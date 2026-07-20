// Round-79.5 regression test — structural parser lock for extension/.
//
// On 2026-07-20 the user reported a real Chrome-extension crash:
//   "Uncaught SyntaxError" at popup.js (real location: an orphan
//   } catch (_) { clause + a dangling }) IIFE close inside
//   refreshDetectedFields).
//
// The pivotal finding was that `node --check extension/popup.js`
// reported rc=0 (no syntax errors), AND the `yarn lint:await-async`
// scanner reported zero await-outside-async violations. The file
// LOOKED clean. But the MV3 module-script pipeline (Chrome V8
// strict-mode + ESM) refused to load it. Root cause was a structural
// defect `node --check` tolerated because it parses `.js` as a
// CJS-script by default in a Next.js project.
//
// This test locks the file structure going forward by piping each
// entry-point through `node --check --input-type=module -` (stdin
// pipeline). The `--input-type=module` flag forces V8 to compile
// the stdin contents as an ESM module — the SAME V8 module-graph
// compile pipeline Chrome MV3 uses. Any structural defect surfaced
// by Chrome's module-script loader (orphan catch clause, missing
// `try {` before `} catch`, dangling `})` off a non-existent IIFE,
// top-level await outside an async context, a reserved-word
// variable name, an unescaped template-literal backtick, an
// unbalanced brace, etc.) fails this test.
//
// Coverage: extension/popup.js + extension/content.js +
// extension/background.js + extension/content-email.js.
//
// On stderr we surface the EXACT V8 SyntaxError message + caret
// indicator so a developer reading a failure can locate the
// defect without re-running node themselves.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { probeStringAsESM, ROUND_79_5_MINIMAL_BROKEN } from './_helpers/probe-esm.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..', '..')

// Every entry-point file in extension/ that Chrome MV3 loads as a
// module-script. Adding a new file here is a deliberate decision;
// the structural lock below is the gate that fails the build if a
// new entry-point is added with a parse error.
const MV3_ENTRY_POINTS = [
  'extension/popup.js',
  'extension/content.js',
  'extension/background.js',
  'extension/content-email.js',
]

/**
 * Probe a single file as ESM via the shared helper. Reads the
 * file, then pipes it through `node --check --input-type=module -`
 * (the SAME V8 module-graph compile pipeline Chrome MV3 uses to
 * load the extension). Returns null on success or a string with
 * the EXACT V8 SyntaxError stderr on failure.
 */
function probeAsESM(filePath) {
  const abs = resolve(PROJECT_ROOT, filePath)
  // Sanity: file must exist + non-empty (a missing file would
  // short-circuit with ENOENT — different failure mode from a
  // real parse error).
  let stat
  try {
    stat = statSync(abs)
  } catch (e) {
    return `ENOENT: ${e?.message || e}`
  }
  if (!stat.isFile() || stat.size === 0) {
    return 'zero-byte file'
  }
  const src = readFileSync(abs, 'utf8')
  return probeStringAsESM(src)
}

test('Round-79.5 lock: every MV3 entry-point parses cleanly as ESM (Chrome-V8 module-script pipeline)', () => {
  const failures = []
  for (const filePath of MV3_ENTRY_POINTS) {
    const stderr = probeAsESM(filePath)
    if (stderr === null) continue
    failures.push({ filePath, stderr })
  }
  if (failures.length === 0) return

  const lines = failures.map((f) => {
    const trimmed = f.stderr.split('\n').slice(0, 24).join('\n').trim()
    return `\n=== ${f.filePath} ===\n${trimmed}`
  })
  assert.fail(
    `Round-79.5 regression - MV3 entry-points failed ESM parse (the V8 module-script pipeline Chrome MV3 uses to load the extension).\n` +
      'node --check alone does NOT validate Chrome MV3 - it parses .js as a CJS-script by default in a Next.js project.\n' +
      'This test catches the round-79.5 class of bug (orphan catch, dangling IIFE close, await-outside-async, etc.).\n' +
      'Failures:' +
      lines.join('\n'),
  )
})

