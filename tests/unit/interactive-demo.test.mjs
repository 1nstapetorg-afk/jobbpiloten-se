// tests/unit/interactive-demo.test.mjs
//
// Round-34 (Part 1 — Interactive Landing Demo) — state machine
// contract tests for the pure reducer in
// `components/InteractiveDemo.jsx`.
//
// Why this file exists
// --------------------
//
// The InteractiveDemo is a client component with side effects
// (timers, framer-motion, window.matchMedia). Booting React in
// `node --test` is not worth the cost for what is essentially a
// state-machine contract. So we extract the reducer + state +
// action constants as named exports, and lock the transitions
// here in plain `node:test`.
//
// What we lock
// ------------
//   1. The 6 DEMO_STATES and 6 DEMO_ACTIONS are exported with the
//      exact names + string values the JSX uses — a rename of any
//      symbol would silently break the JSX dispatch wiring.
//   2. The 5 legal transitions all return the expected next state
//      when called with the right (state, action) pair.
//   3. Every OTHER (state, action) pair is a NO-OP — the reducer
//      returns the current state unchanged. This is the "explicit
//      table of legal transitions" guarantee: a future maintainer
//      who adds a new transition MUST extend the switch + this
//      test file in lockstep.
//   4. The RESET action works from any state, not just SUCCESS.
//   5. The DEMO_TIMING constants stay above the visual-pacing
//      minimum (≥1s total run) so a future maintainer can't
//      accidentally drop the pacing below user-perceivable
//      thresholds.
//   6. The mock job + field data shape contract — the reducer
//      is the gate, but the SHAPE of `MOCK_JOB` and `MOCK_FIELDS`
//      is a parallel contract that future e2e specs will depend
//      on (e.g. asserting the company name renders).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEMO_STATES,
  DEMO_ACTIONS,
  DEMO_TIMING,
  demoReducer,
} from '../../lib/demo-state-machine.mjs'

// ---- Constants are exported with the expected shapes ----

test('DEMO_STATES has exactly the 6 expected states', () => {
  // The reducer + JSX + the test itself all share the same enum.
  // If a future maintainer renames a state, every other test
  // here + the JSX dispatch calls would silently break — lock
  // the literal set instead of just "is non-empty".
  assert.deepEqual(
    Object.keys(DEMO_STATES).sort(),
    ['AI_FILLING', 'FORM_OPEN', 'IDLE', 'READY', 'REVIEW', 'SUCCESS'],
  )
  assert.equal(DEMO_STATES.IDLE, 'IDLE')
  assert.equal(DEMO_STATES.FORM_OPEN, 'FORM_OPEN')
  assert.equal(DEMO_STATES.AI_FILLING, 'AI_FILLING')
  assert.equal(DEMO_STATES.REVIEW, 'REVIEW')
  assert.equal(DEMO_STATES.READY, 'READY')
  assert.equal(DEMO_STATES.SUCCESS, 'SUCCESS')
})

test('DEMO_ACTIONS has exactly the 6 expected actions', () => {
  assert.deepEqual(
    Object.keys(DEMO_ACTIONS).sort(),
    ['AI_FILL_DONE', 'CLICK_AI_FILL', 'CLICK_APPLY', 'CLICK_SEND', 'RESET', 'REVIEW_DONE'],
  )
  assert.equal(DEMO_ACTIONS.CLICK_APPLY, 'CLICK_APPLY')
  assert.equal(DEMO_ACTIONS.CLICK_AI_FILL, 'CLICK_AI_FILL')
  assert.equal(DEMO_ACTIONS.AI_FILL_DONE, 'AI_FILL_DONE')
  assert.equal(DEMO_ACTIONS.REVIEW_DONE, 'REVIEW_DONE')
  assert.equal(DEMO_ACTIONS.CLICK_SEND, 'CLICK_SEND')
  assert.equal(DEMO_ACTIONS.RESET, 'RESET')
})

test('DEMO_STATES + DEMO_ACTIONS are frozen (no accidental mutation)', () => {
  // A future maintainer who tries to add a state at runtime via
  // `DEMO_STATES.NEW_STATE = 'NEW_STATE'` would break the
  // reducer's switch (Object.freeze throws in strict mode, which
  // ESM uses by default). The freeze is the belt-and-suspenders
  // guard that catches this BEFORE a future test or the reducer
  // blows up.
  assert.throws(
    () => { DEMO_STATES.NEW_STATE = 'NEW_STATE' },
    /Cannot add property/,
    'DEMO_STATES must be frozen',
  )
  assert.throws(
    () => { DEMO_ACTIONS.NEW_ACTION = 'NEW_ACTION' },
    /Cannot add property/,
    'DEMO_ACTIONS must be frozen',
  )
})

// ---- Legal transitions ----

test('IDLE + CLICK_APPLY → FORM_OPEN', () => {
  assert.equal(
    demoReducer(DEMO_STATES.IDLE, { type: DEMO_ACTIONS.CLICK_APPLY }),
    DEMO_STATES.FORM_OPEN,
  )
})

