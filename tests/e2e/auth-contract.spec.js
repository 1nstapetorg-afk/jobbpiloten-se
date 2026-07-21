// tests/e2e/auth-contract.spec.js
//
// E2E contract lock for the consolidated `requireAuth` / `resolveClerkId`
// helpers in /app/lib/auth.js — verified via the 3 protected routes
// (catch-all /api/profile, /api/extension/token, /api/upload-cv).
//
// Behaviour contract:
//   • Valid session (Clerk OR demoUserId cookie) → 200 with body.
//   • No session in demo mode → 401 with message "Unauthorized — logga in
//     demoläge" (the demo login form expects this exact phrase).
//   • No session in Clerk mode → 401 with message "Unauthorized" (Clerk
//     hosts its own sign-in flow).
//
// The previous unit suite (tests/unit/, lib/auth.js#isClerkConfigured etc.)
// already locks the source-level behaviour. THIS spec adds the HTTP-layer
// contract: the consolidated helper actually integrates correctly into
// Next.js App Router handlers and produces a real 401 NextResponse that
// the client can fetch() against. Catches next.js-only regressions
// (e.g. accidental sync/async mismatch in a Next 15 route handler) that
// `node --check` and unit-level mocks can't see.
//
// Run: `yarn test:e2e auth-contract`

import { test as base, expect } from '@playwright/test'
import { test as demoTest, expect as demoExpect } from './_fixtures/auth'
import { apiFetch } from './_helpers/apiFetch'

// ---------- Demo-mode (with seeded demoUserId cookie) ----------
// The _fixtures/auth test fixtures seeds `demoUserId=demo-user-001` on
// every new context, so this branch represents the user-already-logged-in
// scenario when Clerk isn't configured.

demoTest.describe('requireAuth — demo mode (cookie seeded)', () => {
  demoTest('GET /api/profile returns 200 with valid demoUserId cookie', async ({ page }) => {
    // The cookie is set by the fixture at context creation. Just hit
    // the route — no UI interaction needed.
    const res = await apiFetch(page, '/api/profile')
    // demo-user-001 has no Mongo profile document, so the route returns
    // 200 + { profile: null } — NOT a 401. The 401 gate is BEFORE the
    // profile lookup, so a 200 here confirms the auth helper passed
    // through. A 404 would be a regression in the helper itself.
    expect(res.status).toBe(200)
    // Body shape: { profile: <doc|null> } — value is null since the
    // demo-user hasn't seeded a profile in this test context.
    expect(res.body).toBeTruthy()
    expect('profile' in res.body).toBe(true)
  })
})

// ---------- Unauthenticated (no cookies, no Clerk keys in this env) ----------
// The base `@playwright/test` test (NOT the demo fixture) is used here
// so the browser context has NO cookies — this is what a freshly-installed
// extension popup would experience on first launch.