test('Round-79.5 lock: self-litmus - the probe mechanism WOULD catch a round-79.5-class SyntaxError if reintroduced', () => {
  // ROUND_79_5_MINIMAL_BROKEN comes from the shared helper. See
  // tests/unit/_helpers/probe-esm.mjs for the spec (orphan-`}`
  // invariant, same SHAPE as round-79.5's refreshDetectedFields
  // defect, built via String.fromCharCode so the fixture has zero
  // template-literal coupling).
  //
  // The orphan-`}` invariant is the BASELINE misshape V8 always
  // rejects at compile-time. Critically: top-level `await` IS
  // legal in ESM modules under ES2022+, so a naive "just put
  // `const x = await` at top level" invariant would NOT reliably
  // fail this probe. The orphan-`}` invariant IS reliable across
  // V8 versions because an orphan brace is one of the few
  // syntactic defects the parser ALWAYS surfaces (no contextual
  // recovery).
  //
  // If probeStringAsESM accepts this string and reports null
  // (success), the probe mechanism is broken - this test must FAIL
  // so the bug is visible at CI time.
  //
  // Sibling lock in tests/unit/extension-mailto-detector-source.test.mjs
  // exercises the same ROUND_79_5_MINIMAL_BROKEN + probeStringAsESM
  // pair so a regression of the probe mechanism fails BOTH files
  // at the same time and surfaces the regression more visibly.
  const stderr = probeStringAsESM(ROUND_79_5_MINIMAL_BROKEN)
  assert.notEqual(
    stderr,
    null,
    'probeStringAsESM must REJECT a round-79.5-class string. ' +
      'If this assertion fails, the probe mechanism itself is broken - ' +
      'the structural parser lock above cannot catch real Chrome crashes.',
  )
  // stderr should mention at least one of the tokens V8's parse
  // failure surfaces (Unexpected, finally, catch, SyntaxError, or a
  // caret line). For the minimal orphan-`}` invariant, "Unexpected"
  // is the indicator V8 emits.
  assert.match(
    stderr,
    /finally|Unexpected|catch|SyntaxError|^\s*\^+/m,
    'probe stderr should carry V8s parse-error indicator (literal "finally", "Unexpected", "catch", "SyntaxError", or a caret line)',
  )
})

test('Round-79.5 lock: file line-count floors (no truncation regression) - SOFT, warns only', () => {
  // Soft-floors (warn instead of fail) so a legitimate LOC-trim
  // commit (e.g. deleting a stale feature) does not break CI. The
  // hard floor is the ESM parse test above - a truncation that
  // lands on a syntactic boundary still parses cleanly, but the
  // ESM probe would catch any structurally-broken truncation.
  // The line-count check here is a SCENT check for "did someone
  // accidentally delete 200 lines?" not a contract.
  const SOFT_FLOORS = {
    'extension/popup.js': 2700,
    'extension/content.js': 2300,
    'extension/background.js': 100,
    'extension/content-email.js': 380,
  }
  const warnings = []
  for (const [filePath, minLines] of Object.entries(SOFT_FLOORS)) {
    const abs = resolve(PROJECT_ROOT, filePath)
    const src = readFileSync(abs, 'utf8')
    const lineCount = src.split('\n').length
    if (lineCount < minLines) {
      warnings.push(
        `${filePath}: ${lineCount} lines - below the soft floor of ${minLines}. Likely truncation regression.`,
      )
    }
  }
  if (warnings.length > 0) {
    // Soft-warn via stderr so a developer running `yarn test:unit`
    // sees it but CI does not fail.
    process.stderr.write(`\n[popup-esm-parse soft-floor warnings]\n${warnings.join('\n')}\n`)
  }
  // Always assert true so the test passes regardless of floor status.
  assert.ok(true)
})
