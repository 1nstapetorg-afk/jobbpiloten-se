// tests/unit/round88-middleware-resource-auth.test.mjs
//
// Round-88 / Priority-2 #6 — locks the migration away from the
// deprecated `createRouteMatcher` in @clerk/nextjs 7.5.21.
//
// Background: Clerk's `createRouteMatcher` is deprecated — calling it
// logs a deprecation warning on EVERY construction (i.e. every request
// in dev) and it will be removed in the next major. Clerk's official
// migration guide (migrate-from-create-route-matcher) says middleware
// path logic should use the framework's NATIVE matching
// (`config.matcher` + `req.nextUrl.pathname`) instead, while
// `clerkMiddleware` itself stays (it is still required for Clerk).
//
// This file locks:
//   1. `createRouteMatcher` is no longer imported OR called.
//   2. The replacement `matchesPath` helper reads `req.nextUrl.pathname`
//      and implements the `(.*)` wildcard semantics.
//   3. `clerkMiddleware` is still imported + invoked (Clerk needs it).
//   4. Every formerly-protected route pattern survives in the native
//      matcher (dashboard/onboarding/settings + the /api/* set) and the
//      public set (sign-in/sign-up/webhooks/health/extension) is intact.
//
// The Round-85 demo-fallback gates (tests/unit/round85-auth-demo-fallback.test.mjs)
// continue to lock the auth BEHAVIOR (demo pass-throughs, JSON 401
// contract, NODE_ENV gating) — this file only locks the matcher swap.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MIDDLEWARE = readFileSync('middleware.js', 'utf8')

test('Round-88: createRouteMatcher is fully removed (import + call + destructure)', () => {
  // The deprecation warning fires at CONSTRUCTION — any remaining
  // executable usage (import, destructure, or call) re-opens the
  // every-request dev-log warning AND breaks at the next @clerk/nextjs
  // major. The header comment may still MENTION the symbol (it
  // documents the migration), so this lock filters comment lines the
  // same way the Round-80 raw-call lock in groq-provider-priority.test.mjs
  // does.
  const executableLines = MIDDLEWARE.split('\n').filter(
    (l) => l.includes('createRouteMatcher') && !l.trim().startsWith('//') && !l.trim().startsWith('*'),
  )
  assert.equal(
    executableLines.length,
    0,
    `createRouteMatcher must have zero executable usages (deprecated in @clerk/nextjs 7.5.21), found ${executableLines.length}:\n${executableLines.join('\n')}`,
  )
})

test('Round-88: matchesPath helper uses the native req.nextUrl.pathname', () => {
  // Clerk migration guide: replace matcher path logic with the
  // framework's native matching — `req.nextUrl.pathname`. The helper
  // must exist and read the pathname (never `req.url` string matching,
  // which would include query/hash and break pattern semantics).
  assert.match(
    MIDDLEWARE,
    /function\s+matchesPath\s*\(\s*req\s*,\s*patterns\s*\)\s*\{[\s\S]*?req\.nextUrl\.pathname/,
    'matchesPath(req, patterns) must exist and read req.nextUrl.pathname',
  )
})

test('Round-88: matchesPath preserves (.*)-wildcard semantics (base + prefix)', () => {
  // The deprecated matcher treated `/dashboard(.*)` as "exact base OR
  // base + any path". The native helper must keep that contract so
  // `/dashboard` and `/dashboard/x/y` both match.
  assert.match(
    MIDDLEWARE,
    /pattern\.endsWith\s*\(\s*['"]\(\.\*\)['"]\s*\)/,
    'matchesPath must special-case patterns ending in `(.*)`',
  )
  assert.match(
    MIDDLEWARE,
    /pathname\s*===\s*base\s*\|\|\s*pathname\.startsWith\s*\(\s*base\s*\+\s*['"]\/['"]\s*\)/,
    'matchesPath must match exact base OR base + / prefix (the (.*) wildcard contract)',
  )
})

test('Round-88: clerkMiddleware is still imported and invoked', () => {
  // The migration keeps clerkMiddleware — it is required for Clerk to
  // work at all (JWT refresh, session handling, cookie sync). Removing
  // it while removing createRouteMatcher would silently break auth.
  assert.match(
    MIDDLEWARE,
    /import\s*\(\s*['"]@clerk\/nextjs\/server['"]\s*\)[\s\S]*?clerkModule\.clerkMiddleware/,
    'middleware must still import clerkMiddleware from @clerk/nextjs/server',
  )
  assert.match(
    MIDDLEWARE,
    /clerkMiddleware\s*\(\s*async\s*\(\s*auth\s*,\s*req\s*\)/,
    'clerkMiddleware must still be invoked with the (auth, req) callback',
  )
})

test('Round-88: protected route set survives in the native matcher', () => {
  for (const pattern of [
    "'/dashboard(.*)'",
    "'/onboarding(.*)'",
    "'/settings(.*)'",
    "'/api/profile(.*)'",
    "'/api/applications(.*)'",
    "'/api/stats(.*)'",
    "'/api/apply-now(.*)'",
    "'/api/report(.*)'",
    "'/api/checkout(.*)'",
    "'/api/portal(.*)'",
    "'/api/subscription(.*)'",
  ]) {
    assert.ok(
      MIDDLEWARE.includes(`isProtectedRoute`),
      `isProtectedRoute matcher must exist (missing for ${pattern})`,
    )
    assert.ok(
      MIDDLEWARE.includes(pattern),
      `protected route pattern ${pattern} must survive the migration`,
    )
  }
})

test('Round-88: public route set survives in the native matcher', () => {
  for (const pattern of [
    "'/'",
    "'/sign-in(.*)'",
    "'/sign-up(.*)'",
    "'/api/webhooks/(.*)'",
    "'/api/health'",
    "'/api/extension/(.*)'",
  ]) {
    assert.ok(
      MIDDLEWARE.includes(`isPublicRoute`),
      `isPublicRoute matcher must exist (missing for ${pattern})`,
    )
    assert.ok(
      MIDDLEWARE.includes(pattern),
      `public route pattern ${pattern} must survive the migration`,
    )
  }
})

test('Round-88: config.matcher is untouched (framework-native filter)', () => {
  // The top-level config.matcher is the OTHER half of native matching —
  // it decides which requests reach middleware at all. A regression
  // that narrows it would silently stop protecting /api/* routes.
  assert.match(
    MIDDLEWARE,
    /export\s+const\s+config\s*=\s*\{[\s\S]*?matcher:\s*\[/,
    'config.matcher export must remain (framework-native request filter)',
  )
  assert.match(
    MIDDLEWARE,
    /'\/\(api\|trpc\)\(\.\*\)'/,
    'config.matcher must still always run for API routes',
  )
})
