/**
 * FeatherMaskGenerator.js
 *
 * IMPORTANT: Classic script (no import/export), loaded via `importScripts()`
 * into the worker's global scope from `cv.worker.js`. Depends on the global
 * `cv` object and `WORKER_CONFIG`.
 *
 * Builds a distance-transform-based alpha feather mask describing where the
 * detail image's warped quadrilateral fades toward its own bounding box
 * edges. The mask is generated in "bounding-box-relative" space: since the
 * anchor-to-master transform applied later on the main thread is a uniform
 * similarity (scale + translate), the *relative* position of any point
 * within the warped quad's bounding box is preserved when that transform is
 * applied — so this worker-side computation (using only the raw detail-to-
 * anchor homography) remains valid once composed with that later transform.
 */
class FeatherMaskGenerator {
  /**
   * Applies a row-major 3x3 homography (as a flat number[9] array) to a 2D
   * point, with perspective divide.
   * @param {number[]} h
   * @param {number} x
   * @param {number} y
   * @returns {[number, number]}
   */
  static #applyHomography(h, x, y) {
    const w = h[6] * x + h[7] * y + h[8];
    const px = (h[0] * x + h[1] * y + h[2]) / w;
    const py = (h[3] * x + h[4] * y + h[5]) / w;
    return [px, py];
  }

  /**
   * @param {number[]} homography row-major 3x3, maps detail px -> anchor px
   * @param {number} detailWidth
   * @param {number} detailHeight
   * @param {number} [maskResolution] square mask side length in px
   * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
   */
  static generate(
    homography,
    detailWidth,
    detailHeight,
    maskResolution = WORKER_CONFIG.FEATHER_MASK_RESOLUTION
  ) {
    // 1. Project the detail image's 4 corners into anchor space.
    const corners = [
      [0, 0],
      [detailWidth, 0],
      [detailWidth, detailHeight],
      [0, detailHeight],
    ].map(([x, y]) => FeatherMaskGenerator.#applyHomography(homography, x, y));

    // 2. Bounding box of the projected quad.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of corners) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bboxW = Math.max(maxX - minX, 1e-6);
    const bboxH = Math.max(maxY - minY, 1e-6);

    // 3. Rasterize the quad into a binary coverage mask at maskResolution.
    const binaryMask = cv.Mat.zeros(maskResolution, maskResolution, cv.CV_8UC1);
    const localCorners = corners.map(([x, y]) => [
      Math.round(((x - minX) / bboxW) * (maskResolution - 1)),
      Math.round(((y - minY) / bboxH) * (maskResolution - 1)),
    ]);

    const flatPts = [];
    for (const [x, y] of localCorners) flatPts.push(x, y);
    const polyMat = cv.matFromArray(localCorners.length, 1, cv.CV_32SC2, flatPts);
    const polyVec = new cv.MatVector();
    polyVec.push_back(polyMat);

    try {
      cv.fillPoly(binaryMask, polyVec, new cv.Scalar(255));
    } finally {
      polyMat.delete();
      polyVec.delete();
    }

    // 4. Distance transform: distance (px, in mask space) from the nearest
    //    zero (background/outside-quad) pixel.
    const distMat = new cv.Mat();
    let alphaData;

    try {
      cv.distanceTransform(binaryMask, distMat, cv.DIST_L2, cv.DIST_MASK_5);

      const featherRadiusPx = maskResolution * WORKER_CONFIG.FEATHER_FRACTION;
      alphaData = new Uint8ClampedArray(maskResolution * maskResolution);
      const distData = distMat.data32F;

      for (let i = 0; i < distData.length; i++) {
        const d = distData[i];
        const normalized = featherRadiusPx > 0 ? d / featherRadiusPx : 1;
        const clamped = Math.max(0, Math.min(1, normalized));
        alphaData[i] = Math.round(clamped * 255);
      }
    } finally {
      binaryMask.delete();
      distMat.delete();
    }

    return { width: maskResolution, height: maskResolution, data: alphaData };
  }
}
