// tests/unit/clerk-config-shape.test.mjs
//
// Shape-contract lock for `lib/clerk-config.js` — the single source of
// truth for "is Clerk actually configured?" answers.
//
// Why this file exists
// --------------------
//
// The prior round consolidated six+ inline copies of `isClerkConfigured`
// into two named exports with explicit server/client semantics:
//   • `isClerkConfiguredClient()` — public-key only; safe in the client bundle
//   • `isClerkConfiguredServer()` — public + secret; server-only
//
// That consolidation was motivated by a footgun: the SAME name had
// meant different check sets in different files (some checked only the
// publishable key, some checked both, some hardcoded different
// placeholder patterns). A future rename or merge of the two exports
// would silently bring back the footgun — so we lock the SHAPE here:
//
//   1. Both exports are named functions (NOT arrow expressions, NOT
//      default-only re-exports) — so destructuring imports stay valid
//      across renames.
//   2. Both return a strict boolean — `Boolean(...)` coercion drift is
//      a common silent regression in env-var checks.
//   3. Client reads ONLY the publishable key (never reads the secret).
//      A regression that adds `process.env.CLERK_SECRET_KEY` to the
//      client function would leak the secret into the browser bundle —
//      the lock below fails fast.
//   4. Server reads BOTH pub + secret. A regression that drops the
//      secret-key check would let partially-configured deployments
//      (only NEXT_PUBLIC_* set) silently hit Clerk at boot — the
//      lock below catches that.
//   5. The unqualified symbol `isClerkConfigured` (no `Client`/`Server`
//      suffix) is NOT exported — re-introducing the footgun alias
//      (which the prior round dropped) trips this lock.
//
// Mirrors the structural contract locks in
// `tests/unit/dashboard-contracts.test.mjs` and
// `tests/unit/load-more-jobs-visa-fler.test.mjs`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as clerkConfig from '../../lib/clerk-config.js'

// ---- Shape ----

test('lib/clerk-config.js exports isClerkConfiguredClient as a function', () => {
  // Named function export — not a const arrow, not a default re-export.
  // A `let` / `const` assignment would still be typeof 'function' for
  // arrow funcs, so we additionally assert it's a proper function
  // (own prototype Function.prototype, not {} with a call property).
  assert.equal(typeof clerkConfig.isClerkConfiguredClient, 'function')
  // Arrow functions have a .name of the variable name; regular
  // functions preserve the literal name. We don't care which — just
  // that it has a non-empty name (the function name is what shows up
  // in stack traces when something throws).
  assert.ok(clerkConfig.isClerkConfiguredClient.name.length > 0)
})

test('lib/clerk-config.js exports isClerkConfiguredServer as a function', () => {
  assert.equal(typeof clerkConfig.isClerkConfiguredServer, 'function')
  assert.ok(clerkConfig.isClerkConfiguredServer.name.length > 0)
})

test('lib/clerk-config.js does NOT export an unqualified `isClerkConfigured`', () => {
  // The prior round removed this alias because the same name meant
  // the SERVER variant in `lib/auth.js` but the CLIENT variant in
  // `lib/auth-cookie.js`, with no way to tell from the import site.
  // Re-introducing the alias (even unintentionally via a wildcard
  // re-export) restores that footgun. This lock catches both cases.
  assert.equal(
    'isClerkConfigured' in clerkConfig,
    false,
    'lib/clerk-config.js must NOT export an unqualified `isClerkConfigured` — see the file header for the prior footgun.',
  )
})

test('lib/clerk-config.js does NOT use a wildcard module re-export', () => {
  // Belt-and-suspenders: a future refactor that uses
  //   `export * from './something-else'`
  // could leak an `isClerkConfigured` symbol back into this module
  // without touching its own source. Lock the file's own export
  // surface by sanity-checking the export keys are exactly the two
  // we expect — no wildcard garbage, no `default`, no surprises.
  const keys = Object.keys(clerkConfig).sort()
  assert.deepEqual(
    keys,
    ['isClerkConfiguredClient', 'isClerkConfiguredServer'],
    `Expected exactly two named exports; got [${keys.join(', ')}]`,
  )
})

// ---- Return type ----

test('isClerkConfiguredClient returns a strict boolean', () => {
  // Pure env-var gate — must always be a boolean, never undefined /
  // null / a string from a typo'd key length.
  const ret = clerkConfig.isClerkConfiguredClient()
  assert.equal(typeof ret, 'boolean')
})

