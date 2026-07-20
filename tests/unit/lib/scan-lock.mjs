// tests/unit/lib/scan-lock.mjs
//
// Round-77.8 (2026-07-20) — simplified to a sync per-test
// acquire/release + module-import-time self-flush.
//
// Why this exists:
// tests/unit/lint-await-async.test.mjs Test 2 (WRITES a fixture
// into extension/ + SCANS via the scanner wrapper) and
// tests/unit/round74-await-scan.test.mjs Test 1 (read-only
// SCAN via the scanner fixture) must not interleave their
// scanner subprocesses against an unsanitised extension/
// directory. The lock guarantees a clean boundary between the
// writer's `finally{}` cleanup and the reader's scan start.
//
// Why ASYNC helpers are gone in Round-77.8:
// scripts/run-unit-tests.mjs forces `--test-concurrency=1`,
// so only ONE test file runs at a time — there is no
// concurrent acquirer to race against. The Round-77.3 async
// retry-with-backoff was needed only when spawnSync + openSync
// could simultaneously fire from two process trees; with
// serial execution that race cannot recur. Round-77.6
// confirmed the path (`../../fixtures/.round77-scan.lock`)
// is correct, so the old "10 s retry budget" failure mode is
// also gone.
//
// What survives:
//   - SCAN_LOCK_PATH — exported so the 2 tests share one
//     constant (critical: a drift here re-introduces Round-77.0
//     test isolation failures).
//   - Module-level self-flush — nukes any leftover lock file
//     at import time. A prior killed `yarn test:unit` could
//     leave the file on disk; under concurrency=1 the file
//     has no live holder, so a hard unlink is safe. Best-effort
//     swallows EBUSY on Windows + permission edge cases.
//   - acquireScanLock() — sync openSync('wx'). Always succeeds
//     under concurrency=1 unless another node:test subprocess
//     is already running (impossible at concurrency=1).
//   - releaseScanLock(fd) — sync close + unlink. Idempotent on
//     null/undefined fd.

import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Round-77.6 path fix preserved: TWO `..` segments. scan-lock.mjs
// lives at `tests/unit/lib/scan-lock.mjs`; one `..` would resolve
// to `tests/unit/fixtures/.round77-scan.lock` (parent dir absent —
// every openSync('wx') throws ENOENT, the lock never acquires,
// and BOTH contending tests fail).
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const SCAN_LOCK_PATH = path.resolve(__dirname, '../../fixtures/.round77-scan.lock')

// Module-level self-flush: cheap (single existsSync + optional
// unlinkSync), runs once at import time per test file. Under
// `--test-concurrency=1`, a leftover lock at startup means a prior
// run aborted without releasing — safe to nuke because no other
// test process can assert against it (only ONE test file runs at
// once). The try/catch swallows Windows EBUSY + permission edge
// cases so a denial-of-unlink doesn't bring the test suite down.
if (existsSync(SCAN_LOCK_PATH)) {
  try { unlinkSync(SCAN_LOCK_PATH) } catch (_) { /* best-effort */ }
}

/**
 * Acquire the cross-test-file scan lock.
 *
 * Sync — no async retry budget needed under `--test-concurrency=1`.
 * On EEXIST (impossible under serial execution unless a future
 * maintainer bumps concurrency back up), re-emits a descriptive
 * Error that points the operator at scripts/run-unit-tests.mjs
 * instead of an opaque Node.js EEXIST.
 */
export function acquireScanLock() {
  try {
    return openSync(SCAN_LOCK_PATH, 'wx')
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw new Error(
        'Cross-test-file scan lock contention at ' + SCAN_LOCK_PATH + '. ' +
          'This means JOBBPILOTEN_TEST_CONCURRENCY >= 2. ' +
          'See scripts/run-unit-tests.mjs Round-77.5 comment for the fix.',
        { cause: e },
      )
    }
    throw e
  }
}

/**
 * Release the lock. Idempotent on null/undefined fd. Best-effort:
 * swallows errors so a stale fd or already-unlinked lock doesn't
 * throw out of the release path during a finally{} cleanup.
 */
export function releaseScanLock(fd) {
  if (fd == null) return
  try { closeSync(fd) } catch (_) {}
  try { unlinkSync(SCAN_LOCK_PATH) } catch (_) {}
}
