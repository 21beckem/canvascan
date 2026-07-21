import { Type } from '../utils/Type.js';
import { WebGL2Renderer } from '../render/WebGL2Renderer.js';
import { ProgressMap } from '../ui/ProgressMap.js';
import { CanvasExporter } from '../export/CanvasExporter.js';

/**
 * SessionPipeline.js
 * The transport-agnostic core of a Canvascan session: owns the OpenCV
 * worker, the WebGL2 tiled renderer, and the progress-grid, and drives the
 * anchor/detail-queue state machine. It knows nothing about where photos
 * come from (PeerJS, or a local camera) — callers submit photos via
 * `submitAnchor`/`submitDetail` and get results back through callbacks.
 *
 * This exists so HostApp.js (computer, receives photos over PeerJS from any
 * number of pooled phones) and StandaloneApp.js (phone-only mode, captures
 * locally) can share one implementation of "the actual processing" rather
 * than maintaining two copies of the same worker/renderer/queue logic.
 *
 * An opaque `tag` can be passed to submitAnchor/submitDetail and is threaded
 * back through the corresponding callback unchanged — HostApp uses this to
 * remember which phone (peerId) submitted which photo, so it can route
 * per-sender acks; StandaloneApp just leaves it undefined.
 */
export class SessionPipeline {
  #worker;
  #renderer;
  #progressMap;
  #callbacks;
  #cvReady;
  #hasAnchor;
  #anchorInFlight;
  #anchorTag;
  #totalDetailCount;
  #completedDetailCount;
  #pendingDetails; // photoId -> { bitmap, tag }

  /**
   * @param {{
   *   glCanvasElement: HTMLCanvasElement,
   *   progressMapElement: HTMLCanvasElement,
   *   progressMapMaxDim?: number,
   *   callbacks: {
   *     onStatus?: (stage: string) => void,
   *     onReady?: () => void,
   *     onWorkerError?: (event: ErrorEvent) => void,
   *     onAnchorReady?: (size: {outputWidth:number, outputHeight:number, gridCols:number, gridRows:number}, tag: unknown) => void,
   *     onAnchorFailed?: (reason: string, tag: unknown) => void,
   *     onDetailResult?: (bbox: object, tag: unknown, photoId: string) => void,
   *     onDetailFailed?: (reason: string, tag: unknown, photoId: string) => void,
   *     onQueueChanged?: (completed: number, total: number) => void,
   *     onQueueDrained?: () => void,
   *   },
   * }} params
   */
  constructor(o) {
    Type.check({ parameters: o }, 'object');
    const { glCanvasElement, progressMapElement, progressMapMaxDim, callbacks } = o;
    Type.check({ glCanvasElement }, HTMLCanvasElement);
    Type.check({ progressMapElement }, HTMLCanvasElement);
    Type.check({ progressMapMaxDim }, 'number');
    Type.check({ callbacks }, 'object');
    Type.check({
      onStatus: callbacks.onStatus,
      onReady: callbacks.onReady,
      onWorkerError: callbacks.onWorkerError,
      onAnchorReady: callbacks.onAnchorReady,
      onAnchorFailed: callbacks.onAnchorFailed,
      onDetailResult: callbacks.onDetailResult,
      onDetailFailed: callbacks.onDetailFailed,
      onQueueChanged: callbacks.onQueueChanged,
      onQueueDrained: callbacks.onQueueDrained,
    }, 'function');


    this.#callbacks = callbacks;
    this.#cvReady = false;
    this.#hasAnchor = false;
    this.#anchorInFlight = false;
    this.#anchorTag = null;
    this.#totalDetailCount = 0;
    this.#completedDetailCount = 0;
    this.#pendingDetails = new Map();

    this.#renderer = WebGL2Renderer.create(glCanvasElement);
    this.#progressMap = new ProgressMap(progressMapElement, progressMapMaxDim);

    this.#worker = new Worker(new URL('../cv-worker/cv.worker.js', import.meta.url));
    this.#worker.postMessage({ type: 'INIT' });
    this.#worker.onmessage = (event) => this.#handleWorkerMessage(event.data);
    this.#worker.onerror = (event) => this.#callbacks.onWorkerError(event);
  }

  /** @returns {boolean} whether the OpenCV worker has finished loading. */
  get isReady() {
    return this.#cvReady;
  }

  /** @returns {boolean} whether this session has an anchor yet. */
  get hasAnchor() {
    return this.#hasAnchor;
  }

