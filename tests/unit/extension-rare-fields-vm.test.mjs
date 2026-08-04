// tests/unit/extension-rare-fields-vm.test.mjs
//
// Round-84 — behavioral vm-sandbox test for the Tier-3 rare-field
// round-trip:
//
//   popup.js saveTier3Answers()
//     → POST /api/profile-update { rareFields: { [id]: answer } }
//     → profile.rareFields persisted server-side
//     → content.js fillRareFields() autofills the question on the
//       NEXT page that asks it, instead of prompting again.
//
// BACKGROUND:
//   The popup's Tier-3 prompt detects rare (job-specific) questions
//   on the host page (ständig natt, uppsägningstid, referenstagare,
//   …). The user types an answer; if the "Spara svar för framtida
//   ansökningar" checkbox is checked, saveTier3Answers() collects the
//   per-field inputs and POSTs them under `rareFields` (keyed by the
//   canonical ids in lib/field-taxonomy.js RARE_FIELDS). On a LATER
//   page that asks the same question, fillRareFields() label-matches
//   host inputs and fills them from the saved answers.
//
//   A regression in either half (a wrong payload shape, a leaked
//   checkbox state, an answer written into a radio group, a
//   stopword-only label match) would silently break the "answer once,
//   autofill forever" promise. This file pins both halves at the
//   unit level.
//
// STRATEGY:
//   1. Extract the functions via anchored regex from the source
//      files (same convention as tests/unit/extension-fill-vm.test.mjs
//      — the regexes fail loudly if a function is renamed).
//   2. Run each in a minimal vm sandbox with stubbed DOM / chrome.* /
//      fetch surfaces, and assert the observable behaviour.
//
// We do NOT load the full content.js / popup.js (aggressive DOM
// side-effects at parse time) — regex extraction gives bytewise
// control over each helper in isolation.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const CONTENT = fs.readFileSync(path.resolve(ROOT, 'extension/content.js'), 'utf-8')
const POPUP = fs.readFileSync(path.resolve(ROOT, 'extension/popup.js'), 'utf-8')

// ---------- 1. Function extraction (anchored, fail-loud) ----------
//
// NOTE for future refactors: the extraction regexes use `[^)]*` for
// the parameter list, so extracted functions must keep their params
// FREE of parentheses (e.g. no `handledBooleanGroups = new Set()`
// defaults). If a param ever gains parens the regex stops matching
// and the extraction-guard test fails loudly — update BOTH the
// regex and the sandbox call sites together.

// content.js helpers. Every regex is anchored on `^function name(`
// and closed by a column-0 `}` — the inner blocks are all indented,
// so the first column-0 brace IS the function's own closing brace.
const CONTENT_EXTRACTIONS = {
  normalizeMatchText: CONTENT.match(/^function normalizeMatchText\([^)]*\)\s*\{[\s\S]+?^}/m),
  fieldLabelKeywords: CONTENT.match(/^function fieldLabelKeywords\([^)]*\)\s*\{[\s\S]+?^}/m),
  metaMatchesIndustryLabel: CONTENT.match(/^function metaMatchesIndustryLabel\([^)]*\)\s*\{[\s\S]+?^}/m),
  booleanGroupKey: CONTENT.match(/^function booleanGroupKey\([^)]*\)\s*\{[\s\S]+?^}/m),
  setInputValue: CONTENT.match(/^function setInputValue\([^)]*\)\s*\{[\s\S]+?^}/m),
  fillRareFields: CONTENT.match(/^async function fillRareFields\([^)]*\)\s*\{[\s\S]+?^}/m),
  // The stopwords const is a dependency of fieldLabelKeywords — it is
  // NOT a function, so extract the whole `new Set([...])` literal.
  // NOTE: no trailing semicolon in the source — the const ends with
  // a bare `])` at column 0, so the regex stops there.
  stopwords: CONTENT.match(/const INDUSTRY_MATCH_STOPWORDS = new Set\(\[[\s\S]+?^]\)/m),
}

