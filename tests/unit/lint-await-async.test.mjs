// tests/unit/lint-await-async.test.mjs
//
// Round-77 (2026-07-20) — Test surface for scripts/lint-await-async.mjs.
//
// Mirrors the 5-test pattern of tests/unit/lint-scope.test.mjs:
//
//   1. Script exists + exits 0 on clean extension/*.js (no offenders).
//   2. Negative fixture: inject a fake await-in-non-async-fn into
//      extension/ at runtime, run the lint, expect exit 1 + the
//      offending function name in the output. Cleanup guard in a
//      finally{} block + serializing lock ensure the fixture
//      never leaks across runs AND Round-74's parallel await-scan
//      test (which also scans extension/) cannot race against
//      the injected fixture.
//   3. The wrapper correctly REFERENCES
//      tests/fixtures/round74-await-scan.js via path.resolve AND
//      parses the `TOTAL REAL OFFENDING SITES:` summary line.
//   4. Round-74 user-reported fix preservation: popup.js setStatus
//      + wire still declare `async` (the bug class this lint
//      catches). Belt-and-braces regression lock — without it a
//      future maintainer could trivially revert the lint's purpose.
//   5. package.json wiring lock: scripts['lint:await-async'] points
//      at the wrapper AND scripts['package:extension'] calls it
//      before the python packaging step.
//
// Round-76 reviewer flagged this test was missing — without it,
// any regression in the wrapper itself (broken path-resolve, exit-
// code drift, summary-parsing bug) would only surface on the next
// real syntax-error run instead of at make-time. Round-77.1 (2026-07-20)
// fixes the inverted-cleanup-assertion bug Round-76 reviewer
// flagged in Test 2's finally{} block AND adds an exclusive
// cross-test file lock so the Round-74 await-scan test cannot
// race against the injected fixture when both run in parallel.
//

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import {
  SCAN_LOCK_PATH,
  acquireScanLock,
  releaseScanLock,
} from './lib/scan-lock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/lint-await-async.mjs')
const SCANNER_PATH = path.resolve(__dirname, '../fixtures/round74-await-scan.js')
const EXTENSION_DIR = path.resolve(__dirname, '../../extension')
// SCAN_LOCK_PATH is exported from tests/unit/lib/scan-lock.mjs so
// tests/unit/round74-await-scan.test.mjs can acquire the SAME
// lock for read-side serialisation (Round-77.2 — without this,
// Round-74's read-scan races against Test 2's write+scan).

/**
 * Helper — spawn the lint wrapper, capture exit code + stdout +
 * stderr. Uses spawnSync so the test is before-the-next-test
 * deterministic (no parallel-state race with the actual fixture-
 * run that follows).
 */
function runLint() {
  const result = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    // 30s ceiling — the scanner walk is ~1-2s on warm cache; 30s
    // is generous without slowing down a hung crash detection.
    timeout: 30_000,
  })
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

// No local aliases — Test 2 calls acquireScanLockWithBackoff +
// releaseScanLock directly from the imports. Round-77.3
// simplification drops the Round-77.1 thin wrappers.

// =============================================================================
// Test 1 — Wrapper exits 0 on clean extension/* (no offenders in production
// =============================================================================

test('Round-77: scripts/lint-await-async.mjs exits 0 + reports clean when extension/*.js has no await-outside-async sites', () => {
  if (!existsSync(SCANNER_PATH)) {
    // Skip if Round-74.1 scanner fixture is missing — the wrapper
    // requires it. The Round-74 suite should always have this
    // fixture (tests/unit/round74-await-scan.test.mjs depends on
    // it), so a missing fixture here would mean a deeper test
    // suite problem.
    assert.ok(existsSync(SCANNER_PATH), `Required scanner fixture missing at ${SCANNER_PATH}`)
    return
  }
  const out = runLint()
  assert.equal(
    out.status,
    0,
    `Expected exit 0 (clean) but got ${out.status}.\n` +
      `If this fires, the wrapper's exit-code contract broke OR the scanner found an offender.\n` +
      `STDOUT:\n${out.stdout}\nSTDERR:\n${out.stderr}`,
  )
  assert.match(
    out.stderr,
    /OK\s+—\s+no await-outside-async violations detected/,
    'lint output must report a clean pass with the canonical OK message',
  )
})

