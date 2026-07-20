#!/usr/bin/env node
/**
 * scripts/run-unit-tests.mjs — cross-platform runner for the tests/unit tree.
 *
 * Replaces the previous POSIX-only
 *   `find tests/unit -name '*.test.mjs' | xargs node --test`
 * syntax so the same command works on Windows cmd (which has no
 * `find`/`xargs`). Walks `tests/unit/` recursively and forwards every
 * `*.test.mjs` path to a single `node --test` invocation, matching the
 * shape of the old xargs pipeline.
 *
 * Exit code mirrors `node --test`: 0 if all tests pass, 1 if any
 * fail, 2 if the test directory or any walker hit fails.
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const UNIT = join(ROOT, 'tests', 'unit')

/** Recursively collect every `*.test.mjs` under `dir`. Returns paths
 *  sorted ascending so consecutive runs report identical sequencing. */
function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    // ENOENT on a SUBDIR is a benign race (the dir was just deleted
    // mid-scan); anything else is a real failure and we want it
    // surfaced so the runner doesn't silently ship a smaller-than-
    // expected test list. The root-level `!existsSync(UNIT)` check
    // above already hard-fails for missing-root cases.
    if (e.code !== 'ENOENT') console.error(`Cannot read ${dir}: ${e.message}`)
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      out.push(full)
    }
  }
  return out
}

if (!existsSync(UNIT)) {
  console.error(`Tests directory not found: ${UNIT}`)
  process.exit(2)
}

const files = walk(UNIT).map(f => relative(ROOT, f)).sort()

if (files.length === 0) {
  console.error(`No *.test.mjs files found under tests/unit/`)
  process.exit(2)
}

// Round-77.5 (2026-07-20) — Default concurrency=1 (serial).
// Required because tests/unit/lint-await-async.test.mjs (writer:
// injects a fixture into extension/ + scans) and
// tests/unit/round74-await-scan.test.mjs (reader: scans
// extension/ via the round74 fixture) both spawn subprocesses
// that walk extension/*.js for `await`-outside-`async`
// violations. When test files run in parallel (default
// node:test concurrency), they race to acquire an exclusive
// `openSync('wx')` on tests/fixtures/.round77-scan.lock — only
// one wins; the other exhausts its 10 s retry budget waiting
// for the winner to release. The Round-77.0–77.4 cross-file
// lock pattern (in tests/unit/lib/scan-lock.mjs) could not
// resolve this because spawnSync blocks Node's event loop
// synchronously, preventing the loser's setTimeout-based
// retry timer from firing within the 10 s budget.
//
// Override via env: `JOBBPILOTEN_TEST_CONCURRENCY=N yarn
// test:unit`. Default=1 (serial, race-free). The actual race
// boundary is N=2: with concurrency 2, node:test runs both
// tests/unit/lint-await-async.test.mjs AND
// tests/unit/round74-await-scan.test.mjs IN PARALLEL (they are
// the only TWO lock-contending files), so they race on
// tests/fixtures/.round77-scan.lock. The Round-77.6 reviewer
// flagged that `> 2` was the wrong threshold — too lax, would
// silently re-enable the race at N=2. We use `>= 2` so every
// bump above 1 emits the warning. Mirrors the existing
// SKIP_BUILD_SMOKE env-var pattern in scripts/lint-await-
// async.mjs. Wall-clock cost at default 1: ~1.5–2× slower than
// parallel execution (~12 s → ~20 s); for fast-feedback dev
// loops on a quiet box `JOBBPILOTEN_TEST_CONCURRENCY=2` will
// trigger the warning and likely race unless the 2 lock-
// contending tests are first split/eliminated.
const effectiveConcurrency = (() => {
  const raw = process.env.JOBBPILOTEN_TEST_CONCURRENCY
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 1) return 1
  return n
})()
if (effectiveConcurrency >= 2) {
  console.error(
    `WARNING: JOBBPILOTEN_TEST_CONCURRENCY=${effectiveConcurrency} will likely ` +
      're-introduce cross-file race between tests/unit/lint-await-async.test.mjs and ' +
      'tests/unit/round74-await-scan.test.mjs unless one of them is eliminated first. ' +
      'See scripts/run-unit-tests.mjs Round-77.5 comment for details.',
  )
}
console.error(`Running ${files.length} unit-test file(s) via node --test (concurrency=${effectiveConcurrency}) ...`)
const result = spawnSync(
  process.execPath,
  ['--test', `--test-concurrency=${effectiveConcurrency}`, ...files],
  { stdio: 'inherit', cwd: ROOT },
)
process.exit(result.status ?? 1)
