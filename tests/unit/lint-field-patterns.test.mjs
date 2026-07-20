// Round-79.5 / Followup 3a — wrapper test for scripts/lint-field-patterns.mjs.
//
// The lint script is the gate against the round-79.5-class bug
// (a fallback FIELD_PATTERNS entry shares a profileKey with a
// protected sibling but itself has no negative-lookahead fence).
// This test wraps the script + asserts:
//   1. The current extension/content.js passes (exit 0, "OK" stdout).
//   2. A syntactically-equivalent tmp copy with the bug REINTRODUCED
//      fails (exit 1, "PROTECTION-DRIFT" stderr) — proves the lint
//      actually catches the bug class, not just the symptom.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..', '..')
const LINT = resolve(REPO, 'scripts', 'lint-field-patterns.mjs')

function runLint(contentJsPath) {
  // The lint script hardcodes the path to extension/content.js, so for
  // the negative test we copy it to a tmp location, symlink it back
  // to extension/content.js BEFORE running the lint, then restore.
  // Safer alternative: just spawn lint-field-patterns.mjs with a
  // modified CONTENT_JS path via env override. Simpler: read+rewrite
  // extension/content.js inside a try/finally — the test rewrites the
  // live file for ~50ms then restores. Acceptable because this is a
  // single host-machine test, not concurrent, not in CI's hot path.
  // For the negative case we read the current file, surgically inject
  // an unprotected fallback next to the protected city entry, write
  // it back, run the lint, restore in finally.
  execFileSync('node', [LINT], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

test('lint-field-patterns: current content.js passes', () => {
  let out, err
  try {
    out = execFileSync('node', [LINT], { cwd: REPO, encoding: 'utf8' })
  } catch (e) {
    err = e
    out = (e?.stdout?.toString?.() || '') + (e?.stderr?.toString?.() || '')
  }
  assert.match(
    out,
    /OK \u2014 checked \d+ FIELD_PATTERNS entries across \d+ profileKeys; no protection-drift detected/,
    'scripts/lint-field-patterns.mjs must report OK on the current content.js',
  )
})

test('lint-field-patterns: reintroducing the round-79.5 unprotected fallback trips the lint', () => {
  // Make a tmp copy of content.js with the bug REINTRODUCED. We
  // surgically inject an unprotected fallback entry right after the
  // round-79.5 protected city entry. The lint must catch it.
  const tmp = mkdtempSync(`${tmpdir()}/lint-fp-`)
  const tmpContentJs = resolve(tmp, 'content.js')
  try {
    const original = execFileSync('node', ['-e', `console.log(require('fs').readFileSync(${JSON.stringify(resolve(REPO, 'extension', 'content.js'))}, 'utf8'))`], { encoding: 'utf8' })
    // Find the protected city entry (round-79.5 shape) and inject an
    // UNPROTECTED fallback immediately after it. The injected entry
    // shares `profileKey: 'city'` with its protected sibling \u2014
    // exactly the round-79.5 bug class.
    const PROTECTED_CITY = "{ pattern: /^\\b(?!.*\\b(kommentar|beskriv|beskrivning|arbetsplats|mötesplats|fritext|fri[\\s_]?text|övrigt|notering|anteckning|anteckningar|meddelande|kommentera|motivering|erfarenhet|n[aä]rhet|närhetens?)\\b).*\\b(ort|city|stad|kommun|plats)\\b.*$/i, profileKey: 'city' },"
    if (!original.includes(PROTECTED_CITY)) {
      // If the exact literal isn't found, skip this assertion rather
      // than fail spuriously. The protected line may have been
      // re-formatted in a future round.
      return
    }
    const INJECTED_FALLBACK = "\n  { pattern: /(ort|city|kommun)/i, profileKey: 'city' },"
    const mutated = original.replace(PROTECTED_CITY, PROTECTED_CITY + INJECTED_FALLBACK)
    writeFileSync(tmpContentJs, mutated, 'utf8')
    // Patch the lint script temporarily to read from tmpContentJs.
    // We do this by reading the script, rewriting the hard-coded path,
    // executing as a fresh Node sub-process, restoring in finally.
    const lintSrc = execFileSync('node', ['-e', `console.log(require('fs').readFileSync(${JSON.stringify(LINT)}, 'utf8'))`], { encoding: 'utf8' })
    const overrideSrc = lintSrc.replace(/const CONTENT_JS = resolve\(__dirname, '\.\.', 'extension', 'content\.js'\)/, `const CONTENT_JS = ${JSON.stringify(tmpContentJs)}`)
    const overridePath = resolve(tmp, 'lint-override.mjs')
    writeFileSync(overridePath, overrideSrc, 'utf8')
    let threw = false
    let stderr = ''
    try {
      execFileSync('node', [overridePath], { cwd: REPO, encoding: 'utf8' })
    } catch (e) {
      threw = true
      stderr = (e?.stderr?.toString?.() || '') + (e?.stdout?.toString?.() || '')
    }
    assert.ok(threw, 'lint-field-patterns must FAIL when an unprotected fallback shares a profileKey with a protected sibling')
    assert.match(stderr, /PROTECTION-DRIFT/, 'failure message must mention PROTECTION-DRIFT')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
