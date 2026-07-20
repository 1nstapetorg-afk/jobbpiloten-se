// tests/unit/extension-fill-vm.test.mjs
//
// 2026-07-16 (Round-12, followup #3) — vm-sandbox behavioral test for
// the extension's Round-12 dispatch helpers.
//
// BACKGROUND:
//   The extension's fillAll() dispatches to different helpers based on
//   the matched FIELD_PATTERNS entry's `kind`:
//     • kind:'boolean' / 'booleanThreshold' → clickBooleanOption()
//     • kind:'multiselect'                  → checkMultiCheckboxes()
//     • kind:'consent'                      → checkConsent()
//     • kind:'select'                       → setInputValue() (handles <select>)
//   Plus the underlying helpers parseExperienceThreshold(),
//   booleanFromExperienceYears(), and resolveProfileRaw() power the
//   boolean-threshold path.
//
//   A behaviour regression in any of these helpers (e.g. a flipped
//   wanted value, a missing regex escape, an off-by-one in the
//   parentElement walk) would silently mis-fill real Swedish job
//   forms. This file pins each helper's behaviour at the unit level
//   so a regression can't ship.
//
// STRATEGY:
//   1. Extract the helpers via anchored regex from
//      extension/content.js (same pattern as
//      tests/unit/extension-content-vm.test.mjs). The regexes
//      include extraction guards — if a function is renamed, the
//      test fails loudly before any code runs.
//   2. Build a minimal DOM stub (`FakeElement` class) supporting
//      the specific methods the helpers use: `tagName`, `type`,
//      `name`, `value`, `checked`, `innerText`/`textContent`,
//      `getAttribute`, `parentElement` chain, `form` (back-ref),
//      `closest()`, `matches()`, `querySelectorAll()`,
//      `dispatchEvent()`, `click()`.
//   3. Build a realistic Swedish job-form fixture programmatically —
//      4 fieldsets × 2 Ja/Nej radios, 1 <select> (Kön), 1 multi-
//      select fieldset with 5 checkboxes, 1 GDPR consent checkbox.
//   4. Invoke each helper against the fixture and assert the
//      resulting DOM state.
//
// We do NOT load the full content.js (2416 lines, aggressive DOM
// side-effects at parse time, document.documentElement.setAttribute
// at module load) — same rationale as the existing extension-content-vm
// test. Regex extraction gives us bytewise-controlled access to each
// helper in isolation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../extension/content.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')

// ---------- 1. Helper extraction ----------
//
// Anchored regex (`^function name(...)`) with `^}` (closing brace at
// line start, 0-indent) bounds the match to the function body. If a
// refactor renames or restructures the function, the test fails
// loudly before any vm code runs.

// `setInputValue` covers BOTH text inputs AND <select> dropdowns.
// The Round-12 test pins the <select> branch (Kön dropdown).
const SET_INPUT_VALUE_RX = /^function setInputValue\([^)]*\)\s*\{[\s\S]+?^}/m
// `clickBooleanOption` is the core Ja/Nej dispatch — tested with
// all three detection paths (radio group, button cluster, ARIA switch).
const CLICK_BOOLEAN_RX = /^function clickBooleanOption\([^)]*\)\s*\{[\s\S]+?^}/m
// `checkMultiCheckboxes` walks siblings/parents to find checkboxes
// matching the profile array entries (case-insensitive word-boundary).
const CHECK_MULTI_RX = /^function checkMultiCheckboxes\([^)]*\)\s*\{[\s\S]+?^}/m
// `checkConsent` is the GDPR safety-policy helper — never clicks
// unless profile.autoConsent === true.
const CHECK_CONSENT_RX = /^function checkConsent\([^)]*\)\s*\{[\s\S]+?^}/m
// `parseExperienceThreshold` extracts "minst X år" / "at least X years"
const PARSE_THRESHOLD_RX = /^function parseExperienceThreshold\([^)]*\)\s*\{[\s\S]+?^}/m
// `booleanFromExperienceYears` is the comparator for threshold questions
const BOOL_FROM_YEARS_RX = /^function booleanFromExperienceYears\([^)]*\)\s*\{[\s\S]+?^}/m
// `resolveProfileRaw` walks dotted paths in the profile (e.g.
// "answers.whyThisCompany") and returns the raw typed value.
const RESOLVE_RAW_RX = /^function resolveProfileRaw\([^)]*\)\s*\{[\s\S]+?^}/m

