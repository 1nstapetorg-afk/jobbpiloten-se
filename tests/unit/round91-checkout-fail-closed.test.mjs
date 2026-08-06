// tests/unit/round91-checkout-fail-closed.test.mjs
//
// Round-91 (P1 #3) — structural lock for the checkout fail-closed
// branch in app/api/[[...path]]/route.js.
//
// CONTEXT
// -------
// The catch-all's `checkout` branch must distinguish TWO failure
// modes that pre-Round-91 collapsed into one `!priceId` check:
//
//   • an invalid tier/interval combo       → 400 'Invalid tier/interval'
//     (a client bug — the caller sent a tier/interval that is not one
//     of the 6 canonical combos)
//   • a VALID combo whose STRIPE_PRICE_* env var is unset
//     → 503 { code: 'PRICING_NOT_CONFIGURED' } (a deploy gap)
//
// Pre-fix, a valid combo with an unset env var reached Stripe with
// `undefined` as the price and surfaced a raw English Stripe error to
// the user. `Object.prototype.hasOwnProperty` on PRICE_MAP tells the
// two apart: the key exists only for the 6 canonical combos, and its
// value is `undefined` exactly when the matching env var is missing.
//
// Why structural locks (not an import-based behavioural test): the
// catch-all imports the Mongo singleton, Stripe, pdf-report, groq,
// push, avatar registry, style presets, field taxonomy — importing
// it into a `node --test` file pulls a whole dependency graph and a
// DB connection. The cheapest early-warning barrier is source-grep
// for the two branches, their ORDER (hasOwnProperty guard BEFORE the
// value check, Stripe session create AFTER both), and the PRICE_MAP
// env wiring — exactly the parts most likely to drift during a
// refactor. Behavioural coverage of the happy path lives in the
// Stripe webhook tests + the manual/e2e checkout flow.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const ROUTE_SRC = fs.readFileSync(path.join(ROOT, 'app/api/[[...path]]/route.js'), 'utf-8')

// The 6 canonical tier:interval combos the landing pricing toggle can
// emit. Any other combo is a client bug → 400.
const CANONICAL_COMBOS = [
  'Basic:month', 'Basic:year',
  'Professional:month', 'Professional:year',
  'Elite:month', 'Elite:year',
]

// The STRIPE_PRICE_* env var each combo reads from. A key exists in
// PRICE_MAP for every combo, but its VALUE is undefined exactly when
// this env var is missing — the signal for the 503 branch.
const COMBO_ENV = {
  'Basic:month': 'STRIPE_PRICE_BASIC_MONTHLY',
  'Basic:year': 'STRIPE_PRICE_BASIC_YEARLY',
  'Professional:month': 'STRIPE_PRICE_PRO_MONTHLY',
  'Professional:year': 'STRIPE_PRICE_PRO_YEARLY',
  'Elite:month': 'STRIPE_PRICE_ELITE_MONTHLY',
  'Elite:year': 'STRIPE_PRICE_ELITE_YEARLY',
}

// ---------------------------------------------------------------------------
// 1. PRICE_MAP — exactly the 6 canonical combos, env-driven values
// ---------------------------------------------------------------------------

