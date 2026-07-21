// tests/unit/bug-name-boolean.test.mjs
//
// 2026-07-21 — Regression locks for the two highest-visibility
// real-form bugs the user reported Aug-2026. Each fix shipped
// directly under the prefix "BUG N" in extension/content.js so a
// future regression is traceable by grep.
//
// BUG 1 — Name duplication on 6/8 forms.
//   Pre-fix `getFieldMeta()` did
//     parent.querySelector('label, legend')  // FIRST match in subtree
//   from every ancestor up to 4 hops. On a row with two
//   adjacent inputs (Förnamn / Efternamn) both inputs received
//   "Förnamn" in their meta and FIELD_PATTERNS routed both to
//   the firstName entry. Post-fix: cross-tree querySelector is
//   gone; only unambiguous label sources (wrapping <label>,
//   fieldset <legend>, input.labels) contribute to meta.
//
// BUG 4 — Boolean radios never answered on 7/8 forms.
//   Pre-fix fillAll() processed BOTH Ja-radio and Nej-radio of
//   the same boolean group (they share a <legend>/<label> meta),
//   firing clickBooleanOption twice. For Bootstrap-style toggle
//   buttons the second click DEACTIVATES the first. Post-fix:
//   a per-question dedup Set (handledBooleanGroups) + a stable
//   group key (booleanGroupKey) ensure exactly one click per
//   question.

// Static source-grep contract — extension/content.js must NOT
// contain the cross-tree querySelector inside getFieldMeta, and
// MUST contain the unambiguous replacement sources.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../extension/content.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// Static regression guards — these are bytewise identity checks so a
// future refactor that removes the fix trips the test BEFORE the regression
// reaches production forms.
// ---------------------------------------------------------------------------