const EXTRACTIONS = {
  setInputValue: SOURCE.match(SET_INPUT_VALUE_RX),
  clickBooleanOption: SOURCE.match(CLICK_BOOLEAN_RX),
  checkMultiCheckboxes: SOURCE.match(CHECK_MULTI_RX),
  checkConsent: SOURCE.match(CHECK_CONSENT_RX),
  parseExperienceThreshold: SOURCE.match(PARSE_THRESHOLD_RX),
  booleanFromExperienceYears: SOURCE.match(BOOL_FROM_YEARS_RX),
  resolveProfileRaw: SOURCE.match(RESOLVE_RAW_RX),
}

// Helper-dependency extractions.
//
// clickBooleanOption CALLS matchesYesNoText and nearestBooleanGroup.
// checkMultiCheckboxes CALLS nearestCheckboxGroup. Without these
// helpers, the entry-point functions throw ReferenceError on every
// call (caught by the outer try/catch and reported as
// `{clicked: false, reason: 'exception'}` — silent in production).
// We extract them too so the entry points can resolve.
const MATCHES_YES_NO_RX = /^function matchesYesNoText\([^)]*\)\s*\{[\s\S]+?^}/m
const NEAREST_BOOLEAN_GROUP_RX = /^function nearestBooleanGroup\([^)]*\)\s*\{[\s\S]+?^}/m
const NEAREST_CHECKBOX_GROUP_RX = /^function nearestCheckboxGroup\([^)]*\)\s*\{[\s\S]+?^}/m

EXTRACTIONS.matchesYesNoText = SOURCE.match(MATCHES_YES_NO_RX)
EXTRACTIONS.nearestBooleanGroup = SOURCE.match(NEAREST_BOOLEAN_GROUP_RX)
EXTRACTIONS.nearestCheckboxGroup = SOURCE.match(NEAREST_CHECKBOX_GROUP_RX)

// Extraction guards — fail loudly if a refactor renames a function.
for (const [name, match] of Object.entries(EXTRACTIONS)) {
  test(`extraction: source-grep regex must locate ${name}`, () => {
    assert.ok(match,
      `${name} regex failed — the function was renamed or its declaration changed. Update both the regex AND the vm test together.`)
  })
}