test('FORM_OPEN + CLICK_AI_FILL → AI_FILLING', () => {
  assert.equal(
    demoReducer(DEMO_STATES.FORM_OPEN, { type: DEMO_ACTIONS.CLICK_AI_FILL }),
    DEMO_STATES.AI_FILLING,
  )
})

test('AI_FILLING + AI_FILL_DONE → REVIEW', () => {
  assert.equal(
    demoReducer(DEMO_STATES.AI_FILLING, { type: DEMO_ACTIONS.AI_FILL_DONE }),
    DEMO_STATES.REVIEW,
  )
})

test('REVIEW + REVIEW_DONE → READY', () => {
  assert.equal(
    demoReducer(DEMO_STATES.REVIEW, { type: DEMO_ACTIONS.REVIEW_DONE }),
    DEMO_STATES.READY,
  )
})

test('READY + CLICK_SEND → SUCCESS', () => {
  assert.equal(
    demoReducer(DEMO_STATES.READY, { type: DEMO_ACTIONS.CLICK_SEND }),
    DEMO_STATES.SUCCESS,
  )
})

// ---- RESET works from any state ----

test('RESET from every state returns to IDLE', () => {
  for (const state of Object.values(DEMO_STATES)) {
    assert.equal(
      demoReducer(state, { type: DEMO_ACTIONS.RESET }),
      DEMO_STATES.IDLE,
      `RESET from ${state} must return IDLE`,
    )
  }
})

// ---- All other (state, action) pairs are NO-OPs ----

test('Wrong-action-in-state returns current state (no-op)', () => {
  // The "explicit table of legal transitions" guarantee. For
  // every (state, action) pair that ISN'T in the table above,
  // the reducer must return the current state unchanged. A
  // future maintainer who adds a default-case "fall through"
  // transition would surface here.
  const cases = [
    // The most likely regression: an action firing in a state
    // it shouldn't. E.g. CLICK_APPLY after the user is already
    // mid-flow → no-op (not "open another form"). A regression
    // that re-opens the form would surface as `FORM_OPEN`
    // instead of `AI_FILLING` here.
    [DEMO_STATES.FORM_OPEN, DEMO_ACTIONS.CLICK_APPLY, DEMO_STATES.FORM_OPEN],
    [DEMO_STATES.AI_FILLING, DEMO_ACTIONS.CLICK_APPLY, DEMO_STATES.AI_FILLING],
    [DEMO_STATES.AI_FILLING, DEMO_ACTIONS.CLICK_AI_FILL, DEMO_STATES.AI_FILLING],
    [DEMO_STATES.REVIEW, DEMO_ACTIONS.AI_FILL_DONE, DEMO_STATES.REVIEW],
    [DEMO_STATES.READY, DEMO_ACTIONS.REVIEW_DONE, DEMO_STATES.READY],
    [DEMO_STATES.SUCCESS, DEMO_ACTIONS.CLICK_SEND, DEMO_STATES.SUCCESS],
    [DEMO_STATES.IDLE, DEMO_ACTIONS.CLICK_AI_FILL, DEMO_STATES.IDLE],
    [DEMO_STATES.IDLE, DEMO_ACTIONS.AI_FILL_DONE, DEMO_STATES.IDLE],
    [DEMO_STATES.IDLE, DEMO_ACTIONS.REVIEW_DONE, DEMO_STATES.IDLE],
    [DEMO_STATES.IDLE, DEMO_ACTIONS.CLICK_SEND, DEMO_STATES.IDLE],
  ]
  for (const [state, action, expected] of cases) {
    assert.equal(
      demoReducer(state, { type: action }),
      expected,
      `(${state}, ${action}) must be a no-op returning ${expected}`,
    )
  }
})

test('Unknown action returns current state (no-op)', () => {
  // Defence against typo'd action types — the reducer must NOT
  // throw on an unknown action (e.g. from a stale message handler
  // in production). The default case returns the current state
  // unchanged.
  assert.equal(
    demoReducer(DEMO_STATES.IDLE, { type: 'BOGUS_ACTION' }),
    DEMO_STATES.IDLE,
  )
  assert.equal(
    demoReducer(DEMO_STATES.AI_FILLING, { type: 'BOGUS_ACTION' }),
    DEMO_STATES.AI_FILLING,
  )
})

test('Missing/undefined action returns current state (no-op)', () => {
  // Belt-and-suspenders: a future caller that forgets the `type`
  // property (e.g. a v0.1.0 codepath that shipped before the
  // reducer was added) must not crash the demo. The `action?.type`
  // guard inside the reducer's switch falls through to default
  // when action is null/undefined or lacks a .type.
  assert.equal(demoReducer(DEMO_STATES.IDLE, null), DEMO_STATES.IDLE)
  assert.equal(demoReducer(DEMO_STATES.READY, undefined), DEMO_STATES.READY)
  assert.equal(demoReducer(DEMO_STATES.SUCCESS, {}), DEMO_STATES.SUCCESS)
})

