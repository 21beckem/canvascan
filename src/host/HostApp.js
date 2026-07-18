import { Config } from '../shared/utils/Config.js';
import { StatusOverlay } from '../shared/ui/StatusOverlay.js';
import { PhotoCodec } from '../shared/transfer/PhotoCodec.js';
import { PhotoReceiver } from '../shared/transfer/PhotoTransfer.js';
import { WebGL2Renderer } from './render/WebGL2Renderer.js';
import { ProgressMap } from './ui/ProgressMap.js';
import { CanvasExporter } from './export/CanvasExporter.js';
import { HostUIController } from './HostUIController.js';
import { PeerHostManager } from './PeerHostManager.js';
import { QRCodeView } from './qrcode/QRCodeView.js';

/**
 * HostApp.js
 * Composition root for host.html — the computer side of the phone/computer
 * split architecture. Owns the WebGL2 tiled renderer, the OpenCV worker, and
 * the pooled PeerJS session: any number of phones may be connected at once,
 * and any of them may contribute the (single, shared) anchor photo or any
 * number of detail photos. The first accepted anchor wins; later phones
 * that try to set one are just told the session's anchor is already set.
 */
class HostApp {
  #ui;
  #statusOverlay;
  #progressMap;
  #renderer;
  #worker;
  #peerHost;
  #photoReceiver;
  #qrCodeView;
  #cvReady;
  #hasAnchor;
  #anchorInFlight;
  #anchorSenderId;
  #totalDetailCount;
  #completedDetailCount;
  #pendingBitmaps; // photoId -> { bitmap: ImageBitmap, senderId: string }

  constructor() {
    this.#cvReady = false;
    this.#hasAnchor = false;
    this.#anchorInFlight = false;
    this.#anchorSenderId = null;
    this.#totalDetailCount = 0;
    this.#completedDetailCount = 0;
    this.#pendingBitmaps = new Map();
  }

