import { test as base } from '@playwright/test'
import { seedDemoUser } from '../_helpers/seedDemoUser'

/**
 * Demo-mode auth fixture.
 *
 * JobbPiloten's API supports a demo-cookie fallback when Clerk keys are
 * absent (see lib/auth.js → getDemoUserId). We seed the cookie at the
 * browser-context level so every test starts already "authenticated"
 * without going through Clerk's hosted sign-in form.
 *
 * Round-13 expansion: extended-auth/page.js uses `useUser()` which reads
 * the user from `localStorage.demoUser` (not the cookie — the cookie is
 * only read server-side via requireAuth). The "happy-path: signed-in
 * user short-circuits to DONE without showing the sign-in block"
 * extension-auth spec expected the bridge to mint on first paint,
 * but without a localStorage seed the page rendered the SIGN_IN block
 * and waited 15 s before timing out. We now seed `localStorage.demoUser`
 * via `context.addInitScript` so EVERY page that opens under this
 * fixture starts with the demo user already authenticated client-side.
 *
 * The spec that EXPLICITLY removes localStorage.demoUser to force the
 * SIGN_IN path (extension-auth-handshake.spec.js — the demo-mode
 * Clicks-the-button test) still works: the per-test removal overrides
 * the init-script seed on the next reload.
 *
 * Round-30 per-worker fixture migration: each Playwright worker had its
 * own OS process and got `TEST_PARALLEL_INDEX` = '0', '1', '2', ...
 * auto-set. We derived `DEMO_CLERK_ID = "demo-user-001-w${idx}"` so
 * destructive tests (GDPR account-delete in tests/e2e/settings.spec.js)
 * only wiped their own per-worker row. Default to '0' for `workers: 1`
 * runs (the legacy baseline) so the lite path still worked as
 * `demo-user-001-w0`.
 *
 * Round-31 PER-TEST FIXTURE MIGRATION (this round): the per-WORKER
 * isolation was insufficient — within a worker, parallel tests still
 * shared the same clerkId, so fullyParallel: true (or any local
 * `workers ≥ 2` run that incidentally routed parallel tests into
 * the same worker) could cascade-fail GDPR destructive ops.
 * Fix: derive the clerkId from `testInfo.workerIndex` +
 * `hash(testInfo.title)` at fixture-call time (per-TEST, NOT
 * module-load). Using `testInfo.title` hash instead of
 * `testInfo.parallelIndex` because:
 *   • parallelIndex is NOT stable across re-runs of the same test
 *     command (Playwright's partition algorithm shuffles which
 *     worker handles which test). tests that depended on persisted
 *     state across runs would misbehave.
 *   • title hash IS stable: same test title always yields same
 *     clerkId across runs and across worker pool sizes
 *     (`workers: 1` ↔ `workers: 4`).
 *   • Collisions are 1/2^32 by birthday paradox — practically
 *     impossible for the current ~30-test suite.
 * Format: `demo-user-001-w${workerIdx}-h${titleHash}`.
 *
 * With per-test clerkIds, `fullyParallel: true` is now safe (Round-31
 * flips it back from Round-30's `false` belt-and-braces setting).
 * Different parallel tests within the SAME worker now have different
 * `-h${hash}` suffixes, so the GDPR destructive test in
 * tests/e2e/settings.spec.js wipes only its OWN per-test row and
 * does not cascade to read-only parallel siblings. The TODO marker
 * in tests/e2e/settings.spec.js is resolved.
 *
 * The lib/auth-cookie.js builder tests still pass literals like
 * 'demo-user-001' directly because they exercise the
 * `setDemoSessionCookie()` helper for the manual demo-button flow
 * (sign-in / sign-up / onboarding), NOT the e2e fixture path. The
 * `walkthrough.mjs` script also uses the literal — it's a manual
 * smoke script, not a fixture.
 *
 * Usage:
 *   import { test, expect } from './_fixtures/auth'
 *   test('...', async ({ page }) => { ... })
 */