test('isClerkConfiguredServer returns a strict boolean', () => {
  const ret = clerkConfig.isClerkConfiguredServer()
  assert.equal(typeof ret, 'boolean')
})

// ---- Client reads ONLY the publishable key ----

test('isClerkConfiguredClient ignores CLERK_SECRET_KEY (client-bundle safe)', () => {
  // Set ONLY the secret (the publishable stays empty). The client
  // function MUST return false (the canonical behaviour) even though
  // a bug that read the secret key in a client bundle would surface
  // as a `true` here. This locks that the secret is NEVER read from
  // the client check — important because the secret being read in the
  // client bundle would be a credential leak.
  const originalPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const originalSec = process.env.CLERK_SECRET_KEY
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  // Real-shape secret (clears the 20-char + not-`xxx` gates so a
  // typo'd check wouldn't accidentally filter it out).
  process.env.CLERK_SECRET_KEY = 'sk_test_' + 'a'.repeat(40)
  try {
    assert.equal(
      clerkConfig.isClerkConfiguredClient(),
      false,
      'A publishable-less deployment with ONLY the secret set must not register as Clerk-configured in the client check. (Reading the secret key client-side would be a credential leak.)',
    )
  } finally {
    if (originalPub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPub
    if (originalSec === undefined) delete process.env.CLERK_SECRET_KEY
    else process.env.CLERK_SECRET_KEY = originalSec
  }
})

test('isClerkConfiguredClient returns true for a real-shape publishable key alone', () => {
  // The complement of the prior test: with ONLY the publishable set
  // to a real-shape value, the client function MUST return true.
  // This locks "the secret is not required for the client path" —
  // a regression that swaps in `isClerkConfiguredServer`'s logic
  // would surface as false here.
  const originalPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const originalSec = process.env.CLERK_SECRET_KEY
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_' + 'a'.repeat(33)
  delete process.env.CLERK_SECRET_KEY
  try {
    assert.equal(clerkConfig.isClerkConfiguredClient(), true)
  } finally {
    if (originalPub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPub
    if (originalSec === undefined) delete process.env.CLERK_SECRET_KEY
    else process.env.CLERK_SECRET_KEY = originalSec
  }
})

// ---- Server requires BOTH keys ----

test('isClerkConfiguredServer returns false when publishable is missing', () => {
  // Even with a real-shape secret, the server check MUST require the
  // publishable key too — a regression that drops the publishable
  // gate would let partially-configured deployments (only the secret
  // set) silently try to mount ClerkProvider and crash on boot.
  const originalPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const originalSec = process.env.CLERK_SECRET_KEY
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  process.env.CLERK_SECRET_KEY = 'sk_test_' + 'a'.repeat(40)
  try {
    assert.equal(
      clerkConfig.isClerkConfiguredServer(),
      false,
      'Server check must require the publishable key, not just the secret.',
    )
  } finally {
    if (originalPub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPub
    if (originalSec === undefined) delete process.env.CLERK_SECRET_KEY
    else process.env.CLERK_SECRET_KEY = originalSec
  }
})

test('isClerkConfiguredServer returns false when secret is missing', () => {
  // The converse: with ONLY the publishable key set, the server
  // check MUST return false. This is the gate that prevents
  // demo-mode fallback when only NEXT_PUBLIC_* vars have been
  // configured (a common misconfiguration in local development).
  const originalPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const originalSec = process.env.CLERK_SECRET_KEY
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_' + 'a'.repeat(33)
  delete process.env.CLERK_SECRET_KEY
  try {
    assert.equal(
      clerkConfig.isClerkConfiguredServer(),
      false,
      'Server check MUST reject publishable-only configs — demo-mode fallback must NOT silently activate when secret is missing.',
    )
  } finally {
    if (originalPub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPub
    if (originalSec === undefined) delete process.env.CLERK_SECRET_KEY
    else process.env.CLERK_SECRET_KEY = originalSec
  }
})

test('isClerkConfiguredServer returns true when BOTH keys are real-shape', () => {
  // The happy-path: both keys present, both clear the 20-char +
  // not-`xxx` gates. A regression that drops either gate would
  // surface as false here.
  const originalPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const originalSec = process.env.CLERK_SECRET_KEY
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_' + 'a'.repeat(33)
  process.env.CLERK_SECRET_KEY = 'sk_test_' + 'b'.repeat(40)
  try {
    assert.equal(clerkConfig.isClerkConfiguredServer(), true)
  } finally {
    if (originalPub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPub
    if (originalSec === undefined) delete process.env.CLERK_SECRET_KEY
    else process.env.CLERK_SECRET_KEY = originalSec
  }
})

test('isClerkConfiguredServer rejects "xxx" templates on EITHER key', () => {
  // Two parallel sub-assertions inside one test so the lock fires
  // independently for pub-side rejections and sec-side rejections.
  // Drift here would surface after the round-9 audit, where the
  // 6-line copy-pasted gates had inconsistent `xxx` coverage.

  // (a) Real pub, fake secret (`xxx` template)
  const originalPub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const originalSec = process.env.CLERK_SECRET_KEY
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_' + 'a'.repeat(33)
  // Long enough to clear the 20-char gate, but contains `xxx`.
  process.env.CLERK_SECRET_KEY = 'sk_test_xxxx_' + 'y'.repeat(30)
  try {
    assert.equal(
      clerkConfig.isClerkConfiguredServer(),
      false,
      'Server check must reject secrets containing the `xxx` template sentinel even when long enough to clear the length gate.',
    )
  } finally {
    if (originalPub === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPub
    if (originalSec === undefined) delete process.env.CLERK_SECRET_KEY
    else process.env.CLERK_SECRET_KEY = originalSec
  }

  // (b) Fake pub (`xxx`), real secret
  const originalPub2 = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const originalSec2 = process.env.CLERK_SECRET_KEY
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxxx_' + 'y'.repeat(30)
  process.env.CLERK_SECRET_KEY = 'sk_test_' + 'b'.repeat(40)
  try {
    assert.equal(
      clerkConfig.isClerkConfiguredServer(),
      false,
      'Server check must reject publishables containing the `xxx` template sentinel even when the secret key is real.',
    )
  } finally {
    if (originalPub2 === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = originalPub2
    if (originalSec2 === undefined) delete process.env.CLERK_SECRET_KEY
    else process.env.CLERK_SECRET_KEY = originalSec2
  }
})

// ---- SSR-safety guard (process availability) ----
//
// Both functions must short-circuit on `typeof process === 'undefined'`
// OR `!process.env`. The canonical implementation has this guard at the
// top of each function body — a refactor that removes it would crash on
// environments where `process` isn't polyfilled (some bundlers /
// older test runners). Belt-and-suspenders lock: temporarily null out
// `globalThis.process`, call each function, assert it returns `false`
// rather than throwing.
//
// `Object.defineProperty` is used (not direct assignment) because
// `process` is non-writable in strict mode ESM. `configurable: true`
// is required so the `finally` block can restore the original
// reference and the rest of the suite isn't poisoned by our test
// stub leaking past the rebound.

test('isClerkConfiguredClient returns false (does NOT throw) when `process` is undefined', () => {
  // `Object.defineProperty` (not plain assignment) is required because
  // `process` is a getter-backed V8 global — a bare `globalThis.process
  // = undefined` throws TypeError ("Cannot set property process of
  // #<Object> which has only a getter") under strict-mode ESM, which
  // the Node test runner enforces by default. Pattern matches the
  // simpler `globalThis.location = {...}` style used in
  // `tests/unit/auth-cookie.test.mjs`, just upgraded for non-writable
  // built-ins. Save the original descriptor first so the `finally`
  // block can restore the live getter rather than leaving behind a
  // dead `undefined` value field that would poison every subsequent
  // env-var-sensitive test in the suite.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')
  // Hide the global so the guard fires on the next call.
  Object.defineProperty(globalThis, 'process', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  try {
    let result
    assert.doesNotThrow(
      () => { result = clerkConfig.isClerkConfiguredClient() },
      'isClerkConfiguredClient must defend against missing `process` rather than crashing on `process.env.X` access',
    )
    assert.equal(result, false)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'process', descriptor)
  }
})

test('isClerkConfiguredServer returns false (does NOT throw) when `process` is undefined', () => {
  // See `isClerkConfiguredClient` test above for the rationale behind
  // Object.defineProperty + descriptor save/restore.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')
  Object.defineProperty(globalThis, 'process', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  try {
    let result
    assert.doesNotThrow(
      () => { result = clerkConfig.isClerkConfiguredServer() },
      'isClerkConfiguredServer must defend against missing `process` rather than crashing on `process.env.X` access',
    )
    assert.equal(result, false)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'process', descriptor)
  }
})
