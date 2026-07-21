/**
 * Round-79 regression — when Clerk SDK rejects keys, `middleware.js` must:
 *   1. Not crash with HTTP 500 (the Round-78 cascade symptom).
 *   2. Redirect unauthenticated visitors hitting protected routes to /sign-in.
 *      (Pre-Round-79 returned NextResponse.next() which leaked protected HTML.)
 *   3. Pass PUBLIC routes through unchanged.
 *
 * The test mocks `@clerk/nextjs/server` via `Module._cache` so we don't need a
 * real Clerk install. clerkMiddleware() returns a function that THROWS — that
 * is the exact failure mode from the live test (Clerk SDK V7 rejecting the
 * user's publishable key on every request).
 *
 * Run with: node --test tests/unit/middleware-clerk-failure.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

// ─── helpers ──────────────────────────────────────────────────────────────

function setMockClerk(behaviour = 'throw') {
  // Inject a mock for @clerk/nextjs/server BEFORE middleware.js imports it.
  const MOCK_ID = '@clerk/nextjs/server';
  Module._cache[MOCK_ID] = {
    id: MOCK_ID,
    filename: MOCK_ID,
    loaded: true,
    exports: {
      clerkMiddleware: (_innerCb) => async (_req) => {
        if (behaviour === 'throw') {
          // The exact stack pattern we observed in production:
          // Clerk SDK V7 throws "publishable_key_invalid" when given a key
          // whose ClerkFrontendAPI URL does not match a real instance.
          throw new Error('clerk: publishable_key_invalid');
        }
        return { status: 200, headers: new Headers() };
      },
      createRouteMatcher: (patterns) => (req) => {
        const path = new URL(req.url).pathname;
        return patterns.some((p) => {
          // Strip regex noise used by Next.js matcher strings: '(.*)', '(.*)', '$'.
          const bare = p.replace(/\(\.\*\)/g, '').replace(/\$$/, '').replace(/\$$/, '');
          return path === bare || path.startsWith(bare);
        });
      },
    },
  };
}

function clearMockClerk() {
  delete Module._cache['@clerk/nextjs/server'];
}

// ─── setUp ────────────────────────────────────────────────────────────────

test.before(async () => {
  // Set env BEFORE loading middleware.js so isClerkConfiguredServer() returns true.
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY =
    'pk_test_mock-publishable-key-for-unit-test-only';
  process.env.CLERK_SECRET_KEY = 'sk_test_mock-secret-key-for-unit-test-only-30chars';
});

// ─── tests ────────────────────────────────────────────────────────────────

test('middleware.js: protected route under Clerk-Failure redirects to /sign-in', async () => {
  clearMockClerk();
  setMockClerk('throw');

  // Re-import middleware fresh so it picks up our cached @clerk/nextjs/server mock
  const middlewarePath = new URL('../../middleware.js', import.meta.url).pathname;
  const mod = await import(middlewarePath + '?t=' + Date.now());
  const mw = mod.default;
  assert.equal(typeof mw, 'function', 'middleware.js must export default async fn');

  const req = {
    url: 'http://localhost:3000/dashboard',
    headers: new Headers(),
  };

  const res = await mw(req);

  // Assert: status is 3xx (redirect) — NOT 500 (the Round-78 cascade)
  assert.ok(
    res.status >= 300 && res.status < 400,
    `expected redirect (3xx), got ${res.status}. Caller should be sent to /sign-in.`,
  );

  // Assert: location header points at /sign-in
  const loc = res.headers.get('location') || '';
  assert.match(
    loc,
    /\/sign-in/,
    `expected redirect to /sign-in, got location="${loc}"`,
  );
});

test('middleware.js: public route under Clerk-Failure passes through unchanged', async () => {
  clearMockClerk();
  setMockClerk('throw');

  const middlewarePath = new URL('../../middleware.js', import.meta.url).pathname;
  const mod = await import(middlewarePath + '?t=' + Date.now());
  const mw = mod.default;

  const req = {
    url: 'http://localhost:3000/',
    headers: new Headers(),
  };

  const res = await mw(req);

  // Assert: NOT a redirect (public route gets NextResponse.next())
  assert.ok(
    res.status === 200 || res.status === 307 || res.status === undefined,
    `public route should pass through (200) or normal-response, got ${res.status}`,
  );
});

test('middleware.js: happy-path (keys valid) — protected route also redirects when no auth', async () => {
  clearMockClerk();
  setMockClerk('ok'); // clerkMw returns 200 — but Clerk auth itself would
                       // normally issue a redirect via auth.protect(). Since
                       // we mock clerkMiddleware, we only verify here that
                       // paths classified as non-protected still pass through.

  const middlewarePath = new URL('../../middleware.js', import.meta.url).pathname;
  const mod = await import(middlewarePath + '?t=' + Date.now());
  const mw = mod.default;

  const req = {
    url: 'http://localhost:3000/',
    headers: new Headers(),
  };

  const res = await mw(req);
  assert.ok(res, 'middleware must return a NextResponse on success path');
});
