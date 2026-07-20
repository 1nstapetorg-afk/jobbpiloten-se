// lib/demo-state-machine.mjs
//
// Round-34 (Part 1 — Interactive Landing Demo). Pure ES module
// extraction of the demo's state machine. Lives in lib/ instead of
// components/ because (a) it has no React/JSX dependency, and
// (b) it must be importable from `node --test` — which can NOT
// parse `.jsx` files. The InteractiveDemo component imports the
// reducer from here; the unit tests import it from here too.
//
// Single source of truth for the demo's view-state. The reducer
// is a pure function: (state, action) → state. Side effects
// (timers, window.matchMedia) live in the component; the
// reducer owns the state shape and the table of legal
// transitions.

export const DEMO_STATES = Object.freeze({
  IDLE: 'IDLE',
  FORM_OPEN: 'FORM_OPEN',
  AI_FILLING: 'AI_FILLING',
  REVIEW: 'REVIEW',
  READY: 'READY',
  SUCCESS: 'SUCCESS',
})

export const DEMO_ACTIONS = Object.freeze({
  CLICK_APPLY: 'CLICK_APPLY',
  CLICK_AI_FILL: 'CLICK_AI_FILL',
  AI_FILL_DONE: 'AI_FILL_DONE',
  REVIEW_DONE: 'REVIEW_DONE',
  CLICK_SEND: 'CLICK_SEND',
  RESET: 'RESET',
})

// Visual pacing. Centralised so a designer can tweak demo tempo
// without grepping for setTimeout calls. Total demo run is ~3.7s
// (apply → AI fill → review pause → ready → click) which fits
// inside the typical landing-page dwell window.
export const DEMO_TIMING = Object.freeze({
  aiFillMs: 2200,
  reviewMs: 1500,
})

export function demoReducer(state, action) {
  switch (action?.type) {
    case DEMO_ACTIONS.CLICK_APPLY:
      return state === DEMO_STATES.IDLE ? DEMO_STATES.FORM_OPEN : state
    case DEMO_ACTIONS.CLICK_AI_FILL:
      return state === DEMO_STATES.FORM_OPEN ? DEMO_STATES.AI_FILLING : state
    case DEMO_ACTIONS.AI_FILL_DONE:
      return state === DEMO_STATES.AI_FILLING ? DEMO_STATES.REVIEW : state
    case DEMO_ACTIONS.REVIEW_DONE:
      return state === DEMO_STATES.REVIEW ? DEMO_STATES.READY : state
    case DEMO_ACTIONS.CLICK_SEND:
      return state === DEMO_STATES.READY ? DEMO_STATES.SUCCESS : state
    case DEMO_ACTIONS.RESET:
      return DEMO_STATES.IDLE
    default:
      return state
  }
}
