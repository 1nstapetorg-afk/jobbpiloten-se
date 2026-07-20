// Round-34 / Part 4 — source-locks companion to
// tests/unit/extension-mailto-detector.test.mjs. The behavior
// test inlines the regex constants from extension/content.js; this
// test verifies the bytewise identity of those literals in the
// production source. If a future maintainer quietly edits the
// regex in content.js (e.g. to allow a new TLD), they MUST also
// update the behavior test, AND this lock catches a forgotten
// update before it reaches production.
//
// Lock scope: source-grep over extension/content.js for the three
// regex literals (EMAIL_REGEX, EMAIL_REGEX_OBFUSC, EMAIL_PHRASES)
// and the two function names (findMailtoSignals,
// writeEmailSignalsIfChanged).
//
// Round-36.3 design note: ALL source-lock tests in this file use
// `src.includes(literal)` substring checks rather than
// `assert.match(src, /regex/)`. Three regex-iteration cycles in
// Round-36 / Round-36.1 / Round-36.2 demonstrated that source-lock
// regexes with quantifier-and-char-class shapes fight the data:
// the regex engine matches prefix portions of larger char classes
// then back-tracks through every shorter prefix, or V8 raises
// "Invalid regular expression: missing /" when the pattern
// contains `\\-` sequences that the parser can't disambiguate.
// A substring check is the most direct bytewise-identity lock:
// the source MUST contain the exact literal text. Future
// maintainers can extend char classes (add Norwegian, Spanish,
// Polish chars) and the test STILL passes — the lock is anchored
// on the LITERAL TEXT, not on a regex that approximates it.
//
// Round-79.5 sibling lock: this file USED to be a pure mailto
// bytewise-identity lock. As of Round-79.5 it ALSO imports the
// shared probe-esm.mjs helper and runs the SAME orphan-`}`
// invariant as tests/unit/popup-esm-parse.test.mjs. The two
// sibling tests fail together if the probe mechanism regresses,
// so a future V8 release that relaxes parse-error reporting
// surfaces the regression simultaneously rather than silently
// passing CI.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

import { probeStringAsESM, ROUND_79_5_MINIMAL_BROKEN } from './_helpers/probe-esm.mjs'

const CONTENT_PATH = 'extension/content.js'

assert.ok(existsSync(CONTENT_PATH), `${CONTENT_PATH} must exist`)
const src = readFileSync(CONTENT_PATH, 'utf8')

test('Round-34: content.js declares EMAIL_REGEX literal bytewise-identical to behavior test', () => {
  assert.ok(
    src.includes('const EMAIL_REGEX = /[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g'),
    'EMAIL_REGEX literal must match the regex used in tests/unit/extension-mailto-detector.test.mjs — bytewise identity is the contract',
  )
})

test('Round-34: content.js declares EMAIL_REGEX_OBFUSC literal (obfuscated [at]/[dot] decoder)', () => {
  // Round-36: Swedish chars (åäöÅÄÖ) added to all three char
  // classes in content.js so obfuscated patterns like
  // "ansök (at) foretag (punkt) se" decode to a valid email. The
  // bytewise-identity lock here pins the literal text — a future
  // maintainer who quietly edits the regex (e.g. to allow a new
  // TLD) MUST also update the behavior test, AND this lock
  // catches a forgotten update before it reaches production.
  assert.ok(
    src.includes('const EMAIL_REGEX_OBFUSC = /\\b([a-zA-Z0-9._%+\\-åäöÅÄÖ]{2,})'),
    'EMAIL_REGEX_OBFUSC literal must exist in content.js — required for Swedish [at]/[dot] recruiter obfuscation decoding',
  )
})

test('Round-34: content.js declares EMAIL_PHRASES literal (Swedish + English phrase patterns)', () => {
  assert.ok(
    src.includes('const EMAIL_PHRASES = /(skicka[\\s\\S]{0,40}?(?:ansökan|cv)'),
    'EMAIL_PHRASES literal must exist in content.js — required for phrase-only fallback when no address was found but an email-apply CTA is implied',
  )
})

test('Round-34: content.js defines findMailtoSignals function', () => {
  assert.ok(
    src.includes('function findMailtoSignals(root = document)'),
    'findMailtoSignals must be defined as a function with document default — required for the mailto-detection API surface',
  )
})

