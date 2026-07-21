import { Type } from '../utils/Type.js';
import { Config } from '../utils/Config.js';

/**
 * CameraController.js
 * Owns the MediaDevices camera stream: permission request, rear/environment
 * camera selection, and maximum-available-resolution constraints.
 */
export class CameraController {
  #stream;
  #videoElement;
  #devices;
  #currentDeviceId;

  /**
   * @param {MediaStream} stream
   * @param {string | null} [deviceId] the deviceId actually in use, if known
   */
  constructor(stream, deviceId = null) {
    Type.check({ stream }, MediaStream);
    if (deviceId !== null) Type.check({ deviceId }, 'string');
    this.#stream = stream;
    this.#videoElement = null;
    this.#devices = null;
    this.#currentDeviceId = deviceId;
  }

  /**
   * Requests camera permission and opens the rear/environment-facing camera
   * at the highest resolution the device will offer.
   * @returns {Promise<CameraController>}
   * @throws {Error} with a `.userMessage` field suitable for display if
   *   permission is denied or no camera is available.
   */
  static async create() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('Camera API unavailable in this browser.');
      err.userMessage = 'This browser does not support camera capture.';
      throw err;
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: Config.CAMERA_IDEAL_WIDTH },
        height: { ideal: Config.CAMERA_IDEAL_HEIGHT },
      },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const deviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
      return new CameraController(stream, deviceId);
    } catch (err) {
      throw CameraController.#wrapGetUserMediaError(err);
    }
  }

  static #wrapGetUserMediaError(err) {
    Type.check({ err }, Error);
    const wrapped = new Error(`getUserMedia failed: ${err.message}`);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      wrapped.userMessage = 'Camera permission was denied. Enable camera access and try again.';
    } else if (err.name === 'NotFoundError') {
      wrapped.userMessage = 'No camera was found on this device.';
    } else if (err.name === 'NotReadableError') {
      wrapped.userMessage = 'The camera is already in use by another app.';
    } else if (err.name === 'OverconstrainedError') {
      wrapped.userMessage = 'That camera is not available right now.';
    } else {
      wrapped.userMessage = 'Could not start the camera. Try again.';
    }
    wrapped.cause = err;
    return wrapped;
  }

  /**
   * Refreshes and returns the list of available video input devices. Device
   * `label`s are only populated once camera permission has been granted at
   * least once, which is guaranteed by the time this is useful.
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async #refreshDeviceList() {
    const all = await navigator.mediaDevices.enumerateDevices();
    this.#devices = all.filter((d) => d.kind === 'videoinput');
    return this.#devices;
  }

  /**
   * Stops the current stream and opens the next camera in device order,
   * wrapping around to the first after the last. Cycles through every
   * available video input device (front, back, wide, telephoto, etc), not
   * just environment-facing ones.
   * @returns {Promise<MediaDeviceInfo>} the device now active
   * @throws {Error} with `.userMessage` if no other camera could be opened.
   */
  async cycleToNextDevice() {
    const devices = await this.#refreshDeviceList();
    if (devices.length === 0) {
      const err = new Error('CameraController: no video input devices found.');
      err.userMessage = 'No cameras were found on this device.';
      throw err;
    }

    const currentIndex = devices.findIndex((d) => d.deviceId === this.#currentDeviceId);
    const nextIndex = (currentIndex + 1) % devices.length;
    const nextDevice = devices[nextIndex];

    const constraints = {
      audio: false,
      video: {
        deviceId: { exact: nextDevice.deviceId },
        width: { ideal: Config.CAMERA_IDEAL_WIDTH },
        height: { ideal: Config.CAMERA_IDEAL_HEIGHT },
      },
    };

    for (const track of this.#stream.getTracks()) {
      track.stop();
    }

    let newStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      throw CameraController.#wrapGetUserMediaError(err);
    }

    this.#stream = newStream;
    this.#currentDeviceId = nextDevice.deviceId;

    if (this.#videoElement) {
      await this.attach(this.#videoElement);
    }

    return nextDevice;
  }

  /** @returns {string | null} the currently active device's id, if known. */
  getCurrentDeviceId() {
    return this.#currentDeviceId;
  }

  /**
   * Attaches the live stream to a `<video>` element and waits for its
   * intrinsic dimensions to be known.
   * @param {HTMLVideoElement} videoElement
   * @returns {Promise<{width:number, height:number}>}
   */
  attach(videoElement) {
    Type.check({ videoElement }, HTMLVideoElement);
    this.#videoElement = videoElement;
    videoElement.srcObject = this.#stream;
    videoElement.setAttribute('playsinline', ''); // required for iOS inline playback
    videoElement.muted = true;

    return new Promise((resolve, reject) => {
      const onLoaded = () => {
        videoElement.removeEventListener('loadedmetadata', onLoaded);
        videoElement
          .play()
          .then(() =>
            resolve({ width: videoElement.videoWidth, height: videoElement.videoHeight })
          )
          .catch((err) => {
            const wrapped = new Error(`video.play() failed: ${err.message}`);
            wrapped.userMessage = 'Could not start the video preview.';
            reject(wrapped);
          });
      };
      videoElement.addEventListener('loadedmetadata', onLoaded);
    });
  }

  /** @returns {HTMLVideoElement | null} */
  get videoElement() {
    return this.#videoElement;
  }

  /** Reports the actual negotiated track settings (resolution, etc). */
  getActiveSettings() {
    const [track] = this.#stream.getVideoTracks();
    return track ? track.getSettings() : {};
  }

  /** Stops all tracks and releases the camera. */
  stop() {
    for (const track of this.#stream.getTracks()) {
      track.stop();
    }
  }
}
