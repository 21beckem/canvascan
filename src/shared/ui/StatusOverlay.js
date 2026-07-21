import { Type } from '../utils/Type.js';
/**
 * StatusOverlay.js
 * Controls the small status readout (spinner + label) shown while the CV
 * worker is processing, and a dismissible error toast for DETAIL_FAILED /
 * ANCHOR_FAILED conditions.
 */
const STAGE_LABELS = Object.freeze({
  // Host-side (CV worker) stages:
  loading_wasm: 'Loading vision engine…',
  extracting: 'Detecting features…',
  matching: 'Matching against anchor…',
  ransac: 'Estimating alignment…',
  feathering: 'Blending edges…',
  // Scanner-side (network/camera) stages:
  connecting_peer: 'Connecting to computer…',
  requesting_camera: 'Requesting camera access…',
  sending: 'Sending photo…',
});

export class StatusOverlay {
  #statusEl;
  #statusTextEl;
  #toastEl;
  #toastTextEl;
  #toastTimer;
  #queueBadgeEl;
  #queueBadgeTextEl;

  /**
   * @param {{
   *   statusEl: HTMLElement, statusTextEl: HTMLElement,
   *   toastEl: HTMLElement, toastTextEl: HTMLElement,
   *   queueBadgeEl?: HTMLElement, queueBadgeTextEl?: HTMLElement,
   * }} refs
   */
  constructor({ statusEl, statusTextEl, toastEl, toastTextEl, queueBadgeEl, queueBadgeTextEl }) {
    Type.check({ statusEl, statusTextEl, toastEl, toastTextEl }, HTMLElement);
    Type.check({ queueBadgeEl, queueBadgeTextEl }, HTMLElement, true);
    this.#statusEl = statusEl;
    this.#statusTextEl = statusTextEl;
    this.#toastEl = toastEl;
    this.#toastTextEl = toastTextEl;
    this.#toastTimer = null;
    this.#queueBadgeEl = queueBadgeEl ?? null;
    this.#queueBadgeTextEl = queueBadgeTextEl ?? null;

    const dismissBtn = toastEl.querySelector('[data-role="toast-dismiss"]');
    dismissBtn?.addEventListener('click', () => this.hideError());
  }

  /**
   * Shows/updates the "Stitching X/Y" badge. Pass `total: 0` to hide it
   * (used when resetting for a new anchor).
   * @param {number} completed
   * @param {number} total
   */
  setQueueProgress(completed, total) {
    Type.check({ completed, total }, 'number');
    if (!this.#queueBadgeEl || !this.#queueBadgeTextEl) return;
    if (total <= 0) {
      this.#queueBadgeEl.hidden = true;
      return;
    }
    this.#queueBadgeTextEl.textContent = `Stitching ${completed}/${total}`;
    this.#queueBadgeEl.hidden = false;
  }

  /** @param {string} stage one of the keys in STAGE_LABELS */
  setStage(stage) {
    Type.check({ stage }, 'string');
    const label = STAGE_LABELS[stage] ?? 'Working…';
    this.#statusTextEl.textContent = label;
    this.#statusEl.hidden = false;
    this.#statusEl.setAttribute('aria-busy', 'true');
  }

  hide() {
    this.#statusEl.hidden = true;
    this.#statusEl.removeAttribute('aria-busy');
  }

  /**
   * Shows a dismissible error toast. Auto-hides after `durationMs` unless
   * the user dismisses it first. Also logs to the console so the full
   * message (and any stack trace, if passed) is easy to inspect while
   * debugging.
   * @param {string} message
   * @param {number} [durationMs]
   * @param {unknown} [debugDetail] optional Error/object logged alongside the message
   */
  showError(message, durationMs = 6000, debugDetail) {
    Type.check({ message }, 'string');
    Type.check({ durationMs }, 'number');
    // eslint-disable-next-line no-console
    console.error(`[Canvascan] ${message}`, debugDetail ?? '');
    this.#toastTextEl.textContent = message;
    this.#toastEl.hidden = false;
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => this.hideError(), durationMs);
  }

  hideError() {
    this.#toastEl.hidden = true;
    clearTimeout(this.#toastTimer);
  }
}
