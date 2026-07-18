/**
 * HostUIController.js
 * Wires DOM elements for host.html: the QR pairing panel (which docks to a
 * corner once at least one phone is connected), the connected-phone count,
 * the three "what's happening" states (waiting for a connection / waiting
 * for the anchor / session active), and the Export button.
 */
export class HostUIController {
  #refs;

  /**
   * @param {{
   *   qrPanelEl: HTMLElement,
   *   connectedCountEl: HTMLElement,
   *   waitingConnectionEl: HTMLElement,
   *   waitingAnchorEl: HTMLElement,
   *   sessionActiveEl: HTMLElement,
   *   exportBtn: HTMLButtonElement,
   * }} refs
   */
  constructor(refs) {
    this.#refs = refs;
  }

  /**
   * @param {() => void} onExport
   */
  wireCallbacks({ onExport }) {
    this.#refs.exportBtn.addEventListener('click', () => onExport?.());
  }

  /** @param {number} count number of currently-connected phones. */
  setConnectionCount(count) {
    const { qrPanelEl, connectedCountEl } = this.#refs;
    qrPanelEl.classList.toggle('docked', count > 0);
    connectedCountEl.textContent =
      count === 0 ? 'No phones connected' : count === 1 ? '1 phone connected' : `${count} phones connected`;
    this.#refreshVisibility(count);
  }

  /** @param {boolean} hasAnchor whether the (shared, pooled) session has an anchor yet. */
  setHasAnchor(hasAnchor) {
    this.#hasAnchor = hasAnchor;
    this.#refreshVisibility(this.#lastCount ?? 0);
  }

  #hasAnchor = false;
  #lastCount = 0;

  #refreshVisibility(count) {
    this.#lastCount = count;
    const { waitingConnectionEl, waitingAnchorEl, sessionActiveEl } = this.#refs;
    const connected = count > 0;
    waitingConnectionEl.hidden = connected;
    waitingAnchorEl.hidden = !connected || this.#hasAnchor;
    sessionActiveEl.hidden = !connected || !this.#hasAnchor;
  }

  /** @param {boolean} enabled whether Export can be tapped right now. */
  setExportEnabled(enabled) {
    this.#refs.exportBtn.disabled = !enabled;
  }
}