// Round-31: title hash for stable per-test clerkIds. NOT a crypto
// hash — just a 32-bit FNV-1a-style integer hash. Determinism is
// what we need (same title → same hash across runs and platform),
// NOT collision resistance. The cookie value passes through
// decodeURIComponent in lib/auth.js → getDemoUserId, so plain
// ASCII integers (no special chars) are key-safe. Function
// declaration (vs arrow) for source-grep boundary consistency
// with isStrict() in seedDemoUser.js.
//
// Round-31.1 polish (code-review minor #2): non-zero FNV offset
// basis (`0x811c9dc5`) so an empty-title test never collides on
// `h0`. Playwright titles are non-empty in practice, but a defensive
// non-zero seed eliminates the footgun entirely. The empty-title
// case is mathematically still possible (e.g. a future maintainer
// who uses an anonymous `test(' ')`) and a single zero-output
// collision would silently share the same Mongo doc across the
// whole suite — bad blast radius.
function hashTestTitle(title) {
  let h = 0x811c9dc5  // FNV-1a offset basis
  for (let i = 0; i < title.length; i++) {
    h = (h ^ title.charCodeAt(i)) | 0
    // FNV-1a prime multiplier, mod 2^32 via `| 0`.
    h = Math.imul(h, 0x01000193) | 0
  }
  // Math.abs to keep the result positive so the final id never
  // has a negative sign in the suffix (cosmetic; the cookie
  // regex captures either way, but a positive int is cleaner).
  return Math.abs(h)
}

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    // Round-31: per-test clerkId. workerIndex is stable per-worker
    // (process-level). titleHash is stable per-test (deterministic
    // across re-runs + worker pool sizes). Both feed into the
    // final id so logs can tell which worker + which test.
    //
    // ?? fallbacks for non-Playwright invocations (e.g. a future
    // script that imports this file outside the test runner).
    const workerIdx = testInfo.workerIndex ?? 0
    const titleHash = hashTestTitle(testInfo.title)
    const demoClerkId = `demo-user-001-w${workerIdx}-h${titleHash}`
    await context.addCookies([
      {
        name: 'demoUserId',
        value: demoClerkId,
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: false,
        sameSite: 'Lax',
      },
    ])
    // Seed localStorage.demoUser at every page's document_start so
    // client-side useUser() returns the demo user immediately. The
    // initScript runs BEFORE the React mount, so useState/init-effect
    // captures the seeded value on first render — same observable
    // shape as a real Clerk-or-demo user. Shape mirrors the object
    // sign-in/page.js writes when the demo button is clicked.
    //
    // Round-30: thread the per-worker clerkId through `addInitScript`'s
    // arg slot rather than via closure. Playwright runs the init
    // function in the BROWSER realm — closure variables from the
    // Node scope serialize as `undefined` (the function is stringified
    // and eval'd in the page). The arg parameter is the supported
    // cross-realm escape hatch and avoids the silent "employee id is
    // undefined in the browser" trap that the Round-30 thinker flagged.
    // Round-31: now thread the PER-TEST clerkId (the bound variable
    // `demoClerkId` from above is captured into the fixture closure
    // but ONLY as the arg — the function source itself does NOT
    // close over it).
    await context.addInitScript((clerkId) => {
      try {
        window.localStorage.setItem(
          'demoUser',
          JSON.stringify({
            id: clerkId,
            firstName: 'Demo',
            lastName: 'Användare',
            fullName: 'Demo Användare',
            primaryEmailAddress: { emailAddress: 'demo@jobbpiloten.se' },
            emailAddresses: [
              { emailAddress: 'demo@jobbpiloten.se', id: 'demo-email-1' },
            ],
            imageUrl: null,
            createdAt: new Date().toISOString(),
          }),
        )
      } catch (_) {
        // Older browsers / privacy modes that throw on localStorage
        // access — fall through. Server-side cookie is still set so
        // the API routes still auth the request; only client-side
        // useUser() would render without a user.
      }
    }, demoClerkId)

    // Round-15: seed demo profile + 12 sample apps before specs.
    // Round-24 (seedDemoUser extraction) — the inline try/catch dance
    // moved to tests/e2e/_helpers/seedDemoUser.js so any spec that
    // needs the canonical Swedish-form seed can import + call it
    // directly. The helper preserves the exact CI-throw vs local-
    // warn semantics the fixture used to inline here. Call site +
    // commit history (cc91a77) live in the helper.
    // throws on CI, warns-and-continues locally — do NOT wrap in
    // an outer try/catch (would swallow CI failures and let them
    // surface as 20 s timeouts downstream instead of a clear error).
    //
    // Round-31 note: seedDemoUser reads the active clerkId via
    // /api/profile (Round-30 verify step) so the warning copy will
    // surface the actual per-test id (`demo-user-001-w${i}-h${hash}`)
    // for whichever test just seeded.
    await seedDemoUser(context)

    await use(context)
  },
})

export { expect } from '@playwright/test'