// popup.js — the Tier-3 save handler.
const POPUP_EXTRACTIONS = {
  saveTier3Answers: POPUP.match(/^async function saveTier3Answers\(\)\s*\{[\s\S]+?^}/m),
}

// Extraction guards — a rename/restructure fails the suite loudly
// before any vm code runs (mirrors extension-fill-vm.test.mjs).
for (const [name, match] of Object.entries({ ...CONTENT_EXTRACTIONS, ...POPUP_EXTRACTIONS })) {
  test(`extraction: source regex must locate ${name}`, () => {
    assert.ok(match,
      `${name} regex failed — the function was renamed or its declaration changed. Update BOTH the regex and this test together.`)
  })
}

// ---------- 2. content.js sandbox (fillRareFields half) ----------

// Build a vm context whose global surface covers everything the
// extracted content.js helpers touch, then evaluate the extracted
// snippets in dependency order. `makeInput` constructs DOM-shaped
// inputs INSIDE the sandbox realm so Object.getPrototypeOf in
// setInputValue resolves the value accessor (realm-consistent), and
// `metaFor` feeds getFieldMeta's controlled meta strings.
function contentSandbox({ metaFor = () => '' }) {
  const sandbox = {
    console: { warn() {}, log() {} },
    Event: class { constructor(type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles) } },
    HTMLInputElement: class {
      get value() { return this._value ?? '' }
      set value(v) { this._value = v }
    },
    HTMLTextAreaElement: class {
      get value() { return this._value ?? '' }
      set value(v) { this._value = v }
    },
    FIELD_TAXONOMY: { rareFields: [] },
    // getFieldMeta stub — the real one is a DOM walk (aria-label,
    // name/id/placeholder, <label for=…>, data-* hooks); for the
    // unit level we feed the meta string directly so the matching
    // logic is what's exercised.
    getFieldMeta(input) { return metaFor(input) },
    // collectInputs stub — the real one walks document.querySelectorAll;
    // every test overrides this right after construction with the exact
    // candidate list it wants the fill pass to walk.
    collectInputs() { return [] },
    paintField() {},
    __makeInput(opts) {
      const el = new sandbox.HTMLInputElement()
      el.tagName = String(opts.tagName || 'INPUT').toUpperCase()
      el.type = opts.type || ''
      el.name = opts.name || ''
      el.id = opts.id || ''
      el.form = opts.form || null
      el.options = opts.options || null
      el._attrs = opts.attrs || {}
      el.parentElement = opts.parentElement || null
      el.getAttribute = (k) => (
        Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null
      )
      el.dispatchEvent = () => {}
      el.addEventListener = () => {}
      return el
    },
  }
  vm.createContext(sandbox)
  // Dependency order matters — each snippet only references symbols
  // evaluated before it (or provided by the sandbox above).
  for (const key of ['normalizeMatchText', 'stopwords', 'fieldLabelKeywords', 'metaMatchesIndustryLabel', 'booleanGroupKey', 'setInputValue', 'fillRareFields']) {
    vm.runInContext(CONTENT_EXTRACTIONS[key][0], sandbox)
  }
  return sandbox
}

const RARE_TAXONOMY = [{ id: 'uppsagningstid', label: 'Uppsägningstid' }]

test('fillRareFields fills a text input whose meta matches the rare-field label', async () => {
  const sandbox = contentSandbox({ metaFor: () => 'Uppsägningstid — ange längd' })
  sandbox.FIELD_TAXONOMY = { rareFields: RARE_TAXONOMY }
  // Tag/type/name are passed through __makeInput options; the meta
  // string comes from the getFieldMeta stub (metaFor).
  const hostInput = sandbox.__makeInput({
    tagName: 'INPUT', type: 'text', name: 'notice_period',
    attrs: { placeholder: 'Uppsägningstid — ange längd' },
  })
  sandbox.collectInputs = () => [{ input: hostInput }]

  const filled = await sandbox.fillRareFields(
    { rareFields: { uppsagningstid: '2 veckor' } },
    new Set(),
  )
  assert.equal(filled, 1, 'the matching input must be filled')
  assert.equal(hostInput.value, '2 veckor', 'the saved answer must land in the input value')
})