base.describe('requireAuth — unauthenticated (no cookies)', () => {
  // Use a fresh context WITHOUT the demoUserId cookie so the auth helper
  // exercises its failing branch.
  let ctx
  let page

  base.beforeEach(async ({ browser }) => {
    ctx = await browser.newContext()
    page = await ctx.newPage()
  })

  base.afterEach(async () => {
    // Defensive guard: if `beforeEach` threw before assigning `ctx`,
    // `ctx` remains `undefined` and calling `.close()` would throw a
    // TypeError that cascades to fail the entire suite. This pattern
    // is mandatory for any Playwright test that creates a context in
    // `beforeEach` — without it, a single `browser.newContext()` flake
    // kills every subsequent test in the describe block.
    if (ctx) await ctx.close()
  })

  base('GET /api/profile returns 401 with Swedish demo-mode message', async () => {
    const res = await apiFetch(page, '/api/profile')
    expect(res.status).toBe(401)
    expect(typeof res.body?.error).toBe('string')
    // The exact Swedish phrase the demo login form greps for to render
    // the inline demo button. Drift here breaks the demo UX.
    expect(res.body.error).toContain('logga in i demoläge')
  })

  base('GET /api/applications returns 401 with Swedish demo-mode message', async () => {
    // Same exact-phrase contract as /api/profile — both flow through
    // requireAuth's demo branch via app/api/[[...path]]/route.js. The
    // dashboard hits this endpoint on every load and depends on the
    // 401-with-Swedish-error contract to redirect to /sign-in when the
    // demo cookie is missing. Caught a regression where the catch-all
    // was refactored away from requireAuth and the helper's message
    // string drifted to "Unauthorized" instead of the Swedish demo
    // phrase — users with a missing cookie were redirected to
    // /onboarding instead of /sign-in, breaking the re-sign-in UX.
    const res = await apiFetch(page, '/api/applications')
    expect(res.status).toBe(401)
    expect(typeof res.body?.error).toBe('string')
    expect(res.body.error).toContain('logga in i demoläge')
  })

  base('POST /api/extension/token returns 401 with "Inte inloggad" message', async () => {
    // The token route's custom 401 message is different from catch-all's
    // because it speaks to a Chrome-extension user directly (not a
    // Swedish-named dashboard session). Locking this distinct string
    // prevents accidental cross-pollination with the catch-all's
    // message.
    const res = await apiFetch(page, '/api/extension/token', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(typeof res.body?.error).toBe('string')
    expect(res.body.error).toContain('Inte inloggad')
  })

  base('POST /api/upload-cv returns 401 (gate before multipart parse)', async () => {
    // Even an empty/garbage body should 401 — proves the requireAuth
    // gate is checked before FormData parsing. A regression that
    // moves the auth check AFTER `request.formData()` would surface
    // as 400 (bad multipart) instead of 401, breaking the E2E.
    const res = await apiFetch(page, '/api/upload-cv', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

// ---------- Helper-level invariant lock ----------
// Static source-grep lock (mirrors the unit-test style). Audits that
// the consolidated helper is the actual source of the auth logic —
// no route handler should re-introduce an inline isClerkConfigured +
// requireAuth + resolveClerkId block that drifts from the canonical
// helper. Caught the round-9 consolidation regression by inspecting
// source-grep matches across the 3 routes.
//
// Round-13 expansion: cv-ocr/route.js + ai-usage/route.js used to
// carry their own inline `if (isClerkConfigured()) { ... Clerk ... }
// else { ... demo 401 ... }` blocks with BOTH literal messages
// hard-coded. The Clerk branch literal was the same `'Unauthorized'`
// the old lock already catches, but the demo branch literal was
// `'Unauthorized — logga in i demoläge'` — outside the old lock's
// `not.toMatch` regex. A future refactor that re-inlined the demo
// branch with a typo (e.g. `'logga in demoläge'` without the `i`)
// would survive the old regex AND still produce a 401, with no
// test feedback. We now match BOTH literals per route.

base.describe('Auth consolidation invariant (source-grep)', () => {
  base('no route handler carries an inline "Unauthorized" or "logga in i demoläge" 401 gate', async () => {
    // The previous duplication was: inline `if (...) return { error:
    // NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }`
    // blocks in catch-all + upload-cv + extension/token + cv-ocr +
    // ai-usage. The consolidated helper is the ONLY place this
    // literal appears now. If a future refactor re-inlines ANY
    // 401-gate definition with EITHER literal, this lock catches
    // it before the route ships.
    const fs = await import('node:fs/promises')
    const routes = [
      // The 3 high-traffic routes (covered by the original lock).
      'app/api/[[...path]]/route.js',
      'app/api/upload-cv/route.js',
      'app/api/extension/token/route.js',
      // The 2 stub / monitoring routes that used to carry inline
      // gates via the isClerkConfiguredServer import pattern. Now
      // canonical via `requireAuth`, but the lock covers them so
      // a future "copy-paste the gate into cv-ocr / ai-usage"
      // refactor is caught immediately.
      'app/api/cv-ocr/route.js',
      'app/api/ai-usage/route.js',
    ]
    // The bad pattern: any inline 401-gate that hard-codes EITHER
    // literal. The good pattern:
    //   `const { userId, error } = await requireAuth(...)`
    // Two separate regexes (one per literal) so the lock message
    // tells the next reader WHICH string drifted, not just "a 401
    // gate was re-inlined". The Swedish literal is the one the demo
    // login form greps for to render the inline demo button — drift
    // there breaks the demo UX specifically.
    const inlineUnauthorized = /\{ error: NextResponse\.json\(\s*\{\s*error:\s*['"]Unauthorized['"]\s*\s*\}/
    const inlineSwedishDemo = /\{ error: NextResponse\.json\(\s*\{\s*error:\s*['"]Unauthorized\s*—\s*logga in i demoläge['"]\s*\}/
    for (const r of routes) {
      const src = await fs.readFile(r, 'utf-8')
      expect(src, `${r} re-inlined an 'Unauthorized' 401-gate that should come from lib/auth.js#requireAuth`).not.toMatch(inlineUnauthorized)
      expect(src, `${r} re-inlined a 'Unauthorized — logga in i demoläge' 401-gate that should come from lib/auth.js#requireAuth`).not.toMatch(inlineSwedishDemo)
    }
  })
})
