/**
 * FeatureMatcher.js
 *
 * IMPORTANT: This file is loaded into the worker's global scope via
 * `importScripts()` from `cv.worker.js` — it is a CLASSIC script, not an ES
 * module (no `import`/`export`). It relies on the global `cv` object having
 * already been initialized by opencv.js, and on the global `WORKER_CONFIG`
 * object defined at the top of `cv.worker.js`.
 *
 * Encapsulates AKAZE/ORB feature detection, descriptor matching (Lowe ratio
 * test), and RANSAC homography estimation, matched star-topology against a
 * single cached anchor descriptor set.
 *
 * PERFORMANCE NOTE: detection/matching runs on a copy of each photo
 * downscaled to WORKER_CONFIG.ALIGNMENT_WORK_MEGAPIXELS (mirroring OpenCV's
 * own reference Stitcher pipeline, which downscales to a "work_megapix"
 * budget for registration and only composites at full resolution). AKAZE's
 * cost rises sharply with resolution, and brute-force matching cost scales
 * with (keypoints in A) x (keypoints in B), so this is the single biggest
 * lever for alignment speed on a high-megapixel source (a high-res webcam
 * or phone camera). The resulting homography is computed in DOWNSCALED
 * pixel coordinates, so it's algebraically rescaled back to full-resolution
 * coordinates before being returned — see #rescaleHomographyToFullRes.
 * Compositing (in WebGL2Renderer, on the main thread) always uses the full,
 * untouched original photo — only alignment ever sees the smaller copy.
 */
class FeatureMatcher {
  #algorithm;
  #anchorKeypoints;
  #anchorDescriptors;
  #anchorScale;

  /** @param {string} algorithm 'AKAZE' | 'ORB' */
  constructor(algorithm) {
    this.#algorithm = algorithm || WORKER_CONFIG.DEFAULT_ALGORITHM;
    this.#anchorKeypoints = null;
    this.#anchorDescriptors = null;
    this.#anchorScale = null;
  }

  /** @param {'AKAZE'|'ORB'} algorithm */
  setAlgorithm(algorithm) {
    this.#algorithm = algorithm;
  }

  /** @returns {string} */
  getAlgorithm() {
    return this.#algorithm;
  }

