import { Type } from '../utils/Type.js';
/**
 * FrameGrabber.js
 * Grabs a full-resolution frame from the live `<video>` track as a
 * transferable `ImageBitmap`, decoupled from the video element's displayed
 * (CSS) size — the bitmap is sized to the video's intrinsic resolution.
 */
export class FrameGrabber {
  /**
   * @param {HTMLVideoElement} videoElement
   * @returns {Promise<ImageBitmap>}
   * @throws {Error} with `.userMessage` if the frame could not be captured.
   */
  static async grabFullResolution(videoElement) {
    Type.check({ videoElement }, HTMLVideoElement);
    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      const err = new Error('FrameGrabber: video has no intrinsic dimensions yet.');
      err.userMessage = 'Camera is not ready yet — wait a moment and try again.';
      throw err;
    }

    if (typeof createImageBitmap !== 'function') {
      const err = new Error('FrameGrabber: createImageBitmap is unsupported.');
      err.userMessage = 'This browser cannot capture frames from the camera.';
      throw err;
    }

    try {
      // createImageBitmap(video) captures the current decoded frame at the
      // track's native intrinsic resolution — no re-encoding or downscale.
      return await createImageBitmap(videoElement);
    } catch (err) {
      const wrapped = new Error(`FrameGrabber: createImageBitmap failed: ${err.message}`);
      wrapped.userMessage = 'Could not capture the photo. Try again.';
      wrapped.cause = err;
      throw wrapped;
    }
  }
}
