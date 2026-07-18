/**
 * AppStateMachine.js
 * Finite state machine governing the three top-level UI states:
 *   SETUP_CAMERA  -> State A
 *   CAPTURE_ANCHOR -> State B
 *   CAPTURE_DETAILS -> State C
 *
 * In the phone/computer split architecture, sessions are pooled across any
 * number of connected phones: a phone that joins after another phone has
 * already set the anchor should skip straight from SETUP_CAMERA to
 * CAPTURE_DETAILS. There is no way back to CAPTURE_ANCHOR (no "retake" —
 * restarting a session means reloading the host page).
 */

export const AppState = Object.freeze({
  SETUP_CAMERA: 'SETUP_CAMERA',
  CAPTURE_ANCHOR: 'CAPTURE_ANCHOR',
  CAPTURE_DETAILS: 'CAPTURE_DETAILS',
});

/** Allowed forward transitions between states (one-directional, no going back). */
const TRANSITIONS = Object.freeze({
  [AppState.SETUP_CAMERA]: [AppState.CAPTURE_ANCHOR, AppState.CAPTURE_DETAILS],
  [AppState.CAPTURE_ANCHOR]: [AppState.CAPTURE_DETAILS],
  [AppState.CAPTURE_DETAILS]: [],
});

export class AppStateMachine {
  #state;
  #listeners;

  constructor(initialState = AppState.SETUP_CAMERA) {
    this.#state = initialState;
    this.#listeners = new Set();
  }

  static create() {
    return new AppStateMachine(AppState.SETUP_CAMERA);
  }

  /** @returns {string} the current state. */
  get state() {
    return this.#state;
  }

  /**
   * Registers a listener invoked as `(newState, previousState) => void`
   * whenever a transition succeeds.
   * @param {(newState: string, previousState: string) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onTransition(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Attempts to transition to `nextState`. Throws if the transition is not
   * permitted from the current state.
   * @param {string} nextState
   */
  transition(nextState) {
    const allowed = TRANSITIONS[this.#state] ?? [];
    if (!allowed.includes(nextState)) {
      throw new Error(
        `AppStateMachine: illegal transition from ${this.#state} to ${nextState}`
      );
    }
    const previous = this.#state;
    this.#state = nextState;
    for (const listener of this.#listeners) {
      listener(nextState, previous);
    }
  }

  is(state) {
    return this.#state === state;
  }
}
