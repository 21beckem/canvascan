/**
 * Matrix3.js
 * Minimal 3x3 row-major matrix helpers used for composing and inverting
 * homographies / similarity transforms on the main thread. All matrices are
 * plain `number[9]` arrays in row-major order:
 *   [ a b c
 *     d e f
 *     g h i ]
 */
export class Matrix3 {
  /** @returns {number[9]} the 3x3 identity matrix. */
  static identity() {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  /**
   * Builds an affine similarity transform representing a uniform scale plus
   * translation: p' = scale * p + (tx, ty).
   * @param {number} scale
   * @param {number} tx
   * @param {number} ty
   * @returns {number[9]}
   */
  static fromScaleTranslate(scale, tx, ty) {
    return [scale, 0, tx, 0, scale, ty, 0, 0, 1];
  }

  /**
   * Row-major 3x3 matrix multiplication: returns a * b.
   * @param {number[9]} a
   * @param {number[9]} b
   * @returns {number[9]}
   */
  static multiply(a, b) {
    const out = new Array(9).fill(0);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) {
          sum += a[row * 3 + k] * b[k * 3 + col];
        }
        out[row * 3 + col] = sum;
      }
    }
    return out;
  }

  /**
   * Inverts a 3x3 matrix using the adjugate/cofactor method.
   * @param {number[9]} m
   * @returns {number[9]}
   * @throws {Error} if the matrix is singular (determinant ~ 0).
   */
  static invert(m) {
    const [a, b, c, d, e, f, g, h, i] = m;

    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const D = -(b * i - c * h);
    const E = a * i - c * g;
    const F = -(a * h - b * g);
    const G = b * f - c * e;
    const H = -(a * f - c * d);
    const I = a * e - b * d;

    const det = a * A + b * B + c * C;

    if (Math.abs(det) < 1e-12) {
      throw new Error('Matrix3.invert: matrix is singular and cannot be inverted.');
    }

    const invDet = 1 / det;

    // Adjugate is the transpose of the cofactor matrix.
    return [
      A * invDet, D * invDet, G * invDet,
      B * invDet, E * invDet, H * invDet,
      C * invDet, F * invDet, I * invDet,
    ];
  }

  /**
   * Applies a 3x3 matrix to a 2D point using homogeneous coordinates,
   * performing the perspective divide.
   * @param {number[9]} m
   * @param {[number, number]} point
   * @returns {[number, number]}
   */
  static applyToPoint(m, [x, y]) {
    const w = m[6] * x + m[7] * y + m[8];
    const px = (m[0] * x + m[1] * y + m[2]) / w;
    const py = (m[3] * x + m[4] * y + m[5]) / w;
    return [px, py];
  }

  /**
   * Applies a matrix to an array of points, returning new point pairs.
   * @param {number[9]} m
   * @param {Array<[number, number]>} points
   * @returns {Array<[number, number]>}
   */
  static applyToPoints(m, points) {
    return points.map((p) => Matrix3.applyToPoint(m, p));
  }

  /**
   * Computes the axis-aligned bounding box of a set of points.
   * @param {Array<[number, number]>} points
   * @returns {{minX:number, minY:number, maxX:number, maxY:number}}
   */
  static boundingBox(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }
}
