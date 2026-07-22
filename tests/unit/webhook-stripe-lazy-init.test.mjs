// tests/unit/webhook-stripe-lazy-init.test.mjs
//
// Locks the lazy-Stripe-init pattern in app/api/webhooks/stripe/route.js
// AND the consolidation of the pattern into lib/stripe.js (so a
// future "stripe.init at module load" regression becomes a ONE-line
// change instead of a multi-route copy-paste).
//
// History (problem the test originally guarded against):
//   • Commit 7f42b60 retrofitted the catch-all route with a lazy
//     `_stripe` + try/catch + `function getStripe() { return _stripe }`
//     pattern, but MISSED the webhook route.
//   • A fresh-clone `yarn build` therefore crashed with
//     `Error: Neither apiKey nor config.authenticator provided`
//     during the "Collecting page data for /api/webhooks/stripe" phase.
//   • Commit e243348 retrofitted the webhook route with the same
//     inline pattern (still duplicated, but worked).
//   • This test was added in e243348 with 7 inline-pattern assertions.
//   • This file is now UPDATED to lock the centralisation — the lib
//     owns the SDK, both routes import `getStripe` from `@/lib/stripe`,
//     and neither route re-defines a local `function getStripe()`.
//
// The assertions are static-text on the source files rather than
// runtime behavioural tests because:
//   • The route files import `next/server`, `next/headers`,
//     `mongodb`, `stripe`, etc. which would require a full Next.js
//     boot for a behavioural test — overkill for "did the lazy
//     init sneaker slip back in?".
//   • Static text is byte-identical with what `yarn build`
//     evaluates, so the test cannot leave a regression window open.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const LIB_STRIPE = path.join(ROOT, 'lib', 'stripe.js')
const ROUTE_WEBHOOK = path.join(ROOT, 'app', 'api', 'webhooks', 'stripe', 'route.js')
const ROUTE_CATCHALL = path.join(ROOT, 'app', 'api', '[[...path]]', 'route.js')

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

// === lib/stripe.js (canonical module) ===