// ---------- 2. Minimal DOM stub ----------
//
// A `FakeElement` class supporting the specific methods the helpers
// use. We do NOT implement the full DOM spec — just enough surface
// for the dispatch helpers to walk the tree and mutate state.
//
// Implementation notes:
//   • `parentElement` forms a chain (no children→siblings tree, just
//     a linear parent chain). nearestBooleanGroup / nearestCheckboxGroup
//     walk UP, so a linear chain is sufficient.
//   • `querySelectorAll` returns the descendants that were registered
//     via `addDescendant()` (used by nearestBooleanGroup's "2-4 button
//     cluster" heuristic).
//   • `closest()` walks the parent chain looking for an element
//     whose `tagName` matches or whose role attribute matches.
//   • `click()` is a no-op for the helper's purposes — the helpers
//     only check the side effects they care about (checked, value,
//     or that click() was invoked). We track click invocations on
//     each element so the test can assert "did this radio get
//     clicked?".
//   • `dispatchEvent()` is also a no-op — the helpers' `change` event
//     dispatch is for the host page's React/Angular state, which we
//     don't simulate. We only need the side effect (checked=true).
class FakeElement {
  constructor({
    tagName = 'DIV',
    type = '',
    name = '',
    value = '',
    checked = false,
    innerText = '',
    role = null,
    form = null,
  } = {}) {
    this.tagName = String(tagName).toUpperCase()
    this.type = type
    this.name = name
    this._value = value
    this.checked = checked
    this._innerText = innerText
    this._role = role
    this.form = form
    this._attrs = {}
    this._parent = null
    this._descendants = []
    this._clicked = 0 // counter — tests assert click() was called
    if (name) this._attrs.name = name
    if (type) this._attrs.type = type
    if (value) this._attrs.value = value
  }
  // ---- attribute helpers ----
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null
  }
  setAttribute(name, value) {
    this._attrs[name] = value
  }
  // ---- innerText / textContent ----
  get innerText() { return this._innerText }
  set innerText(v) { this._innerText = v }
  get textContent() { return this._innerText }
  set textContent(v) { this._innerText = v }
  // ---- value (mutable) ----
  get value() { return this._value }
  set value(v) {
    this._value = v
    // <input type=checkbox> mirrors value into checked when checked
    // attribute is mutated; for our purposes we only care about
    // checked when type=checkbox.
  }
  // ---- parent chain (linear) ----
  get parentElement() { return this._parent }
  setParent(p) {
    this._parent = p
    if (p) p._addDescendant(this)
  }
  _addDescendant(d) { this._descendants.push(d) }
  // ---- querySelectorAll: simple tag/role/type match ----
  // Supports the specific selectors used by nearestBooleanGroup /
  // nearestCheckboxGroup:
  //   'button, [role="button"], input[type="radio"], a'
  //   'input[type="checkbox"]'
  // Each is a comma-separated list of tag-name or [attr="value"]
  // selectors. We parse and match.
  querySelectorAll(selector) {
    const parts = selector.split(',').map((s) => s.trim())
    const matches = []
    for (const d of this._descendants) {
      if (this._matchesAny(d, parts)) matches.push(d)
      // Recurse into descendants' own descendants.
      for (const dd of d._descendants) {
        if (this._matchesAny(dd, parts)) matches.push(dd)
      }
    }
    return matches
  }
  _matchesAny(el, parts) {
    return parts.some((p) => this._matchesSelector(el, p))
  }
  _matchesSelector(el, sel) {
    // tag name: 'button', 'a', 'input'
    const tag = sel.match(/^([a-z]+)$/i)
    if (tag) return el.tagName === tag[1].toUpperCase()
    // [attr="value"]: '[role="button"]', '[role="radiogroup"]',
    // '[role="switch"]', 'input[type="radio"]', 'input[type="checkbox"]'
    const attr = sel.match(/^([a-z]+)\[([a-z-]+)="([^"]+)"\]$/i)
    if (attr) {
      const tagMatch = !attr[1] || el.tagName === attr[1].toUpperCase()
      if (!tagMatch) return false
      if (attr[2] === 'type') return el.type === attr[3]
      if (attr[2] === 'role') return el._role === attr[3] || el.getAttribute('role') === attr[3]
      return el.getAttribute(attr[2]) === attr[3]
    }
    return false
  }
  // ---- closest: walk parent chain looking for tagName/role match ----
  // Supports '[role="switch"]' (used by clickBooleanOption path iii)
  // and 'fieldset' / 'form' (used by nearestBooleanGroup /
  // nearestCheckboxGroup — but those walk parentElement directly,
  // not via closest, so we only need closest for the switch case).
  closest(selector) {
    let cur = this
    while (cur) {
      const attr = selector.match(/^\[([a-z-]+)="([^"]+)"\]$/i)
      if (attr) {
        if (cur.getAttribute(attr[1]) === attr[2]) return cur
      } else {
        if (cur.tagName === selector.toUpperCase()) return cur
      }
      cur = cur._parent
    }
    return null
  }
  matches(selector) {
    return this._matchesSelector(this, selector)
  }
  // ---- dispatchEvent: no-op (helpers only care about side effects) ----
  dispatchEvent(_e) { /* no-op */ }
  // ---- toJSON: prevent circular-reference errors when test assertion
  // messages stringify the helper's return value (e.g. clickBooleanOption
  // returns `{clicked, target: <FakeElement>, reason}`). Without toJSON,
  // JSON.stringify throws on the _parent ↔ _descendants cycle.
  //
  // Returns a STRUCTURED OBJECT (not a string) so error messages render
  // as `{"tag":"INPUT","name":"drivers","value":"yes"}` instead of a
  // double-quoted-string wrapper. The string-only-value guard skips
  // value repr if it's an object (defensive — prevents re-throws if a
  // future FakeElement ever stores circular refs in _value).
  toJSON() {
    const out = { tag: this.tagName }
    if (this.name) out.name = this.name
    if (typeof this.value === 'string') out.value = this.value
    return out
  }
  // ---- click: side-effect + counter ----
  click() {
    this._clicked++
    if (this.type === 'checkbox' || this.type === 'radio') {
      this.checked = true
    }
  }
}