// =============================================================================
// Test 2 — Negative test: injected fixture → exit 1 + offender name
// =============================================================================
//
// Touches extension/ at runtime so the Round-74 scanner walk picks
// up the injected function.
//
// Two safety mechanisms guarantee correctness:
//   (a) cleanup in finally{} — unlinks the fixture even on
//       assertion failure, then asserts !existsSync on the path.
//       The asserted !existsSync is UNCONDITIONAL (Round-77.1 fix
//       — the prior `|| ok === false` was inverted logic that
//       silently accepted a leaked fixture on failure paths).
//   (b) cross-test file exclusive lock — serialises this test
//       against tests/unit/round74-await-scan.test.mjs so the
//       parallel-scan race can't make the Round-74 test see the
//       injected fixture while we're still scanning it ourselves.
//       If the lock is contended, the test asserts loudly so the
//       operator knows to re-run with --concurrency=1 rather
//       than silently skipping.

test('Round-77: scripts/lint-await-async.mjs detects injected await-in-non-async-fn with exit 1 + offending function name', () => {
  if (!existsSync(SCANNER_PATH)) {
    assert.ok(existsSync(SCANNER_PATH), `Required scanner fixture missing at ${SCANNER_PATH}`)
    return
  }

  // Round-77.8 — sync acquire. Under `--test-concurrency=1`
  // (enforced by scripts/run-unit-tests.mjs) no concurrent
  // acquirer exists; openSync('wx') either succeeds or throws
  // EEXIST (impossible unless a future maintainer bumps
  // concurrency back up — if that happens the loud EEXIST
  // surfaces the regression rather than masking it with a
  // silent skip or 10 s retry exhaustion).
  const lockFd = acquireScanLock()

  const fixtureName = '__lint_await_async_negative_test__.js'
  const fixturePath = path.join(EXTENSION_DIR, fixtureName)
  const fixtureContent = `
// Round-77 negative-test fixture — DO NOT REMOVE THIS COMMENT.
// The lint must flag this file's await as a REAL BUG because
// the enclosing function lintAwaitAsyncNegativeTest is NOT async.
function lintAwaitAsyncNegativeTest() {
  const x = await chrome.storage.local.get('profile');
  return x;
}
`

  try {
    writeFileSync(fixturePath, fixtureContent, 'utf-8')
    // Sanity-read back — confirms the fixture on disk is what we
    // wrote (a flaky writeFileSync without a flush is impossible
    // because Node sync APIs are synchronous through fsync).
    const written = readFileSync(fixturePath, 'utf-8')
    assert.ok(
      /lintAwaitAsyncNegativeTest/.test(written),
      'fixture must be written to disk before lint runs',
    )

    const out = runLint()
    // Hard-fail fast if the wrapper exited 0 (i.e. the scanner
    // missed the injected offender). Surface full stdout/stderr.
    if (out.status !== 1) {
      assert.fail(
        `Expected exit 1 (REAL offender detected) but got ${out.status}.\n` +
          `If exit 0 was returned, EITHER:\n` +
          `  (a) The scanner's brace-counting regressed — fix the scanner.\n` +
          `  (b) The wrapper's TOTAL summary regex broke — fix the wrapper.\n` +
          `STDOUT:\n${out.stdout}\nSTDERR:\n${out.stderr}`,
      )
    }
    // The injected function name must appear in stderr (the
    // scanner prints `REAL BUG (in non-async "lintAwaitAsyncNegativeTest" ...)`).
    assert.match(
      out.stderr,
      /lintAwaitAsyncNegativeTest/,
      'lint output must mention the injected function name (scanner format)',
    )
    assert.match(
      out.stderr,
      /REAL BUG/i,
      'lint output must include the scanner\'s REAL BUG marker',
    )
    assert.match(
      out.stderr,
      /FAILED:\s+1\s+await-outside-async violation/i,
      'lint output must report a single violation count for the injected file',
    )
  } finally {
    // Cleanup is MANDATORY even on assertion failure. After
    // unlink, an UNCONDITIONAL existsSync assertion fails the
    // test loudly on a real cleanup regression (Round-77.1
    // fix — prior `|| ok === false` was inverted).
    if (existsSync(fixturePath)) {
      try { unlinkSync(fixturePath) } catch (_) { /* best-effort */ }
    }
    releaseScanLock(lockFd)
    assert.ok(
      !existsSync(fixturePath),
      `Fixture ${fixturePath} must be cleaned up after the test (Round-77.1 unconditional check; was previously inverted \`|| ok === false\` which silently accepted leaks on failure)`,
    )
    assert.ok(
      !existsSync(SCAN_LOCK_PATH),
      `Scan lock file ${SCAN_LOCK_PATH} must be removed after the test (Round-77.2: imported from tests/unit/lib/scan-lock.mjs so Round-74-await-scan can share)`,
    )
  }
})