  start() {
    this.#ui = new HostUIController({
      qrPanelEl: document.getElementById('qr-panel'),
      connectedCountEl: document.getElementById('connected-count'),
      waitingConnectionEl: document.getElementById('waiting-connection'),
      waitingAnchorEl: document.getElementById('waiting-anchor'),
      sessionActiveEl: document.getElementById('session-active'),
      exportBtn: document.getElementById('export-btn'),
    });
    this.#ui.wireCallbacks({ onExport: () => this.#handleExport() });
    this.#ui.setConnectionCount(0);
    this.#ui.setHasAnchor(false);
    this.#ui.setExportEnabled(false);

    this.#statusOverlay = new StatusOverlay({
      statusEl: document.getElementById('status-overlay'),
      statusTextEl: document.getElementById('status-text'),
      toastEl: document.getElementById('toast'),
      toastTextEl: document.getElementById('toast-text'),
      queueBadgeEl: document.getElementById('queue-badge'),
      queueBadgeTextEl: document.getElementById('queue-badge-text'),
    });

    this.#progressMap = new ProgressMap(document.getElementById('progress-map'), 640);
    this.#renderer = WebGL2Renderer.create(document.getElementById('gl-canvas'));
    this.#photoReceiver = new PhotoReceiver((payload) => this.#handlePhotoComplete(payload));
    this.#qrCodeView = new QRCodeView(document.getElementById('qr-code'));

    this.#initWorker();
    this.#initPeerHost();
  }

  #initWorker() {
    this.#worker = new Worker(new URL('./cv-worker/cv.worker.js', import.meta.url));
    this.#worker.postMessage({ type: 'INIT' });
    this.#worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
    this.#worker.onerror = (event) => {
      this.#statusOverlay.showError(
        'The vision engine crashed. Reload the page to continue.',
        6000,
        event
      );
    };
  }

  #initPeerHost() {
    this.#peerHost = new PeerHostManager({
      onHostReady: (hostPeerId) => this.#handleHostReady(hostPeerId),
      onHostError: (err) =>
        this.#statusOverlay.showError(
          'Could not start the pairing service. Reload the page to try again.',
          8000,
          err
        ),
      onClientConnected: (peerId, count) => {
        this.#ui.setConnectionCount(count);
        if (this.#hasAnchor) {
          // Late joiner: the pooled session already has an anchor, so this
          // phone should skip straight to detail capture.
          this.#peerHost.sendTo(peerId, { type: 'ANCHOR_ESTABLISHED' });
        }
      },
      onClientDisconnected: (peerId, count) => {
        this.#photoReceiver.discardFrom(peerId);
        this.#ui.setConnectionCount(count);
      },
      onMessage: (peerId, data) => this.#photoReceiver.handleMessage(data, peerId),
    });
  }

  #handleHostReady(hostPeerId) {
    const scannerUrl = new URL('scanner.html', window.location.href);
    scannerUrl.searchParams.set(Config.PEER_ID_QUERY_PARAM, hostPeerId);
    console.log(`Host ready. Peer ID: ${hostPeerId}. Scanner URL: ${scannerUrl.toString()}`);
    this.#qrCodeView.render(scannerUrl.toString());
  }

  #handleWorkerMessage(msg) {
    switch (msg.type) {
      case 'STATUS':
        this.#statusOverlay.setStage(msg.stage);
        break;

      case 'READY':
        this.#cvReady = true;
        this.#statusOverlay.hide();
        break;

      case 'ANCHOR_READY':
        this.#handleAnchorReady();
        break;

      case 'ANCHOR_FAILED':
        this.#anchorInFlight = false;
        if (this.#anchorSenderId) {
          this.#peerHost.sendTo(this.#anchorSenderId, { type: 'ANCHOR_FAILED', reason: msg.reason });
        }
        this.#statusOverlay.showError(msg.reason, 6000, msg);
        break;

      case 'DETAIL_RESULT':
        this.#applyDetailResult(msg);
        break;

      case 'DETAIL_FAILED': {
        const entry = this.#pendingBitmaps.get(msg.detailId);
        this.#pendingBitmaps.delete(msg.detailId);
        if (entry?.senderId) {
          this.#peerHost.sendTo(entry.senderId, {
            type: 'DETAIL_ACK',
            photoId: msg.detailId,
            success: false,
            reason: msg.reason,
          });
        }
        this.#statusOverlay.showError(msg.reason, 6000, msg);
        this.#advanceDetailQueue();
        break;
      }

      default:
        break;
    }
  }

  async #handlePhotoComplete({ photoId, kind, format, width, height, buffer, senderId }) {
    if (!this.#cvReady) {
      this.#statusOverlay.showError('Still starting up — try that photo again in a few seconds.');
      return;
    }

    let bitmap;
    try {
      bitmap = await PhotoCodec.decode({ format, width, height, buffer });
    } catch (err) {
      this.#statusOverlay.showError('Received a photo that could not be decoded.', 6000, err);
      return;
    }

    if (kind === 'ANCHOR') {
      if (this.#hasAnchor) {
        // Another phone already established the session's anchor; let this
        // (likely-racing) sender know so its UI can resync.
        this.#peerHost.sendTo(senderId, { type: 'ANCHOR_ESTABLISHED' });
        bitmap.close();
        return;
      }
      if (this.#anchorInFlight) {
        // A different phone's anchor is already being processed right now.
        this.#peerHost.sendTo(senderId, { type: 'ANCHOR_BUSY' });
        bitmap.close();
        return;
      }
      this.#anchorInFlight = true;
      this.#anchorSenderId = senderId;
      this.#renderer.configureForAnchor(bitmap);
      this.#worker.postMessage({ type: 'SET_ANCHOR', imageBitmap: bitmap }, [bitmap]);
      return;
    }

    // kind === 'DETAIL'
    if (!this.#hasAnchor) {
      bitmap.close();
      return; // defensive: phones shouldn't send details before the anchor exists
    }
    this.#pendingBitmaps.set(photoId, { bitmap, senderId });
    this.#totalDetailCount++;
    this.#statusOverlay.setQueueProgress(this.#completedDetailCount, this.#totalDetailCount);
    this.#ui.setExportEnabled(false);
    this.#worker.postMessage({ type: 'PROCESS_DETAIL', detailId: photoId, imageBitmap: bitmap });
  }

  #handleAnchorReady() {
    const { width: outputWidth, height: outputHeight } = this.#renderer.outputSize;
    const { gridCols, gridRows } = this.#renderer.tileManager;

    this.#progressMap.configure({ outputWidth, outputHeight, gridCols, gridRows });
    this.#progressMap.markAnchorPainted();

    this.#hasAnchor = true;
    this.#anchorInFlight = false;
    this.#anchorSenderId = null;
    this.#totalDetailCount = 0;
    this.#completedDetailCount = 0;
    this.#statusOverlay.setQueueProgress(0, 0);
    this.#statusOverlay.hide();

    this.#ui.setHasAnchor(true);
    this.#ui.setExportEnabled(true);
    this.#peerHost.broadcast({ type: 'ANCHOR_ESTABLISHED' });
  }

  #applyDetailResult(msg) {
    const entry = this.#pendingBitmaps.get(msg.detailId);
    this.#pendingBitmaps.delete(msg.detailId);

    try {
      const bbox = this.#renderer.stitchDetail({
        detailBitmap: entry?.bitmap,
        homography: msg.homography,
        featherMask: msg.featherMask,
        detailWidth: msg.detailWidth,
        detailHeight: msg.detailHeight,
      });
      this.#progressMap.markStitched(bbox);
      if (entry?.senderId) {
        this.#peerHost.sendTo(entry.senderId, { type: 'DETAIL_ACK', photoId: msg.detailId, success: true });
      }
    } finally {
      entry?.bitmap?.close();
      this.#advanceDetailQueue();
    }
  }

  #advanceDetailQueue() {
    this.#completedDetailCount++;
    this.#statusOverlay.setQueueProgress(this.#completedDetailCount, this.#totalDetailCount);
    if (this.#completedDetailCount >= this.#totalDetailCount) {
      this.#statusOverlay.hide();
      this.#ui.setExportEnabled(true);
    }
  }

  async #handleExport() {
    this.#ui.setExportEnabled(false);
    try {
      await CanvasExporter.downloadComposite(this.#renderer);
    } catch (err) {
      this.#statusOverlay.showError('Could not export the final image.', 6000, err);
    } finally {
      this.#ui.setExportEnabled(true);
    }
  }
}

const app = new HostApp();
app.start();