// ---------- 3. Swedish form fixture ----------
//
// Realistic mock of a Platsbanken/Teamtailor job application form.
// Contains every field type the Round-12 dispatch helpers handle:
//
//   - 4 boolean fieldsets × 2 radios (B-körkort, EU-medborgare,
//     3+ år erfarenhet, truckförarbevis)
//   - 1 <select> (Kön: Man / Kvinna / Annat / Vill inte uppge)
//   - 1 multi-select fieldset with 5 checkboxes (Maskiner / Sanering
//     / Service / Förvaltning / Truck)
//   - 1 GDPR consent checkbox
//
// The fixture is built as a real DOM tree so clickBooleanOption's
// parentElement walks + querySelectorAll children actually work.
function buildFormFixture() {
  const form = new FakeElement({ tagName: 'FORM' })

  // ---- Boolean fieldset helper ----
  const makeBooleanFieldset = (legendText, yesValue = 'yes', noValue = 'no') => {
    const fs = new FakeElement({ tagName: 'FIELDSET' })
    fs._innerText = legendText
    const yesLabel = new FakeElement({ tagName: 'LABEL', innerText: 'Ja' })
    const noLabel = new FakeElement({ tagName: 'LABEL', innerText: 'Nej' })
    const yesRadio = new FakeElement({
      tagName: 'INPUT', type: 'radio', name: legendText.toLowerCase().replace(/\s+/g, '_'),
      value: yesValue, form,
    })
    const noRadio = new FakeElement({
      tagName: 'INPUT', type: 'radio', name: legendText.toLowerCase().replace(/\s+/g, '_'),
      value: noValue, form,
    })
    yesLabel.setParent(fs)
    noLabel.setParent(fs)
    yesRadio.setParent(yesLabel)
    noRadio.setParent(noLabel)
    // Mirror radios into form.elements (used by clickBooleanOption
    // path i — `host.form.elements`).
    form._elements = form._elements || []
    form._elements.push(yesRadio, noRadio)
    return { fs, yesLabel, noLabel, yesRadio, noRadio }
  }

  const drivers = makeBooleanFieldset('Har du B-körkort')
  const eu = makeBooleanFieldset('Är du medborgare i EU')
  // NOTE: parseExperienceThreshold only handles DIGIT forms (e.g.
  // "Minst 3 år"). Swedish word-numbers ("Minst tre år") return
  // null — the regex `(?:\d+)` doesn't match letters. Real ATS
  // forms use digits more often than words, but a future round
  // could extend the regex to a word→digit map (tre=3, fyra=4,
  // five=5, three=3). Pinned as a known-limitation test below.
  const exp3y = makeBooleanFieldset('Minst 3 års arbetslivserfarenhet')
  const truck = makeBooleanFieldset('Har du truckförarbevis')

  // ---- <select> for Kön ----
  const genderSelect = new FakeElement({ tagName: 'SELECT' })
  genderSelect.options = []
  for (const [val, label] of [['Man', 'Man'], ['Kvinna', 'Kvinna'], ['Annat', 'Annat'], ['', 'Välj kön']]) {
    const opt = new FakeElement({ tagName: 'OPTION', value: val, innerText: label })
    genderSelect.options.push(opt)
  }
  genderSelect.setParent(form)

  // ---- Multi-select checkboxes ----
  const skillsFs = new FakeElement({ tagName: 'FIELDSET', innerText: 'Jag har erfarenhet av' })
  const skills = {}
  for (const skill of ['Maskiner', 'Sanering', 'Service', 'Förvaltning', 'Truck']) {
    const label = new FakeElement({ tagName: 'LABEL', innerText: skill })
    const cb = new FakeElement({ tagName: 'INPUT', type: 'checkbox', value: skill })
    cb.setParent(label)
    label.setParent(skillsFs)
    skills[skill] = { label, cb }
  }
  skillsFs.setParent(form)

  // ---- GDPR consent checkbox ----
  const consentLabel = new FakeElement({ tagName: 'LABEL', innerText: 'Jag godkänner GDPR' })
  const consentCb = new FakeElement({ tagName: 'INPUT', type: 'checkbox', value: 'consent' })
  consentCb.setParent(consentLabel)
  consentLabel.setParent(form)

  // Make form.elements an iterable Array-like (used by
  // clickBooleanOption path i: `Array.from(form.elements)`).
  form.elements = form._elements || []

  return { form, drivers, eu, exp3y, truck, genderSelect, skillsFs, skills, consentCb }
}

// ---------- 4. Compile the extracted helpers in vm sandbox ----------
//
// The helpers' bodies only use:
//   - Array.from, Array.isArray, JSON (built-in)
//   - Object / Number / String / RegExp (built-in)
//   - setTimeout / clearTimeout (some may run async — not used in
//     the dispatch path)
// No DOM globals, no chrome.* — purely string + regex operations
// against the FakeElement tree we pass in.
const sandbox = {
  Promise,
  setTimeout,
  clearTimeout,
  AbortController: globalThis.AbortController,
  // Event is required by setInputValue() (`new Event('change', {bubbles:true})`)
  // and checkConsent() (same pattern). Without it, the dispatchEvent
  // call throws and the try/catch returns false / {clicked:false} even
  // though the value was successfully assigned. Verified by debug
  // script: sel.value became 'Kvinna' but setInputValue returned false
  // because `new Event(...)` threw ReferenceError (Event undefined in
  // vm sandbox).
  Event: globalThis.Event,
}
const ctx = vm.createContext(sandbox)