test('BUG 1: getFieldMeta must NOT call parent.querySelector("label, legend") (cross-tree label contamination)', () => {
  // Extract getFieldMeta's CODE body (excluding the explanatory
  // comments) so the regression guard doesn't false-positive on the
  // explanatory block that *documents* the bug. The pre-fix
  // fingerprint `parent.querySelector('label, legend')` MUST NOT
  // appear in any code line.
  const startIdx = SOURCE.indexOf('function getFieldMeta(')
  assert.ok(startIdx > 0, 'getFieldMeta must exist in extension/content.js')
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < SOURCE.length; i++) {
    const ch = SOURCE[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  assert.ok(endIdx > startIdx, 'failed to find closing brace of getFieldMeta')
  // Drop full-line comments (//-prefixed) — the explanatory
  // bug-history block lives in those comments and would
  // otherwise trip the regression scan.
  const rawBody = SOURCE.slice(startIdx, endIdx + 1)
  const codeOnly = rawBody
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

  // Pre-fix fingerprint: `parent.querySelector('label, legend')` (or
  // close equivalent with whitespace). The fix replaces it with
  // :scope > selectors and input.labels, neither of which can
  // reach sibling labels by construction.
  assert.ok(
    !/parent\.querySelector\s*\(\s*['"`]label\s*,\s*legend['"`]\s*\)/.test(codeOnly),
    'BUG 1 regression: getFieldMeta still calls parent.querySelector("label, legend") — this would cross-contaminate sibling inputs on adjacent-label forms (the symptom: both Förnamn AND Efternamn getting firstName)',
  )
  assert.ok(
    !/querySelector\s*\(\s*['"`]label\s*,\s*legend['"`]\s*\)/.test(codeOnly),
    'BUG 1 regression: getFieldMeta still calls a broad querySelector("label, legend") — any version of this query can return sibling labels',
  )
})

test('BUG 1: getFieldMeta must include the unambiguous replacement label sources', () => {
  const startIdx = SOURCE.indexOf('function getFieldMeta(')
  assert.ok(startIdx > 0)
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < SOURCE.length; i++) {
    const ch = SOURCE[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  const body = SOURCE.slice(startIdx, endIdx + 1)

  // The three replacement sources must all be present.
  assert.ok(
    /parent\.tagName\s*===\s*['"`]FIELDSET['"`]/.test(body),
    'BUG 1 fix: getFieldMeta must include a fieldset-tag check that pulls a direct-child <legend>',
  )
  assert.ok(
    /:scope\s*>\s*legend/.test(body) || /'\\:scope\\s*>\\s*legend'/.test(body),
    'BUG 1 fix: the fieldset branch must use a `:scope > legend` selector so a sibling fieldset\'s <legend> cannot leak in',
  )
  assert.ok(
    /input\.labels/.test(body),
    'BUG 1 fix: getFieldMeta must read input.labels (native <label for="id"> association) which cannot return sibling labels',
  )
})

test('BUG 4: fillAll() must declare handledBooleanGroups Set + booleanGroupKey helper', () => {
  assert.ok(
    /handledBooleanGroups\s*=\s*new\s+Set\s*\(\s*\)/.test(SOURCE),
    'BUG 4 fix: fillAll() must declare a local `handledBooleanGroups = new Set()` for per-question dedup',
  )
  assert.ok(
    /function\s+booleanGroupKey\s*\(/.test(SOURCE),
    'BUG 4 fix: a `function booleanGroupKey(input)` helper must exist to produce a stable per-question key',
  )
})

test('BUG 4: fillAll\'s boolean branch must consult handledBooleanGroups BEFORE clickBooleanOption', () => {
  // Capture the boolean-kind branch of fillAll. The pre-fix shape
  // called clickBooleanOption() unconditionally. Post-fix shape
  // gates on `handledBooleanGroups.has(...)` first.
  const fillStart = SOURCE.indexOf('async function fillAll(')
  assert.ok(fillStart > 0)
  // Find the closing brace of fillAll via balanced counting.
  let depth = 0
  let fillEnd = -1
  for (let i = fillStart; i < SOURCE.length; i++) {
    const ch = SOURCE[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { fillEnd = i; break }
    }
  }
  const fillBody = SOURCE.slice(fillStart, fillEnd + 1)
  // The boolean branch must reference handledBooleanGroups AND
  // booleanGroupKey before the clickBooleanOption call site.
  assert.ok(
    /handledBooleanGroups\.has\s*\(/.test(fillBody),
    'BUG 4 fix: fillAll must check handledBooleanGroups.has(...) in the boolean branch',
  )
  const hasGate = fillBody.indexOf('handledBooleanGroups.has(')
  const hasKey = fillBody.indexOf('booleanGroupKey(input)')
  const hasClick = fillBody.indexOf('clickBooleanOption(input, desired)')
  assert.ok(hasGate > 0 && hasKey > 0 && hasClick > 0, 'all three anchor strings must appear in fillAll')
  assert.ok(
    hasGate < hasClick && hasKey < hasClick,
    `BUG 4 fix: dedup gate (${hasGate}) + key call (${hasKey}) must both precede the clickBooleanOption call (${hasClick}) so the dedup actually short-circuits the click`,
  )
})

// ---------------------------------------------------------------------------
// Behavioral test — verify booleanGroupKey itself produces stable,
// non-collision-prone keys for the most common Swedish form patterns.
// ---------------------------------------------------------------------------

test('BUG 4: booleanGroupKey returns the same key for a radio pair sharing a form.name', () => {
  // Extract booleanGroupKey source via a balanced-brace walk.
  const startIdx = SOURCE.indexOf('function booleanGroupKey(')
  assert.ok(startIdx > 0)
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < SOURCE.length; i++) {
    const ch = SOURCE[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  const fnSource = SOURCE.slice(startIdx, endIdx + 1)
  // Build a minimal DOM stub: the helper only reads `tagName`,
  // `type`, `name`, `form`, then walks `parentElement` looking
  // for `tagName === 'FIELDSET'` etc. Build by hand — no jsdom dep.
  const fakeForm = { id: 'f1', action: '', elements: [] }
  const radioJa = {
    tagName: 'INPUT',
    type: 'radio',
    name: 'hasLicense',
    form: fakeForm,
    parentElement: null,
    id: '',
    getAttribute: () => null,
  }
  const radioNej = {
    tagName: 'INPUT',
    type: 'radio',
    name: 'hasLicense',
    form: fakeForm,
    parentElement: null,
    id: '',
    getAttribute: () => null,
  }
  // Wrap in a containing <fieldset> to mirror real DOM.
  const fakeFieldset = {
    tagName: 'FIELDSET',
    id: '',
    innerText: 'B-körkort',
    querySelector: () => null,
    getAttribute: () => null,
  }
  radioJa.parentElement = fakeFieldset
  radioNej.parentElement = fakeFieldset
  fakeFieldset.parentElement = { tagName: 'BODY' }
  // Compile the function in this realm by indirect eval.
  const fn = new Function(`${fnSource}; return booleanGroupKey;`)()
  const k1 = fn(radioJa)
  const k2 = fn(radioNej)
  assert.equal(
    typeof k1, 'string',
    'booleanGroupKey must return a string key for radio inputs',
  )
  assert.equal(
    k1, k2,
    `BUG 4 fix: booleanGroupKey must return the SAME key for a Ja/Nej radio pair — got ${JSON.stringify(k1)} vs ${JSON.stringify(k2)}`,
  )
})

test('BUG 4: booleanGroupKey returns DIFFERENT keys for distinct radio groups', () => {
  const startIdx = SOURCE.indexOf('function booleanGroupKey(')
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < SOURCE.length; i++) {
    const ch = SOURCE[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  const fn = new Function(`${SOURCE.slice(startIdx, endIdx + 1)}; return booleanGroupKey;`)()
  const fakeForm = { id: 'f1', action: '', elements: [] }
  const radioA = {
    tagName: 'INPUT', type: 'radio', name: 'korkort', form: fakeForm,
    parentElement: { tagName: 'FIELDSET', id: '', innerText: 'lorem', querySelector: () => null, getAttribute: () => null },
    id: '', getAttribute: () => null,
  }
  const radioB = {
    tagName: 'INPUT', type: 'radio', name: 'truck', form: fakeForm,
    parentElement: { tagName: 'FIELDSET', id: '', innerText: 'ipsum', querySelector: () => null, getAttribute: () => null },
    id: '', getAttribute: () => null,
  }
  const k1 = fn(radioA)
  const k2 = fn(radioB)
  assert.notEqual(
    k1, k2,
    `BUG 4 fix: distinct radio groups MUST produce distinct keys so each question is resolved independently — got the same key for ${k1}`,
  )
})

// ---------------------------------------------------------------------------
// 2026-07-21 / Round-72.2 / Followup-3 — covering the minor
// edge case the final code-review flagged: a wrapping <legend>
// that's NOT inside a <fieldset> (rare but real on mobile-first
// ATS templates shipping <legend>...</legend><input/> with no
// fieldset parent). After the BUG 1 fix (parent.querySelector
// removed), this pattern would have its text dropped from
// meta, silently routing the input to the catch-all / 'missing'
// paint. The third else-if branch closes that path.
// ---------------------------------------------------------------------------

test('BUG 1 followup: getFieldMeta must include a wrapping-LEGEND-outside-FIELDSET branch (mobile-first ATS pattern)', () => {
  const startIdx = SOURCE.indexOf('function getFieldMeta(')
  assert.ok(startIdx > 0, 'getFieldMeta must exist in extension/content.js')
  let depth = 0
  let endIdx = -1
  for (let i = startIdx; i < SOURCE.length; i++) {
    const ch = SOURCE[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  const body = SOURCE.slice(startIdx, endIdx + 1)
  // Two-part lock:
  //   (a) the LEGEND branch literal must exist (otherwise the
  //       rare mobile-first ATS pattern drops meta silently),
  //   (b) the branch must be direct-parent only (hops === 0)
  //       — without the gate, a <legend> 2-4 hops up the chain
  //       re-introduces the exact cross-tree reach BUG 1
  //       explicitly fixed (the LABEL/FIELDSET branches have
  //       selector-side bounds so they don't need a hops
  //       gate; LEGEND is unbquerySelector-bound and does).
  assert.ok(
    /parent\.tagName\s*===\s*['"`]LEGEND['"`]/.test(body),
    'BUG 1 followup fix (a): getFieldMeta must include a `parent.tagName === "LEGEND"` branch so wrapping <legend> elements outside <fieldset> still surface their text. Round-72.2 / Followup-3 locked here so removing the branch trips the regression test BEFORE the silent meta-loss reaches production forms.',
  )
  // The second assertion uses a SINGLE-LINE match (`[^\n]*?`
  // with no global / dotAll flag) so the LEGEND literal and the
  // `hops === 0` gate MUST live on the same source line — a
  // future refactor that splits them across lines (e.g. when
  // pulling the gate into a helper) will fail THIS assertion
  // before it can silently re-enable cross-tree reach.
  // The literal-followed-by-gate adjacency is the structural
  // lock; the previous `{0,80}?` regex had a window wide enough
  // for a same-line comment to absorb it.
  assert.ok(
    /parent\.tagName\s*===\s*['"`]LEGEND['"`][^\n]*?hops\s*===\s*0\b/.test(body),
    'BUG 1 followup fix (b): the LEGEND branch MUST be gated on `hops === 0` AND the gate must live on the same source line as the LEGEND literal — restoring the cross-tree contract BUG 1 explicitly fixed.',
  )
})
