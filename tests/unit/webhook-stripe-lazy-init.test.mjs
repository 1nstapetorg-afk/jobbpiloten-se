// tests/unit/webhook-stripe-lazy-init.test.mjs
//
// Locks the lazy-Stripe-init pattern in app/api/webhooks/stripe/route.js
// so a future copy-paste regression can't reintroduce the build crash
// (`Error: Neither apiKey nor config.authenticator provided` during
// "Collecting page data for /api/webhooks/stripe").
//
// The catch-all route `app/api/[[...path]]/route.js` already has the same
// pattern from commit 7f42b60 ("fix: lazy Stripe initializer with try-catch
// + null guards for dev mode"); the webhook route was missed by that fix
// and crashed every fresh-clone build.
//
// The assertions are static text on the source file rather than runtime
// behavioural tests because:
//   • The route imports `next/server`, `next/headers`, `mongodb`, `stripe`,
//     which would require a full Next.js boot for a behavioural test —
//     overkill for "did the lazy init sneaker slip back in?"
//   • Static text is byte-identical with what `yarn build` evaluates, so
//     the test cannot leave a regression window open.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROUTE = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'app',
  'api',
  'webhooks',
  'stripe',
  'route.js',
)
const CATCHALL = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'app',
  'api',
  '[[...path]]',
  'route.js',
)

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

test('webhook route has no module-level `const stripe = new Stripe(...)`', () => {
  const src = read(ROUTE)
  assert.ok(
    !/^const\s+stripe\s*=\s*new\s+Stripe\s*\(/m.test(src),
    'webhook route is missing the lazy-init helper — the unguarded module-level ' +
      '`new Stripe(process.env.STRIPE_SECRET_KEY, ...)` will crash `yarn build` ' +
      'under CI / dev mode with `Neither apiKey nor config.authenticator provided`.',
  )
})

test('webhook route has a lazy `getStripe()` helper', () => {
  const src = read(ROUTE)
  assert.ok(
    /function\s+getStripe\s*\(\s*\)\s*\{[^}]*\}/.test(src),
    'webhook route is missing `function getStripe()` — required so the rest of ' +
      'the module can degrade gracefully when STRIPE_SECRET_KEY is not set.',
  )
})

test('webhook POST handler null-guards getStripe() before constructEvent', () => {
  const src = read(ROUTE)
  assert.ok(
    /getStripe\s*\(\s*\)/.test(src),
    'webhook POST handler must call `getStripe()` before any stripe.webhooks.* call.',
  )
  // Null-guard: a `if (!stripe) { return ... }` block right after `const stripe = getStripe();`
  assert.ok(
    /const\s+stripe\s*=\s*getStripe\s*\(\s*\)\s*;[\s\S]{0,200}if\s*\(\s*!\s*stripe\s*\)/.test(src),
    'webhook POST handler must null-guard `getStripe()` immediately after the call. ' +
      'Without the guard, a missing STRIPE_SECRET_KEY throws at the SDK call site.',
  )
})

test('webhook null-guard matches catch-all error shape (NextResponse.json)', () => {
  const src = read(ROUTE)
  assert.ok(
    /NextResponse\.json\(\s*\{\s*error:\s*['"]Betalning är inte konfigurerad\.['"]\s*\}/.test(src),
    'webhook null-guard should return `NextResponse.json({ error: \'Betalning är inte konfigurerad.\' }, { status: 500 })` ' +
      'so the webhook and catch-all routes share the same error contract.',
  )
})

test('webhook route declares nodejs runtime + force-dynamic', () => {
  const src = read(ROUTE)
  assert.ok(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/.test(src), 'expected runtime=nodejs')
  assert.ok(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src), 'expected dynamic=force-dynamic')
})

test('webhook apiVersion stays in lockstep with catch-all', () => {
  const srcWebhook = read(ROUTE)
  const srcCatchall = read(CATCHALL)
  const apiVer = /apiVersion:\s*['"]([^'"]+)['"]/
  const webhookVer = (srcWebhook.match(apiVer) || [])[1]
  const catchallVer = (srcCatchall.match(apiVer) || [])[1]
  assert.ok(webhookVer, 'webhook route is missing apiVersion')
  assert.ok(catchallVer, 'catchall route is missing apiVersion')
  assert.strictEqual(
    webhookVer,
    catchallVer,
    `webhook apiVersion (${webhookVer}) drifts from catch-all apiVersion (${catchallVer}). ` +
      'Both routes must use the same Stripe SDK API version so signature verification ' +
      'and checkout calls stay in lockstep.',
  )
})

test('webhook route handles bad signature with the existing 400 path (sanity)', () => {
  // Defensive check: after the lazy-init refactor, the signature-verification
  // try/catch + 400-response path must stay. If a future re-write accidentally
  // drops the wrapped try/catch, Stripe will see a 500 instead of a 400 on a
  // forged-signature event — which most delivery tools treat as retryable
  // and channels into a poison-message loop.
  const src = read(ROUTE)
  assert.ok(/stripe\.webhooks\.constructEvent\s*\(/.test(src), 'expected stripe.webhooks.constructEvent(...) call site')
  assert.ok(
    /Webhook Error:\s*\$\{?err\.message\}?/.test(src) || /'Webhook Error:/m.test(src),
    'expected the 400-path to surface the verification error verbatim to Stripe',
  )
  assert.ok(/status:\s*400/.test(src), 'expected a 400 status on signature failure')
})
