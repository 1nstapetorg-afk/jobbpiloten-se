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
 * @param {string|undefined|null} key
 * @returns {boolean}
 */
function isClerkKeyReal(key) {
  if (!key) return false
  if (key.includes('xxx')) return false
  if (key.length < 20) return false
  return true
}
