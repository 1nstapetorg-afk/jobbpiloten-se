// lib/clerk-config.js
//
// Single source of truth for "is Clerk actually configured?" answers.
//
// The two variants exist because the public-vs-secret split crosses the
// server/client boundary:
//   • `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is inlined into the client
//     bundle at build time, so the client can read it safely.
//   • `CLERK_SECRET_KEY` is server-only — Next.js refuses to inline it
//     into a client bundle, and reading it client-side would silently
//     return `undefined` (a footgun if the two functions were merged
//     into a single "isClerkConfigured" that checks both).
//
// A Clerk-mode user with `lib/auth-cookie.js#DemoAuthProvider` re-
// bootstrapping a stale demo cookie from `localStorage` is the failure
// mode this separation prevents: the server check is the authoritative
// one (the cookie is server-readable, the bootstrap is server-aware),
// while the client check is for UI gating only (e.g. show Clerk's
// `<UserButton />` only when Clerk is wired up).
//
// BEFORE this module: the same 6-line `isClerkConfigured` function was
// copy-pasted into 6 files. Three of the copies checked the public key
// only (correct for client usage but accidentally correct for some
// server usages too); one (middleware.js) checked both; one (lib/auth.js)
// checked both. Drift was inevitable: the `length < 20` and `xxx` guards
// were in some copies and missing from others. ONE place, ONE definition.

/**
 * Client-safe Clerk check. Reads only the public key, which Next.js
 * inlines into the client bundle at build time. Safe to call from any
 * component, hook, or context provider — never reads the secret.
 *
 * @returns {boolean} true iff the publishable key looks like a real
 *   Clerk key (non-empty, no `xxx` template placeholder, ≥20 chars).
 */
export function isClerkConfiguredClient() {
  if (typeof process === 'undefined' || !process.env) return false
  const pubKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  return isClerkKeyReal(pubKey)
}

/**
 * Authoritative server-side Clerk check. Reads BOTH the public and
 * secret keys. The secret-key check is the gate that prevents demo-mode
 * fallback when only a publishable key has been configured (a common
 * misconfiguration during local development where the dev copies
 * NEXT_PUBLIC_* vars but forgets CLERK_SECRET_KEY).
 *
 * Server-only — never import this from a `'use client'` component.
 *
 * @returns {boolean} true iff both keys are present and look real.
 */
export function isClerkConfiguredServer() {
  if (typeof process === 'undefined' || !process.env) return false
  const pubKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const secKey = process.env.CLERK_SECRET_KEY
  return isClerkKeyReal(pubKey) && isClerkKeyReal(secKey)
}

/**
 * Shared key-validity check. The 20-char minimum is what every real
 * Clerk key clears; short test-template values like `pk_test_xxxx` or
 * `xxx` are rejected up front so a misconfigured deployment can't
 * silently fall back to demo mode in production.
 *
 * 2026-07-21 / Round-79 followup — added KNOWN_BROKEN prefix
 * blocklist. The `eternal-pika-64` Clerk instance key (decoded from
 * `pk_test_ZXRlcm5hbC1waWthLTY0LmNsZXJrLmFjY291bnRzLmRldiQ`) was rejected
 * by Clerk SDK V7 on every request in the May-July 2026 soft-launch
 * testing window. Rejecting it explicitly here means a leftover .env
 * that still carries the broken key falls back to demo mode instead
 * of cascading into the Round-78 HTTP-500-every-route failure mode
 * (clerkMiddleware throws, Next.js dev-overlay swallows it).
 *
 * If you copy a NEW broken key from a flutter demo or test project,
 * add its `pk_test_...` prefix here (use the first decode-stable
 * substring, NOT the whole base64). The blocklist is intentionally
 * SCAN-FRIENDLY so it can grow without code review.
 *
 * @param {string|undefined|null} key
 * @returns {boolean}
 */

// Round-79 — known-broken Clerk publishable-key PREFIXES (NOT full
// keys, NEVER secrets). The base64 form decodes to a ClerkFrontendAPI
// instance name (e.g. `eternal-pika-64.clerk.accounts.dev$`) — Clerk
// SDK V7 rejects these on every request and the failure cascades into
// Round-78's HTTP-500 cascade. blocklist here ensures a stale .env
// gracefully degrades to demo mode instead.
//
// DEGRADED-MODE CAVEAT (Round-79 followup): when a key matches this
// blocklist (or when Clerk isn't configured at all), `isClerkKeyReal()`
// returns false → `isClerkConfiguredServer()` returns false →
// middleware.js Round-79 fix returns `NextResponse.next()` for every
// request. That means THE CLERK AUTH GATE IS BYPASSED — protected
// routes (e.g. /dashboard) are publicly accessible in degraded mode.
// This is intentional for soft-launch dev to prevent the HTTP-500
// cascade, but it is NOT safe for production. Production deploys MUST
// rotate to a fresh Clerk key (see .env.template rotation procedure)
// AND must NOT rely on demo-mode as a security boundary.
const KNOWN_BROKEN_CLERK_KEY_PREFIXES = [
  // eternal-pika-64.clerk.accounts.dev$ — base64 form
  // `pk_test_ZXRlcm5hbC1waWthLTY0`. Rejected by Clerk SDK V7 in
  // May-July 2026.
  'pk_test_ZXRlcm5hbC1waWthLTY0',
]

function isClerkKeyReal(key) {
  if (!key) return false
  if (key.includes('xxx')) return false
  if (key.length < 20) return false
  // Round-79 blocklist — explicit reject. Cheap O(n) scan over a
  // tiny list of known-broken prefixes. Log so a maintainer knows
  // WHY their key was rejected on first serve rather than parsing a
  // generic `clerkMiddleware threw` later.
  for (const broken of KNOWN_BROKEN_CLERK_KEY_PREFIXES) {
    if (key.startsWith(broken)) {
      console.warn(
        '[clerk-config] Rejecting known-broken Clerk key prefix (rotation required):',
        broken,
        '— see .env.template header for the rotation procedure.',
      )
      return false
    }
  }
  return true
}