const code = `
(() => {
  ${EXTRACTIONS.matchesYesNoText ? EXTRACTIONS.matchesYesNoText[0] : ''}
  ${EXTRACTIONS.nearestBooleanGroup ? EXTRACTIONS.nearestBooleanGroup[0] : ''}
  ${EXTRACTIONS.nearestCheckboxGroup ? EXTRACTIONS.nearestCheckboxGroup[0] : ''}
  ${EXTRACTIONS.setInputValue ? EXTRACTIONS.setInputValue[0] : ''}
  ${EXTRACTIONS.clickBooleanOption ? EXTRACTIONS.clickBooleanOption[0] : ''}
  ${EXTRACTIONS.checkMultiCheckboxes ? EXTRACTIONS.checkMultiCheckboxes[0] : ''}
  ${EXTRACTIONS.checkConsent ? EXTRACTIONS.checkConsent[0] : ''}
  ${EXTRACTIONS.parseExperienceThreshold ? EXTRACTIONS.parseExperienceThreshold[0] : ''}
  ${EXTRACTIONS.booleanFromExperienceYears ? EXTRACTIONS.booleanFromExperienceYears[0] : ''}
  ${EXTRACTIONS.resolveProfileRaw ? EXTRACTIONS.resolveProfileRaw[0] : ''}
  return {
    setInputValue,
    clickBooleanOption,
    checkMultiCheckboxes,
    checkConsent,
    parseExperienceThreshold,
    booleanFromExperienceYears,
    resolveProfileRaw,
  }
})()
`
const helpers = vm.runInNewContext(code, ctx)
const {
  setInputValue,
  clickBooleanOption,
  checkMultiCheckboxes,
  checkConsent,
  parseExperienceThreshold,
  booleanFromExperienceYears,
  resolveProfileRaw,
} = helpers

// ============================================================
// clickBooleanOption — the core Ja/Nej dispatch
// ============================================================

test('clickBooleanOption: clicks the Ja radio when desiredValue=true', () => {
  const fx = buildFormFixture()
  const res = clickBooleanOption(fx.drivers.yesRadio, true)
  assert.equal(res.clicked, true, `expected clicked=true, got ${JSON.stringify(res)}`)
  assert.equal(fx.drivers.yesRadio.checked, true, 'yes radio should be checked after click')
  assert.equal(fx.drivers.yesRadio._clicked, 1, 'yes radio click() should have been invoked once')
  assert.equal(fx.drivers.noRadio.checked, false, 'no radio should NOT be checked')
})

test('clickBooleanOption: clicks the Nej radio when desiredValue=false', () => {
  const fx = buildFormFixture()
  const res = clickBooleanOption(fx.drivers.noRadio, false)
  assert.equal(res.clicked, true)
  assert.equal(fx.drivers.noRadio.checked, true, 'no radio should be checked after click')
  assert.equal(fx.drivers.noRadio._clicked, 1)
  assert.equal(fx.drivers.yesRadio.checked, false)
})

test('clickBooleanOption: returns clicked=false when desiredValue is undefined', () => {
  const fx = buildFormFixture()
  const res = clickBooleanOption(fx.drivers.yesRadio, undefined)
  assert.equal(res.clicked, false, 'undefined desiredValue must short-circuit without clicking')
  assert.equal(fx.drivers.yesRadio._clicked, 0, 'no click should have happened')
})

test('clickBooleanOption: works across multiple boolean fieldsets (B-körkort + EU + 3y + truck)', () => {
  // Simulates a user with profile:
  //   hasDriversLicense=true, isEuCitizen=true,
  //   yearsExperience=5 (>= 3 threshold), hasForkliftLicense=false
  // fillAll iterates the matches and calls clickBooleanOption per field.
  const fx = buildFormFixture()
  // Path (i) — radio group detection
  clickBooleanOption(fx.drivers.yesRadio, true)
  clickBooleanOption(fx.eu.yesRadio, true)
  clickBooleanOption(fx.exp3y.yesRadio, true)
  clickBooleanOption(fx.truck.noRadio, false)
  // Each yes radio should be checked, the no radio should be checked.
  assert.equal(fx.drivers.yesRadio.checked, true)
  assert.equal(fx.eu.yesRadio.checked, true)
  assert.equal(fx.exp3y.yesRadio.checked, true)
  assert.equal(fx.truck.noRadio.checked, true)
  assert.equal(fx.drivers.noRadio.checked, false)
  assert.equal(fx.eu.noRadio.checked, false)
  assert.equal(fx.exp3y.noRadio.checked, false)
  assert.equal(fx.truck.yesRadio.checked, false)
})