test('fillRareFields never writes a free-text answer into a radio/checkbox group', async () => {
  const sandbox = contentSandbox({ metaFor: () => 'Uppsägningstid' })
  sandbox.FIELD_TAXONOMY = { rareFields: RARE_TAXONOMY }
  // A radio pair whose meta matches the label — the eligible-type gate
  // (tag INPUT + type radio ∉ [text,email,tel,url,search]) must skip it.
  const radio = sandbox.__makeInput({
    tagName: 'INPUT', type: 'radio', name: 'uppsagningstid', attrs: {},
  })
  sandbox.collectInputs = () => [{ input: radio }]

  const filled = await sandbox.fillRareFields(
    { rareFields: { uppsagningstid: '2 veckor' } },
    new Set(),
  )
  assert.equal(filled, 0, 'radios must never receive a rare free-text answer')
  assert.equal(radio.value, '', 'the radio value must stay untouched')
})

test('fillRareFields picks the matching <select> option for a rare answer', async () => {
  const sandbox = contentSandbox({ metaFor: () => 'Uppsägningstid' })
  sandbox.FIELD_TAXONOMY = { rareFields: RARE_TAXONOMY }
  // A <select> whose options carry text matching the saved answer.
  // __makeInput options are passed straight through — the SELECT
  // branch of setInputValue reads input.options (value/text pairs).
  const select = sandbox.__makeInput({
    tagName: 'SELECT', name: 'notice_period',
    options: [
      { value: '0', text: 'Ingen uppsägningstid' },
      { value: '14', text: '2 veckor' },
      { value: '30', text: '1 månad' },
    ],
    attrs: { name: 'notice_period' },
  })
  sandbox.collectInputs = () => [{ input: select }]

  const filled = await sandbox.fillRareFields(
    { rareFields: { uppsagningstid: '2 veckor' } },
    new Set(),
  )
  assert.equal(filled, 1, 'the <select> must be filled')
  assert.equal(select.value, '14', 'the option whose text contains the saved answer must be selected')
})

test('fillRareFields respects the shared handledBooleanGroups dedup set', async () => {
  const sandbox = contentSandbox({ metaFor: () => 'Uppsägningstid' })
  sandbox.FIELD_TAXONOMY = { rareFields: RARE_TAXONOMY }
  const input = sandbox.__makeInput({
    tagName: 'INPUT', type: 'text', name: 'uppsagningstid', attrs: {},
  })
  sandbox.collectInputs = () => [{ input }]
  // The boolean/industry fill passes already handled this question.
  const handled = new Set([sandbox.booleanGroupKey(input)])

  const filled = await sandbox.fillRareFields(
    { rareFields: { uppsagningstid: '2 veckor' } },
    handled,
  )
  assert.equal(filled, 0, 'an already-handled question must not be re-filled')
  assert.equal(input.value, '', 'the deduped input must stay untouched')
})

test('fillRareFields returns 0 for blank answers or a missing taxonomy', async () => {
  const sandbox = contentSandbox({ metaFor: () => 'Uppsägningstid' })
  sandbox.FIELD_TAXONOMY = { rareFields: RARE_TAXONOMY }
  const input = sandbox.__makeInput({
    tagName: 'INPUT', type: 'text', name: 'notice_period', attrs: {},
  })
  sandbox.collectInputs = () => [{ input }]

  // Blank / whitespace-only saved answers are filtered before matching.
  assert.equal(
    await sandbox.fillRareFields({ rareFields: { uppsagningstid: '   ' } }, new Set()),
    0,
    'whitespace-only answers must be skipped',
  )
  // No taxonomy bundle → no label map → no fill (fail-safe).
  sandbox.FIELD_TAXONOMY = undefined
  assert.equal(
    await sandbox.fillRareFields({ rareFields: { uppsagningstid: '2 veckor' } }, new Set()),
    0,
    'missing FIELD_TAXONOMY must degrade to a no-op, not throw',
  )
})

