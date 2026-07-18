/**
 * ProgressMap.js
 * Renders a small 2D-canvas mini-map of the tile grid, sized to match the
 * Master Canvas's own aspect ratio, filling in regions as they are stitched
 * so the person can see, at a glance, how much of the painting still needs
 * detail photos.
 */

export class ProgressMap {
  #canvas;
  #ctx;
  #masterWidth;
  #masterHeight;
  #gridCols;
  #gridRows;
  #maxDisplayDim;

  /**
   * @param {HTMLCanvasElement} canvasElement
   * @param {number} [maxDisplayDim] CSS px length of the map's longer edge.
   */
  constructor(canvasElement, maxDisplayDim = 90) {
    this.#canvas = canvasElement;
    this.#ctx = canvasElement.getContext('2d');
    this.#masterWidth = 1;
    this.#masterHeight = 1;
    this.#gridCols = 1;
    this.#gridRows = 1;
    this.#maxDisplayDim = maxDisplayDim;
  }

  /**
   * Resizes the mini-map (both its backing resolution and its CSS display
   * size) to match the Master Canvas's true aspect ratio, and records the
   * tile grid dimensions used to draw grid lines.
   * @param {{
   *   outputWidth: number, outputHeight: number,
   *   gridCols: number, gridRows: number,
   * }} params
   */
  configure({ outputWidth, outputHeight, gridCols, gridRows }) {
    this.#masterWidth = outputWidth;
    this.#masterHeight = outputHeight;
    this.#gridCols = gridCols;
    this.#gridRows = gridRows;

    const dpr = window.devicePixelRatio || 1;
    let dispW;
    let dispH;
    if (outputWidth >= outputHeight) {
      dispW = this.#maxDisplayDim;
      dispH = Math.max(1, Math.round(this.#maxDisplayDim * (outputHeight / outputWidth)));
    } else {
      dispH = this.#maxDisplayDim;
      dispW = Math.max(1, Math.round(this.#maxDisplayDim * (outputWidth / outputHeight)));
    }

    this.#canvas.width = Math.round(dispW * dpr);
    this.#canvas.height = Math.round(dispH * dpr);
    this.#canvas.style.width = `${dispW}px`;
    this.#canvas.style.height = `${dispH}px`;
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.reset();
  }

  /** @returns {{width:number, height:number}} current CSS-pixel display size. */
  #cssSize() {
    return {
      width: parseFloat(this.#canvas.style.width) || this.#canvas.width,
      height: parseFloat(this.#canvas.style.height) || this.#canvas.height,
    };
  }

  /** Clears the mini-map and redraws the grid outline. */
  reset() {
    const { width, height } = this.#cssSize();
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i < this.#gridCols; i++) {
      const x = (width / this.#gridCols) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let i = 1; i < this.#gridRows; i++) {
      const y = (height / this.#gridRows) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  /** Draws the anchor's footprint once it has been captured (full frame). */
  markAnchorPainted() {
    const { width, height } = this.#cssSize();
    this.#ctx.fillStyle = 'rgba(201, 162, 75, 0.35)'; // brass tint
    this.#ctx.fillRect(0, 0, width, height);
  }

  /**
   * Marks a master-canvas-space bounding box as stitched.
   * @param {{minX:number, minY:number, maxX:number, maxY:number}} bbox
   */
  markStitched({ minX, minY, maxX, maxY }) {
    const { width, height } = this.#cssSize();
    const scaleX = width / this.#masterWidth;
    const scaleY = height / this.#masterHeight;

    this.#ctx.fillStyle = 'rgba(76, 122, 109, 0.75)'; // verdigris
    this.#ctx.fillRect(
      minX * scaleX,
      minY * scaleY,
      (maxX - minX) * scaleX,
      (maxY - minY) * scaleY
    );
  }
}
