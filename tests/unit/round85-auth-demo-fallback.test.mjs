// tests/unit/round85-auth-demo-fallback.test.mjs
//
// 2026-08-04 (Round-85) — structural lock for the "onboarding shows
// Unauthorized" fix. Manual testers running the app in a
// Clerk-configured dev environment (real Clerk keys in .env) hit 401
// on every onboarding API call:
//   • "Förhandsvisa AI-mejl" → POST /api/email-preview → 401
//   • "Slutför" → POST /api/profile → 401 ("Kunde inte spara
//     profilen: Unauthorized")
//
// ROOT CAUSE: the onboarding wizard (app/onboarding/page.js) sets the
// demo cookie (`demoUserId=demo-user-001`) and expects demo-mode auth,
// but `resolveAuthState` (lib/auth.js) and the middleware's /api/*
// gate ONLY accepted Clerk sessions when Clerk keys were configured —
// the demo cookie was ignored, so a tester without a Clerk session
// was 401'd everywhere.
//
// FIX: when Clerk IS configured but yields no session, fall back to
// the demo identity (getDemoUserId) — gated to NON-PRODUCTION so a
// real production deploy keeps strict Clerk-only auth. Applied in:
//   • lib/auth.js     — resolveAuthState falls back to getDemoUserId.
//   • middleware.js   — the /api/* gate AND page-route protection skip
//     for demo-identity requests on the main path and the
//     Clerk-SDK-throw catch path.
//
// WHAT THIS FILE LOCKS (source-pattern, mirrors the codebase's
// structural-lock culture — see clerk-config-shape.test.mjs,
// round74-upload-cv-runtime-shape.test.mjs):
//   • resolveAuthState still attempts Clerk auth() when configured.
//   • The demo fallback exists and is gated by NODE_ENV !== 'production'.
//   • middleware.js imports getDemoUserId (the shared helper) rather
//     than re-implementing cookie parsing (drift guard).
//   • The demo pass-through exists on BOTH the main clerkMw path and
//     the Clerk-SDK-throw catch path, for BOTH /api/* and page routes.
//
// We deliberately do NOT execute resolveAuthState here — it
// dynamically imports @clerk/nextjs/server, which would pull the full
// Clerk SDK into a plain node --test run. Source-pattern locking is
// the established contract for this module (same rationale as the
// round-74 runtime-shape locks).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_SRC = fs.readFileSync(path.join(__dirname, '../..', 'lib', 'auth.js'), 'utf8')
const MIDDLEWARE_SRC = fs.readFileSync(path.join(__dirname, '../..', 'middleware.js'), 'utf8')

// =====================================================================
// Lock 1 — resolveAuthState still attempts Clerk auth when configured.
// =====================================================================

test('Lock 1: resolveAuthState calls Clerk auth() when configured', () => {
  assert.match(
    AUTH_SRC,
    /const\s+\{\s*auth\s*\}\s*=\s*await\s+import\('@clerk\/nextjs\/server'\)/,
    'resolveAuthState must dynamically import Clerk server auth when Clerk is configured.',
  )
  assert.match(
    AUTH_SRC,
    /await\s+auth\(\)/,
    'resolveAuthState must await auth() so a real Clerk session always wins over the demo fallback.',
  )
})

// =====================================================================
// Lock 2 — the demo-cookie fallback exists and is non-production gated.
// =====================================================================

test('Lock 2: resolveAuthState falls back to getDemoUserId when Clerk yields no session, non-production only', () => {
  assert.match(
    AUTH_SRC,
    /getDemoUserId\s*\(\s*request\s*\)/,
    'resolveAuthState must fall back to getDemoUserId(request) when Clerk yields no session.',
  )
  assert.match(
    AUTH_SRC,
    /process\.env\.NODE_ENV\s*!==\s*'production'/,
    'the demo fallback must be gated to non-production so a production deploy keeps strict Clerk-only auth.',
  )
  // The fallback must be INSIDE the Clerk-configured branch (i.e. after
  // `isClerkConfiguredServer()`), not on the demo-mode-only path.
  // Anchor on the ASSIGNMENT call (`const demoId = getDemoUserId(request)`)
  // rather than the bare symbol — the function DEFINITION
  // `export function getDemoUserId(request)` also contains the same
  // text and sits BEFORE the resolveAuthState branch, which would
  // produce a false "fallback appears after branch" pass/fail.
  const configuredIdx = AUTH_SRC.indexOf('isClerkConfiguredServer()')
  const fallbackIdx = AUTH_SRC.indexOf('const demoId = getDemoUserId(request)')
  assert.ok(
    fallbackIdx > 0,
    'resolveAuthState must assign the demo fallback via `const demoId = getDemoUserId(request)`.',
  )
  assert.ok(
    configuredIdx >= 0 && fallbackIdx > configuredIdx,
    'the getDemoUserId fallback must appear AFTER the isClerkConfiguredServer() branch so it only fires in Clerk-configured mode.',
  )
})

