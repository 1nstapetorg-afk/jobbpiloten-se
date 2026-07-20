// tests/unit/auth-cookie.test.mjs
//
// Unit tests for the pure helpers in `lib/auth-cookie.js`.
//
// These cover the functions that don't need a browser runtime —
// constants, header builders, and the env-var readers. The DOM-
// touching `setDemoSessionCookie` and `hasDemoSessionCookie` are
// tested via JSDOM-style global stubs (delete / reassign
// `globalThis.location` and `globalThis.document`) so the suite
// runs in plain `node --test` without a jsdom dependency.
//
// On the `demo-user-001` literal:
// Every `buildDemoSessionCookieHeader('demo-user-001')` /
// `setDemoSessionCookie('demo-user-001')` call in this file is
// testing the MANUAL DEMO-BUTTON FLOW — the path exercised when
// a user clicks "Demo" on /sign-in, /sign-up, /onboarding, or
// /extension-auth (Round-32 closure review confirmed all four
// call sites). That flow writes a fixed `demo-user-001` to the
// demo cookie. The E2E FIXTURE path is fully separate:
// tests/e2e/_fixtures/auth.js (Round-31) derives a per-TEST
// `demo-user-001-w${workerIdx}-h${hash}` clerkId via testInfo
// + FNV-1a, so the fixture path never sets the literal
// `demo-user-001`. The literal here is correct in its own
// context (manual button flow); a future maintainer confusing
// the two would NOT be caught by this test — the e2e fixture
// isolation is locked by `tests/unit/auth-fixture.test.mjs`.
// Keep them mentally separate: this file = manual button flow;
// tests/unit/auth-fixture.test.mjs = e2e fixture isolation.
//
// Round-32 (consolidates prior asymmetry note + no-separate-file
// paragraph): the originally-referenced
// tests/unit/cookie-config-contract.test.mjs was never landed, so
// no separate call-site pattern-lock file exists. The in-file
// enforcement is the test-name suffix `— manual demo-button flow`
// — ANY new test added that exercises the cookie builder
// helpers (`buildDemoSessionCookieHeader`, `hasDemoSessionCookie`,
// `setDemoSessionCookie`) MUST append the suffix (coverage
// degrades silently otherwise). The `isClerkConfigured` env-
// var tests below are intentionally UNSUFFIXED because they
// exercise `lib/clerk-config.js` shape, NOT the manual-flow
// cookie builder.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEMO_COOKIE_NAME,
  DEMO_COOKIE_MAX_AGE_SECONDS,
  buildDemoSessionCookieHeader,
  hasDemoSessionCookie,
  setDemoSessionCookie,
} from '../../lib/auth-cookie.js'
// `isClerkConfigured` is no longer re-exported from `lib/auth-cookie.js`
// — it was dropped in the round-12 consolidation to remove the
// footgun where the same name meant SERVER in `lib/auth.js` but
// CLIENT in `lib/auth-cookie.js`. The canonical export now lives
// in `lib/clerk-config.js`. Importing from there directly.
import { isClerkConfiguredClient as isClerkConfigured } from '../../lib/clerk-config.js'

// ----- Constants -----

test('DEMO_COOKIE_NAME is the literal "demoUserId"', () => {
  // Locked so a typo in the constant doesn't silently miss every call
  // site — `getDemoUserId` in lib/auth.js reads the same string, so
  // divergence breaks auth end-to-end.
  assert.equal(DEMO_COOKIE_NAME, 'demoUserId')
})

test('DEMO_COOKIE_MAX_AGE_SECONDS is exactly 30 days', () => {
  // 30d is the agreed value across sign-in, onboarding, and the
  // DemoAuthProvider bootstrap. Drift here would create a split-brain
  // where the helper writes 30d but one of the call sites still
  // hard-codes 24h (the old default).
  assert.equal(DEMO_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 30)
})

// ----- buildDemoSessionCookieHeader -----

