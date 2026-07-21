import { Type } from '../../shared/utils/Type.js';
/**
 * QRCodeView.js
 * Thin wrapper around the global `QRCode` class (from qrcodejs, loaded via a
 * plain <script> tag in host.html). Renders the pairing URL as a QR code
 * into a container element. Shrinking the code to the corner once a phone
 * connects is a pure CSS/layout concern handled by HostUIController — this
 * class only knows how to draw/redraw the code itself.
 */
export class QRCodeView {
  #containerEl;
  #instance;

  /** @param {HTMLElement} containerEl */
  constructor(containerEl) {
    this.#containerEl = containerEl;
    this.#instance = null;
  }

  /** @param {string} url the scanner.html URL (with ?peer=<hostId>) to encode. */
  render(url) {
    Type.check({ url }, 'string');
    this.#containerEl.innerHTML = '';
    // eslint-disable-next-line no-undef
    this.#instance = new QRCode(this.#containerEl, {
      text: url,
      width: 220,
      height: 220,
      colorDark: '#0e1013',
      colorLight: '#e9e6dd',
      // eslint-disable-next-line no-undef
      correctLevel: QRCode.CorrectLevel.M,
    });
  }
}
