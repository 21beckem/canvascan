import { AppState } from '../shared/state/AppStateMachine.js';

/**
 * StandaloneUIController.js
 * Wires DOM elements for scanner.html when running in phone-only mode
 * (`?peer=none`): the same capture panels as RemoteScannerUIController, PLUS
 * the processing-facing elements that only this mode needs on the phone
 * itself — the small corner progress-grid and the Export button (in
 * connected mode those live on host.html instead).
 */
export class StandaloneUIController {
  #refs;
  #currentState;
  #cameraSwitchLocked;

  /**
   * @param {{
   *   panelSetup: HTMLElement,
   *   panelAnchor: HTMLElement,
   *   panelDetails: HTMLElement,
   *   captureAnchorBtn: HTMLButtonElement,
   *   captureDetailBtn: HTMLButtonElement,
   *   retryCameraBtn: HTMLButtonElement,
   *   switchCameraBtn: HTMLButtonElement,
   *   setupMessageEl: HTMLElement,
   *   progressMapEl: HTMLElement,
   *   exportBtn: HTMLButtonElement,
   * }} refs
   */
  constructor(refs) {
    this.#refs = refs;
    this.#currentState = AppState.SETUP_CAMERA;
    this.#cameraSwitchLocked = false;
    if (this.#refs.exportBtn) this.#refs.exportBtn.hidden = false;
  }

  /** @param {import('../shared/state/AppStateMachine.js').AppStateMachine} stateMachine */
  bindStateMachine(stateMachine) {
    const apply = (state) => this.#applyState(state);
    apply(stateMachine.state);
    stateMachine.onTransition((state) => apply(state));
  }

  #applyState(state) {
    this.#currentState = state;
    const { panelSetup, panelAnchor, panelDetails, progressMapEl } = this.#refs;
    panelSetup.hidden = state !== AppState.SETUP_CAMERA;
    panelAnchor.hidden = state !== AppState.CAPTURE_ANCHOR;
    panelDetails.hidden = state !== AppState.CAPTURE_DETAILS;

    if (progressMapEl) progressMapEl.hidden = state !== AppState.CAPTURE_DETAILS;
    if (this.#refs.switchCameraBtn) {
      this.#refs.switchCameraBtn.hidden =
        this.#cameraSwitchLocked || state !== AppState.CAPTURE_ANCHOR;
    }
  }

  /**
   * @param {{
   *   onCaptureAnchor: () => void,
   *   onCaptureDetail: () => void,
   *   onRetryCamera: () => void,
   *   onSwitchCamera: () => void,
   *   onExport: () => void,
   * }} handlers
   */
  wireCallbacks(handlers) {
    const { captureAnchorBtn, captureDetailBtn, retryCameraBtn, switchCameraBtn, exportBtn } =
      this.#refs;
    captureAnchorBtn.addEventListener('click', () => handlers.onCaptureAnchor?.());
    captureDetailBtn.addEventListener('click', () => handlers.onCaptureDetail?.());
    retryCameraBtn.addEventListener('click', () => handlers.onRetryCamera?.());
    switchCameraBtn?.addEventListener('click', () => handlers.onSwitchCamera?.());
    exportBtn?.addEventListener('click', () => handlers.onExport?.());
  }

  /** @param {boolean} busy disables capture-anchor/switch-camera during the one-shot anchor capture. */
  setAnchorBusy(busy) {
    const { captureAnchorBtn, switchCameraBtn } = this.#refs;
    captureAnchorBtn.disabled = busy;
    if (switchCameraBtn) switchCameraBtn.disabled = busy;
  }

  /** Permanently hides the switch-camera control. */
  lockCameraSwitching() {
    this.#cameraSwitchLocked = true;
    this.#applyState(this.#currentState);
  }

  /** @param {boolean} enabled whether Export can be tapped right now. */
  setExportEnabled(enabled) {
    if (this.#refs.exportBtn) this.#refs.exportBtn.disabled = !enabled;
  }

  showSetupError(message) {
    this.#refs.setupMessageEl.textContent = message;
    this.#refs.retryCameraBtn.hidden = false;
  }

  showSetupMessage(message) {
    this.#refs.setupMessageEl.textContent = message;
    this.#refs.retryCameraBtn.hidden = true;
  }
}
