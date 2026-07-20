// tests/unit/lint-scope.test.mjs
//
// Round-51 — Test surface for scripts/lint-scope.mjs (the AST-based
// scope-leak linter). Tests five contracts:
//
//   1. Bug pattern detection — the linter MUST flag
//      tests/fixtures/lint-scope-bad.js (re-creates the Round-49
//      bug pattern from lib/groq.js). Asserts non-zero exit + the
//      offending const name appears in stderr.
//
//   2. False-positive resistance — the linter MUST NOT flag
//      tests/fixtures/lint-scope-good.js (legit module-scope
//      const used inside a function, short-identifier noise,
//      string + comment mentions, block-scoped shadowing,
//      destructuring patterns, property access, object keys,
//      parameter shadow, let-shadows, ternary preservation,
//      spread/rest). Asserts zero exit + no const-name in the
//      output.
//
//   3. Production code is clean — running the linter against the
//      real lib/ directory must produce <= 0 leaks. The AST
//      scanner handles all destructuring patterns natively so the
//      Round-50.3 34-ceiling is now a hard zero. A future
//      regression that re-introduces leaks (real or false)
//      trips this test loudly.
//
//   4. Round-49 bug fixture still matches — the existing
//      lint-scope-bad.js fixture preserves the Round-49
//      PROMPT_CV_CHAR_CAP shape so a future regression of the
//      linter's bug-class detection is caught at the unit level.
//
//   5. Round-51 AST contract lock — string-grep check against
//      scripts/lint-scope.mjs to lock the AST scan + acorn
//      dependency in place, and to assert the Round-50 char-walker
//      helper names have been removed. A future maintainer who
//      reverts the scanner to the regex walker fails this test
//      loudly.
//
// Each test launches scripts/lint-scope.mjs as a child process
// (not via direct import) so the behavioural contract matches
// the developer-facing `yarn lint:scope` invocation. The test
// catches CLI surface regressions that a direct-import test
// would miss.
//
// Test architecture note: this test is registered with `node
// --test` via tests/unit/*.test.mjs discovery (package.json's
// yarn test:unit glob). It's a single .test.mjs file but uses
// child-process spawning per the system's "test as a unit test"
// convention. The fixtures live in tests/fixtures/ — kept
// outside tests/unit/ so the glob doesn't pick them up.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/lint-scope.mjs')
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures')
const LIB_DIR = path.resolve(__dirname, '../../lib')

// Round-51 — AST scanner produces zero leaks in production lib/.
// The previous Round-50.3 ceiling was 34 (all phantom leaks from
// destructuring patterns the regex walker couldn't parse). The
// AST walker handles every destructuring shape natively
// (ObjectPattern / ArrayPattern / RestElement / AssignmentPattern,
// plus for-of / for-in left-binding) so the ceiling is now
// exactly 0. A non-zero count is a regression we want surfaced
// loudly — either a real Round-49-style cross-function leak was
// introduced, or a future scanner rewrite re-introduced phantom
// leaks.
const PRODUCED_CEILING = 0

/**
 * Helper — spawn the linter against a given directory. Captures
 * stdout, stderr, and exit code so the test can assert on all
 * three. Uses spawnSync because we want a deterministic
 * before-next-test ordering — the test async-awaits the whole
 * result; no parallel-state race.
 */