test('Round-34: content.js defines writeEmailSignalsIfChanged helper', () => {
  assert.ok(
    src.includes('function writeEmailSignalsIfChanged(signals)'),
    'writeEmailSignalsIfChanged must be defined and called with a signals argument — required so a 20-mutation burst (Workday) does not spam chrome.storage.local',
  )
})

test('Round-34: scheduleScan calls findMailtoSignals + writeEmailSignalsIfChanged', () => {
  // The integration is load-bearing — without it the popup never
  // sees the signals and the compose panel stays hidden.
  //
  // Round-37.1 tightening (the pre-Round-37.1 assertion
  // `src.indexOf('writeEmailSignalsIfChanged(signals)')` returned
  // the FIRST occurrence — that's the function DECLARATION at
  // line 1113 (`function writeEmailSignalsIfChanged(signals) {`),
  // NOT the call site. A future maintainer who strips the call
  // site (e.g. to 'clean up' the mailto detector) would leave the
  // function declared but never invoked, and the previous test
  // would still pass — silent dead-code regression).
  //
  // Count-based lock: declared exactly once + called at least
  // once = total occurrence count >= 2. A declaration-only
  // function = count === 1 (test fails). The call site at line
  // 1402 is in scheduleScan's setTimeout callback, so the count
  // proxy (>= 2) genuinely requires both declaration and use.
  const writeCallCount = (src.match(/writeEmailSignalsIfChanged\(signals\)/g) || []).length
  assert.ok(
    writeCallCount >= 2,
    `writeEmailSignalsIfChanged(signals) must be invoked in scheduleScan (declared + called = count >= 2, found ${writeCallCount}) — required so the popup compose panel updates as new emails mount`,
  )
  // Same tightening for findMailtoSignals — function declaration
  // at line 1027 (`function findMailtoSignals(root = document) {`)
  // vs call site `findMailtoSignals()` at line 1401. The
  // substring `findMailtoSignals(` is present in BOTH the
  // declaration and the call, so count >= 2 means declared AND
  // called.
  const findCallCount = (src.match(/findMailtoSignals\(/g) || []).length
  assert.ok(
    findCallCount >= 2,
    `findMailtoSignals must be invoked in scheduleScan (declared + called = count >= 2, found ${findCallCount}) — required for mailto detection`,
  )
})

test('Round-34: content.js JOBBPILOTEN_QUERY onMessage handler preserves existing detected-field shape', () => {
  // The mailto detector ADDS to the existing onMessage job —
  // it must NOT silently drop the existing detected-fields response
  // shape that popup.js's queryActiveTab() consumes. The grep
  // confirms the original `detected: matches.slice(...).map(...)`
  // shape is intact.
  assert.ok(
    src.includes('sendResponse({ detected'),
    'JOBBPILOTEN_QUERY handler must still return { detected: [...] } — popup.queryActiveTab reads this',
  )
})

// ---------- Round-79.5 sibling lock ----------
// Sibling to tests/unit/popup-esm-parse.test.mjs's self-litmus.
// Same ROUND_79_5_MINIMAL_BROKEN orphan-`}` invariant imported
// from the shared helper (see tests/unit/_helpers/probe-esm.mjs).
// If the probe mechanism regresses (e.g. V8 contextual-recovery
// changes in a future V8 release), BOTH this test AND the
// popup-esm-parse sibling fail at the same time, surfacing the
// regression more visibly than a single lock would.

test('Round-79.5 sibling lock: probe mechanism would still catch a round-79.5-class SyntaxError if reintroduced', () => {
  const stderr = probeStringAsESM(ROUND_79_5_MINIMAL_BROKEN)
  assert.notEqual(
    stderr,
    null,
    'probeStringAsESM must REJECT a round-79.5-class string. ' +
      'If this assertion fails, the probe mechanism itself is broken - ' +
      'the structural parser lock in popup-esm-parse.test.mjs and this ' +
      'sibling would both be false-passing, so the regression would NOT ' +
      'be caught at CI time.',
  )
  assert.match(
    stderr,
    /finally|Unexpected|catch|SyntaxError|^\s*\^+/m,
    'probe stderr should carry V8’s parse-error indicator (literal "finally", "Unexpected", "catch", "SyntaxError", or a caret line)',
  )
})
