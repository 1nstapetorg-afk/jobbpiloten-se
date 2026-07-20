// tests/unit/auth-fixture.test.mjs
//
// Round-31 structural-lock test for tests/e2e/_fixtures/auth.js.
// Round-31 is the canonical fixture design; see HISTORICAL footer
// for the Round-30 superseded pattern.
//
// The Round-31 migration moved the clerkId derivation from
// module-load (process.env.TEST_PARALLEL_INDEX) to per-test
// (testInfo.workerIndex + hash(testInfo.title)) and enabled
// fullyParallel: true in playwright.config.js.
//
// This test locks the new SOURCE-GREP invariants so a future
// maintainer can't silently regress to the per-WORKER pattern,
// the env-var-reading pattern, the closure-capture addInitScript
// pattern, or any other sub-pattern that closes the per-test
// isolation guarantee.
//
// Pattern mirrors tests/unit/seedDemoUser-fixture.test.mjs: read
// the file as a string and grep. The fixture is e2e-only — unit
// testing via source-grep is the cheapest available regression
// net.
//
// HISTORICAL (Round-30, superseded): per-WORKER derivation via
// process.env.TEST_PARALLEL_INDEX. Round-30's code-reviewer
// flagged the parallel-within-worker cascade as a critical
// finding; Round-31 (above) is the canonical resolution. Kept
// here for archaeology only — the migration narrative is in
// last_response.txt (Round-30 + Round-31 blocks).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync('tests/e2e/_fixtures/auth.js', 'utf8')

// ---------- Round-31 PRIMARY: per-test derivation ----------

test('Round-31: clerkId is derived from testInfo.workerIndex (per-test, NOT module-load)', () => {
  // The fixture function is `(context, use, testInfo) => { ... }` —
  // testInfo is the third argument. The clerkId must derive from
  // `testInfo.workerIndex` so each worker process has its own
  // segment of the clerkId namespace.
  assert.match(
    SOURCE,
    /testInfo\.workerIndex/,
    'tests/e2e/_fixtures/auth.js must read testInfo.workerIndex — Round-31 per-test migration requires per-worker scoping on the worker process index',
  )
})

test('Round-31: clerkId is derived from testInfo.title hash (deterministic across worker pool sizes)', () => {
  // Round-31 chose title hash over parallelIndex because
  // parallelIndex is NOT stable across re-runs (Playwright's
  // partition algorithm shuffles which worker handles which test).
  // title hash IS stable across re-runs and worker pool sizes.
  assert.match(
    SOURCE,
    /testInfo\.title/,
    'tests/e2e/_fixtures/auth.js must read testInfo.title — title hash is the Round-31 stable per-test key (parallelIndex would shuffle across re-runs)',
  )
})

test('Round-31: clerkId format is demo-user-001-w${workerIdx}-h${titleHash}', () => {
  // Anchored regex locks the new format. Future maintainer changing
  // the format breaks the test with a regression-specific message.
  assert.match(
    SOURCE,
    /`demo-user-001-w\$\{workerIdx\}-h\$\{titleHash\}`/,
    'tests/e2e/_fixtures/auth.js must template the clerkId as `demo-user-001-w${workerIdx}-h${titleHash}` — the Round-31 per-test format',
  )
})

test('Round-31: hashTestTitle helper exists as a function declaration with FNV-1a-style hash + non-zero offset basis', () => {
  // The helper is a function declaration (NOT arrow) for source-
  // grep boundary consistency with isStrict() / buildDemoProfilePayload()
  // in seedDemoUser.js. Round-31.1 polish (code-reviewer minor #2):
  // upgraded from djb2 to FNV-1a with non-zero offset basis
  // `0x811c9dc5` so empty titles produce a distinct hash (eliminates
  // the collision footgun that djb2 had on empty input). The
  // non-zero seed assertion locks in this hardening — reverts to
  // djb2-style zero-init break the build.
  assert.match(
    SOURCE,
    /function\s+hashTestTitle\s*\([^)]*\)\s*\{[\s\S]*?0x811c9dc5/,
    'tests/e2e/_fixtures/auth.js must define `function hashTestTitle(...)` with FNV-1a offset basis 0x811c9dc5 — Round-31.1 polish upgraded from djb2 to FNV-1a to eliminate empty-title collision risk',
  )
  // Sanity: charCodeAt-driven multiplicative hash backing — both FNV-1a
  // and djb2 share this surface, so we also assert the operator to
  // catch a regression to a no-op hash (e.g. `return 0`).
  assert.match(
    SOURCE,
    /function\s+hashTestTitle\s*\([^)]*\)\s*\{[\s\S]*?charCodeAt/,
    'tests/e2e/_fixtures/auth.js hashTestTitle must read charCodeAt — both FNV-1a and djb2 use charCodeAt; restores the regression net against a no-op or stub hash',
  )
})

test('Round-31 inverse: TEST_PARALLEL_INDEX env-var reading is RETIRED (uses doesNotMatch)', () => {
  // Round-30 read process.env.TEST_PARALLEL_INDEX at module-load
  // time. Round-31 retired that pattern. If a future maintainer
  // re-introduces the env-var reading (e.g. via a fallback for
  // non-Playwright contexts), this test breaks loudly — re-
  // introducing module-load derivation is exactly the bug we
  // just fixed.
  assert.doesNotMatch(
    SOURCE,
    /process\.env\.TEST_PARALLEL_INDEX/,
    'tests/e2e/_fixtures/auth.js must NOT read process.env.TEST_PARALLEL_INDEX — Round-31 retired the module-load per-worker derivation in favour of per-test (testInfo.workerIndex + testInfo.title hash) derivation. Re-introducing env-var reading would re-open the per-worker cascade.',
  )
})

// ---------- Round-30 carried invariants (still required) ----------

test('Round-30 carried: addInitScript uses arg passing (NOT closure capture)', () => {
  // Round-30: Playwright stringifies the init function for the
  // browser realm; closure variables from the Node scope become
  // `undefined` after stringification. The arg parameter is the
  // supported cross-realm escape hatch.
  assert.match(
    SOURCE,
    /context\.addInitScript\(\s*\(\s*clerkId\s*\)\s*=>/,
    'tests/e2e/_fixtures/auth.js must use `addInitScript((clerkId) => {...}, demoClerkId)` arg passing — closure capture silently loses Node-scope variables after Playwright stringifies the function for the browser realm',
  )
})

test('Round-30 carried: cookie name is the literal `demoUserId`', () => {
  // The cookie name is the source of truth for lib/auth.js →
  // getDemoUserId(`/demoUserId=([^;]+)/`) regex parsing. A future
  // rename would break every API route's auth.
  assert.match(
    SOURCE,
    /name:\s*['"]demoUserId['"]/,
    'tests/e2e/_fixtures/auth.js must set cookie name to literal `demoUserId` — server-side regex in lib/auth.js → getDemoUserId hardcodes this name',
  )
})

// Note (Round-31.1 polish): the carried settings.spec.js TODO-
// resolution assertion was extracted to its own test file,
// `tests/unit/settings-spec-todo.test.mjs`, so the auth-fixture
// test's responsibility matches its filename (auth-fixture only).
// Cross-file source-grep creates implicit coupling — split into
// dedicated test files for each guarded file.