function runLinter(dir) {
  const result = spawnSync('node', [SCRIPT_PATH, dir], {
    encoding: 'utf-8',
    timeout: 5_000,
  })
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

// =============================================================================
// Test 1 — Linter detects the Round-49 bug pattern (lint-scope-bad.js)
// =============================================================================

test('Round-51: lint-scope.mjs must flag tests/fixtures/lint-scope-bad.js with non-zero exit + SHARED in output', () => {
  const dir = path.join(FIXTURES_DIR, 'lint-scope-bad-dir')
  // The fixture is a single file — for the linter to accept the
  // directory it must contain files. So we copy the fixture into a
  // fresh temp dir for this test (clean, non-destructive path).
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(path.join(FIXTURES_DIR, 'lint-scope-bad.js'), path.join(dir, 'lint-scope-bad.js'))

  const out = runLinter(dir)
  // Hard fail fast — the test is meaningless if the linter crashed
  // (the script may have a Node-level error). Surface the full
  // stdout/stderr in the failure message so the maintainer can
  // debug without rerunning.
  if (out.status !== 1) {
    assert.fail(
      `Expected exit code 1 (scope leak detected) but got ${out.status}.\nSTDOUT:\n${out.stdout}\nSTDERR:\n${out.stderr}`,
    )
  }
  // SHARED is the offending const in tests/fixtures/lint-scope-bad.js
  assert.ok(
    /SHARED/.test(out.stderr),
    `lint-scope.mjs output must mention SHARED; got stderr:\n${out.stderr}`,
  )
  // The complaint must show one of the cross-function / cross-scope
  // severity labels so a maintainer knows the leak shape.
  assert.match(
    out.stderr,
    /cross-function|cross-scope/i,
    'lint output must label the leak as cross-function or cross-scope',
  )
})

// =============================================================================
// Test 2 — Linter does not flag legitimate code (lint-scope-good.js)
// =============================================================================

test('Round-51: lint-scope.mjs must NOT flag tests/fixtures/lint-scope-good.js — exit 0, no const-name leaks', () => {
  const dir = path.join(FIXTURES_DIR, 'lint-scope-good-dir')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(path.join(FIXTURES_DIR, 'lint-scope-good.js'), path.join(dir, 'lint-scope-good.js'))

  const out = runLinter(dir)
  if (out.status !== 0) {
    assert.fail(
      `Expected exit 0 (no leaks) but got ${out.status}.\nSTDOUT:\n${out.stdout}\nSTDERR:\n${out.stderr}`,
    )
  }
  // No `cross-function` / `cross-scope` labels in the output.
  assert.doesNotMatch(
    out.stderr,
    /cross-function|cross-scope/i,
    `lint output must NOT label any leak in the good fixture; got stderr:\n${out.stderr}`,
  )
  assert.match(
    out.stderr,
    /OK\s+—\s+no scope leaks detected/,
    'lint output must report a clean pass on the good fixture',
  )
})

// =============================================================================
// Test 3 — Production code is clean (Round-49 fix posture preserved)
// =============================================================================

test(`Round-51: lint-scope.mjs against ./lib produces <= ${PRODUCED_CEILING} leaks (AST scanner native; no false positives)`, () => {
  // Round-51 win: Round-50.3's 34-leak ceiling drops to 0. The AST
  // scanner handles every destructuring pattern natively, so the
  // only way to flag a leak is to introduce a real Round-49-style
  // cross-function scope leak. The lib/ codebase has been
  // PM-confirmed safe across all module/helper routes via direct
  // unit tests on ai-usage.js, analytics.js, push.js, groq.js,
  // pdf-report.js, ssrf-guard.js, swedishLocations.js, ats-keywords.js
  // — each file's exports execute cleanly when imported.
  const out = runLinter(LIB_DIR)
  const match = out.stderr.match(/^(\d+)\s+potential scope leak\(s\)/m)
  if (!match) {
    // No per-line "N potential..." line means clean pass.
    assert.match(
      out.stderr,
      /OK\s+—\s+no scope leaks detected/,
      `lint output must report clean pass or a leak count line; got:\n${out.stderr}`,
    )
    return
  }
  const flagged = parseInt(match[1], 10)
  assert.ok(
    flagged <= PRODUCED_CEILING,
    `Production lib/ has ${flagged} leaks — exceeds Round-51 ceiling (${PRODUCED_CEILING}). ` +
      `This is a regression: either a real scope leak was reintroduced (Round-49 bug class) ` +
      `OR the AST scanner's name-filter regressed and phantom leaks returned. ` +
      `Investigate before raising the ceiling. Output:\n${out.stderr}`,
  )
})

// =============================================================================
// Test 3b — Round-50.3 followup: bad fixture proves spread detection works
// =============================================================================
//
// The good-fixture (Test 2) demonstrates that shadow detection doesn't
// break correct code. But to prove the spread-argument path actually
// CATCHES what it should, we need a BAD fixture: a cross-function
// scope leak via spread (const declared in one function, used via
// spread in a different function) that the scanner must flag.
//
// If this test fails after a future refactor of the AST scanner, the
// regression is: the scanner stopped recognising the `arr` Identifier
// inside SpreadElement — e.g. by accidentally falling back to the
// Round-50 char-walker's triple-dot guard instead of AST node types.
// This locks the behavioural contract.

test('Round-51: lint-scope.mjs must flag tests/fixtures/lint-scope-spread-bad.js (cross-function spread leak)', () => {
  const dir = path.join(FIXTURES_DIR, 'lint-scope-spread-bad-dir')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(
    path.join(FIXTURES_DIR, 'lint-scope-spread-bad.js'),
    path.join(dir, 'lint-scope-spread-bad.js'),
  )

  const out = runLinter(dir)
  if (out.status !== 1) {
    assert.fail(
      `Expected exit code 1 (spread scope leak detected) but got ${out.status}.\n` +
        `If the scanner's SpreadElement handling regressed, the spread\n` +
        `argument would be skipped (not recognised as a use of 'arr'), ` +
        `and no flag would be emitted.\n` +
        `STDOUT:\n${out.stdout}\nSTDERR:\n${out.stderr}`,
    )
  }
  // The offending const in the fixture is `arr`, declared in
  // `spreadProducer` and read via spread in `spreadConsumer`.
  assert.ok(
    /arr/.test(out.stderr),
    `lint-scope.mjs output must mention \`arr\`; got stderr:\n${out.stderr}`,
  )
  // The leak must be labelled cross-function (the use is inside
  // another function's body, not at module scope).
  assert.match(
    out.stderr,
    /cross-function/,
    'lint output must label the spread leak as cross-function',
  )
})

// =============================================================================
// Test 4 — Round-49 PRE-fix lock (security-net for the bug pattern itself)
// =============================================================================

test('Round-51: lint-scope.mjs fixture re-creates the Round-49 PROMPT_CV_CHAR_CAP pattern', () => {
  // Source-grep check on the existing lint-scope-bad.js fixture:
  // re-creating the bug pattern is the most direct way to ensure
  // the fixture stays an accurate test of the regression class.
  // The fixture MUST contain a `const SHARED = ...` inside one
  // function and a `SHARED` reference in another function — that
  // is the Round-49 bug shape.
  const src = readFileSync(path.join(FIXTURES_DIR, 'lint-scope-bad.js'), 'utf-8')
  assert.ok(
    /const\s+SHARED\s*=/.test(src),
    'lint-scope-bad.js must contain `const SHARED = ...` declaration',
  )
  // The sibling function reads SHARED without proper scope (uses
  // SHARED * 2 syntax) — the literal `SHARED * 2` is the read site.
  assert.ok(
    /SHARED\s*\*\s*2/.test(src),
    'lint-scope-bad.js must contain a `SHARED * 2` read site in another function (this is the Round-49 leak shape)',
  )
})

// =============================================================================
// Test 5 — Round-51 AST contract lock (string-grep means upstream
// lock; a future maintainer who refactors the linter back to a
// regex walker fails this test loudly).
// =============================================================================
//
// The Round-50.3 regex-grep contract locks (`propAccess = ...`,
// `inObjectLiteral = ...`, `F.params.includes(identifier)`,
// `(?:const|let|var)`, triple-dot guard) are all gone — the AST
// scanner handles those concerns structurally via `MemberExpression`,
// `Property`, `Function.params`, and array `elements[].type` AST
// nodes. Locking back to the regex walker would reintroduce all the
// Round-50 false-positive surface. This test asserts:
//   (a) the scanner imports acorn (AST scanner marker)
//   (b) the scanner invokes acorn's parse() on source files
//   (c) the scanner parses with sourceType: "module" — required for
//       `export const`-bearing lib/*.js files
//   (d) the scanner does NOT contain the Round-50 char-walker
//       helper names (revert detector) — findFunctionDecls /
//       findConstDeclsInBody / findIdentifierUses /
//       findModuleScopeConstDecls were the helper-symbol names
//       from the Round-50 walker; their return trips this test as
//       a hard fail.

const LINT_SRC = readFileSync(SCRIPT_PATH, 'utf-8')

test('Round-51: scripts/lint-scope.mjs must use the acorn AST scanner (lock against Round-50 regex-walker regression)', () => {
  // (a) Acorn dependency
  assert.match(
    LINT_SRC,
    /from\s+['"]acorn['"]/,
    'lint-scope.mjs must import acorn (AST scanner dependency)',
  )
  // (b) Acorn parse() invocation
  assert.match(
    LINT_SRC,
    /\bparse\s*\(/,
    'lint-scope.mjs must invoke parse() on the source file (AST-based scanning)',
  )
  // (c) Module-sourceType (needed for export const in lib/*.js)
  assert.match(
    LINT_SRC,
    /sourceType:\s*['"]module['"]/,
    'lint-scope.mjs must parse with sourceType: "module" (required for `export const`-bearing lib/*.js)',
  )
  // (d) Revert detector — Round-50 char-walker helper names
  //     must NOT appear. If they're reintroduced, the AST scanner
  //     was (partially or fully) reverted.
  assert.doesNotMatch(
    LINT_SRC,
    /\bfindFunctionDecls\b|\bfindConstDeclsInBody\b|\bfindIdentifierUses\b|\bfindModuleScopeConstDecls\b/,
    'lint-scope.mjs must NOT contain the Round-50 char-walker helpers — their return would mean the AST scanner was reverted',
  )
})
