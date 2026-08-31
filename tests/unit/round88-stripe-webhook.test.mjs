// tests/unit/round88-stripe-webhook.test.mjs
//
// Round-88 / Priority-1 #3 — lock the behavior of the Stripe webhook
// route (app/api/webhooks/stripe/route.js). The route was merged from
// two contributors in the Round-87 rebase, so this file pins its
// wire contract with REAL signature crypto (the Stripe SDK's
// `webhooks.generateTestHeaderString` + `webhooks.constructEvent`),
// not a fake that could diverge from the SDK's actual verification.
//
// Why a vm harness instead of `mock.module` / jest mocks:
//   • The route imports `next/server` + `next/headers`, which throw
//     outside a request scope in plain Node. The codebase's existing
//     behavioural route/extension tests use `node:vm` to evaluate the
//     module source with the imported names supplied as sandbox
//     globals (see tests/unit/extension-popup-vm.test.mjs).
//   • `stripe.webhooks.generateTestHeaderString` is real crypto
//     (HMAC-SHA256 over the exact payload bytes), so a signature
//     produced for payload A CANNOT verify payload B — the invalid-
//     signature case is a genuine end-to-end rejection, not a stub
//     pretending to fail.
//
// Contract under test (each is a node:test case):
//   1. valid signature  → 200 `{ received: true }` + profiles upsert
//   2. invalid signature → 400 `Webhook Error: …`
//   3. unknown event    → 200 no-op (no DB write)
//   4. getStripe() null → 500 Swedish `Betalning är inte konfigurerad.`
//   5. subscription.updated → 200 + update by stripeSubscriptionId
//   6. subscription.deleted → 200 + tier forced to Basic
//
// Network-safety: the REAL Stripe client is only used for its
// webhooks.constructEvent / generateTestHeaderString static crypto —
// the client's `subscriptions.retrieve` is stubbed so no API call
// ever fires.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import Stripe from 'stripe'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const ROUTE_PATH = path.join(ROOT, 'app', 'api', 'webhooks', 'stripe', 'route.js')
const ROUTE_SRC = fs.readFileSync(ROUTE_PATH, 'utf8')

const WEBHOOK_SECRET = 'whsec_test_round88_contract_lock'
const PRICE_IDS = {
  STRIPE_PRICE_BASIC_MONTHLY: 'price_basic_monthly',
  STRIPE_PRICE_BASIC_YEARLY: 'price_basic_yearly',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
  STRIPE_PRICE_ELITE_MONTHLY: 'price_elite_monthly',
  STRIPE_PRICE_ELITE_YEARLY: 'price_elite_yearly',
}

// ---------------------------------------------------------------------------
// vm harness — evaluate the route source with the imported names supplied
// as sandbox globals (NextResponse / headers / getStripe / getDb).
// ---------------------------------------------------------------------------

// Strip `import …` lines and the `export` keyword so the module body is a
// plain script that `vm.runInNewContext` can evaluate. The sandbox provides
// every imported name, so the stripping is purely syntactic.
function transformRouteSource(src) {
  return src
    .replace(/^import\s+[^\n]*;\n/gm, '')
    .replace(/^export\s+(?=const|async|function)/gm, '')
}

// Minimal duck-typed NextResponse: `NextResponse.json(body, init)` static
// + `new NextResponse(text, { status })` constructor. `json()` resolves the
// original object so assertions read the exact body the route serialised.
class NextResponseStub {
  constructor(body, init = {}) {
    this.status = init.status || 200
    this._body = body
    this._jsonBody = typeof body === 'object' ? body : null
  }
  static json(body, init = {}) {
    return new NextResponseStub(body, init)
  }
  async json() {
    if (this._jsonBody !== null) return this._jsonBody
    if (typeof this._body === 'string') return { text: this._body }
    return this._body
  }
}

function buildHarness({ signature, stripe, db }) {
  const sandbox = {
    console,
    process,
    NextResponse: NextResponseStub,
    // next/headers `headers()` — the route only reads stripe-signature.
    headers: async () => ({
      get: (name) => (name === 'stripe-signature' ? signature : null),
    }),
    getStripe: () => stripe,
    getDb: () => db,
  }
  const script = transformRouteSource(ROUTE_SRC)
  // Attach to the context and re-read `POST` off the sandbox — function
  // declarations from `runInNewContext` land on the context global.
  vm.createContext(sandbox)
  vm.runInContext(script, sandbox, { filename: 'webhooks/stripe/route.js' })
  return { POST: sandbox.POST }
}

// In-memory profiles-collection spy: records every updateOne call so the
// test can assert filter / $set / upsert shape without touching Mongo.
function makeDbSpy() {
  const calls = []
  const db = {
    collection: (name) => ({
      updateOne: async (filter, update, options) => {
        calls.push({ name, filter, update, options })
        return { matchedCount: 1, upsertedCount: options?.upsert ? 1 : 0 }
      },
    }),
  }
  return { db, calls }
}