test('metaMatchesIndustryLabel: single distinctive keyword matches; stopwords-only does not', () => {
  const sandbox = contentSandbox({ metaFor: () => '' })
  assert.equal(
    sandbox.metaMatchesIndustryLabel('Uppsägningstid — ange längd', 'Uppsägningstid'),
    true,
    'one distinctive ≥4-char keyword must be enough (uppsägningstid)',
  )
  assert.equal(
    sandbox.metaMatchesIndustryLabel('Telefonnummer', 'Uppsägningstid'),
    false,
    'an unrelated meta must not match',
  )
  assert.equal(
    sandbox.metaMatchesIndustryLabel('Kan du arbeta?', 'Kan du arbeta?'),
    false,
    'a stopwords-only label must not self-match (arbeta/du/kan are all filtered)',
  )
})

// ---------- 3. popup.js sandbox (saveTier3Answers half) ----------

// Build a vm context covering everything saveTier3Answers touches:
// $ (DOM lookups), chrome.storage.local, activeTabUrl, loadStorage,
// resolveEnvAuthBaseUrl, assertOriginAllowed, fetchWithRetry and
// refreshProfile. `calls` captures every observable side effect so
// the tests can assert the exact payload shape + dismissal behaviour.
function popupSandbox({ answers = [], saveChecked = false, token = 'tok-1', ok = true }) {
  const calls = {
    fetch: [],
    storageSets: [],
    refreshCount: 0,
    warn: [],
  }
  const section = { hidden: false }
  const saveCheck = { checked: saveChecked }
  const answersBox = {
    querySelectorAll(sel) {
      if (sel !== '.jp-tier3-answer-input') return []
      return answers.map((a) => ({
        dataset: { rareId: a.id },
        value: a.value,
      }))
    },
  }
  const sandbox = {
    console: { warn(...args) { calls.warn.push(args) } },
    STORAGE_KEYS: { tier3Dismissed: 'jobbpiloten_tier3Dismissed' },
    $: (id) => ({
      'jp-tier3-answers': answersBox,
      'jp-tier3-save-check': saveCheck,
      'jp-tier3': section,
    }[id]),
    chrome: {
      storage: {
        local: { async set(obj) { calls.storageSets.push(obj) } },
      },
    },
    activeTabUrl: async () => 'https://job.example/ansokan/1',
    loadStorage: async () => ({ token }),
    resolveEnvAuthBaseUrl: async () => 'https://app.example',
    assertOriginAllowed: async () => {},
    fetchWithRetry: async (url, opts) => {
      calls.fetch.push({ url, opts })
      return {
        ok,
        async json() { return ok ? {} : { error: 'Något gick fel' } },
      }
    },
    refreshProfile: async () => { calls.refreshCount += 1 },
  }
  vm.createContext(sandbox)
  vm.runInContext(POPUP_EXTRACTIONS.saveTier3Answers[0], sandbox)
  return { sandbox, calls, section, saveCheck }
}

