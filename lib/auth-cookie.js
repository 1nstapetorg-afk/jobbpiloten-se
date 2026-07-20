// lib/auth-cookie.js
//
// Single source of truth for the demo-mode session cookie. Used by
// three call sites that previously hard-coded the same
// `path=/; max-age=…; SameSite=Lax` string in three places
// (app/sign-in/[[...sign-in]]/page.js, app/onboarding/page.js,
// app/providers.js#DemoAuthProvider). Drift risk was high — a
// future bump to the TTL or SameSite would have required finding
// every duplicate. The helper is client-safe (no `next/server`
// imports) so the dashboard, sign-in, and onboarding flows can
// all import it without crossing the server/client boundary.
//
// Why a 30-day TTL? The cookie's job is to identify the user
// server-side. The client-side `useUser()` hook reads
// `localStorage.demoUser` as the source of truth, and a fresh
// localStorage entry survives browser restart for as long as the
// user doesn't clear site data. The earlier 24-hour cookie
// expired faster than localStorage, so a user coming back after
// 24h appeared "logged out" client-side (localStorage still
// valid) but actually got a 401 server-side (cookie gone) and
// the dashboard redirected them to /onboarding. Aligning the
// cookie TTL with the localStorage default removes that split-
// brain. KEEP IN SYNC if you ever add an explicit localStorage
// TTL (we don't have one today — localStorage is the durable
// half of the pair, the cookie is the bridge).

export const DEMO_COOKIE_NAME = 'demoUserId'

// 30 days, in seconds. Stored as a constant so the helper can
// re-use it for the `max-age` attribute.
export const DEMO_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/**
 * (No `isClerkConfigured` re-export here on purpose — the prior
 * footgun had the same name mean the SERVER variant in `lib/auth.js`
 * and the CLIENT variant in `lib/auth-cookie.js`, with no way to
 * tell from the import site. Internal callers of the client-side
 * check should import `isClerkConfiguredClient` from
 * `lib/clerk-config` directly. The `DemoAuthProvider` already does
 * this; removing the re-export prevents a future developer from
 * importing the wrong-named alias and silently getting the wrong
 * variant.)
 */

/**
 * Build the `Set-Cookie` header value for a demo session. Kept
 * as a separate pure function so the parsing logic is testable
 * without a DOM. `userId` is URL-encoded so future ids that
 * contain reserved characters (e.g. `;`, `,`) don't break the
 * header.
 *
 * The `Secure` flag is added conditionally on `location.protocol
 * === 'https:'` so the dev localhost flow (HTTP) keeps working
 * while Vercel HTTPS production gets the strict-transport-only
 * cookie. Browsers ignore `Secure` on HTTP origins, but
 * `SameSite=Lax` already protects the cookie from cross-site
 * CSRF in dev.
 */
export function buildDemoSessionCookieHeader(userId) {
  const secureFlag = (typeof location !== 'undefined' && location.protocol === 'https:')
    ? '; Secure'
    : ''
  return `${DEMO_COOKIE_NAME}=${encodeURIComponent(userId)}; path=/; max-age=${DEMO_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secureFlag}`
}

/**
 * Set the demo session cookie. Idempotent. Safe to call multiple
 * times (browser dedupes `Set-Cookie` on the same name+path+domain).
 * No-op on the server (`document` undefined).
 */
export function setDemoSessionCookie(userId) {
  if (typeof document === 'undefined') return
  document.cookie = buildDemoSessionCookieHeader(userId)
}

/**
 * True when the demo session cookie is present. Cheap O(n)
 * substring scan; the cookie header is at most a few hundred
 * chars so this is fine for the per-render use case in
 * `DemoAuthProvider`.
 */
export function hasDemoSessionCookie() {
  if (typeof document === 'undefined') return false
  return document.cookie.includes(`${DEMO_COOKIE_NAME}=`)
}