// REAL Stripe client whose `subscriptions.retrieve` is stubbed to the given
// subscription shape (only crypto methods are real; no network ever fires).
function makeStripe(subscriptionShape) {
  const stripe = new Stripe('sk_test_round88_contract_lock')
  stripe.subscriptions = {
    retrieve: async (id) => ({ id, ...subscriptionShape }),
  }
  return stripe
}

const ENV_KEYS = ['STRIPE_WEBHOOK_SECRET', ...Object.keys(PRICE_IDS)]

async function withStripeEnv(fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  for (const [k, v] of Object.entries(PRICE_IDS)) process.env[k] = v
  try {
    // MUST `await fn()` — a bare `return fn()` would trigger the
    // finally-restore while the async body is still pending, so the
    // route's constructEvent would read STRIPE_WEBHOOK_SECRET as
    // undefined mid-request (the exact bug this helper fixes).
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

function sign(stripe, payload) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
}

async function callPost(POST, payload) {
  const req = { text: async () => payload }
  return POST(req)
}

// ---------------------------------------------------------------------------
// 1. Valid signature → 200 + profiles upsert (checkout.session.completed)
// ---------------------------------------------------------------------------

test('Round-88 webhook: valid signature → 200 received + profiles upsert with tier', async () => {
  await withStripeEnv(async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'clerk_round88_1',
          customer: 'cus_round88_1',
          subscription: 'sub_round88_1',
        },
      },
    }
    const payload = JSON.stringify(event)
    const stripe = makeStripe({
      status: 'active',
      items: { data: [{ price: { id: PRICE_IDS.STRIPE_PRICE_PRO_MONTHLY } }] },
      current_period_end: 1_750_000_000,
      cancel_at_period_end: false,
    })
    const signature = sign(stripe, payload)
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature, stripe, db })

    const res = await callPost(POST, payload)

    assert.equal(res.status, 200)
    // Field-by-field (not deepStrictEqual): the route body crosses the vm
    // realm boundary, so its prototype differs from a test-realm literal.
    assert.equal((await res.json()).received, true)
    assert.equal(calls.length, 1, 'exactly one profiles updateOne expected')
    const c = calls[0]
    assert.equal(c.name, 'profiles')
    assert.equal(c.filter.clerkId, 'clerk_round88_1')
    assert.equal(c.update.$set.stripeCustomerId, 'cus_round88_1')
    assert.equal(c.update.$set.stripeSubscriptionId, 'sub_round88_1')
    assert.equal(c.update.$set.tier, 'Professional', 'price → tier mapping must hold')
    assert.equal(c.update.$set.billingInterval, 'month')
    assert.equal(c.update.$set.subscriptionStatus, 'active')
    assert.equal(c.update.$set.cancelAtPeriodEnd, false)
    // Realm-safe Date check — `instanceof Date` fails across vm realms.
    assert.equal(
      Object.prototype.toString.call(c.update.$setOnInsert.createdAt),
      '[object Date]',
      'createdAt must be a Date for the upsert seed',
    )
    assert.equal(c.options.upsert, true, 'webhook must upsert so a session can land before onboarding')
  })
})

// ---------------------------------------------------------------------------
// 2. Invalid signature → 400 Webhook Error (never reaches the DB)
// ---------------------------------------------------------------------------

test('Round-88 webhook: tampered payload with valid header → 400 Webhook Error + no DB write', async () => {
  await withStripeEnv(async () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'clerk_round88_2' } },
    }
    const payload = JSON.stringify(event)
    const stripe = makeStripe({ status: 'active', items: { data: [] } })
    // Generate a VALID signature, then tamper the payload: the header now
    // no longer matches the body — constructEvent must reject.
    const signature = sign(stripe, payload)
    const tampered = payload.replace('clerk_round88_2', 'clerk_evil_999')
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature, stripe, db })

    const res = await callPost(POST, tampered)

    assert.equal(res.status, 400, 'signature mismatch must be a 400 (non-retryable)')
    assert.match(String(res._body || ''), /^Webhook Error:/)
    assert.equal(calls.length, 0, 'a forged event must never reach the DB')
  })
})

