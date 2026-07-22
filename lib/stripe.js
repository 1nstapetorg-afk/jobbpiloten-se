// lib/stripe.js
//
// Single source of truth for the lazy Stripe singleton. Both Stripe
// consumers in the app MUST import `getStripe` from this module:
//
//   • app/api/[[...path]]/route.js      — checkout + billing portal
//   • app/api/webhooks/stripe/route.js  — webhook signature
//                                        verification +
//                                        subscription-tombstone sync
//
// Why centralised here? Previous commits (`7f42b60`, `e243348`)
// duplicated this lazy-init pattern across route files — each route
// was a separate chance to forget the init pattern on the next
// retrofit. Hoisting to `lib/stripe.js` makes the dependency
// explicit at the import site, so a future "stripe.init at module-
// load" attempt is a ONE-line change here instead of a multi-route
// copy-paste.
//
// Dev-mode behaviour: when `STRIPE_SECRET_KEY` is missing OR the
// Stripe SDK constructor throws (rare — can happen on malformed-key
// shapes), `_stripe` stays null. Both caller routes' null-guards
// return a friendly 500 (`Betalning är inte konfigurerad.`) instead
// of crashing the request. This is the pattern that keeps
// `yarn build` green under fresh clones where
// `Error: Neither apiKey nor config.authenticator provided` used
// to crater the "Collecting page data for /api/webhooks/stripe"
// phase.

import Stripe from 'stripe'

// The Stripe SDK API version used BY EVERY CONSUMER in the app.
// Exposed as a named export so tests can lock version lockstep
// (`tests/unit/webhook-stripe-lazy-init.test.mjs` — the "catch-all
// apiVersion stays in lockstep" assertion).
export const STRIPE_VERSION = '2025-06-30.basil'

// Module-level lazy singleton. Initial eval runs once per Vercel
// cold start (NOT on every `getStripe()` call), so a
// `STRIPE_SECRET_KEY` that flips absent → present between requests
// won't be picked up until the next cold start. Vercel env vars
// never change at runtime, so a per-request check would just be
// slower for no upside.
let _stripe = null

function initStripe() {
  _stripe = null
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: STRIPE_VERSION,
      })
    }
  } catch (_) {
    // Stripe SDK can throw during construction on some platforms
    // (e.g. malformed-key shapes). Degrade gracefully — callers
    // null-guard.
  }
}

// Module-level init — same lifecycle as the previous inline init
// pattern that lived in each route file before this consolidation.
initStripe()

/**
 * Returns the cached Stripe client, or `null` if Stripe couldn't be
 * configured (missing or invalid `STRIPE_SECRET_KEY`).
 *
 * Caller contract (mirror verbatim, applies to BOTH routes):
 *
 *   const stripe = getStripe();
 *   if (!stripe) {
 *     return NextResponse.json(
 *       { error: 'Betalning är inte konfigurerad.' },
 *       { status: 500 },
 *     );
 *   }
 *
 * @returns {Stripe | null}
 */
export function getStripe() {
  return _stripe
}

/**
 * Test-only: clear the singleton and re-init. Production code MUST
 * NOT call this. Used by `tests/unit/webhook-stripe-lazy-init.test.mjs`
 * and any future Stripe-related test that needs deterministic
 * behaviour across multiple env shapes.
 */
export function __resetStripeForTests() {
  initStripe()
}
