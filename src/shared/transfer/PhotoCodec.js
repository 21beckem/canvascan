import { Config } from '../utils/Config.js';

/**
 * PhotoCodec.js
 * Converts an `ImageBitmap` to a transferable `{format, width, height,
 * buffer}` payload (sender/phone side) and back again (receiver/host side).
 * Used identically on both ends, so it lives in `shared/`.
 *
 * Two formats are supported, switched by `Config.PHOTO_TRANSFER_FORMAT`:
 *   'raw'  — the ImageBitmap's raw RGBA8 pixels (via OffscreenCanvas +
 *            getImageData), zero quality loss, ~4 bytes/pixel.
 *   'jpeg' — compressed via OffscreenCanvas.convertToBlob, much smaller,
 *            minor generational quality loss.
 */
export class PhotoCodec {
  /**
   * @param {ImageBitmap} bitmap
   * @param {'raw'|'jpeg'} [format]
   * @returns {Promise<{format:'raw'|'jpeg', width:number, height:number, buffer:ArrayBuffer}>}
   */
  static async encode(bitmap, format = Config.PHOTO_TRANSFER_FORMAT) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: format === 'raw' });
    ctx.drawImage(bitmap, 0, 0);

    if (format === 'jpeg') {
      const blob = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: Config.PHOTO_TRANSFER_JPEG_QUALITY,
      });
      const buffer = await blob.arrayBuffer();
      return { format: 'jpeg', width: bitmap.width, height: bitmap.height, buffer };
    }

    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    // .slice() so the returned buffer isn't tied to the ImageData's own
    // backing store lifetime in every implementation.
    const buffer = imageData.data.buffer.slice(0);
    return { format: 'raw', width: bitmap.width, height: bitmap.height, buffer };
  }

  /**
   * @param {{format:'raw'|'jpeg', width:number, height:number, buffer:ArrayBuffer}} payload
   * @returns {Promise<ImageBitmap>}
   */
  static async decode({ format, width, height, buffer }) {
    if (format === 'jpeg') {
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      return createImageBitmap(blob);
    }

    const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    return createImageBitmap(imageData);
  }
}
