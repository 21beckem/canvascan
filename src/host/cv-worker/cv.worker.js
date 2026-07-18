/**
 * cv.worker.js
 *
 * Worker entry point. This is intentionally a CLASSIC (non-module) dedicated
 * worker — see the note in FeatureMatcher.js for why: it needs synchronous
 * `importScripts()` to load the UMD/Emscripten opencv.js bundle, which is
 * not reliably supported inside module workers across mobile browsers.
 *
 * Instantiated on the main thread via:
 *   new Worker(new URL('./cv-worker/cv.worker.js', import.meta.url))
 * (no `{ type: 'module' }` option — classic worker).
 */

// Mirrors a subset of src/utils/Config.js — see the note there.
const WORKER_CONFIG = Object.freeze({
  DEFAULT_ALGORITHM: 'AKAZE',
  MIN_INLIER_RATIO: 0.15,
  RANSAC_REPROJ_THRESHOLD: 3.0,
  LOWE_RATIO_TEST_THRESHOLD: 0.75,
  FEATHER_MASK_RESOLUTION: 512,
  FEATHER_FRACTION: 0.1,
  ALIGNMENT_WORK_MEGAPIXELS: 1.2,
  OPENCV_JS_CDN_URL:
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
});

let cvReady = false;
let matcher = null;

/** Posts a STATUS message to the main thread. */
function postStatus(stage) {
  self.postMessage({ type: 'STATUS', stage });
}

postStatus('loading_wasm');

// Load our own classic-script helper classes into this global scope.
importScripts('./FeatureMatcher.js');
importScripts('./FeatherMaskGenerator.js');

// Load OpenCV.js (WASM). The @techstark/opencv-js UMD build assigns a global
// `cv`, which is either used directly once `cv.onRuntimeInitialized` fires,
// or (in some builds) is itself a Promise that resolves to the real module.
importScripts(WORKER_CONFIG.OPENCV_JS_CDN_URL);

function onCvReady() {
  if (cvReady) return;
  cvReady = true;
  matcher = new FeatureMatcher(WORKER_CONFIG.DEFAULT_ALGORITHM);
  self.postMessage({ type: 'READY' });
}

if (typeof cv !== 'undefined' && typeof cv.then === 'function') {
  // Promise-based module export style.
  cv.then((resolvedCv) => {
    self.cv = resolvedCv;
    onCvReady();
  });
} else if (typeof cv !== 'undefined') {
  // Emscripten callback style.
  cv['onRuntimeInitialized'] = onCvReady;
} else {
  self.postMessage({
    type: 'ANCHOR_FAILED',
    reason: 'OpenCV.js failed to load from the CDN.',
  });
}

/**
 * Handles a SET_ANCHOR request end-to-end, posting ANCHOR_READY or
 * ANCHOR_FAILED.
 * @param {ImageBitmap} imageBitmap
 */
function handleSetAnchor(imageBitmap) {
  postStatus('extracting');
  try {
    const { keypointCount } = matcher.setAnchor(imageBitmap);
    self.postMessage({ type: 'ANCHOR_READY', keypointCount });
  } catch (err) {
    self.postMessage({
      type: 'ANCHOR_FAILED',
      reason: err.message || 'Could not process the anchor photo.',
    });
  } finally {
    imageBitmap.close();
  }
}

/**
 * Handles a PROCESS_DETAIL request end-to-end, posting DETAIL_RESULT or
 * DETAIL_FAILED.
 * @param {ImageBitmap} imageBitmap
 * @param {string} detailId
 */
function handleProcessDetail(imageBitmap, detailId) {
  postStatus('extracting');
  try {
    postStatus('matching');
    const result = matcher.matchDetail(imageBitmap);

    postStatus('ransac');
    postStatus('feathering');

    const featherMask = FeatherMaskGenerator.generate(
      result.homography,
      result.detailWidth,
      result.detailHeight
    );

    self.postMessage(
      {
        type: 'DETAIL_RESULT',
        detailId,
        homography: result.homography,
        inlierRatio: result.inlierRatio,
        featherMask,
        matchedKeypointCount: result.matchedKeypointCount,
        detailWidth: result.detailWidth,
        detailHeight: result.detailHeight,
      },
      [featherMask.data.buffer]
    );
  } catch (err) {
    self.postMessage({
      type: 'DETAIL_FAILED',
      detailId,
      reason: err.message || 'Alignment failed for this photo.',
    });
  } finally {
    imageBitmap.close();
  }
}

self.onmessage = (event) => {
  const msg = event.data;

  switch (msg.type) {
    case 'INIT':
      // OpenCV loading begins automatically at worker startup; nothing
      // additional to do here. READY is posted once cv finishes init.
      break;

    case 'SET_ANCHOR':
      if (!cvReady) {
        self.postMessage({ type: 'ANCHOR_FAILED', reason: 'OpenCV is not ready yet.' });
        break;
      }
      handleSetAnchor(msg.imageBitmap);
      break;

    case 'PROCESS_DETAIL':
      if (!cvReady) {
        self.postMessage({
          type: 'DETAIL_FAILED',
          detailId: msg.detailId,
          reason: 'OpenCV is not ready yet.',
        });
        break;
      }
      handleProcessDetail(msg.imageBitmap, msg.detailId);
      break;

    case 'SET_ALGORITHM':
      if (matcher) {
        matcher.setAlgorithm(msg.algorithm);
      }
      break;

    case 'TERMINATE':
      matcher?.dispose();
      self.close();
      break;

    default:
      // Unknown message types are ignored rather than throwing, so a
      // forward-compatible main thread can't crash the worker.
      break;
  }
};