  /** Creates a fresh detector instance for the currently active algorithm. */
  #createDetector() {
    if (this.#algorithm === 'ORB') {
      return new cv.ORB(4000);
    }
    // AKAZE default: native MLDB binary descriptor, Hamming-compatible.
    return new cv.AKAZE();
  }

  /**
   * The uniform downscale factor (<=1) that keeps `width x height` within
   * the ALIGNMENT_WORK_MEGAPIXELS budget. Never upscales.
   * @param {number} width
   * @param {number} height
   * @returns {number}
   */
  static #computeWorkScale(width, height) {
    const targetPixels = WORKER_CONFIG.ALIGNMENT_WORK_MEGAPIXELS * 1e6;
    const scale = Math.sqrt(targetPixels / (width * height));
    return Math.min(1, scale);
  }

  /**
   * Decodes an ImageBitmap directly into a DOWNSCALED grayscale cv.Mat.
   * The scaling happens during the canvas draw itself (browsers do this
   * with fast, typically hardware-accelerated resampling), so a
   * full-resolution ImageData/Mat is never materialized at all for
   * alignment purposes.
   * @param {ImageBitmap} imageBitmap
   * @returns {{mat: cv.Mat, scale: number}} caller owns and must `.delete()` the returned Mat.
   */
  #bitmapToScaledGrayMat(imageBitmap) {
    const scale = FeatureMatcher.#computeWorkScale(imageBitmap.width, imageBitmap.height);
    const scaledWidth = Math.max(1, Math.round(imageBitmap.width * scale));
    const scaledHeight = Math.max(1, Math.round(imageBitmap.height * scale));

    const canvas = new OffscreenCanvas(scaledWidth, scaledHeight);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageBitmap, 0, 0, scaledWidth, scaledHeight);
    const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);

    const rgba = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    rgba.delete();
    return { mat: gray, scale };
  }

  /**
   * Detects keypoints/descriptors for a single image, on a downscaled copy.
   * @param {ImageBitmap} imageBitmap
   * @returns {{keypoints: cv.KeyPointVector, descriptors: cv.Mat, scale: number}}
   */
  #detectAndCompute(imageBitmap) {
    const { mat: gray, scale } = this.#bitmapToScaledGrayMat(imageBitmap);
    const detector = this.#createDetector();
    const keypoints = new cv.KeyPointVector();
    const descriptors = new cv.Mat();
    const mask = new cv.Mat();
    try {
      detector.detectAndCompute(gray, mask, keypoints, descriptors);
    } finally {
      detector.delete();
      mask.delete();
      gray.delete();
    }
    return { keypoints, descriptors, scale };
  }

  /**
   * Sets and caches the anchor image's descriptors for star-topology
   * matching. Any previously cached anchor data is freed first.
   * @param {ImageBitmap} imageBitmap
   * @returns {{keypointCount: number}}
   */
  setAnchor(imageBitmap) {
    this.#disposeAnchor();

    const { keypoints, descriptors, scale } = this.#detectAndCompute(imageBitmap);

    if (keypoints.size() === 0 || descriptors.rows === 0) {
      keypoints.delete();
      descriptors.delete();
      throw new WorkerCvError('ANCHOR_NO_FEATURES', 'No features detected in the anchor photo.');
    }

    this.#anchorKeypoints = keypoints;
    this.#anchorDescriptors = descriptors;
    this.#anchorScale = scale;

    return { keypointCount: keypoints.size() };
  }

  #disposeAnchor() {
    this.#anchorKeypoints?.delete();
    this.#anchorDescriptors?.delete();
    this.#anchorKeypoints = null;
    this.#anchorDescriptors = null;
    this.#anchorScale = null;
  }

  hasAnchor() {
    return this.#anchorDescriptors !== null;
  }

  /**
   * Rescales a homography computed between two DOWNSCALED images (detail
   * scaled by `detailScale`, anchor scaled by `this.#anchorScale`) back to
   * one that operates directly on full-resolution pixel coordinates.
   *
   * Both scalings are pure uniform scales (S = diag(s, s, 1), no
   * translation), so H_full = S_anchor^-1 . H_scaled . S_detail simplifies
   * to simple per-element scalar corrections rather than a full matrix
   * multiply — see the derivation in the code comments below.
   * @param {number[]} homographyScaled row-major 3x3
   * @param {number} detailScale
   * @returns {number[]} row-major 3x3, in full-resolution coordinates
   */
  #rescaleHomographyToFullRes(homographyScaled, detailScale) {
    const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = homographyScaled;
    const ratio = detailScale / this.#anchorScale;
    // Right-multiplying by S_detail=diag(s_d,s_d,1) scales columns 0 and 1
    // by s_d; left-multiplying by S_anchor^-1=diag(1/s_a,1/s_a,1) scales
    // rows 0 and 1 by 1/s_a. Row 2 / column 2 (the homogeneous terms) are
    // left untouched by a pure scaling matrix on either side, except h2/h5
    // which pick up the row scale only (their column, index 2, is unscaled).
    return [
      h0 * ratio, h1 * ratio, h2 / this.#anchorScale,
      h3 * ratio, h4 * ratio, h5 / this.#anchorScale,
      h6 * detailScale, h7 * detailScale, h8,
    ];
  }

  /**
   * Matches a detail image against the cached anchor, running Lowe's ratio
   * test then RANSAC homography estimation.
   * @param {ImageBitmap} imageBitmap
   * @returns {{
   *   homography: number[],
   *   inlierRatio: number,
   *   matchedKeypointCount: number,
   *   detailWidth: number,
   *   detailHeight: number,
   * }}
   */
  matchDetail(imageBitmap) {
    if (!this.hasAnchor()) {
      throw new WorkerCvError('NO_ANCHOR', 'No anchor photo has been set yet.');
    }

    const {
      keypoints: detailKeypoints,
      descriptors: detailDescriptors,
      scale: detailScale,
    } = this.#detectAndCompute(imageBitmap);

    if (detailKeypoints.size() < 4 || detailDescriptors.rows === 0) {
      detailKeypoints.delete();
      detailDescriptors.delete();
      throw new WorkerCvError('DETAIL_NO_FEATURES', 'Not enough features found in this photo.');
    }

    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const knnMatches = new cv.DMatchVectorVector();
    let goodMatches = [];
    let homographyMat = null;
    let maskMat = null;

    try {
      matcher.knnMatch(detailDescriptors, this.#anchorDescriptors, knnMatches, 2);

      for (let i = 0; i < knnMatches.size(); i++) {
        const pair = knnMatches.get(i);
        if (pair.size() < 2) continue;
        const m = pair.get(0);
        const n = pair.get(1);
        if (m.distance < WORKER_CONFIG.LOWE_RATIO_TEST_THRESHOLD * n.distance) {
          goodMatches.push(m);
        }
      }

      if (goodMatches.length < 4) {
        throw new WorkerCvError(
          'DETAIL_FAILED',
          'Not enough matching features against the anchor photo.'
        );
      }

      const srcArray = [];
      const dstArray = [];
      for (const match of goodMatches) {
        const srcPt = detailKeypoints.get(match.queryIdx).pt;
        const dstPt = this.#anchorKeypoints.get(match.trainIdx).pt;
        srcArray.push(srcPt.x, srcPt.y);
        dstArray.push(dstPt.x, dstPt.y);
      }

      const srcPoints = cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, srcArray);
      const dstPoints = cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, dstArray);
      maskMat = new cv.Mat();

      try {
        homographyMat = cv.findHomography(
          srcPoints,
          dstPoints,
          cv.RANSAC,
          WORKER_CONFIG.RANSAC_REPROJ_THRESHOLD,
          maskMat
        );
      } finally {
        srcPoints.delete();
        dstPoints.delete();
      }

      if (homographyMat.empty()) {
        throw new WorkerCvError('DETAIL_FAILED', 'Could not compute a valid homography.');
      }

      let inliers = 0;
      for (let i = 0; i < maskMat.rows; i++) {
        if (maskMat.data[i] !== 0) inliers++;
      }
      const inlierRatio = inliers / goodMatches.length;

      if (inlierRatio < WORKER_CONFIG.MIN_INLIER_RATIO) {
        throw new WorkerCvError(
          'DETAIL_FAILED',
          `Alignment too weak (${(inlierRatio * 100).toFixed(0)}% inliers).`
        );
      }

      const homographyScaled = Array.from(homographyMat.data64F);
      const homography = this.#rescaleHomographyToFullRes(homographyScaled, detailScale);

      return {
        homography,
        inlierRatio,
        matchedKeypointCount: goodMatches.length,
        detailWidth: imageBitmap.width,
        detailHeight: imageBitmap.height,
      };
    } finally {
      detailKeypoints.delete();
      detailDescriptors.delete();
      matcher.delete();
      knnMatches.delete();
      homographyMat?.delete();
      maskMat?.delete();
    }
  }

  /** Frees the cached anchor descriptors/keypoints (call on teardown). */
  dispose() {
    this.#disposeAnchor();
  }
}

/** Lightweight typed error used to distinguish worker-side CV failures. */
class WorkerCvError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
