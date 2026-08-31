// tests/unit/browser-sessions.test.mjs
//
// Round-95 (mobile in-app browser) — locks the pure session-management
// contract in lib/browser-sessions.js: tab add / remove / switch / dedupe,
// the autofill flag, the last-tab-closes-browser behaviour, and the
// sessionLabel() pill-label helper.
//
// Run via `yarn test:unit` (`node --test tests/unit/**`).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  initialBrowserState,
  browserReducer,
  createSession,
  createSessionId,
  getActiveSession,
  sessionLabel,
} from '../../lib/browser-sessions.js'

// Deterministic session factory (id/url explicit so tests don't depend on
// Date.now / the global counter).
function sess(id, url, extra = {}) {
  return { id, nativeId: null, url, title: '', favicon: null, scrollPosition: 0, createdAt: '2026-08-19T00:00:00.000Z', canAutofill: false, ...extra }
}

test('createSessionId returns unique, prefixed ids', () => {
  const a = createSessionId()
  const b = createSessionId()
  assert.notEqual(a, b)
  assert.ok(a.startsWith('session-'), 'id must carry the session- prefix')
  assert.ok(b.startsWith('session-'))
})

test('createSession builds the documented shape with canAutofill=false', () => {
  const s = createSession('https://ledigajobb.se/1', 'Frontend-utvecklare')
  assert.equal(s.url, 'https://ledigajobb.se/1')
  assert.equal(s.title, 'Frontend-utvecklare')
  assert.equal(s.nativeId, null)
  assert.equal(s.favicon, null)
  assert.equal(s.scrollPosition, 0)
  assert.equal(s.canAutofill, false)
  assert.ok(s.id.startsWith('session-'))
  assert.ok(typeof s.createdAt === 'string')
})

test('initialBrowserState is empty + closed', () => {
  assert.deepEqual(initialBrowserState, { sessions: [], activeSessionId: null, isBrowserOpen: false })
})

test('ADD_SESSION opens the browser, appends, and activates', () => {
  const s = sess('s1', 'https://a.se')
  const next = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: s })
  assert.equal(next.isBrowserOpen, true)
  assert.equal(next.sessions.length, 1)
  assert.equal(next.activeSessionId, 's1')
  assert.equal(getActiveSession(next).id, 's1')
})

test('ADD_SESSION de-dupes by URL (switches to the existing tab)', () => {
  const state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  const next = browserReducer(state, { type: 'ADD_SESSION', session: sess('s2', 'https://a.se', { title: 'dup' }) })
  assert.equal(next.sessions.length, 1, 'duplicate URL must not add a second tab')
  assert.equal(next.activeSessionId, 's1', 'duplicate URL must switch to the existing tab')
})

test('ADD_SESSION allows blank tabs (url "") to coexist', () => {
  let state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('blank1', '') })
  state = browserReducer(state, { type: 'ADD_SESSION', session: sess('blank2', '') })
  assert.equal(state.sessions.length, 2, 'blank tabs must not dedupe against each other')
  assert.equal(state.activeSessionId, 'blank2')
})

test('SWITCH_SESSION changes the active tab', () => {
  let state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  state = browserReducer(state, { type: 'ADD_SESSION', session: sess('s2', 'https://b.se') })
  const next = browserReducer(state, { type: 'SWITCH_SESSION', id: 's1' })
  assert.equal(next.activeSessionId, 's1')
  // Unknown id is a no-op.
  assert.equal(browserReducer(next, { type: 'SWITCH_SESSION', id: 'nope' }).activeSessionId, 's1')
})

test('REMOVE_SESSION switches to the next neighbour when the active tab closes', () => {
  let state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  state = browserReducer(state, { type: 'ADD_SESSION', session: sess('s2', 'https://b.se') })
  state = browserReducer(state, { type: 'ADD_SESSION', session: sess('s3', 'https://c.se') })
  state = browserReducer(state, { type: 'SWITCH_SESSION', id: 's2' })
  const next = browserReducer(state, { type: 'REMOVE_SESSION', id: 's2' })
  assert.deepEqual(next.sessions.map((s) => s.id), ['s1', 's3'])
  assert.equal(next.activeSessionId, 's3', 'next-in-line neighbour becomes active')
  assert.equal(next.isBrowserOpen, true)
})

test('REMOVE_SESSION falls back to the previous neighbour at the end of the list', () => {
  let state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  state = browserReducer(state, { type: 'ADD_SESSION', session: sess('s2', 'https://b.se') })
  const next = browserReducer(state, { type: 'REMOVE_SESSION', id: 's2' })
  assert.equal(next.activeSessionId, 's1')
})

test('REMOVE_SESSION closes the browser when the last tab is removed', () => {
  const state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  const next = browserReducer(state, { type: 'REMOVE_SESSION', id: 's1' })
  assert.equal(next.sessions.length, 0)
  assert.equal(next.activeSessionId, null)
  assert.equal(next.isBrowserOpen, false)
})

test('CLOSE_BROWSER tears everything down', () => {
  let state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  state = browserReducer(state, { type: 'ADD_SESSION', session: sess('s2', 'https://b.se') })
  const next = browserReducer(state, { type: 'CLOSE_BROWSER' })
  assert.deepEqual(next, initialBrowserState)
})

test('UPDATE_SESSION merges a patch (nativeId / url)', () => {
  const state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  const next = browserReducer(state, { type: 'UPDATE_SESSION', id: 's1', patch: { nativeId: 'wv-1', url: 'https://a.se/2' } })
  assert.equal(next.sessions[0].nativeId, 'wv-1')
  assert.equal(next.sessions[0].url, 'https://a.se/2')
})

test('SET_CAN_AUTOFILL toggles only the target session', () => {
  let state = browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: sess('s1', 'https://a.se') })
  state = browserReducer(state, { type: 'ADD_SESSION', session: sess('s2', 'https://b.se') })
  const next = browserReducer(state, { type: 'SET_CAN_AUTOFILL', id: 's1', canAutofill: true })
  assert.equal(next.sessions.find((s) => s.id === 's1').canAutofill, true)
  assert.equal(next.sessions.find((s) => s.id === 's2').canAutofill, false)
})

test('sessionLabel prefers the title and falls back to "Jobb N"', () => {
  assert.equal(sessionLabel(sess('s1', 'https://a.se', { title: 'Frontend-utvecklare' }), 0), 'Frontend-utvecklare')
  assert.equal(sessionLabel(sess('s1', 'https://a.se'), 0), 'Jobb 1')
  assert.equal(sessionLabel(sess('s2', 'https://b.se'), 3), 'Jobb 4')
})

test('sessionLabel truncates over-long titles', () => {
  const long = 'En väldigt lång jobbtitel som definitivt behöver kortas ner'
  const label = sessionLabel(sess('s1', 'https://a.se', { title: long }), 0)
  assert.ok(label.length <= 22, 'label must be capped')
  assert.ok(label.endsWith('…'), 'truncated label must end with an ellipsis')
})

test('browserReducer ignores malformed actions', () => {
  assert.equal(browserReducer(initialBrowserState, null), initialBrowserState)
  assert.equal(browserReducer(initialBrowserState, {}), initialBrowserState)
  assert.equal(browserReducer(initialBrowserState, { type: 'UNKNOWN' }), initialBrowserState)
  // ADD_SESSION with no session / no id is a no-op.
  assert.equal(browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: null }), initialBrowserState)
  assert.equal(browserReducer(initialBrowserState, { type: 'ADD_SESSION', session: {} }), initialBrowserState)
})