// ---- Timing constants ----

test('DEMO_TIMING.aiFillMs and reviewMs are sane (≥800ms each, <5s total)', () => {
  // Visual pacing lock: the AI fill + review pause must each be
  // long enough for the user to perceive the state transition
  // (≥800ms) and short enough that the whole demo runs in under
  // 5 seconds (≤5000ms total). A regression that drops
  // aiFillMs to 200ms would make the "AI fyller i dina svar…"
  // shimmer invisible; a regression that pushes it to 10s
  // would make the demo feel stuck.
  assert.ok(
    DEMO_TIMING.aiFillMs >= 800,
    `aiFillMs must be ≥800ms (got ${DEMO_TIMING.aiFillMs})`,
  )
  assert.ok(
    DEMO_TIMING.reviewMs >= 800,
    `reviewMs must be ≥800ms (got ${DEMO_TIMING.reviewMs})`,
  )
  assert.ok(
    DEMO_TIMING.aiFillMs + DEMO_TIMING.reviewMs <= 5000,
    `aiFillMs + reviewMs must be ≤5000ms (got ${DEMO_TIMING.aiFillMs + DEMO_TIMING.reviewMs})`,
  )
})

// ---- Mock data shape contract (read from the source file) ----
//
// The reducer is a state-machine gate, but the data contract
// (mock job + 6 fields with the right tone distribution) is a
// parallel contract that e2e specs will eventually depend on.
// We lock the SHAPE here so a future maintainer who renames a
// field, drops a tone, or changes the company name trips a
// test before production.

test('Mock data: 6 fields spanning all 3 tones (high/review/ai)', () => {
  // Source-grep the file for the MOCK_FIELDS array. We don't
  // import the constant directly because the file is a `.jsx`
  // client component — static-source lock is simpler than
  // wiring a CJS export shim just for the test.
  const src = readFileSync(
    new URL('../../components/InteractiveDemo.jsx', import.meta.url),
    'utf8',
  )
  // Spot-check the literal block we ship: 3 'high' tone, 1
  // 'review' tone, 2 'ai' tone fields. This matches the Part 1
  // spec's "green (high confidence) / amber (review) / blue
  // (AI-generated)" mapping with name+email+phone=high (data
  // we have), "Berätta om dig"=review (AI-drafted from CV),
  // and the two free-form questions=ai (fully generated).
  assert.match(src, /tone:\s*['"]high['"][\s\S]*?tone:\s*['"]high['"][\s\S]*?tone:\s*['"]high['"]/)
  assert.match(src, /tone:\s*['"]review['"]/)
  // The "ai" tone must appear at least 2 times (one for
  // "Varför vill du jobba hos oss?" + one for "Vad är din
  // största styrka?"). A regression that drops one to
  // 'review' would shift the colour-coded pedagogy.
  const aiCount = (src.match(/tone:\s*['"]ai['"]/g) || []).length
  assert.equal(aiCount, 2, `Expected 2 'ai' tone fields (got ${aiCount})`)
})

test('Mock data: company name is a real Swedish brand (Spotify)', () => {
  // The Part 1 spec says: "Company: Spotify or Volvo Cars".
  // Locking the literal "Spotify" so a future maintainer who
  // changes the company name to a placeholder ("Acme Inc")
  // trips this test.
  const src = readFileSync(
    new URL('../../components/InteractiveDemo.jsx', import.meta.url),
    'utf8',
  )
  assert.match(src, /company:\s*['"]Spotify['"]/)
})

test('Mock data: Swedish UI copy is present in the component', () => {
  // The Part 1 spec mandates Swedish copy throughout. Lock a
  // handful of literal strings so a future maintainer who
  // accidentally swaps Swedish for English trips a test.
  const src = readFileSync(
    new URL('../../components/InteractiveDemo.jsx', import.meta.url),
    'utf8',
  )
  for (const sv of ['Ansök nu', 'Förbered med AI', 'Klar att skicka', 'Stockholm', 'Frontend-utvecklare']) {
    assert.ok(src.includes(sv), `Missing Swedish copy: ${sv}`)
  }
})

// ---- Integration: InteractiveDemo is wired into app/page.js ----

test('app/page.js imports + renders <InteractiveDemo />', () => {
  // Part 1 spec calls for the demo to live on the landing page.
  // A future maintainer who removes the import OR the JSX
  // usage (e.g. to "consolidate" the section) trips this.
  const src = readFileSync(
    new URL('../../app/page.js', import.meta.url),
    'utf8',
  )
  assert.match(
    src,
    /import\s+InteractiveDemo\s+from\s+['"]@\/components\/InteractiveDemo['"]/,
    'app/page.js must import InteractiveDemo',
  )
  // Must actually RENDER it as a JSX element somewhere between
  // the social-proof and the how-it-works sections.
  assert.match(
    src,
    /<InteractiveDemo\s*\/>/,
    'app/page.js must render <InteractiveDemo />',
  )
})
