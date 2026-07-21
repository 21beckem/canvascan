import { Type } from '../utils/Type.js';
import { Config } from '../utils/Config.js';

/**
 * TileManager.js
 * Maps Master Canvas pixel coordinates to (tileRow, tileCol) + local tile
 * coordinates, and computes which tiles intersect a given bounding box.
 * Pure geometry — no GL dependency.
 *
 * The master canvas is a `gridCols x gridRows` grid of square `tileSize`
 * tiles. `gridCols` and `gridRows` need not be equal — the grid's aspect
 * ratio is chosen (by the caller, see WebGL2Renderer#configureForAnchor) to
 * match the anchor photo's own aspect ratio, so the padded grid size
 * (gridCols*tileSize x gridRows*tileSize) may be very slightly larger than
 * the true output size; the true, unpadded output size is tracked
 * separately and used only at export time to crop off that padding.
 */
export class TileManager {
  #tileSize;
  #gridCols;
  #gridRows;

  /**
   * @param {number} tileSize
   * @param {number} gridCols
   * @param {number} gridRows
   */
  constructor(tileSize, gridCols, gridRows) {
    Type.check({ tileSize, gridCols, gridRows }, 'number');
    this.#tileSize = tileSize;
    this.#gridCols = gridCols;
    this.#gridRows = gridRows;
  }

  /**
   * Builds a TileManager sized to cover at least `contentWidth x
   * contentHeight` pixels with a grid of `tileSize` tiles.
   * @param {number} contentWidth
   * @param {number} contentHeight
   * @param {number} [tileSize]
   * @returns {TileManager}
   */
  static forContentSize(contentWidth, contentHeight, tileSize = Config.TILE_SIZE) {
    Type.check({ contentWidth, contentHeight, tileSize }, 'number');
    const gridCols = Math.max(1, Math.ceil(contentWidth / tileSize));
    const gridRows = Math.max(1, Math.ceil(contentHeight / tileSize));
    return new TileManager(tileSize, gridCols, gridRows);
  }

  get tileSize() {
    return this.#tileSize;
  }

  get gridCols() {
    return this.#gridCols;
  }

  get gridRows() {
    return this.#gridRows;
  }

  /** @returns {number} padded grid width in px (may exceed the true output width). */
  get paddedWidth() {
    return this.#gridCols * this.#tileSize;
  }

  /** @returns {number} padded grid height in px (may exceed the true output height). */
  get paddedHeight() {
    return this.#gridRows * this.#tileSize;
  }

  /**
   * @param {number} row
   * @param {number} col
   * @returns {{x:number, y:number}} the tile's top-left origin in master
   *   canvas pixel space.
   */
  tileOrigin(row, col) {
    Type.check({ row, col }, 'number');
    return { x: col * this.#tileSize, y: row * this.#tileSize };
  }

  /**
   * Converts a master-canvas pixel coordinate to its owning tile plus
   * tile-local coordinates.
   * @param {number} px
   * @param {number} py
   * @returns {{tileRow:number, tileCol:number, localX:number, localY:number}}
   */
  masterToTile(px, py) {
    Type.check({ px, py }, 'number');
    const tileCol = Math.min(this.#gridCols - 1, Math.max(0, Math.floor(px / this.#tileSize)));
    const tileRow = Math.min(this.#gridRows - 1, Math.max(0, Math.floor(py / this.#tileSize)));
    return {
      tileRow,
      tileCol,
      localX: px - tileCol * this.#tileSize,
      localY: py - tileRow * this.#tileSize,
    };
  }

  /**
   * Returns every tile (row/col) whose square footprint overlaps the given
   * axis-aligned bounding box (in master canvas pixel space), along with the
   * sub-rectangle (in that tile's local pixel space) that the bbox covers.
   * @param {number} minX
   * @param {number} minY
   * @param {number} maxX
   * @param {number} maxY
   * @returns {Array<{
   *   tileRow:number, tileCol:number,
   *   subMinX:number, subMinY:number, subMaxX:number, subMaxY:number
   * }>}
   */
  tilesIntersectingBBox(minX, minY, maxX, maxY) {
    Type.check({ minX, minY, maxX, maxY }, 'number');
    const clampedMinX = Math.max(0, Math.min(this.paddedWidth, minX));
    const clampedMinY = Math.max(0, Math.min(this.paddedHeight, minY));
    const clampedMaxX = Math.max(0, Math.min(this.paddedWidth, maxX));
    const clampedMaxY = Math.max(0, Math.min(this.paddedHeight, maxY));

    if (clampedMaxX <= clampedMinX || clampedMaxY <= clampedMinY) {
      return [];
    }

    const colStart = Math.floor(clampedMinX / this.#tileSize);
    const colEnd = Math.floor((clampedMaxX - 1e-6) / this.#tileSize);
    const rowStart = Math.floor(clampedMinY / this.#tileSize);
    const rowEnd = Math.floor((clampedMaxY - 1e-6) / this.#tileSize);

    const results = [];
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const origin = this.tileOrigin(row, col);
        const subMinX = Math.max(0, clampedMinX - origin.x);
        const subMinY = Math.max(0, clampedMinY - origin.y);
        const subMaxX = Math.min(this.#tileSize, clampedMaxX - origin.x);
        const subMaxY = Math.min(this.#tileSize, clampedMaxY - origin.y);
        results.push({ tileRow: row, tileCol: col, subMinX, subMinY, subMaxX, subMaxY });
      }
    }
    return results;
  }

  /** @returns {Array<{row:number, col:number}>} every tile in the grid. */
  allTiles() {
    const tiles = [];
    for (let row = 0; row < this.#gridRows; row++) {
      for (let col = 0; col < this.#gridCols; col++) {
        tiles.push({ row, col });
      }
    }
    return tiles;
  }
}
