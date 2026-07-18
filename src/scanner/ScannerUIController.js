import { AppState } from '../shared/state/AppStateMachine.js';

/**
 * ScannerUIController.js
 * Wires DOM elements for scanner.html. Nearly identical to the original
 * single-device UI, minus: the stitched-photo counter (now the host's
 * "Stitching X/Y" badge), the Export button, the progress-grid preview, and
 * the Retake Anchor button (session restart is now a host-side page reload).
 */
export class ScannerUIController {
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
   * }} refs
   */
  constructor(refs) {
    this.#refs = refs;
    this.#currentState = AppState.SETUP_CAMERA;
    this.#cameraSwitchLocked = false;
  }

  /** @param {import('../shared/state/AppStateMachine.js').AppStateMachine} stateMachine */
  bindStateMachine(stateMachine) {
    const apply = (state) => this.#applyState(state);
    apply(stateMachine.state);
    stateMachine.onTransition((state) => apply(state));
  }

  #applyState(state) {
    this.#currentState = state;
    const { panelSetup, panelAnchor, panelDetails } = this.#refs;
    panelSetup.hidden = state !== AppState.SETUP_CAMERA;
    panelAnchor.hidden = state !== AppState.CAPTURE_ANCHOR;
    panelDetails.hidden = state !== AppState.CAPTURE_DETAILS;

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
   * }} handlers
   */
  wireCallbacks(handlers) {
    const { captureAnchorBtn, captureDetailBtn, retryCameraBtn, switchCameraBtn } = this.#refs;
    captureAnchorBtn.addEventListener('click', () => handlers.onCaptureAnchor?.());
    captureDetailBtn.addEventListener('click', () => handlers.onCaptureDetail?.());
    retryCameraBtn.addEventListener('click', () => handlers.onRetryCamera?.());
    switchCameraBtn?.addEventListener('click', () => handlers.onSwitchCamera?.());
  }

  /** @param {boolean} busy disables capture-anchor/switch-camera during the one-shot anchor capture. */
  setAnchorBusy(busy) {
    const { captureAnchorBtn, switchCameraBtn } = this.#refs;
    captureAnchorBtn.disabled = busy;
    if (switchCameraBtn) switchCameraBtn.disabled = busy;
  }

  /** @param {boolean} enabled whether capture-detail can be tapped right now. */
  setDetailCaptureEnabled(enabled) {
    this.#refs.captureDetailBtn.disabled = !enabled;
  }

  /** Permanently hides the switch-camera control. */
  lockCameraSwitching() {
    this.#cameraSwitchLocked = true;
    this.#applyState(this.#currentState);
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