test('Round-88 webhook: missing signature header → 400 Webhook Error', async () => {
  await withStripeEnv(async () => {
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
    const stripe = makeStripe({ status: 'active', items: { data: [] } })
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature: null, stripe, db })

    const res = await callPost(POST, payload)

    assert.equal(res.status, 400)
    assert.match(String(res._body || ''), /^Webhook Error:/)
    assert.equal(calls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// 3. Unknown event → 200 no-op (default branch must not write)
// ---------------------------------------------------------------------------

test('Round-88 webhook: unknown event type → 200 received + zero DB writes', async () => {
  await withStripeEnv(async () => {
    const event = { type: 'invoice.paid', data: { object: { id: 'in_123' } } }
    const payload = JSON.stringify(event)
    const stripe = makeStripe({})
    const signature = sign(stripe, payload)
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature, stripe, db })

    const res = await callPost(POST, payload)

    assert.equal(res.status, 200)
    assert.equal((await res.json()).received, true)
    assert.equal(calls.length, 0, 'unknown events must be acknowledged but ignored')
  })
})

// ---------------------------------------------------------------------------
// 4. getStripe() null → Swedish 500 (mirrors the catch-all contract)
// ---------------------------------------------------------------------------

test('Round-88 webhook: getStripe() null → 500 Betalning är inte konfigurerad.', async () => {
  await withStripeEnv(async () => {
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature: 'ignored', stripe: null, db })

    const res = await callPost(POST, payload)

    assert.equal(res.status, 500)
    assert.equal((await res.json()).error, 'Betalning är inte konfigurerad.')
    assert.equal(calls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// 5. customer.subscription.updated → 200 + update by stripeSubscriptionId
// ---------------------------------------------------------------------------

test('Round-88 webhook: subscription.updated → 200 + profile update via stripeSubscriptionId', async () => {
  await withStripeEnv(async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_round88_upd',
          status: 'past_due',
          items: { data: [{ price: { id: PRICE_IDS.STRIPE_PRICE_ELITE_YEARLY } }] },
          current_period_end: 1_760_000_000,
          cancel_at_period_end: true,
        },
      },
    }
    const payload = JSON.stringify(event)
    const stripe = makeStripe({})
    const signature = sign(stripe, payload)
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature, stripe, db })

    const res = await callPost(POST, payload)

    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].filter.stripeSubscriptionId, 'sub_round88_upd')
    assert.equal(calls[0].update.$set.subscriptionStatus, 'past_due')
    assert.equal(calls[0].update.$set.tier, 'Elite')
    assert.equal(calls[0].update.$set.billingInterval, 'year')
    assert.equal(calls[0].update.$set.cancelAtPeriodEnd, true)
    // update-by-id must NOT upsert — a tombstone sync only touches existing
    // rows. The route passes NO options arg for this branch, so options
    // must be undefined (strict — `notEqual(…upsert, true)` would also
    // pass if options were missing entirely, which is exactly the
    // regression this locks).
    assert.equal(calls[0].options, undefined)
  })
})

// ---------------------------------------------------------------------------
// 6. customer.subscription.deleted → 200 + tier forced back to Basic
// ---------------------------------------------------------------------------

test('Round-88 webhook: subscription.deleted → 200 + tier reset to Basic', async () => {
  await withStripeEnv(async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_round88_del',
          status: 'canceled',
          items: { data: [{ price: { id: PRICE_IDS.STRIPE_PRICE_PRO_YEARLY } }] },
          current_period_end: null,
          cancel_at_period_end: false,
        },
      },
    }
    const payload = JSON.stringify(event)
    const stripe = makeStripe({})
    const signature = sign(stripe, payload)
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature, stripe, db })

    const res = await callPost(POST, payload)

    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].update.$set.tier, 'Basic', 'canceled subscription must degrade the tier to Basic')
    assert.equal(calls[0].update.$set.subscriptionStatus, 'canceled')
  })
})

// ---------------------------------------------------------------------------
// 7. Source locks — constructEvent + tierFromPriceId surface (regression net)
// ---------------------------------------------------------------------------

test('Round-88 webhook: route still calls stripe.webhooks.constructEvent with (body, signature, secret)', () => {
  assert.ok(
    /stripe\.webhooks\.constructEvent\s*\(\s*body\s*,\s*signature\s*,\s*process\.env\.STRIPE_WEBHOOK_SECRET/.test(ROUTE_SRC),
    'signature verification must use constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)',
  )
})

test('Round-88 webhook: tierFromPriceId falls back to Unknown tier for an unmapped price', async () => {
  await withStripeEnv(async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_round88_unknown',
          status: 'active',
          items: { data: [{ price: { id: 'price_never_seen' } }] },
        },
      },
    }
    const payload = JSON.stringify(event)
    const stripe = makeStripe({})
    const signature = sign(stripe, payload)
    const { db, calls } = makeDbSpy()
    const { POST } = buildHarness({ signature, stripe, db })

    const res = await callPost(POST, payload)

    assert.equal(res.status, 200)
    assert.equal(calls[0].update.$set.tier, 'Unknown')
    assert.equal(calls[0].update.$set.billingInterval, null)
  })
})
