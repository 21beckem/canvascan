import { Type } from '../shared/utils/Type.js';
import { Config } from '../shared/utils/Config.js';
import { AppStateMachine, AppState } from '../shared/state/AppStateMachine.js';
import { StatusOverlay } from '../shared/ui/StatusOverlay.js';
import { PhotoCodec } from '../shared/transfer/PhotoCodec.js';
import { PhotoTransfer, makePhotoId } from '../shared/transfer/PhotoTransfer.js';
import { CameraController } from '../shared/camera/CameraController.js';
import { FrameGrabber } from '../shared/capture/FrameGrabber.js';
import { RemoteScannerUIController } from './RemoteScannerUIController.js';
import { PeerScannerManager } from './PeerScannerManager.js';

/**
 * RemoteScannerApp.js
 * Composition root for scanner.html's remote/connected mode — the phone
 * side of the phone/computer split architecture. Deliberately thin: no
 * OpenCV, no WebGL2, no tiled rendering. It only captures full-resolution
 * frames and ships them to the host over a PeerJS DataConnection; all
 * processing happens on the computer. Any number of phones can run this
 * page against the same host at once (pooled capture) — see HostApp.js for
 * the session-sharing logic. Instantiated by ScannerApp.js's router when
 * the URL has a real `?peer=<hostId>` (as opposed to `?peer=none`, which
 * routes to StandaloneApp.js instead).
 */
export class RemoteScannerApp {
  #stateMachine;
  #ui;
  #statusOverlay;
  #camera;
  #peerScanner;
  #videoElement;
  #cameraReady;
  #peerConnected;
  #anchorEstablished;

  constructor() {
    this.#stateMachine = AppStateMachine.create();
    this.#cameraReady = false;
    this.#peerConnected = false;
    this.#anchorEstablished = false;
  }