// =====================================================================
// Lock 3 — middleware imports the shared getDemoUserId helper (no
// re-implemented cookie parsing that could drift).
// =====================================================================

test('Lock 3: middleware.js imports getDemoUserId from @/lib/auth', () => {
  assert.match(
    MIDDLEWARE_SRC,
    /import\s*\{\s*getDemoUserId\s*\}\s*from\s*['"]@\/lib\/auth['"]/,
    'middleware.js must reuse getDemoUserId from lib/auth.js — a copy-pasted cookie parse could drift from the canonical helper.',
  )
})

// =====================================================================
// Lock 4 — the /api/* gate passes demo-identity requests through,
// non-production only (main clerkMw path AND catch path).
// =====================================================================

test('Lock 4: middleware /api/* gate passes demo-identity requests through (main + catch paths)', () => {
  // Main path: inside the clerkMw callback, /api/* branch.
  const mainGates = MIDDLEWARE_SRC.match(
    /if\s*\(process\.env\.NODE_ENV\s*!==\s*'production'\s*&&\s*getDemoUserId\s*\(\s*req\s*\)\)\s*\{\s*return\s+NextResponse\.next\(\)\s*;/g,
  )
  assert.ok(
    mainGates && mainGates.length >= 1,
    'middleware must have a non-production demo pass-through returning NextResponse.next() for /api/* requests on the main clerkMw path.',
  )
  // Catch path: the Clerk-SDK-throw fallback also passes demo requests.
  assert.ok(
    mainGates && mainGates.length >= 2,
    'the demo pass-through must ALSO exist on the Clerk-SDK-throw catch path (the catch block returns NextResponse.next() for demo-identity requests).',
  )
})

// =====================================================================
// Lock 5 — page-route protection (auth.protect) is also skipped for
// demo-identity requests (so /dashboard renders post-onboarding),
// non-production only.
// =====================================================================

test('Lock 5: middleware page routes skip auth.protect() for demo-identity requests (non-production)', () => {
  // The page-route demo check must appear BEFORE `await auth.protect()`.
  const pageDemoIdx = MIDDLEWARE_SRC.indexOf('getDemoUserId(req)', MIDDLEWARE_SRC.indexOf("pathname.startsWith('/api/')") + 1)
  const protectIdx = MIDDLEWARE_SRC.indexOf('await auth.protect()')
  assert.ok(
    pageDemoIdx >= 0 && protectIdx > pageDemoIdx,
    'a demo-identity check must appear before await auth.protect() so post-onboarding page loads (e.g. /dashboard) render for demo-cookie testers in dev.',
  )
})

// =====================================================================
// Lock 6 — production safety: the fallback must NOT appear in a way
// that could bypass Clerk in production. The two gates are:
//   • resolveAuthState returns `{ userId: null, demo: false }` (strict)
//     when NODE_ENV === 'production' and Clerk has no session.
//   • middleware always 401s /api/* (or redirects pages) for
//     non-demo requests in Clerk mode regardless of env.
// =====================================================================

test('Lock 6: production keeps strict Clerk-only auth (no unconditional demo bypass)', () => {
  // Every getDemoUserId call site in BOTH files must be preceded by a
  // non-production guard within a few lines (source-order heuristic).
  for (const [label, src] of [['lib/auth.js', AUTH_SRC], ['middleware.js', MIDDLEWARE_SRC]]) {
    const matches = [...src.matchAll(/getDemoUserId/g)]
    for (const m of matches) {
      // Skip the function DECLARATION itself ("export function
      // getDemoUserId(request)") — that's the definition, not a call
      // site, and it carries no env guard by design.
      const before = src.slice(Math.max(0, m.index - 80), m.index)
      if (/function\s*$/.test(before)) continue
      // Skip the import statement ("import { getDemoUserId } from ...")
      // — a module import, not a call site.
      if (/import\s*\{\s*$/.test(before)) continue
      // Skip the PURE demo-mode call in lib/auth.js's else branch
      // (`return { userId: getDemoUserId(request), demo: true }`)
      // — that branch only runs when Clerk is NOT configured at all,
      // which is demo mode by definition (no guard needed). Only the
      // Clerk-configured fallback (added Round-85) must be gated.
      const ctxBefore = src.slice(Math.max(0, m.index - 200), m.index)
      const isPureDemoBranch = ctxBefore.includes('return { userId: getDemoUserId')
      if (isPureDemoBranch) continue
      assert.match(
        ctxBefore,
        /NODE_ENV\s*!==\s*'production'|NODE_ENV === 'production'/,
        `${label}: every getDemoUserId call site (except the function definition and the pure demo-mode else branch) must be preceded by a non-production guard within 200 chars (found an ungated call at index ${m.index}).`,
      )
    }
  }
})
