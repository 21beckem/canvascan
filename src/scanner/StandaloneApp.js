import { AppStateMachine, AppState } from '../shared/state/AppStateMachine.js';
import { StatusOverlay } from '../shared/ui/StatusOverlay.js';
import { SessionPipeline } from '../shared/pipeline/SessionPipeline.js';
import { CameraController } from '../shared/camera/CameraController.js';
import { FrameGrabber } from '../shared/capture/FrameGrabber.js';
import { StandaloneUIController } from './StandaloneUIController.js';

let detailCounter = 0;

/**
 * StandaloneApp.js
 * Composition root for scanner.html in phone-only mode (`?peer=none`, or the
 * "New Scan" button on a phone directly, per index.html's device-based
 * routing). Everything runs on this single page: local camera capture AND
 * the full SessionPipeline (OpenCV worker, WebGL2 renderer, export) — no
 * PeerJS, no networking at all. This is "the app as it worked before the
 * phone/computer split," rebuilt on the pipeline now shared with HostApp.js.
 */
export class StandaloneApp {
  #stateMachine;
  #ui;
  #statusOverlay;
  #pipeline;
  #camera;
  #videoElement;
  #cvReady;

  constructor() {
    this.#stateMachine = AppStateMachine.create();
    this.#cvReady = false;
  }

  async start() {
    this.#videoElement = document.getElementById('camera-video');

    this.#ui = new StandaloneUIController({
      panelSetup: document.getElementById('panel-setup'),
      panelAnchor: document.getElementById('panel-anchor'),
      panelDetails: document.getElementById('panel-details'),
      captureAnchorBtn: document.getElementById('capture-anchor-btn'),
      captureDetailBtn: document.getElementById('capture-detail-btn'),
      retryCameraBtn: document.getElementById('retry-camera-btn'),
      switchCameraBtn: document.getElementById('switch-camera-btn'),
      setupMessageEl: document.getElementById('setup-message'),
      progressMapEl: document.getElementById('progress-map'),
      exportBtn: document.getElementById('export-btn'),
    });
    this.#ui.bindStateMachine(this.#stateMachine);
    this.#ui.wireCallbacks({
      onCaptureAnchor: () => this.#handleCaptureAnchor(),
      onCaptureDetail: () => this.#handleCaptureDetail(),
      onRetryCamera: () => this.#initCamera(),
      onSwitchCamera: () => this.#handleSwitchCamera(),
      onExport: () => this.#handleExport(),
    });
    this.#ui.setAnchorBusy(true); // stays disabled until camera + worker are ready
    this.#ui.setExportEnabled(false);

    this.#statusOverlay = new StatusOverlay({
      statusEl: document.getElementById('status-overlay'),
      statusTextEl: document.getElementById('status-text'),
      toastEl: document.getElementById('toast'),
      toastTextEl: document.getElementById('toast-text'),
      queueBadgeEl: document.getElementById('queue-badge'),
      queueBadgeTextEl: document.getElementById('queue-badge-text'),
    });

    this.#pipeline = new SessionPipeline({
      glCanvasElement: document.getElementById('gl-canvas'),
      progressMapElement: document.getElementById('progress-map'),
      progressMapMaxDim: 90,
      callbacks: {
        onStatus: (stage) => this.#statusOverlay.setStage(stage),
        onReady: () => {
          this.#cvReady = true;
          this.#statusOverlay.hide();
          this.#maybeUnlockControls();
        },
        onWorkerError: (event) =>
          this.#statusOverlay.showError(
            'The vision engine crashed. Reload the page to continue.',
            6000,
            event
          ),
        onAnchorReady: () => this.#handleAnchorReady(),
        onAnchorFailed: (reason) => {
          this.#statusOverlay.hide();
          this.#statusOverlay.showError(reason);
          this.#ui.setAnchorBusy(false);
        },
        onDetailFailed: (reason) => this.#statusOverlay.showError(reason),
        onQueueChanged: (completed, total) => {
          this.#statusOverlay.setQueueProgress(completed, total);
          this.#ui.setExportEnabled(completed >= total);
        },
        onQueueDrained: () => this.#statusOverlay.hide(),
        onDetailResult: () => {}
      },
    });

    await this.#initCamera();
  }

  async #initCamera() {
    this.#ui.showSetupMessage('Requesting camera access…');
    try {
      this.#camera = await CameraController.create();
      await this.#camera.attach(this.#videoElement);
      this.#maybeUnlockControls();
      if (this.#stateMachine.is(AppState.SETUP_CAMERA)) {
        this.#stateMachine.transition(AppState.CAPTURE_ANCHOR);
      }
    } catch (err) {
      this.#ui.showSetupError(err.userMessage || 'Could not start the camera.');
    }
  }

  /** Only enables capture controls once BOTH camera and CV worker are ready. */
  #maybeUnlockControls() {
    if (this.#camera && this.#cvReady) {
      this.#ui.setAnchorBusy(false);
    }
  }

  async #handleCaptureAnchor() {
    this.#ui.setAnchorBusy(true);
    try {
      const bitmap = await FrameGrabber.grabFullResolution(this.#videoElement);
      const result = this.#pipeline.submitAnchor(bitmap);
      if (!result.accepted) {
        bitmap.close();
        this.#statusOverlay.showError('Could not set the anchor right now — try again.');
        this.#ui.setAnchorBusy(false);
      }
      // else: stays busy until onAnchorReady/onAnchorFailed fires.
    } catch (err) {
      this.#statusOverlay.showError(err.userMessage || 'Could not capture the anchor photo.', 6000, err);
      this.#ui.setAnchorBusy(false);
    }
  }

  #handleAnchorReady() {
    this.#statusOverlay.hide();
    this.#ui.setAnchorBusy(false);
    this.#ui.lockCameraSwitching();
    this.#ui.setExportEnabled(true);
    this.#stateMachine.transition(AppState.CAPTURE_DETAILS);
  }

  async #handleCaptureDetail() {
    try {
      const bitmap = await FrameGrabber.grabFullResolution(this.#videoElement);
      const photoId = `detail-${++detailCounter}`;
      const result = this.#pipeline.submitDetail(photoId, bitmap);
      if (!result.accepted) {
        bitmap.close();
      }
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

  async #handleExport() {
    this.#ui.setExportEnabled(false);
    try {
      await this.#pipeline.exportComposite();
    } catch (err) {
      this.#statusOverlay.showError('Could not export the final image.', 6000, err);
    } finally {
      this.#ui.setExportEnabled(true);
    }
  }
}