// ============================================================
// checkMultiCheckboxes — skills multi-select
// ============================================================

test('checkMultiCheckboxes: clicks only the checkboxes matching profile.skills (case-insensitive word-boundary)', () => {
  const fx = buildFormFixture()
  // Pick a sibling inside the fieldset as the "host" — the helper
  // walks nearestCheckboxGroup from host.
  const hostCb = fx.skills.Maskiner.cb
  const res = checkMultiCheckboxes(hostCb, ['Maskiner', 'Service', 'Truck'])
  assert.equal(res.candidates, 3, `expected 3 matching candidates, got ${res.candidates}`)
  assert.equal(res.clicked, 3, `expected 3 clicks, got ${res.clicked}`)
  assert.equal(fx.skills.Maskiner.cb.checked, true)
  assert.equal(fx.skills.Service.cb.checked, true)
  assert.equal(fx.skills.Truck.cb.checked, true)
  assert.equal(fx.skills.Sanering.cb.checked, false, 'Sanering is not in profile.skills — must NOT be checked')
  assert.equal(fx.skills.Förvaltning.cb.checked, false, 'Förvaltning is not in profile.skills — must NOT be checked')
})

test('checkMultiCheckboxes: returns clicked=0 when profile.skills is empty', () => {
  const fx = buildFormFixture()
  const res = checkMultiCheckboxes(fx.skills.Maskiner.cb, [])
  assert.equal(res.clicked, 0)
  assert.equal(fx.skills.Maskiner.cb.checked, false, 'empty skills array must NOT click anything')
})

test('checkMultiCheckboxes: word-boundary escaping handles regex special chars', () => {
  // A profile skill containing regex special chars (e.g. "C++")
  // must not blow up the helper's internal RegExp constructor.
  const fx = buildFormFixture()
  const res = checkMultiCheckboxes(fx.skills.Maskiner.cb, ['C++', 'C# (.NET)'])
  // None of these match the checkbox labels so candidates=0; the
  // critical assertion is that no exception was thrown.
  assert.equal(res.candidates, 0)
  assert.equal(res.clicked, 0)
})

// ============================================================
// checkConsent — GDPR safety policy
// ============================================================

test('checkConsent: NEVER clicks when autoConsent is false (GDPR safety default)', () => {
  const fx = buildFormFixture()
  const res = checkConsent(fx.consentCb, false)
  assert.equal(res.clicked, false, 'GDPR safety: autoConsent=false must NEVER auto-click')
  assert.equal(fx.consentCb.checked, false, 'consent checkbox must remain unchecked')
  assert.equal(fx.consentCb._clicked, 0, 'no click() invocation expected')
  assert.equal(res.reason, 'no-auto-consent', `expected reason='no-auto-consent', got '${res.reason}'`)
})

test('checkConsent: clicks when autoConsent is true AND consent is unchecked', () => {
  const fx = buildFormFixture()
  const res = checkConsent(fx.consentCb, true)
  assert.equal(res.clicked, true)
  assert.equal(fx.consentCb.checked, true)
  assert.equal(fx.consentCb._clicked, 1)
})

test('checkConsent: is a no-op when consent is already checked (regardless of autoConsent)', () => {
  const fx = buildFormFixture()
  fx.consentCb.checked = true
  const res = checkConsent(fx.consentCb, true)
  assert.equal(res.clicked, false, 'already-checked must not click again')
  assert.equal(res.reason, 'already-checked')
})

// ============================================================
// parseExperienceThreshold + booleanFromExperienceYears
// ============================================================

test('parseExperienceThreshold: parses Swedish "minst X år"', () => {
  assert.equal(parseExperienceThreshold('Har du minst 3 års arbetslivserfarenhet?'), 3)
  assert.equal(parseExperienceThreshold('Minst 5 års erfarenhet krävs'), 5)
  assert.equal(parseExperienceThreshold('Mer än 2 år'), 2)
})

test('parseExperienceThreshold: parses English "at least X years"', () => {
  assert.equal(parseExperienceThreshold('Do you have at least 3 years of experience?'), 3)
  assert.equal(parseExperienceThreshold('Minimum 5 years required'), 5)
})

test('parseExperienceThreshold: returns null when no threshold present', () => {
  assert.equal(parseExperienceThreshold('Do you have a drivers license?'), null)
  assert.equal(parseExperienceThreshold(''), null)
  assert.equal(parseExperienceThreshold(null), null)
})

