import { Type } from '../shared/utils/Type.js';
import { AppState, AppStateMachine } from '../shared/state/AppStateMachine.js';

/**
 * RemoteScannerUIController.js
 * Wires DOM elements for scanner.html. Nearly identical to the original
 * single-device UI, minus: the stitched-photo counter (now the host's
 * "Stitching X/Y" badge), the Export button, the progress-grid preview, and
 * the Retake Anchor button (session restart is now a host-side page reload).
 */
export class RemoteScannerUIController {
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
    Type.check({ refs }, 'object');
    Type.check({ panelSetup: refs.panelSetup }, HTMLElement);
    Type.check({ panelAnchor: refs.panelAnchor }, HTMLElement);
    Type.check({ panelDetails: refs.panelDetails }, HTMLElement);
    Type.check({ captureAnchorBtn: refs.captureAnchorBtn }, HTMLButtonElement);
    Type.check({ captureDetailBtn: refs.captureDetailBtn }, HTMLButtonElement);
    Type.check({ retryCameraBtn: refs.retryCameraBtn }, HTMLButtonElement);
    Type.check({ switchCameraBtn: refs.switchCameraBtn }, HTMLButtonElement);
    Type.check({ setupMessageEl: refs.setupMessageEl }, HTMLElement);

    this.#refs = refs;
    this.#currentState = AppState.SETUP_CAMERA;
    this.#cameraSwitchLocked = false;
  }

  /** @param {import('../shared/state/AppStateMachine.js').AppStateMachine} stateMachine */
  bindStateMachine(stateMachine) {
    Type.check({ stateMachine }, AppStateMachine);
    const apply = (state) => this.#applyState(state);
    apply(stateMachine.state);
    stateMachine.onTransition((state) => apply(state));
  }

  #applyState(state) {
    Type.check({ state }, 'string');
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
  wireCallbacks(o) {
    Type.check({ parameters: o }, 'object');
    const { onCaptureAnchor, onCaptureDetail, onRetryCamera, onSwitchCamera } = o;
    Type.check({ onCaptureAnchor, onCaptureDetail, onRetryCamera, onSwitchCamera }, 'function');

    const { captureAnchorBtn, captureDetailBtn, retryCameraBtn, switchCameraBtn } = this.#refs;
    captureAnchorBtn.addEventListener('click', () => onCaptureAnchor());
    captureDetailBtn.addEventListener('click', () => onCaptureDetail());
    retryCameraBtn.addEventListener('click', () => onRetryCamera());
    switchCameraBtn?.addEventListener('click', () => onSwitchCamera());
  }

  /** @param {boolean} busy disables capture-anchor/switch-camera during the one-shot anchor capture. */
  setAnchorBusy(busy) {
    Type.check({ busy }, 'boolean');
    const { captureAnchorBtn, switchCameraBtn } = this.#refs;
    captureAnchorBtn.disabled = busy;
    if (switchCameraBtn) switchCameraBtn.disabled = busy;
  }

  /** @param {boolean} enabled whether capture-detail can be tapped right now. */
  setDetailCaptureEnabled(enabled) {
    Type.check({ enabled }, 'boolean');
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