  /**
   * Attempts to set the session anchor from a captured photo. Rejects
   * synchronously (without touching the renderer/worker) if an anchor
   * already exists or another submission is already in flight — callers
   * that need to notify a specific submitter of that (e.g. HostApp telling
   * a losing phone "ANCHOR_BUSY") can do so using the returned reason.
   * @param {ImageBitmap} bitmap ownership transfers to the worker; caller must not reuse it.
   * @param {unknown} [tag] opaque value threaded back through onAnchorReady/onAnchorFailed.
   * @returns {{accepted: boolean, reason?: 'ANCHOR_ALREADY_SET'|'ANCHOR_IN_FLIGHT'}}
   */
  submitAnchor(bitmap, tag = undefined) {
    Type.check({ bitmap }, ImageBitmap);
    if (tag !== undefined) Type.check({ tag }, 'string');
    if (this.#hasAnchor) return { accepted: false, reason: 'ANCHOR_ALREADY_SET' };
    if (this.#anchorInFlight) return { accepted: false, reason: 'ANCHOR_IN_FLIGHT' };

    this.#anchorInFlight = true;
    this.#anchorTag = tag;
    this.#renderer.configureForAnchor(bitmap);
    this.#worker.postMessage({ type: 'SET_ANCHOR', imageBitmap: bitmap }, [bitmap]);
    return { accepted: true };
  }

  /**
   * Queues a detail photo for alignment/stitching. The worker processes
   * queued photos one at a time, in submission order, so callers may submit
   * as many as they like without waiting for earlier ones to finish.
   * @param {string} photoId globally-unique id for this photo.
   * @param {ImageBitmap} bitmap NOT transferred — the pipeline keeps this
   *   reference to composite it once the worker's alignment result arrives.
   * @param {unknown} [tag] opaque value threaded back through onDetailResult/onDetailFailed.
   * @returns {{accepted: boolean, reason?: 'NO_ANCHOR'}}
   */
  submitDetail(photoId, bitmap, tag = undefined) {
    Type.check({ photoId }, 'string');
    Type.check({ bitmap }, ImageBitmap);
    if (tag !== undefined) Type.check({ tag }, 'string');
    if (!this.#hasAnchor) return { accepted: false, reason: 'NO_ANCHOR' };

    this.#pendingDetails.set(photoId, { bitmap, tag });
    this.#totalDetailCount++;
    this.#callbacks.onQueueChanged(this.#completedDetailCount, this.#totalDetailCount);
    this.#worker.postMessage({ type: 'PROCESS_DETAIL', detailId: photoId, imageBitmap: bitmap });
    return { accepted: true };
  }

  /** Composites all tiles and triggers a JPEG download. @param {string} [filename] */
  async exportComposite(filename = null) {
    if (filename !== null) Type.check({ filename }, 'string');
    return filename !== null
      ? CanvasExporter.downloadComposite(this.#renderer, filename)
      : CanvasExporter.downloadComposite(this.#renderer);
  }

  #handleWorkerMessage(msg) {
    Type.check({ msg }, 'object');

    switch (msg.type) {
      case 'STATUS':
        this.#callbacks.onStatus(msg.stage);
        break;

      case 'READY':
        this.#cvReady = true;
        this.#callbacks.onReady();
        break;

      case 'ANCHOR_READY':
        this.#handleAnchorReady();
        break;

      case 'ANCHOR_FAILED': {
        this.#anchorInFlight = false;
        const tag = this.#anchorTag;
        this.#anchorTag = null;
        this.#callbacks.onAnchorFailed(msg.reason, tag);
        break;
      }

      case 'DETAIL_RESULT':
        this.#applyDetailResult(msg);
        break;

      case 'DETAIL_FAILED': {
        const entry = this.#pendingDetails.get(msg.detailId);
        this.#pendingDetails.delete(msg.detailId);
        entry?.bitmap?.close();
        this.#callbacks.onDetailFailed(msg.reason, entry?.tag, msg.detailId);
        this.#advanceQueue();
        break;
      }

      default:
        break;
    }
  }

  #handleAnchorReady() {
    const { width: outputWidth, height: outputHeight } = this.#renderer.outputSize;
    const { gridCols, gridRows } = this.#renderer.tileManager;

    this.#progressMap.configure({ outputWidth, outputHeight, gridCols, gridRows });
    this.#progressMap.markAnchorPainted();

    this.#hasAnchor = true;
    this.#anchorInFlight = false;
    this.#totalDetailCount = 0;
    this.#completedDetailCount = 0;

    const tag = this.#anchorTag;
    this.#anchorTag = null;
    this.#callbacks.onAnchorReady({ outputWidth, outputHeight, gridCols, gridRows }, tag);
  }

  #applyDetailResult(msg) {
    Type.check({ msg }, 'object');
    const entry = this.#pendingDetails.get(msg.detailId);
    this.#pendingDetails.delete(msg.detailId);

    try {
      const bbox = this.#renderer.stitchDetail({
        detailBitmap: entry?.bitmap,
        homography: msg.homography,
        featherMask: msg.featherMask,
        detailWidth: msg.detailWidth,
        detailHeight: msg.detailHeight,
      });
      this.#progressMap.markStitched(bbox);
      this.#callbacks.onDetailResult(bbox, entry?.tag, msg.detailId);
    } finally {
      entry?.bitmap?.close();
      this.#advanceQueue();
    }
  }

  #advanceQueue() {
    this.#completedDetailCount++;
    this.#callbacks.onQueueChanged(this.#completedDetailCount, this.#totalDetailCount);
    if (this.#completedDetailCount >= this.#totalDetailCount) {
      this.#callbacks.onQueueDrained();
    }
  }
}