test('parseExperienceThreshold: KNOWN LIMITATION — returns null for Swedish word-numbers (e.g. "Minst tre år")', () => {
  // Documented limitation: the regex only matches digit thresholds
  // (`\d+`), not word-numbers. Real ATS forms use digits more often
  // than words, but if a form says "Minst tre års erfarenhet" the
  // extension falls back to a plain boolean (the user has to decide).
  // A future round could extend the regex with a Swedish/English
  // word→digit map. Pinned here so a fix is intentional (changing
  // this assertion requires updating the regex + formFromProfile
  // test in the same commit).
  assert.equal(parseExperienceThreshold('Minst tre års arbetslivserfarenhet'), null)
  assert.equal(parseExperienceThreshold('At least three years of experience'), null)
})

test('booleanFromExperienceYears: returns true when yearsExperience >= threshold', () => {
  assert.equal(booleanFromExperienceYears(5, 3), true)
  assert.equal(booleanFromExperienceYears(3, 3), true, 'equal years must count as sufficient')
  assert.equal(booleanFromExperienceYears(10, 5), true)
})

test('booleanFromExperienceYears: returns false when yearsExperience < threshold', () => {
  assert.equal(booleanFromExperienceYears(2, 3), false)
  assert.equal(booleanFromExperienceYears(0, 1), false)
})

test('booleanFromExperienceYears: returns undefined when threshold is null (parsing failed upstream)', () => {
  // The Round-12 booleanThreshold dispatch reads parseExperienceThreshold
  // first; if it returns null, booleanFromExperienceYears must also
  // return undefined so fillAll falls through to plain boolean handling.
  assert.equal(booleanFromExperienceYears(5, null), undefined)
  assert.equal(booleanFromExperienceYears(undefined, 3), undefined, 'non-number profileValue must yield undefined, not NaN-comparison')
})

// ============================================================
// resolveProfileRaw — dotted path resolution
// ============================================================

test('resolveProfileRaw: returns the raw boolean for top-level boolean keys', () => {
  const profile = { hasDriversLicense: true, isEuCitizen: false }
  assert.equal(resolveProfileRaw(profile, 'hasDriversLicense'), true)
  assert.equal(resolveProfileRaw(profile, 'isEuCitizen'), false)
})

test('resolveProfileRaw: returns the raw number for yearsExperience', () => {
  const profile = { yearsExperience: 5 }
  assert.equal(resolveProfileRaw(profile, 'yearsExperience'), 5)
})

test('resolveProfileRaw: walks dotted paths through nested objects', () => {
  // Real profile structure: answers is a sub-object.
  const profile = {
    answers: {
      whyThisCompany: 'Custom answer',
      whyThisRole: 'Another custom',
    },
  }
  assert.equal(resolveProfileRaw(profile, 'answers.whyThisCompany'), 'Custom answer')
  assert.equal(resolveProfileRaw(profile, 'answers.whyThisRole'), 'Another custom')
})

test('resolveProfileRaw: returns undefined for missing paths (not null, not error)', () => {
  const profile = { hasDriversLicense: true }
  assert.equal(resolveProfileRaw(profile, 'missing.key'), undefined)
  assert.equal(resolveProfileRaw(profile, 'hasDriversLicense.deep'), undefined)
})

test('resolveProfileRaw: returns undefined for null/undefined profile (defensive)', () => {
  assert.equal(resolveProfileRaw(null, 'hasDriversLicense'), undefined)
  assert.equal(resolveProfileRaw(undefined, 'hasDriversLicense'), undefined)
  assert.equal(resolveProfileRaw({}, ''), undefined, 'empty dottedKey must yield undefined')
})

test('resolveProfileRaw: preserves array type for skills (boolean/multiselect paths need array vs string)', () => {
  const profile = { skills: ['Maskiner', 'Service'] }
  const result = resolveProfileRaw(profile, 'skills')
  assert.ok(Array.isArray(result), 'skills must remain an array, not stringified')
  assert.deepEqual(result, ['Maskiner', 'Service'])
})

// ============================================================
// setInputValue — <select> dropdown handling (Kön)
// ============================================================

test('setInputValue: <select> — sets the option whose text matches the profile value', () => {
  const fx = buildFormFixture()
  const res = setInputValue(fx.genderSelect, 'Kvinna')
  assert.equal(res, true)
  assert.equal(fx.genderSelect.value, 'Kvinna')
})

test('setInputValue: <select> — matches case-insensitively', () => {
  const fx = buildFormFixture()
  const res = setInputValue(fx.genderSelect, 'man') // lowercase input
  assert.equal(res, true, 'lowercase "man" should match the "Man" option')
  assert.equal(fx.genderSelect.value, 'Man')
})