test('Round-91 checkout: PRICE_MAP defines exactly the 6 canonical combos', () => {
  // The map keys are the canonical `Tier:interval` strings. A refactor
  // that renames a key (e.g. to 'basic' lowercase) silently breaks the
  // landing toggle's `tier:interval` lookup AND the 400/503 split — the
  // combo would fall into the "invalid" branch and 400 a valid user.
  const mapBlock = ROUTE_SRC.match(/const PRICE_MAP = \{([\s\S]*?)\};/)
  assert.ok(mapBlock, 'the catch-all must define PRICE_MAP as a module-scope const')
  for (const combo of CANONICAL_COMBOS) {
    assert.match(
      mapBlock[1],
      new RegExp(`['"]${combo.replace(':', '\\:')}['"]\\s*:`),
      `PRICE_MAP must contain the canonical key ${combo}`,
    )
  }
  // No stray extra keys — the fail-closed split relies on "key exists
  // ⟺ valid combo". Count the declared keys and compare.
  const declared = (mapBlock[1].match(/['"][A-Za-z]+:[a-z]+['"]\s*:/g) || []).length
  assert.equal(declared, 6, `PRICE_MAP must declare exactly 6 keys, found ${declared}`)
})

test('Round-91 checkout: every PRICE_MAP value reads from a STRIPE_PRICE_* env var', () => {
  // The whole point of the 503 branch: the VALUE is undefined when the
  // env var is missing. If a maintainer hard-codes a price id (or an
  // empty string), the value is never undefined and the 503 branch
  // becomes dead code — checkout would silently mis-pricing instead of
  // failing closed.
  const mapBlock = ROUTE_SRC.match(/const PRICE_MAP = \{([\s\S]*?)\};/)
  assert.ok(mapBlock, 'PRICE_MAP must be present')
  for (const combo of CANONICAL_COMBOS) {
    const envVar = COMBO_ENV[combo]
    assert.match(
      mapBlock[1],
      new RegExp(`['"]${combo.replace(':', '\\:')}['"]\\s*:\\s*process\\.env\\.${envVar}`),
      `${combo} must read from process.env.${envVar} (env-driven so an unset var yields undefined → 503)`,
    )
  }
})

// ---------------------------------------------------------------------------
// 2. The two failure branches + their ordering
// ---------------------------------------------------------------------------

test('Round-91 checkout: invalid combos are rejected with 400 via hasOwnProperty', () => {
  // The 400 branch MUST use hasOwnProperty — not truthiness of the
  // looked-up value. `PRICE_MAP[combo]` is undefined for BOTH an
  // invalid combo AND a valid combo with unset env; only
  // hasOwnProperty distinguishes "key absent" (400) from "key present,
  // env unset" (503). A regression to `if (!PRICE_MAP[priceKey])`
  // would silently merge the two branches and the 503 guard below
  // would never fire.
  assert.match(
    ROUTE_SRC,
    /Object\s*\.\s*prototype\s*\.\s*hasOwnProperty\s*\.\s*call\s*\(\s*PRICE_MAP\s*,\s*priceKey\s*\)/,
    'the checkout branch must gate the 400 via hasOwnProperty.call(PRICE_MAP, priceKey)',
  )
  assert.match(
    ROUTE_SRC,
    /status:\s*400/,
    'the invalid-combo rejection must use HTTP 400',
  )
  assert.match(
    ROUTE_SRC,
    /['"]Invalid tier\/interval['"]/,
    'the invalid-combo rejection must return the documented error message',
  )
})

test('Round-91 checkout: valid combo with unset env price returns 503 PRICING_NOT_CONFIGURED', () => {
  // The deploy-gap branch: the combo key EXISTS in PRICE_MAP but its
  // env-driven value is undefined. Must be a distinct 503 with a
  // machine-readable code + user-facing Swedish copy — never a raw
  // Stripe error from a session.create(price: undefined) call.
  assert.match(
    ROUTE_SRC,
    /code:\s*['"]PRICING_NOT_CONFIGURED['"]/,
    'the unset-env rejection must carry code: PRICING_NOT_CONFIGURED',
  )
  assert.match(
    ROUTE_SRC,
    /status:\s*503/,
    'the unset-env rejection must use HTTP 503 (transient deploy gap, retryable)',
  )
  assert.match(
    ROUTE_SRC,
    /['"]Prenumerationer är inte konfigurerade ännu[\s\S]*?['"]/,
    'the 503 must carry the Swedish user-facing message (Prenumerationer är inte konfigurerade ännu …)',
  )
})

test('Round-91 checkout: hasOwnProperty guard runs BEFORE the !priceId 503 check', () => {
  // Order matters: the hasOwnProperty guard must reject invalid combos
  // FIRST, so the 503 branch only ever fires for a valid combo. If the
  // order flips, an invalid combo would 503 (wrong status for a client
  // bug) — or worse, fall through to Stripe.
  const checkoutStart = ROUTE_SRC.indexOf(`if (path === 'checkout')`)
  assert.ok(checkoutStart > -1, 'the catch-all must contain the checkout branch')
  const branch = ROUTE_SRC.slice(checkoutStart, checkoutStart + 1600)
  const hasOwnIdx = branch.indexOf('hasOwnProperty')
  const valueCheckIdx = branch.indexOf('const priceId = PRICE_MAP[priceKey]')
  assert.ok(hasOwnIdx > -1 && valueCheckIdx > -1, 'branch must contain both the hasOwnProperty guard and the value lookup')
  assert.ok(hasOwnIdx < valueCheckIdx, 'the hasOwnProperty 400-guard must run BEFORE reading PRICE_MAP[priceKey] for the 503 check')
})

test('Round-91 checkout: Stripe session creation only happens after both guards', () => {
  // Belt-and-braces: the expensive side-effect call must appear AFTER
  // the two rejection branches. A refactor that hoists the session
  // create above the guards would re-introduce the pre-fix bug
  // (Stripe called with price: undefined) even if the guards still
  // exist in the file.
  const checkoutStart = ROUTE_SRC.indexOf(`if (path === 'checkout')`)
  const branch = ROUTE_SRC.slice(checkoutStart, checkoutStart + 2600)
  const sessionIdx = branch.indexOf('checkout.sessions.create')
  const price503Idx = branch.indexOf('PRICING_NOT_CONFIGURED')
  assert.ok(sessionIdx > -1, 'the checkout branch must call stripeClient.checkout.sessions.create')
  assert.ok(price503Idx > -1, 'the checkout branch must contain the 503 PRICING_NOT_CONFIGURED branch')
  assert.ok(price503Idx < sessionIdx, 'the 503 guard must run BEFORE stripeClient.checkout.sessions.create')
})

// ---------------------------------------------------------------------------
// 3. Sync sanity — branch exists in the canonical catch-all file
// ---------------------------------------------------------------------------

test('Round-91 checkout: branch lives in the catch-all and stays a POST handler', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app/api/[[...path]]/route.js')), 'catch-all route file must exist')
  assert.match(ROUTE_SRC, /export\s+async\s+function\s+POST\s*\(/, 'catch-all must export async function POST')
  assert.match(ROUTE_SRC, /path\s*===\s*['"]checkout['"]/, 'catch-all must route the checkout path')
})
