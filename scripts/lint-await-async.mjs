#!/usr/bin/env node
/**
 * scripts/lint-await-async.mjs
 *
 * Round-76 (2026-07-20) — yarn-runnable CLI wrapper around the
 * existing `tests/fixtures/round74-await-scan.js` scanner.
 *
 * Why this exists:
 * The Round-74 user-reported "Uncaught SyntaxError: Unexpected
 * reserved word" popup.js crash was caused by `await` inside a
 * non-async function. The Round-74.1 unit test
 * (`tests/unit/round74-await-scan.test.mjs`) already catches this
 * at MAKE-time (it runs the same scanner via child_process and
 * fails CI when `TOTAL REAL OFFENDING SITES` is non-zero).
 *
 * Why ALSO this script:
 * The unit test runs as part of `yarn test:unit` — but the
 * packaging pipeline (`yarn package:extension`) does NOT depend
 * on `yarn test:unit`, so a developer who runs `yarn
 * package:extension` directly could ship a broken extension. By
 * wiring this lint into the package chain BEFORE the python
 * zip step, we catch the regression at SHIP-time (extension
 * packaging), not just at MAKE-time (test:unit).
 *
 * The wrapper is intentionally thin:
 *   - Re-uses the existing scanner verbatim (no AST rewrite,
 *     no brace-tracking duplication, no async-arrow boundary
 *     re-implementation — those are battle-tested).
 *   - Standard CLI lint convention: header on stderr, offending
 *     sites on stderr, exit code tells CI green/red.
 *   - No skip conditions: this lint has zero environmental
 *     deps (purely static analysis on extension/*.js). A
 *     failure here is ALWAYS a code defect — by design we never
 *     accidentally mask a real syntax bug behind a sandbox-
 *     skip heuristic like Round-75's build-extension-smoke did.
 *
 * Exit codes:
 *   0 — clean (0 offending sites in extension/*.js)
 *   1 — one or more offending sites found
 *   2 — scanner crashed / stdout malformed / fixture missing.
 *       Distinct from 1 because a 2 indicates a TOOL failure
 *       (not a CODE failure) so an operator triaging CI can
 *       distinguish "developer just needs to add `async`" from
 *       "scanner file got accidentally moved/uninstalled".
 *
 * Usage:
 *   yarn lint:await-async          # developer-facing
 *   yarn package:extension         # packaging chain auto-runs lint first
 *   node scripts/lint-await-async.mjs  # direct invocation also works
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Wrapper lives at scripts/, ROOT is two levels up.
// Passed as cwd to execFileSync so the scanner's
// `path.join(__dirname, '..', '..', 'extension')` resolves
// to project_root/extension regardless of where the wrapper
// is invoked from.
const ROOT = path.resolve(__dirname, '..')
const SCANNER_PATH = path.resolve(ROOT, 'tests/fixtures/round74-await-scan.js')

console.error(`Linting extension/*.js for await-outside-async violations via ${path.relative(ROOT, SCANNER_PATH)} ...`)

let stdout
try {
  stdout = execFileSync(process.execPath, [SCANNER_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
    // The scanner is a script that prints its TOTAL summary
    // to stdout (matches the round74-await-scan.test.mjs
    // contract). Capturing stdout + stderr separately lets us
    // surface stderr (e.g. deprecation warnings) as debug
    // breadcrumb in CI logs without polluting the parse regex.
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })
} catch (e) {
  // execFileSync throws if the scanner exits non-zero OR
  // crashes. For this lint, any non-zero from the scanner means
  // the scanner file itself is broken (since the scanner's own
  // contract is to exit 0 with TOTAL summary on stdout, exit
  // 0 means success regardless of count — see scanner file
  // bottom).
  console.error(`\n[FATAL] Scanner crashed or exited non-zero: ${e.message}`)
  if (e.stdout) console.error(`scanner stdout:\n${e.stdout}`)
  if (e.stderr) console.error(`scanner stderr:\n${e.stderr}`)
  console.error(`\nThis indicates the SCANNER is broken, not the code being scanned.`)
  console.error(`Verify tests/fixtures/round74-await-scan.js exists and runs.`)
  process.exit(2)
}

// Parse the TOTAL summary line — the scanner's locked-in
// contract (see tests/unit/round74-await-scan.test.mjs for the
// other consumer). Future scanner format changes must update
// both consumers in lockstep.
const match = stdout.match(/TOTAL REAL OFFENDING SITES:\s*(\d+)/)
if (!match) {
  console.error(`\n[FATAL] Scanner stdout missing TOTAL summary line.`)
  console.error(`scanner stdout was:\n${stdout}`)
  console.error(`\nThis indicates the scanner's output contract drifted from this wrapper's expectations.`)
  console.error(`Either update the wrapper regex above or fix the scanner.`)
  process.exit(2)
}

const total = Number(match[1])
if (total === 0) {
  console.error('OK — no await-outside-async violations detected.')
  process.exit(0)
}

// Pull the offending-site lines (the ones the scanner printed
// BEFORE the TOTAL summary). Filter to lines containing
// `REAL BUG` so the TOTAL summary line itself doesn't double-
// count in the list.
const offending = stdout
  .split(/\r?\n/)
  .filter((l) => /REAL BUG/.test(l))
  .join('\n  ')

console.error(`\nFAILED: ${total} await-outside-async violation(s) in extension/*.js:`)
console.error(`  ${offending}\n`)
console.error(`Fix: prefix the containing function with \`async\` so it parses under Chrome MV3's module-script parser.`)
console.error(`Background: Chrome MV3 refuses to execute the whole popup.js script at parse time if any \`await\` lives outside an async scope — the popup HTML default "Kontrollerar\u2026" text stays visible and every listener stays dead (Round-74 + Round-74.1 user-reported regression fixed 2026-07-20).`)
console.error(`Reference: tests/unit/round74-await-scan.test.mjs has the make-time regression lock on this exact bug class.\n`)
process.exit(1)