test('buildDemoSessionCookieHeader includes name, value, path, max-age, SameSite=Lax — manual demo-button flow', () => {
  // No document/location stubs needed for the basic shape — the
  // function reads `typeof location` defensively. Without a location
  // global the Secure suffix is simply omitted.
  const originalLocation = globalThis.location
  delete globalThis.location
  try {
    const header = buildDemoSessionCookieHeader('demo-user-001')
    assert.match(header, /^demoUserId=demo-user-001;/)
    assert.match(header, /path=\//)
    assert.match(header, /max-age=2592000/)
    assert.match(header, /SameSite=Lax/)
  } finally {
    if (originalLocation !== undefined) globalThis.location = originalLocation
  }
})

test('buildDemoSessionCookieHeader omits Secure on http: — manual demo-button flow', () => {
  const originalLocation = globalThis.location
  globalThis.location = { protocol: 'http:' }
  try {
    const header = buildDemoSessionCookieHeader('demo-user-001')
    assert.doesNotMatch(header, /Secure/, 'Secure must NOT appear on http origins')
  } finally {
    if (originalLocation !== undefined) globalThis.location = originalLocation
    else delete globalThis.location
  }
})

test('buildDemoSessionCookieHeader adds Secure on https: — manual demo-button flow', () => {
  const originalLocation = globalThis.location
  globalThis.location = { protocol: 'https:' }
  try {
    const header = buildDemoSessionCookieHeader('demo-user-001')
    assert.match(header, /; Secure/, 'Secure MUST appear on https origins')
  } finally {
    if (originalLocation !== undefined) globalThis.location = originalLocation
    else delete globalThis.location
  }
})

test('buildDemoSessionCookieHeader URL-encodes the userId — manual demo-button flow', () => {
  // encodeURIComponent escapes spaces, semicolons, commas, etc. The
  // Set-Cookie header would break if any of those leaked through
  // raw — `;` terminates the cookie, `,` confuses Date attributes,
  // and whitespace isn't allowed in cookie values per RFC 6265.
  const originalLocation = globalThis.location
  delete globalThis.location
  try {
    const header = buildDemoSessionCookieHeader('user with spaces; and,chars')
    assert.match(
      header,
      /demoUserId=user%20with%20spaces%3B%20and%2Cchars/,
      'userId must be URL-encoded so the Set-Cookie header is well-formed',
    )
  } finally {
    if (originalLocation !== undefined) globalThis.location = originalLocation
  }
})

test('buildDemoSessionCookieHeader is order-stable (suffix ordering does not break assertions) — manual demo-button flow', () => {
  // The header is interpolated in a fixed order. Locking the shape
  // here means a future refactor that re-orders the suffix (or
  // accidentally double-emits Secure) will trip a test rather than
  // silently changing the cookie's effective attributes.
  const originalLocation = globalThis.location
  globalThis.location = { protocol: 'https:' }
  try {
    const header = buildDemoSessionCookieHeader('demo-user-001')
    // Expected order: name=value; path=/; max-age=N; SameSite=Lax; Secure
    const secureIdx = header.indexOf('Secure')
    const sameSiteIdx = header.indexOf('SameSite=Lax')
    const maxAgeIdx = header.indexOf('max-age=')
    const pathIdx = header.indexOf('path=/')
    assert.ok(pathIdx >= 0)
    assert.ok(maxAgeIdx > pathIdx)
    assert.ok(sameSiteIdx > maxAgeIdx)
    assert.ok(secureIdx > sameSiteIdx)
  } finally {
    if (originalLocation !== undefined) globalThis.location = originalLocation
    else delete globalThis.location
  }
})

// ----- isClerkConfigured -----

test('isClerkConfigured returns false for empty key', () => {
  const original = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = ''
  try {
    assert.equal(isClerkConfigured(), false)
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = original
  }
})

test('isClerkConfigured returns false for too-short key', () => {
  const original = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'short'
  try {
    assert.equal(isClerkConfigured(), false)
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = original
  }
})

test('isClerkConfigured returns false for "xxx" template placeholder', () => {
  const original = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  // Long enough to clear the 20-char gate, but contains the
  // `xxx` sentinel that flags it as a template placeholder.
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxxx_yyyyyyyyyyyyyyy'
  try {
    assert.equal(isClerkConfigured(), false)
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = original
  }
})

test('isClerkConfigured returns true for a real-shape key (no xxx, >= 20 chars)', () => {
  const original = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  // 40-char fake key that clears all three gates.
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_' + 'a'.repeat(33)
  try {
    assert.equal(isClerkConfigured(), true)
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = original
  }
})

// ----- hasDemoSessionCookie (with globalThis.document stub) -----

test('hasDemoSessionCookie returns false when document is undefined (SSR) — manual demo-button flow', () => {
  const original = globalThis.document
  delete globalThis.document
  try {
    assert.equal(hasDemoSessionCookie(), false)
  } finally {
    if (original !== undefined) globalThis.document = original
  }
})

test('hasDemoSessionCookie returns true when demoUserId is in the cookie string — manual demo-button flow', () => {
  const original = globalThis.document
  globalThis.document = {
    get cookie() { return 'foo=bar; demoUserId=demo-user-001; baz=qux' },
  }
  try {
    assert.equal(hasDemoSessionCookie(), true)
  } finally {
    if (original !== undefined) globalThis.document = original
    else delete globalThis.document
  }
})

test('hasDemoSessionCookie returns false when demoUserId is absent — manual demo-button flow', () => {
  const original = globalThis.document
  globalThis.document = {
    get cookie() { return 'foo=bar; session=other; baz=qux' },
  }
  try {
    assert.equal(hasDemoSessionCookie(), false)
  } finally {
    if (original !== undefined) globalThis.document = original
    else delete globalThis.document
  }
})

// ----- setDemoSessionCookie (DOM-touching; stubbed) -----

test('setDemoSessionCookie is a no-op when document is undefined — manual demo-button flow', () => {
  const original = globalThis.document
  delete globalThis.document
  try {
    // Must not throw. Side effect is impossible to observe without
    // a DOM, so the assertion is "this completes cleanly".
    setDemoSessionCookie('demo-user-001')
  } finally {
    if (original !== undefined) globalThis.document = original
  }
})

test('setDemoSessionCookie writes the expected header to document.cookie — manual demo-button flow', () => {
  const original = globalThis.document
  let written = ''
  globalThis.document = {
    get cookie() { return written },
    set cookie(v) { written = v },
  }
  try {
    setDemoSessionCookie('demo-user-001')
    assert.match(written, /^demoUserId=demo-user-001;/)
    assert.match(written, /path=\//)
    assert.match(written, /max-age=2592000/)
    assert.match(written, /SameSite=Lax/)
  } finally {
    if (original !== undefined) globalThis.document = original
    else delete globalThis.document
  }
})
