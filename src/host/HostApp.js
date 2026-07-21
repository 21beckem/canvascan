import { Type } from '../shared/utils/Type.js';
import { Config } from '../shared/utils/Config.js';
import { StatusOverlay } from '../shared/ui/StatusOverlay.js';
import { PhotoCodec } from '../shared/transfer/PhotoCodec.js';
import { PhotoReceiver } from '../shared/transfer/PhotoTransfer.js';
import { SessionPipeline } from '../shared/pipeline/SessionPipeline.js';
import { HostUIController } from './HostUIController.js';
import { PeerHostManager } from './PeerHostManager.js';
import { QRCodeView } from './qrcode/QRCodeView.js';

/**
 * HostApp.js
 * Composition root for host.html — the computer side of the phone/computer
 * split architecture. All of "the actual processing" (OpenCV worker, WebGL2
 * tiled renderer, progress grid, export) lives in SessionPipeline, shared
 * with StandaloneApp.js (phone-only mode); this file's job is purely the
 * PeerJS transport and pooled multi-phone session bookkeeping — routing
 * each phone's photos into the pipeline and routing acks back to the right
 * phone (using that phone's peerId as the pipeline's opaque "tag").
 */
class HostApp {
  #ui;
  #statusOverlay;
  #pipeline;
  #peerHost;
  #photoReceiver;
  #qrCodeView;

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

    this.#pipeline = new SessionPipeline({
      glCanvasElement: document.getElementById('gl-canvas'),
      progressMapElement: document.getElementById('progress-map'),
      progressMapMaxDim: 640,
      callbacks: {
        onStatus: (stage) => this.#statusOverlay.setStage(stage),
        onReady: () => this.#statusOverlay.hide(),
        onWorkerError: (event) =>
          this.#statusOverlay.showError(
            'The vision engine crashed. Reload the page to continue.',
            6000,
            event
          ),
        onAnchorReady: () => this.#handleAnchorReady(),
        onAnchorFailed: (reason, tag) => this.#handleAnchorFailed(reason, tag),
        onDetailResult: (_bbox, tag, photoId) => this.#handleDetailResult(tag, photoId),
        onDetailFailed: (reason, tag, photoId) => this.#handleDetailFailed(reason, tag, photoId),
        onQueueChanged: (completed, total) => {
          this.#statusOverlay.setQueueProgress(completed, total);
          this.#ui.setExportEnabled(completed >= total);
        },
        onQueueDrained: () => this.#statusOverlay.hide(),
      },
    });

    this.#photoReceiver = new PhotoReceiver((payload) => this.#handlePhotoComplete(payload));
    this.#qrCodeView = new QRCodeView(document.getElementById('qr-code'));

    this.#initPeerHost();
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
        if (this.#pipeline.hasAnchor) {
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
    Type.check({ hostPeerId }, 'string');
    const scannerUrl = new URL('scanner.html', window.location.href);
    scannerUrl.searchParams.set(Config.PEER_ID_QUERY_PARAM, hostPeerId);
    console.log(`Host ready. Scanner URL: ${scannerUrl.toString()}`);
    this.#qrCodeView.render(scannerUrl.toString());
  }

  async #handlePhotoComplete(o) {
    Type.check({ parameters: o }, 'object');
    const { photoId, kind, format, width, height, buffer, senderId } = o;
    Type.check({ photoId, kind, format }, 'string');
    Type.check({ width, height }, 'number');
    Type.check({ buffer }, ArrayBuffer);
    Type.check({ senderId }, 'string');
    
    if (!this.#pipeline.isReady) {
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
      const result = this.#pipeline.submitAnchor(bitmap, senderId);
      if (!result.accepted) {
        // Another phone already has (or is mid-submitting) the anchor.
        const type = result.reason === 'ANCHOR_ALREADY_SET' ? 'ANCHOR_ESTABLISHED' : 'ANCHOR_BUSY';
        this.#peerHost.sendTo(senderId, { type });
        bitmap.close();
      }
      return;
    }

    // kind === 'DETAIL'
    const result = this.#pipeline.submitDetail(photoId, bitmap, senderId);
    if (!result.accepted) {
      bitmap.close(); // defensive: phones shouldn't send details before an anchor exists
    }
  }

  #handleAnchorReady() {
    this.#statusOverlay.hide();
    this.#ui.setHasAnchor(true);
    this.#ui.setExportEnabled(true);
    // Broadcasting to everyone also reaches whichever phone's anchor won,
    // so it doesn't need a separate targeted ack.
    this.#peerHost.broadcast({ type: 'ANCHOR_ESTABLISHED' });
  }

  #handleAnchorFailed(reason, tag) {
    Type.check({ reason, tag }, 'string');
    if (tag) this.#peerHost.sendTo(tag, { type: 'ANCHOR_FAILED', reason });
    this.#statusOverlay.showError(reason);
  }

  #handleDetailResult(tag, photoId) {
    Type.check({ tag, photoId }, 'string');
    if (tag) this.#peerHost.sendTo(tag, { type: 'DETAIL_ACK', photoId, success: true });
  }

  #handleDetailFailed(reason, tag, photoId) {
    if (tag) this.#peerHost.sendTo(tag, { type: 'DETAIL_ACK', photoId, success: false, reason });
    this.#statusOverlay.showError(reason);
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

const app = new HostApp();
app.start();