test('saveTier3Answers: checked + answers POSTs the exact rareFields payload', async () => {
  const { sandbox, calls, section } = popupSandbox({
    answers: [
      { id: 'uppsagningstid', value: '  2 veckor  ' },  // trimmed on the wire
      { id: 'standig_natt', value: 'Ja' },
      { id: 'referensperson', value: '' },              // empty → dropped
    ],
    saveChecked: true,
  })

  await sandbox.saveTier3Answers()

  assert.equal(calls.fetch.length, 1, 'exactly one POST must fire')
  assert.equal(calls.fetch[0].url, 'https://app.example/api/profile-update')
  assert.equal(calls.fetch[0].opts.method, 'POST')
  assert.match(calls.fetch[0].opts.headers.Authorization, /^Bearer tok-1$/)
  const body = JSON.parse(calls.fetch[0].opts.body)
  assert.deepEqual(
    body,
    { rareFields: { uppsagningstid: '2 veckor', standig_natt: 'Ja' } },
    'the payload must carry only non-empty, trimmed answers keyed by canonical id',
  )
  // On success: dismissal persisted + profile refreshed (so the popup
  // status + content-script autofill immediately treat them as answered).
  // JSON-normalise the captured writes: the objects are created inside
  // the vm realm, whose prototypes differ from the host realm, so
  // deepStrictEqual fails on prototype identity (same pattern as
  // extension-taxonomy-parity.test.mjs).
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.storageSets)),
    [{ jobbpiloten_tier3Dismissed: 'https://job.example/ansokan/1' }],
    'the page URL must be recorded as dismissed',
  )
  assert.equal(calls.refreshCount, 1, 'refreshProfile must run after a successful save')
  // Deliberately NOT hidden inline on the success path: the section
  // hide is delegated to the post-save re-render (refreshProfile →
  // status push → renderTier3Prompt), which filters the just-saved
  // fields out of `open` (open.length === 0 → hidden). Asserting
  // hidden===true here would pin the wrong contract.
  assert.equal(section.hidden, false, 'the hide is delegated to the refresh-driven re-render')
})

test('saveTier3Answers: unchecked checkbox behaves like Förstått (no POST)', async () => {
  const { sandbox, calls, section } = popupSandbox({
    answers: [{ id: 'uppsagningstid', value: '2 veckor' }],
    saveChecked: false,
  })

  await sandbox.saveTier3Answers()

  assert.equal(calls.fetch.length, 0, 'no POST may fire when the save checkbox is unchecked')
  assert.equal(
    calls.storageSets.length, 1,
    'the dismissal must still be recorded (prompt-once semantics)',
  )
  assert.equal(section.hidden, true)
})

test('saveTier3Answers: checked but nothing typed → dismiss without a POST', async () => {
  const { sandbox, calls, section } = popupSandbox({
    answers: [
      { id: 'uppsagningstid', value: '' },
      { id: 'standig_natt', value: '   ' },
    ],
    saveChecked: true,
  })

  await sandbox.saveTier3Answers()

  assert.equal(calls.fetch.length, 0, 'nothing to save → no POST')
  assert.equal(calls.storageSets.length, 1, 'dismissal recorded so the prompt does not re-nag')
  assert.equal(section.hidden, true)
})

test('saveTier3Answers: no bearer token → dismiss without a POST', async () => {
  const { sandbox, calls, section } = popupSandbox({
    answers: [{ id: 'uppsagningstid', value: '2 veckor' }],
    saveChecked: true,
    token: null,
  })

  await sandbox.saveTier3Answers()

  assert.equal(calls.fetch.length, 0, 'no token → nothing can be persisted server-side, no POST')
  assert.equal(calls.refreshCount, 0, 'refreshProfile must not run without a save')
  assert.equal(section.hidden, true, 'still dismissed so the prompt never re-nags')
})

test('saveTier3Answers: failed save still dismisses (never re-nags)', async () => {
  const { sandbox, calls, section } = popupSandbox({
    answers: [{ id: 'uppsagningstid', value: '2 veckor' }],
    saveChecked: true,
    ok: false,
  })

  await sandbox.saveTier3Answers()

  assert.equal(calls.fetch.length, 1, 'the POST attempt must fire')
  assert.equal(section.hidden, true, 'a failed save must still hide the prompt')
  assert.equal(calls.warn.length, 1, 'the failure must be logged, not thrown')
})
