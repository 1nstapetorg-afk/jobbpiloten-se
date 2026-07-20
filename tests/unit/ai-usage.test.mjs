// tests/unit/ai-usage.test.mjs
//
// Pure-JS unit tests for lib/ai-usage.js. The Mongo-bound helpers
// (getCurrentCount, incrementUsage, getUsageSnapshot) are exercised
// separately by an integration test if/when Mongo is available
// (tests/integration/ai-usage.test.mjs); here we test the pure
// functions so the suite stays fast (<50 ms) and doesn't need
// fixtures.
//
// Run via `yarn test:unit` (the package.json script wires
// `node --test tests/unit/**`). The tests are also auto-discovered
// by `npm test` in CI.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_TIER_LIMITS,
  monthKey,
  getMonthlyLimitFor,
  getUsageSnapshot,
  isWithinLimit,
} from '../../lib/ai-usage.js'

test('AI_TIER_LIMITS exposes the soft-launch tiers verbatim', () => {
  // The exact numbers drive the user-visible copy on /settings
  // AND the server-side hard cap. Drift between these surfaces as
  // either a misleading UI ("X svar kvar" off by 5) or a server
  // 429 a user didn't expect. Lock the table.
  assert.equal(AI_TIER_LIMITS.Basic, 10)
  assert.equal(AI_TIER_LIMITS.Professional, 50)
  assert.equal(AI_TIER_LIMITS.Elite, Infinity)
})

test('getMonthlyLimitFor defaults unknown tiers to Basic', () => {
  // A user without a tier (demo creation, migration race, etc.)
  // should still benefit from the soft-launch Basic cap rather
  // than crashing the route or silently inheriting a tier of 0.
  assert.equal(getMonthlyLimitFor(undefined), 10)
  assert.equal(getMonthlyLimitFor(null), 10)
  assert.equal(getMonthlyLimitFor('Random'), 10)
  assert.equal(getMonthlyLimitFor(''), 10)
})

test('getMonthlyLimitFor returns the mapped value for known tiers', () => {
  assert.equal(getMonthlyLimitFor('Basic'), 10)
  assert.equal(getMonthlyLimitFor('Professional'), 50)
  assert.equal(getMonthlyLimitFor('Elite'), Infinity)
})

test('isWithinLimit returns false at the cap', () => {
  // Asking for ANY positive delta when the user is already AT cap
  // must return false. The pre-flight is the only thing that
  // protects the user from being silently downgraded; this guard
  // is non-negotiable.
  assert.equal(isWithinLimit(10, 1, 10), false)
  assert.equal(isWithinLimit(10, 12, 10), false)
})

test('isWithinLimit returns true under cap', () => {
  assert.equal(isWithinLimit(9, 1, 10), true)
  assert.equal(isWithinLimit(0, 10, 10), true)
})

test('isWithinLimit never rejects Elite (Infinity cap)', () => {
  // Elite users can never hit the cap. Any sane input returns true.
  assert.equal(isWithinLimit(999_999, 1000, Infinity), true)
  assert.equal(isWithinLimit(0, 12, Infinity), true)
})

test('isWithinLimit tolerates degenerate inputs gracefully', () => {
  // The route handler is hot — defending against a malformed
  // increment value from a future bug is cheaper than a 500.
  assert.equal(isWithinLimit(-1, 1, 10), true)
  assert.equal(isWithinLimit(0, 0, 10), true)
  assert.equal(isWithinLimit(0, -5, 10), true)
})

test('monthKey emits YYYY-MM in UTC', () => {
  // Cron and settings use UTC month boundaries so an evening
  // Swedish cron tick doesn't accidentally roll into the next
  // day vs the user's "today" perception.
  assert.equal(monthKey(new Date('2026-01-15T00:00:00Z')), '2026-01')
  assert.equal(monthKey(new Date('2026-12-31T23:59:59Z')), '2026-12')
  assert.equal(monthKey(new Date('2026-07-10T08:00:00Z')), '2026-07')
})

test('getUsageSnapshot is async and never throws on a missing profile', () => {
  // Without a db handle the helper must NOT throw — it returns a
  // conservative default that the /settings page can still paint.
  // This is the contract the 500-fallback branch in
  // /api/ai-usage/route.js relies on.
  return getUsageSnapshot(null, null).then((snap) => {
    assert.equal(snap.tier, 'Basic')
    assert.equal(snap.limit, 10)
    assert.equal(snap.count, 0)
    assert.equal(snap.remaining, 10)
    assert.match(snap.month, /^\d{4}-\d{2}$/)
  })
})