  async start() {
    this.#videoElement = document.getElementById('camera-video');

    this.#ui = new RemoteScannerUIController({
      panelSetup: document.getElementById('panel-setup'),
      panelAnchor: document.getElementById('panel-anchor'),
      panelDetails: document.getElementById('panel-details'),
      captureAnchorBtn: document.getElementById('capture-anchor-btn'),
      captureDetailBtn: document.getElementById('capture-detail-btn'),
      retryCameraBtn: document.getElementById('retry-camera-btn'),
      switchCameraBtn: document.getElementById('switch-camera-btn'),
      setupMessageEl: document.getElementById('setup-message'),
    });
    this.#ui.bindStateMachine(this.#stateMachine);
    this.#ui.wireCallbacks({
      onCaptureAnchor: () => this.#handleCaptureAnchor(),
      onCaptureDetail: () => this.#handleCaptureDetail(),
      onRetryCamera: () => this.#initCamera(),
      onSwitchCamera: () => this.#handleSwitchCamera(),
    });
    this.#ui.setAnchorBusy(true);

    this.#statusOverlay = new StatusOverlay({
      statusEl: document.getElementById('status-overlay'),
      statusTextEl: document.getElementById('status-text'),
      toastEl: document.getElementById('toast'),
      toastTextEl: document.getElementById('toast-text'),
    });

    const hostPeerId = new URLSearchParams(window.location.search).get(
      Config.PEER_ID_QUERY_PARAM
    );
    if (!hostPeerId) {
      this.#ui.showSetupError('No pairing code found. Scan the QR code shown on the computer.');
      return;
    }

    this.#ui.showSetupMessage('Connecting to computer…');
    this.#initPeerScanner(hostPeerId);
    await this.#initCamera();
  }

  #initPeerScanner(hostPeerId) {
    Type.check({ hostPeerId }, 'string');
    this.#peerScanner = new PeerScannerManager({
      hostPeerId,
      onConnected: () => {
        this.#peerConnected = true;
        this.#tryEnterSession();
      },
      onDisconnected: () => {
        this.#peerConnected = false;
        this.#ui.setAnchorBusy(true);
        this.#ui.setDetailCaptureEnabled(false);
        this.#statusOverlay.showError(
          'Disconnected from the computer. Reload this page (or re-scan the QR code) to reconnect.',
          60000
        );
      },
      onMessage: (data) => this.#handleHostMessage(data),
      onError: (err) => {
        Type.check({ err }, Error);
        if (!this.#peerConnected) {
          this.#ui.showSetupError('Could not connect to the computer. Try scanning the QR code again.');
        } else {
          this.#statusOverlay.showError('Connection error.', 6000, err);
        }
      },
    });
  }

  #handleHostMessage(o) {
    Type.check({ parameters: o }, 'object');
    const { type, reason, success } = o;
    Type.check({ type, reason }, 'string');
    Type.check({ success }, 'boolean');

    switch (type) {
      case 'ANCHOR_ESTABLISHED':
        this.#anchorEstablished = true;
        if (this.#stateMachine.is(AppState.CAPTURE_ANCHOR)) {
          this.#ui.setAnchorBusy(false);
          this.#ui.lockCameraSwitching();
          this.#stateMachine.transition(AppState.CAPTURE_DETAILS);
        } else {
          this.#tryEnterSession();
        }
        break;

      case 'ANCHOR_FAILED':
        this.#statusOverlay.showError(reason || 'The anchor photo could not be processed.');
        this.#ui.setAnchorBusy(false);
        break;

      case 'ANCHOR_BUSY':
        this.#statusOverlay.showError('Another phone is setting the anchor — try again in a moment.');
        this.#ui.setAnchorBusy(false);
        break;

      case 'DETAIL_ACK':
        if (!success) {
          this.#statusOverlay.showError(reason || 'That detail photo could not be aligned.');
        }
        break;

      default:
        break;
    }
  }

  async #initCamera() {
    try {
      this.#camera = await CameraController.create();
      await this.#camera.attach(this.#videoElement);
      this.#cameraReady = true;
      this.#tryEnterSession();
    } catch (err) {
      this.#ui.showSetupError(err.userMessage || 'Could not start the camera.');
    }
  }

  /** Advances out of SETUP_CAMERA once BOTH the peer connection and camera are ready. */
  #tryEnterSession() {
    if (!this.#peerConnected || !this.#cameraReady) return;
    if (!this.#stateMachine.is(AppState.SETUP_CAMERA)) return;

    if (this.#anchorEstablished) {
      this.#ui.lockCameraSwitching();
      this.#stateMachine.transition(AppState.CAPTURE_DETAILS);
    } else {
      this.#ui.setAnchorBusy(false);
      this.#stateMachine.transition(AppState.CAPTURE_ANCHOR);
    }
  }

  async #handleCaptureAnchor() {
    this.#ui.setAnchorBusy(true);
    try {
      const bitmap = await FrameGrabber.grabFullResolution(this.#videoElement);
      const encoded = await PhotoCodec.encode(bitmap);
      bitmap.close();

      this.#statusOverlay.setStage('sending');
      await PhotoTransfer.sendPhoto(this.#peerScanner.connection, {
        photoId: makePhotoId(this.#peerScanner.peerId),
        kind: 'ANCHOR',
        ...encoded,
      });
      this.#statusOverlay.hide();
      // Stays busy until the host replies with ANCHOR_ESTABLISHED / _FAILED / _BUSY.
    } catch (err) {
      this.#statusOverlay.showError(err.userMessage || 'Could not capture the anchor photo.', 6000, err);
      this.#ui.setAnchorBusy(false);
    }
  }

  async #handleCaptureDetail() {
    try {
      const bitmap = await FrameGrabber.grabFullResolution(this.#videoElement);
      const encoded = await PhotoCodec.encode(bitmap);
      bitmap.close();

      this.#statusOverlay.setStage('sending');
      await PhotoTransfer.sendPhoto(this.#peerScanner.connection, {
        photoId: makePhotoId(this.#peerScanner.peerId),
        kind: 'DETAIL',
        ...encoded,
      });
      this.#statusOverlay.hide();
    } catch (err) {
      this.#statusOverlay.showError(err.userMessage || 'Could not capture the detail photo.', 6000, err);
    }
  }

  async #handleSwitchCamera() {
    this.#ui.setAnchorBusy(true);
    try {
      await this.#camera.cycleToNextDevice();
    } catch (err) {
      this.#statusOverlay.showError(err.userMessage || 'Could not switch cameras.', 6000, err);
    } finally {
      this.#ui.setAnchorBusy(false);
    }
  }
}