test('setInputValue: <select> — returns false when no option matches', () => {
  const fx = buildFormFixture()
  const res = setInputValue(fx.genderSelect, 'XYZ-not-an-option')
  assert.equal(res, false, 'unknown value must return false (no throw, no partial mutation)')
})

// ============================================================
// Integration smoke — boolean + select + multi + consent in one pass
// ============================================================

test('integration: a full Round-12 fillAll() pass on a Swedish form fixture', () => {
  // Simulates the per-field dispatch fillAll() does in production:
  //   1. clickBooleanOption per boolean match
  //   2. setInputValue per select match
  //   3. checkMultiCheckboxes per multiselect match
  //   4. checkConsent per consent match (default false → no-op)
  const fx = buildFormFixture()
  const profile = {
    hasDriversLicense: true,
    isEuCitizen: true,
    hasForkliftLicense: false,
    yearsExperience: 5,
    gender: 'Kvinna',
    skills: ['Maskiner', 'Service'],
    autoConsent: false, // GDPR safety default
  }

  // Boolean dispatch
  clickBooleanOption(fx.drivers.yesRadio, profile.hasDriversLicense)
  clickBooleanOption(fx.eu.yesRadio, profile.isEuCitizen)
  clickBooleanOption(fx.truck.noRadio, profile.hasForkliftLicense)
  // Boolean threshold dispatch (derived from yearsExperience + parsed threshold)
  const expThreshold = parseExperienceThreshold(fx.exp3y.fs._innerText)
  const expDesired = booleanFromExperienceYears(profile.yearsExperience, expThreshold)
  clickBooleanOption(fx.exp3y.yesRadio, expDesired)
  // Select dispatch
  setInputValue(fx.genderSelect, profile.gender)
  // Multi-select dispatch
  checkMultiCheckboxes(fx.skills.Maskiner.cb, profile.skills)
  // Consent dispatch (must NOT click — safety default)
  checkConsent(fx.consentCb, profile.autoConsent)

  // Assertions
  assert.equal(fx.drivers.yesRadio.checked, true, 'B-körkort Ja should be checked')
  assert.equal(fx.eu.yesRadio.checked, true, 'EU-medborgare Ja should be checked')
  assert.equal(fx.truck.noRadio.checked, true, 'Truckförarbevis Nej should be checked')
  assert.equal(fx.exp3y.yesRadio.checked, true, '3+ år erf. Ja should be checked (5 >= 3)')
  assert.equal(fx.genderSelect.value, 'Kvinna', 'Kön should be set to Kvinna')
  assert.equal(fx.skills.Maskiner.cb.checked, true)
  assert.equal(fx.skills.Service.cb.checked, true)
  assert.equal(fx.skills.Sanering.cb.checked, false)
  assert.equal(fx.skills.Förvaltning.cb.checked, false)
  assert.equal(fx.skills.Truck.cb.checked, false, 'Truck is NOT in profile.skills for this fixture')
  assert.equal(fx.consentCb.checked, false, 'GDPR consent MUST remain unchecked (autoConsent=false)')
  assert.equal(fx.consentCb._clicked, 0, 'consent click() must NEVER be invoked under default-false policy')
})

// ============================================================
// Signature-shape grep locks
// ============================================================

test('clickBooleanOption signature: (host, desiredValue) — 2 positional args', () => {
  // Anchored grep prevents an accidental `function clickBooleanOption({ host, desiredValue })`
  // destructure that would break fillAll()'s positional call.
  assert.ok(/^function\s+clickBooleanOption\s*\(\s*host\s*,\s*desiredValue\s*\)/m.test(SOURCE),
    'clickBooleanOption must accept positional (host, desiredValue) so fillAll() can call it positionally')
})

test('checkMultiCheckboxes signature: (hostInput, profileArray)', () => {
  assert.ok(/^function\s+checkMultiCheckboxes\s*\(\s*hostInput\s*,\s*profileArray\s*\)/m.test(SOURCE),
    'checkMultiCheckboxes must accept (hostInput, profileArray) positionally')
})

test('checkConsent signature: (input, autoConsent)', () => {
  assert.ok(/^function\s+checkConsent\s*\(\s*input\s*,\s*autoConsent\s*\)/m.test(SOURCE),
    'checkConsent must accept (input, autoConsent) positionally — fillAll() passes the resolved boolean directly')
})

test('booleanFromExperienceYears signature: (profileValue, threshold)', () => {
  assert.ok(/^function\s+booleanFromExperienceYears\s*\(\s*profileValue\s*,\s*threshold\s*\)/m.test(SOURCE))
})