test('lib/stripe.js exists and exports getStripe', () => {
  assert.ok(
    fs.existsSync(LIB_STRIPE),
    'lib/stripe.js must exist as the single source of truth for the Stripe singleton',
  )
  const src = read(LIB_STRIPE)
  assert.ok(
    /export\s+function\s+getStripe\s*\(/.test(src),
    'lib/stripe.js must export a `getStripe` function — callers import this name from both routes',
  )
})

test('lib/stripe.js exports STRIPE_VERSION for lockstep pinning', () => {
  const src = read(LIB_STRIPE)
  assert.ok(
    /export\s+const\s+STRIPE_VERSION\s*=\s*['"]/.test(src),
    'lib/stripe.js must export `STRIPE_VERSION` so callers (and tests) can lock the API version',
  )
})

test('lib/stripe.js STRIPE_VERSION is hard-coded to the canonical 2025-06-30.basil', () => {
  const src = read(LIB_STRIPE)
  const m = src.match(/STRIPE_VERSION\s*=\s*['"]([^'"]+)['"]/)
  assert.ok(m, 'STRIPE_VERSION literal not found in lib/stripe.js')
  assert.strictEqual(
    m[1],
    '2025-06-30.basil',
    'STRIPE_VERSION drifted from the canonical 2025-06-30.basil — update both lib/stripe.js and any lockstep-pinning consumers',
  )
})

test('lib/stripe.js exposes a test reset hook', () => {
  const src = read(LIB_STRIPE)
  assert.ok(
    /export\s+function\s+__resetStripeForTests\s*\(/.test(src),
    'lib/stripe.js must export `__resetStripeForTests` so future tests can re-init under different env shapes',
  )
})

test('lib/stripe.js does NOT define constructor at module level WITHOUT env guard', () => {
  // Belt-and-braces: if a future contributor reverts to module-level
  // `new Stripe(process.env.STRIPE_SECRET_KEY, ...)` WITHOUT wrapping
  // it in `if (process.env.STRIPE_SECRET_KEY)`, the build crashes again.
  const src = read(LIB_STRIPE)
  assert.ok(
    /if\s*\(\s*process\.env\.STRIPE_SECRET_KEY\s*\)/.test(src),
    'lib/stripe.js must guard `new Stripe(...)` on `process.env.STRIPE_SECRET_KEY` so missing key stays a no-op',
  )
  assert.ok(
    /try\s*\{[^}]*new\s+Stripe/m.test(src),
    'lib/stripe.js must wrap `new Stripe(...)` in a try/catch so a malformed key degrades gracefully',
  )
})

// === app/api/webhooks/stripe/route.js ===

test('webhook route imports getStripe from @/lib/stripe (no inline dup)', () => {
  const src = read(ROUTE_WEBHOOK)
  assert.ok(
    /import\s+\{\s*getStripe\s*\}\s+from\s+['"]@\/lib\/stripe['"]/.test(src),
    'webhook route must import `getStripe` from `@/lib/stripe` — inline duplication would defeat the consolidation',
  )
  assert.ok(
    !/import\s+Stripe\s+from\s+['"]stripe['"]/.test(src),
    'webhook route must NOT import `stripe` SDK directly — the SDK import is owned by `lib/stripe.js` only',
  )
  assert.ok(
    !/^function\s+getStripe\s*\(/m.test(src),
    'webhook route must NOT define a local `function getStripe()` — must come from `@/lib/stripe`',
  )
})

test('webhook route has no module-level `_stripe` singleton', () => {
  const src = read(ROUTE_WEBHOOK)
  assert.ok(
    !/^let\s+_stripe\s*=\s*null/m.test(src),
    'webhook route has a local `_stripe` singleton — must be removed in favour of `lib/stripe.js`',
  )
})

test('webhook POST handler null-guards getStripe() before constructEvent', () => {
  const src = read(ROUTE_WEBHOOK)
  assert.ok(/getStripe\s*\(\s*\)/.test(src), 'expected `getStripe()` call site in webhook POST')
  assert.ok(
    /const\s+stripe\s*=\s*getStripe\s*\(\s*\)\s*;[\s\S]{0,200}if\s*\(\s*!\s*stripe\s*\)/.test(src),
    'expected null-guard immediately after `const stripe = getStripe();`',
  )
})

test('webhook null-guard error shape matches catch-all (NextResponse.json)', () => {
  const src = read(ROUTE_WEBHOOK)
  assert.ok(
    /NextResponse\.json\(\s*\{\s*error:\s*['"]Betalning är inte konfigurerad\.['"]\s*\}/.test(src),
    'expected `NextResponse.json({ error: \'Betalning är inte konfigurerad.\' }, ...)` for parity with catch-all',
  )
})

test('webhook route declares nodejs runtime + force-dynamic', () => {
  const src = read(ROUTE_WEBHOOK)
  assert.ok(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/.test(src), 'expected runtime=nodejs')
  assert.ok(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src), 'expected dynamic=force-dynamic')
})

test('webhook keeps the existing signature-verification 400 path', () => {
  // Defensive: a re-write that drops the wrapped try/catch would
  // turn a forged-signature event into a 500 (retryable) instead of
  // a 400 (non-retryable) and could channel into a poison-message
  // loop.
  const src = read(ROUTE_WEBHOOK)
  assert.ok(/stripe\.webhooks\.constructEvent\s*\(/.test(src), 'expected stripe.webhooks.constructEvent(...) call')
  assert.ok(/Webhook Error:/.test(src), 'expected the 400-path to surface the verification error')
  assert.ok(/status:\s*400/.test(src), 'expected a 400 status on signature failure')
})

test('webhook route does NOT hard-code STRIPE_VERSION 2025-06-30.basil', () => {
  // The API version is owned by lib/stripe.js now; the route
  // shouldn't carry a literal copy. If it does, drift is possible.
  const src = read(ROUTE_WEBHOOK)
  assert.ok(
    !/['"]2025-06-30\.basil['"]/.test(src),
    'webhook route hard-codes the Stripe apiVersion — should be referenced via `STRIPE_VERSION` in lib/stripe.js',
  )
})

// === app/api/[[...path]]/route.js (consolidation lockstep) ===

test('catch-all route imports getStripe from @/lib/stripe (no inline dup)', () => {
  const src = read(ROUTE_CATCHALL)
  assert.ok(
    /import\s+\{\s*getStripe\s*\}\s+from\s+['"]@\/lib\/stripe['"]/.test(src),
    'catch-all route must import `getStripe` from `@/lib/stripe`',
  )
  assert.ok(
    !/import\s+Stripe\s+from\s+['"]stripe['"]/.test(src),
    'catch-all route must NOT import `stripe` SDK directly — the SDK import is owned by `lib/stripe.js` only',
  )
  assert.ok(
    !/^function\s+getStripe\s*\(/m.test(src),
    'catch-all route must NOT define a local `function getStripe()` — must be imported from `@/lib/stripe`',
  )
})

test('catch-all route has no module-level `_stripe` singleton', () => {
  const src = read(ROUTE_CATCHALL)
  assert.ok(
    !/^let\s+_stripe\s*=\s*null/m.test(src),
    'catch-all route has a local `_stripe` singleton — must be removed in favour of `lib/stripe.js`',
  )
})

test('catch-all route does NOT hard-code STRIPE_VERSION 2025-06-30.basil', () => {
  const src = read(ROUTE_CATCHALL)
  assert.ok(
    !/['"]2025-06-30\.basil['"]/.test(src),
    'catch-all route hard-codes the Stripe apiVersion — should be referenced via `STRIPE_VERSION` in lib/stripe.js',
  )
})

test('catch-all route null-guard error shape mirrors webhook (NextResponse.json)', () => {
  // Both Stripe consumers must share the same user-visible error
  // contract so a future helper-extraction refactor is safe.
  const src = read(ROUTE_CATCHALL)
  assert.ok(
    /NextResponse\.json\(\s*\{\s*error:\s*['"]Betalning är inte konfigurerad\.['"]\s*\}\s*,\s*\{\s*status:\s*500/.test(src),
    'catch-all route must use `NextResponse.json({ error: \'Betalning är inte konfigurerad.\' }, { status: 500 })` so it stays in parity with the webhook route',
  )
})

test('catch-all route still invokes getStripe() in checkout + billing-portal handlers', () => {
  // The Stripe-API call sites must now route through the lib's
  // getter. If a future cleanup tries to revert to module-level
  // `stripe.checkout.sessions.create(...)`, this test fails.
  const src = read(ROUTE_CATCHALL)
  assert.ok(
    /getStripe\s*\(\s*\)/.test(src),
    'catch-all route must invoke `getStripe()` at the Stripe call sites',
  )
})
