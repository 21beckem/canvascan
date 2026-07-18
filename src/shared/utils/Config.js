/**
 * Config.js
 * Centralized, immutable constants for the Canvascan application.
 *
 * NOTE ON WORKER DUPLICATION:
 * `cv.worker.js` runs as a CLASSIC (non-module) Web Worker so that it can use
 * `importScripts()` to synchronously load the UMD/Emscripten-built opencv.js
 * bundle (module workers with importScripts are unsupported or unreliable on
 * several mobile browsers, notably older iOS Safari). Because classic worker
 * scripts cannot use `import`/`export`, the small subset of constants the
 * worker needs (RANSAC threshold, ratio-test threshold, inlier ratio, feather
 * resolution, algorithm default, CDN URL) are duplicated as plain values at
 * the top of `cv.worker.js`. If you change a value here, update the mirrored
 * constant there too. Everything on the main thread imports from this file.
 */

export class Config {
  /**
   * Target length (px) of the LONGER edge of the Master Canvas. The actual
   * master width/height are computed at runtime (once the anchor photo is
   * captured) to match the anchor's aspect ratio exactly — the canvas is no
   * longer forced square. See WebGL2Renderer#configureForAnchor.
   */
  static LONG_EDGE_TARGET = 8192;

  /** Size (px, square) of a single WebGL2 tile texture/framebuffer. */
  static TILE_SIZE = 2048;

  /** Default feature detector algorithm. */
  static DEFAULT_ALGORITHM = 'AKAZE';

  /** Minimum inlierCount/totalMatches ratio to accept a homography. */
  static MIN_INLIER_RATIO = 0.15;

  /** RANSAC reprojection error threshold (px) passed to cv.findHomography. */
  static RANSAC_REPROJ_THRESHOLD = 3.0;

  /** Lowe's ratio test threshold for pruning weak knn matches. */
  static LOWE_RATIO_TEST_THRESHOLD = 0.75;

  /** Fixed JPEG export quality (not user-adjustable). */
  static JPEG_EXPORT_QUALITY = 0.92;

  /** Pinned OpenCV.js (WASM) CDN URL — do not use @latest. */
  static OPENCV_JS_CDN_URL =
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';

  /** Square resolution (px) of the reduced-resolution feather alpha mask. */
  static FEATHER_MASK_RESOLUTION = 512;

  /** Fraction of the distance-transform range over which the feather ramps. */
  static FEATHER_FRACTION = 0.1;

  /**
   * Feature detection/matching runs on a DOWNSCALED copy of each photo,
   * capped to this many megapixels, then the resulting homography is
   * rescaled back to full-resolution coordinates (see FeatureMatcher.js).
   * AKAZE's cost rises sharply with resolution, and brute-force matching
   * cost scales with (keypoints in A) x (keypoints in B), so this is the
   * single biggest lever for alignment speed — a high-megapixel webcam or
   * phone photo otherwise pays for detail no alignment step needs.
   * This mirrors OpenCV's own reference Stitcher pipeline, which downscales
   * to a "work_megapix" budget (default 0.6MP) for registration and only
   * uses full/compose resolution for final blending. 1.2MP here is a bit
   * more generous than OpenCV's default, since painting/canvas texture can
   * be more repetitive than typical panorama subjects and benefits from a
   * few more distinctive keypoints. Actual compositing is NEVER downscaled.
   */
  static ALIGNMENT_WORK_MEGAPIXELS = 1.2;

  /** Preferred camera capture resolution hints (device may report less). */
  static CAMERA_IDEAL_WIDTH = 4096;
  static CAMERA_IDEAL_HEIGHT = 2160;

  /**
   * How photos are encoded before being sent phone -> computer.
   *   'raw'  — full-quality RGBA pixels, no compression. Larger transfer,
   *            zero quality loss. DEFAULT, since detail photos are the
   *            actual source pixels composited into the final export.
   *   'jpeg' — compressed with PHOTO_TRANSFER_JPEG_QUALITY below. Much
   *            smaller/faster transfer, minor generational quality loss.
   * Change this one line to switch the whole app's transfer behavior.
   */
  static PHOTO_TRANSFER_FORMAT = 'raw';

  /** JPEG quality used only when PHOTO_TRANSFER_FORMAT === 'jpeg'. */
  static PHOTO_TRANSFER_JPEG_QUALITY = 0.95;

  /**
   * Application-level chunk size (bytes) for splitting a photo's binary
   * payload across multiple PeerJS DataConnection messages. Raw photos can
   * be tens of MB (e.g. a 4032x3024 RGBA frame is ~48MB); relying solely on
   * a library's internal chunking is riskier than chunking explicitly
   * ourselves at a conservative size well under typical WebRTC data channel
   * message limits.
   */
  static TRANSFER_CHUNK_SIZE = 256 * 1024;

  /**
   * RTCDataChannel.bufferedAmount (bytes) above which the sender pauses and
   * waits before queuing more chunks, to avoid overwhelming the channel.
   */
  static TRANSFER_BACKPRESSURE_THRESHOLD = 4 * 1024 * 1024;

  /** Pinned PeerJS CDN URL (loaded via a classic <script> tag). */
  static PEERJS_CDN_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';

  /** Pinned QRCode-generation CDN URL (loaded via a classic <script> tag). */
  static QRCODE_CDN_URL = 'https://cdn.jsdelivr.net/npm/davidshimjs-qrcodejs@0.0.2/qrcode.min.js';

  /**
   * Query-string key on scanner.html that carries the host's PeerJS id,
   * e.g. scanner.html?peer=abc123.
   */
  static PEER_ID_QUERY_PARAM = 'peer';
}