// =============================================================================
// Test 3 — Contract lock: wrapper references scanner via path.resolve + parses summary
// =============================================================================

test('Round-77: scripts/lint-await-async.mjs REFERENCES the scanner fixture via path.resolve + parses the TOTAL summary line', () => {
  assert.ok(
    existsSync(SCRIPT_PATH),
    `Wrapper script must exist at ${SCRIPT_PATH}`,
  )
  const src = readFileSync(SCRIPT_PATH, 'utf-8')
  // (a) Locate scanner via path.resolve(...fixtures/round74-await-scan.js)
  assert.match(
    src,
    /path\.resolve\([^)]*['"`]tests\/fixtures\/round74-await-scan\.js['"`]/,
    'lint-await-async.mjs must locate the scanner fixture via path.resolve(...tests/fixtures/round74-await-scan.js)',
  )
  // (b) Parse the TOTAL summary line — the contract the scanner locks in
  assert.match(
    src,
    /TOTAL REAL OFFENDING SITES/,
    'lint-await-async.mjs must parse the TOTAL REAL OFFENDING SITES summary line',
  )
  // (c) Distinct exit codes: 0 / 1 / 2 documented separately so a
  // future regression reuniting them would fail this assertion.
  assert.match(src, /exit\(0\)/, 'wrapper must exit(0) on clean')
  assert.match(src, /exit\(1\)/, 'wrapper must exit(1) on offenders')
  assert.match(src, /exit\(2\)/, 'wrapper must exit(2) on scanner-tool failure')
})

// =============================================================================
// Test 4 — Round-74 user-reported fix preservation (lock the bug class)
// =============================================================================
//
// The lint catches `await` outside `async`. The most likely
// regression class is reverting the actual fixes that the lint is
// designed to catch — i.e. dropping `async` from setStatus() or
// wire(). This test asserts both are still declared `async`,
// independent of the lint's invocation, so it locks the bug-class
// itself even if the wrapper or scanner break.

test('Round-77: popup.js setStatus + wire remain declared `async` (Round-74 user-reported fix preserved)', async () => { // kept async: reads file via fs/promises
  const fs = await import('node:fs/promises')
  const popup = await fs.readFile(path.resolve(__dirname, '../../extension/popup.js'), 'utf8')
  assert.match(
    popup,
    /async\s+function\s+setStatus\s*\(/,
    'popup.js must declare `async function setStatus(...)` so Round-74 regression class stays fixed',
  )
  assert.match(
    popup,
    /async\s+function\s+wire\s*\(/,
    'popup.js must declare `async function wire(...)` so Round-74 second-instance regression stays fixed',
  )
})

// =============================================================================
// Test 5 — package.json wiring lock (lint reaches the build pre-step)
// =============================================================================
//
// The lint is worthless if it doesn't actually gate the build.
// This test pins the package.json wiring so a future command
// renamer (e.g. "lint:await-async" → "lint:extension-await")
// won't silently lose the package:extension hook.

test('Round-77: package.json wires `lint:await-async` into `package:extension` chain pre-step', () => {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'))
  assert.equal(
    pkg.scripts['lint:await-async'],
    'node scripts/lint-await-async.mjs',
    'scripts[\'lint:await-async\'] must point at scripts/lint-await-async.mjs verbatim',
  )
  assert.ok(
    typeof pkg.scripts['package:extension'] === 'string' &&
      pkg.scripts['package:extension'].includes('yarn lint:await-async'),
    'scripts[\'package:extension\'] must chain yarn lint:await-async BEFORE the python packaging step',
  )
  // The validator + lint chain must precede the python packaging
  // step. Order matters: validator (manifest audit) → lint (syntax
  // contract) → python (zip).
  const order = pkg.scripts['package:extension']
  const validatorIdx = order.indexOf('yarn validate:extension')
  const lintIdx = order.indexOf('yarn lint:await-async')
  const pythonIdx = order.indexOf('scripts/python.mjs')
  assert.ok(
    validatorIdx !== -1 && lintIdx !== -1 && pythonIdx !== -1,
    'package:extension must contain all 3 chain steps',
  )
  assert.ok(
    validatorIdx < lintIdx && lintIdx < pythonIdx,
    'package:extension chain order must be: validate:extension → lint:await-async → python packaging',
  )
})
