import { Config } from '../utils/Config.js';

/**
 * CanvasExporter.js
 * Reads back every tile framebuffer from the WebGL2Renderer, composites them
 * into a single full-resolution 2D canvas (flipping each tile vertically —
 * see the note in WebGL2Renderer.readTilePixels), and exports a JPEG.
 */
export class CanvasExporter {
  /**
   * @param {import('../render/WebGL2Renderer.js').WebGL2Renderer} renderer
   * @returns {Promise<Blob>}
   */
  static async compositeToBlob(renderer) {
    const tileManager = renderer.tileManager;
    const tileSize = tileManager.tileSize;
    const { width: outputWidth, height: outputHeight } = renderer.outputSize;

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');

    // Opaque white background: any un-stitched areas export as white rather
    // than transparent/black, since JPEG has no alpha channel.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileSize;
    tileCanvas.height = tileSize;
    const tileCtx = tileCanvas.getContext('2d');

    for (const { row, col } of tileManager.allTiles()) {
      const raw = renderer.readTilePixels(row, col);
      const flipped = CanvasExporter.#flipVertical(raw, tileSize, tileSize);
      const imageData = new ImageData(flipped, tileSize, tileSize);
      tileCtx.putImageData(imageData, 0, 0);

      const origin = tileManager.tileOrigin(row, col);
      // drawImage clips automatically at the canvas's true (unpadded)
      // bounds, so tiles that extend past the anchor's aspect ratio simply
      // have their excess dropped here.
      ctx.drawImage(tileCanvas, origin.x, origin.y);
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export produced an empty blob.'))),
        'image/jpeg',
        Config.JPEG_EXPORT_QUALITY
      );
    });
  }

  /**
   * Flips an RGBA pixel buffer vertically (row 0 <-> last row).
   * @param {Uint8Array} data
   * @param {number} width
   * @param {number} height
   * @returns {Uint8ClampedArray}
   */
  static #flipVertical(data, width, height) {
    const rowBytes = width * 4;
    const out = new Uint8ClampedArray(data.length);
    for (let row = 0; row < height; row++) {
      const srcStart = row * rowBytes;
      const dstStart = (height - 1 - row) * rowBytes;
      out.set(data.subarray(srcStart, srcStart + rowBytes), dstStart);
    }
    return out;
  }

  /**
   * Composites and triggers a browser download of the final JPEG.
   * @param {import('../render/WebGL2Renderer.js').WebGL2Renderer} renderer
   * @param {string} [filename]
   */
  static async downloadComposite(renderer, filename = 'canvascan-export.jpg') {
    const blob = await CanvasExporter.compositeToBlob(renderer);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
