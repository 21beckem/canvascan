import { Type } from '../shared/utils/Type.js';
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
  #currentState;
  #cameraSwitchLocked;

  #panelSetupNode;
  #panelAnchorNode;
  #panelDetailsNode;
  #setupMessageElNode;
  #progressMapElNode;
  #captureAnchorBtnNode;
  #captureDetailBtnNode;
  #retryCameraBtnNode;
  #switchCameraBtnNode;
  #exportBtnNode;

  constructor(o) {
    Type.check({ parameters: o }, 'object');
    const { panelSetup, panelAnchor, panelDetails, captureAnchorBtn, captureDetailBtn, retryCameraBtn, switchCameraBtn, setupMessageEl, progressMapEl, exportBtn } = o;
    Type.check({ panelSetup,  panelAnchor,  panelDetails,  setupMessageEl,  progressMapEl }, HTMLElement);
    Type.check({ captureAnchorBtn, captureDetailBtn, retryCameraBtn, switchCameraBtn, exportBtn }, HTMLButtonElement);

    this.#panelSetupNode = panelSetup;
    this.#panelAnchorNode = panelAnchor;
    this.#panelDetailsNode = panelDetails;
    this.#setupMessageElNode = setupMessageEl;
    this.#progressMapElNode = progressMapEl;
    this.#captureAnchorBtnNode = captureAnchorBtn;
    this.#captureDetailBtnNode = captureDetailBtn;
    this.#retryCameraBtnNode = retryCameraBtn;
    this.#switchCameraBtnNode = switchCameraBtn;
    this.#exportBtnNode = exportBtn;

    this.#currentState = AppState.SETUP_CAMERA;
    this.#cameraSwitchLocked = false;
    if (this.#exportBtnNode) this.#exportBtnNode.hidden = false;
  }

  /** @param {import('../shared/state/AppStateMachine.js').AppStateMachine} stateMachine */
  bindStateMachine(stateMachine) {
    const apply = (state) => this.#applyState(state);
    apply(stateMachine.state);
    stateMachine.onTransition((state) => apply(state));
  }

  #applyState(state) {
    this.#currentState = state;
    this.#panelSetupNode.hidden = state !== AppState.SETUP_CAMERA;
    this.#panelAnchorNode.hidden = state !== AppState.CAPTURE_ANCHOR;
    this.#panelDetailsNode.hidden = state !== AppState.CAPTURE_DETAILS;

    if (this.#progressMapElNode) this.#progressMapElNode.hidden = state !== AppState.CAPTURE_DETAILS;
    if (this.#switchCameraBtnNode) {
      this.#switchCameraBtnNode.hidden =
        this.#cameraSwitchLocked || state !== AppState.CAPTURE_ANCHOR;
    }
  }

  wireCallbacks(o) {
    Type.check({ parameters: o }, 'object');
    const { onCaptureAnchor, onCaptureDetail, onRetryCamera, onSwitchCamera, onExport } = o;
    Type.check({ onCaptureAnchor, onCaptureDetail, onRetryCamera, onSwitchCamera, onExport }, 'function');

    this.#captureAnchorBtnNode.addEventListener('click', () => onCaptureAnchor());
    this.#captureDetailBtnNode.addEventListener('click', () => onCaptureDetail());
    this.#retryCameraBtnNode.addEventListener('click', () => onRetryCamera());
    this.#switchCameraBtnNode?.addEventListener('click', () => onSwitchCamera());
    this.#exportBtnNode?.addEventListener('click', () => onExport());
  }

  /** @param {boolean} busy disables capture-anchor/switch-camera during the one-shot anchor capture. */
  setAnchorBusy(busy) {
    Type.check({ busy }, 'boolean');
    this.#captureAnchorBtnNode.disabled = busy;
    if (this.#switchCameraBtnNode) this.#switchCameraBtnNode.disabled = busy;
  }

  /** Permanently hides the switch-camera control. */
  lockCameraSwitching() {
    this.#cameraSwitchLocked = true;
    this.#applyState(this.#currentState);
  }

  /** @param {boolean} enabled whether Export can be tapped right now. */
  setExportEnabled(enabled) {
    if (this.#exportBtnNode) this.#exportBtnNode.disabled = !enabled;
  }

  showSetupError(message) {
    this.#setupMessageElNode.textContent = message;
    this.#retryCameraBtnNode.hidden = false;
  }

  showSetupMessage(message) {
    this.#setupMessageElNode.textContent = message;
    this.#retryCameraBtnNode.hidden = true;
  }
}
