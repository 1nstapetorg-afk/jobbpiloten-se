// tests/unit/demo-button-call-sites.test.mjs
//
// Round-33 structural-lock test for the manual demo-button flow
// call sites in the 4 page files referenced by the auth-cookie
// docstring (tests/unit/auth-cookie.test.mjs):
//
//   - /sign-in        (app/sign-in/[[...sign-in]]/page.js)
//   - /sign-up        (app/sign-up/[[...sign-up]]/page.js)
//   - /onboarding     (app/onboarding/page.js)
//   - /extension-auth (app/extension-auth/page.js)
//
// The docstring at tests/unit/auth-cookie.test.mjs asserts:
// "the path exercised when a user clicks 'Demo' on /sign-in,
//  /sign-up, /onboarding, or /extension-auth (Round-32 closure
//  review confirmed all four call sites)".
//
// The four pages exhibit HETEROGENEOUS wiring patterns:
//   - /onboarding     calls `setDemoSessionCookie('demo-user-001')`
//                     directly with the literal.
//   - /sign-in        calls `setDemoSessionCookie(demoUser.id)`
//                     where `demoUser.id = 'demo-user-001'`.
//   - /sign-up        does NOT call setDemoSessionCookie; the
//                     literal is in the demo Clerk-shaped user
//                     object's `id` field (the parent flow is
//                     elsewhere).
//   - /extension-auth same shape as /sign-up. The literal lives in
//                     the demo user object's `id` field.
//
// The UNIVERSAL PIN across all four pages is the literal
// `'demo-user-001'` — present in the demo Clerk user-shaped
// object's `id` field on every page. If a future maintainer
// migrates the wizard pages away from the Clerk-shaped demo
// user object (e.g. replaces `id: 'demo-user-001'` with an
// env-var indirection or null), the manual-flow contract
// breaks silently — this test fires if ANY of the four pages
// loses the literal.
//
// Source-grep pattern matches single OR double quotes (the
// literal may flip between `'demo-user-001'` and
// `"demo-user-001"` over time without changing intent).
//
// Pattern mirrors tests/unit/auth-fixture.test.mjs and
// tests/unit/playwright-config.test.mjs: read the file as a
// string and grep. Pages are React-rendered client components
// in a Next.js app — the demo-button wiring is the structural
// invariant being locked, not the rendered output (rendered
// output is tested in tests/e2e/extension-auth-handshake.spec.js
// et al).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

// Route label + page-file path. The dynamic-segment bracketed
// folders (`[[...sign-in]]`) are kept literal — they are the
// actual filesystem names, not regex patterns.
const DEMO_BUTTON_PAGES = [
  { route: '/sign-in', path: 'app/sign-in/[[...sign-in]]/page.js' },
  { route: '/sign-up', path: 'app/sign-up/[[...sign-up]]/page.js' },
  { route: '/onboarding', path: 'app/onboarding/page.js' },
  { route: '/extension-auth', path: 'app/extension-auth/page.js' },
]

// Match single-quoted, double-quoted, OR backtick-quoted literal.
// The Round-33 reviewer's "cheap insurance" item — handles a
// future maintainer who writes `id: \`demo-user-001\`` (template
// literal style) instead of single/double quoted. All-three-
// string-syntaxes are canonical here.
const DEMO_USER_LITERAL = /['"`]demo-user-001['"`]/

for (const { route, path } of DEMO_BUTTON_PAGES) {
  test(`Round-33: ${route} page (${path}) still contains the 'demo-user-001' literal — manual demo-button flow contract pin`, () => {
    // Pre-flight: file exists check. A maintainer who moves the
    // page gets a specific error rather than a regex silent-miss
    // (which would imply the demo button is still wired when
    // it's not).
    assert.ok(
      existsSync(path),
      `${route} (${path}) page file must exist — if the page was moved, this test should be updated alongside the migration, not deleted silently`,
    )
    const source = readFileSync(path, 'utf8')
    assert.match(
      source,
      DEMO_USER_LITERAL,
      `${route} (${path}) must still contain the literal 'demo-user-001' (single- or double-quoted). Dropping this literal breaks the manual demo-button flow that tests/unit/auth-cookie.test.mjs references as one of the four required call sites. Pin rationale: the 4 pages have heterogeneous wiring (only /onboarding calls setDemoSessionCookie directly; /sign-in /sign-up /extension-auth thread the literal through demoUser.id) — the universal pin is the literal itself.`,
    )
  })
}
