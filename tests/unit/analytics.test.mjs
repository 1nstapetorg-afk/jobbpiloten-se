// tests/unit/analytics.test.mjs
//
// Unit tests for lib/analytics.js. Validates the structured event
// contract (event name regex, props filtering), the rolling p95
// timing tracker, and the EVENTS constant freeze. The captureError
// and trackEventClient paths are tested by integration via
// /api/track (see app/api/track/route.js — has no unit test
// because it needs the Next.js runtime).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  trackEvent,
  captureError,
  recordTiming,
  getTimingStats,
  getAllTimingStats,
  EVENTS,
} from '../../lib/analytics.js'

// Disable the no-op env so we can exercise the code path
// explicitly. ANALYTICS_DISABLED=1 is honoured by the module.
process.env.ANALYTICS_DISABLED = '0'

test('trackEvent is a no-op for missing / malformed names', () => {
  // Capture the console.log output to ensure the helper does NOT
  // emit a line for these cases. Note: single-segment lowercase
  // names ARE valid since Round-43 (relaxed the regex to allow
  // `signup` alongside `landing.page_view`), so the test below
  // uses ONLY truly malformed inputs.
  const original = console.log
  const lines = []
  console.log = (...args) => lines.push(args.join(' '))
  try {
    trackEvent(null)
    trackEvent('')
    trackEvent('Upper.Case')        // uppercase letter
    trackEvent('1leading.numeric')  // leading digit
    trackEvent('space here.now')    // contains space
    trackEvent('special!char.now')  // contains !
    trackEvent('dots..double')      // double dot
    assert.equal(lines.length, 0, `expected 0 lines, got ${lines.length}: ${lines.join(' | ')}`)
  } finally {
    console.log = original
  }
})

test('trackEvent emits structured JSON with v=1 schema marker', () => {
  const original = console.log
  let captured = ''
  console.log = (line) => { captured = String(line) }
  try {
    trackEvent('test.event_name', { userId: 'abc', value: 42, on: true })
  } finally {
    console.log = original
  }
  const parsed = JSON.parse(captured)
  assert.equal(parsed.evt, 'jobbpiloten.event')
  assert.equal(parsed.v, 1)
  assert.equal(parsed.name, 'test.event_name')
  assert.equal(parsed.userId, 'abc')
  assert.equal(parsed.value, 42)
  assert.equal(parsed.on, true)
  assert.ok(typeof parsed.ts === 'string' && parsed.ts.endsWith('Z'))
})

test('trackEvent stringifies objects + filters invalid keys', () => {
  const original = console.log
  let captured = ''
  console.log = (line) => { captured = String(line) }
  try {
    trackEvent('test.event', {
      'good_key': 'value',
      'bad-key': 'dropped',
      '1leading': 'dropped',
      'with space': 'dropped',
      nested: { ok: 1 },
      arr: [1, 2],
      undef: undefined,
      nullVal: null,
    })
  } finally {
    console.log = original
  }
  const parsed = JSON.parse(captured)
  assert.equal(parsed.good_key, 'value')
  assert.equal(parsed.bad_key, undefined)
  assert.equal(parsed['1leading'], undefined)
  assert.equal(parsed['with space'], undefined)
  assert.ok(typeof parsed.nested === 'string', 'object should be stringified')
  assert.ok(typeof parsed.arr === 'string', 'array should be stringified')
  assert.equal(parsed.nullVal, null)
})

test('captureError emits structured JSON with v=1 marker', () => {
  const original = console.error
  let captured = ''
  console.error = (line) => { captured = String(line) }
  try {
    captureError(new Error('boom'), { route: 'test', tag: 'x' })
    captureError('string error', { route: 'test' })
    captureError(null) // no-op
  } finally {
    console.error = original
  }
  assert.ok(captured.length > 0)
  // The LAST non-null call wins; null is a no-op so the second
  // call's payload is what's captured.
  const lines = captured.split('\n').filter(Boolean)
  const last = JSON.parse(lines[lines.length - 1])
  assert.equal(last.evt, 'jobbpiloten.error')
  assert.equal(last.v, 1)
  assert.equal(last.error, 'string error')
  assert.equal(last.route, 'test')
})

test('recordTiming + getTimingStats computes p95 over the rolling window', () => {
  // Use a unique route so we don't collide with other tests that
  // might run in the same process and share the module-level
  // `_timings` map.
  const ROUTE = `/__test_${Date.now()}_${Math.random().toString(36).slice(2)}`
  for (let i = 1; i <= 100; i++) recordTiming('GET', ROUTE, i)
  const stats = getTimingStats('GET', ROUTE)
  assert.equal(stats.count, 100)
  assert.ok(stats.p50 >= 49 && stats.p50 <= 51, `p50 ~ 50 (got ${stats.p50})`)
  // p95 of 1..100 is 95. Use a small tolerance window.
  assert.ok(stats.p95 >= 93 && stats.p95 <= 96, `p95 ~ 95 (got ${stats.p95})`)
  assert.ok(stats.p99 >= 97 && stats.p99 <= 100, `p99 ~ 99 (got ${stats.p99})`)
  assert.ok(stats.mean > 0)
})

test('getTimingStats returns zeros for an unknown route', () => {
  const stats = getTimingStats('GET', '/__definitely_not_recorded__')
  assert.equal(stats.count, 0)
  assert.equal(stats.p50, null)
  assert.equal(stats.p95, null)
})

test('recordTiming ignores negative / non-numeric values', () => {
  const ROUTE = '/__test_neg'
  recordTiming('GET', ROUTE, -5)
  recordTiming('GET', ROUTE, 'oops')
  recordTiming('GET', ROUTE, NaN)
  recordTiming('GET', ROUTE, Infinity)
  recordTiming('GET', ROUTE, 42)
  const stats = getTimingStats('GET', ROUTE)
  assert.equal(stats.count, 1, 'only the single valid timing should be recorded')
  assert.equal(stats.p50, 42)
})

test('recordTiming caps window to 256 entries', () => {
  const ROUTE = '/__test_cap'
  for (let i = 0; i < 300; i++) recordTiming('GET', ROUTE, i)
  const stats = getTimingStats('GET', ROUTE)
  assert.equal(stats.count, 256, 'window should be capped at 256')
})

test('getAllTimingStats returns the full per-key map', () => {
  const ROUTE = '/__test_all'
  recordTiming('POST', ROUTE, 12)
  recordTiming('POST', ROUTE, 24)
  const all = getAllTimingStats()
  assert.ok(all['POST ' + ROUTE], 'key should be `METHOD route`')
  assert.equal(all['POST ' + ROUTE].count, 2)
})

test('EVENTS is frozen + contains all spec-mandated names', () => {
  assert.ok(Object.isFrozen(EVENTS), 'EVENTS should be frozen')
  const required = [
    'landing_page_view',
    'landing_cta_click',
    'demo_interaction',
    'signup_started',
    'signup_completed',
    'first_job_match_viewed',
    'first_coverletter_generated',
    'application_prepared',
    'application_sent',
    'extension_installed',
    'extension_field_filled',
    'answer_memory_used',
    'style_changed',
    'subscription_started',
    'subscription_cancelled',
    'payment_failed',
  ]
  for (const r of required) {
    assert.equal(EVENTS[r.toUpperCase()], r, `EVENTS should include ${r}`)
  }
})
