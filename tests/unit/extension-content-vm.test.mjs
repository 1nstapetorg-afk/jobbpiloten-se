// tests/unit/extension-content-vm.test.mjs
//
// Round-46 — vm-based behavioral smoke test for the style-override
// wiring fixed in Round-44.
//
// BACKGROUND: the popup's "Skrivstil för detta svar" <select>
// writes `jobbpiloten_styleOverride` to chrome.storage.local. The
// content script's fetchAIAnswers / fetchBatchAIAnswers both
// receive a `styleOverride` argument and conditionally attach
// `style: overrideStyle` to the request body. Round-44 added 3
// STATIC-grep regression locks (regex over the source) to prevent
// a syntactic drop of the assignment. This file adds a
// BEHAVIORAL test that proves the wiring ASSEMBLES the body
// correctly at runtime — a regex test would not catch a typo in
// the variable name, a forgotten `String(...).trim()`, or a
// refactor that'd drop the conditional while keeping the literal.
//
// STRATEGY: rather than loading the entire content.js (which has
// aggressive DOM side-effects at parse time and can't run in
// node --test), we:
//   1. extract fetchAIAnswers + fetchBatchAIAnswers via anchored
//      regex from the source
//   2. background-compile the extracted blocks inside a bare
//      vm sandbox with just enough chrome.* / fetch / DOM stubs
//      to satisfy the body-construction code
//   3. invoke the helpers with synthetic inputs
//   4. spy on `fetch` to capture what would be POSTed
//   5. assert the captured body has / doesn't have the style
//      field as expected
//
// Edge-case coverage:
//   * styleOverride = 'lagom'         → body.style === 'lagom'
//   * styleOverride = ''              → body.style === undefined
//                                       (omitted entirely so Zod's
//                                       optional+min(1) doesn't
//                                       reject)
//   * styleOverride = '   ' (trim)    → body.style === undefined
//                                       (whitespace-only override
//                                       is treated as cleared)
//
// The test file does NOT require vm2, vitest, or any extra deps.
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.resolve(__dirname, '../../extension/content.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf-8')

// ---------- 1. Extract the two functions via anchored regex ----------
//
// Anchoring on the function-declaration line + the matching
// 0-indent closing brace keeps the extraction robust against
// whitespace drift (Prettier) but the regex WILL fail loudly if
// either function is renamed. The 'm' flag (`^`/`$` match line
// boundaries) lets us anchor on the 0-indent close brace 'at the
// start of a line' — fetching the function body up to the first
// such brace.
//
// Why we can't use `function fnName(...)` alone: the regex would
// greedily match across the entire rest of the file (no `}`
// anchor). Anchoring on `^}` (the close-brace MUST be at line
// start, i.e. 0-indent) bounds the match to the function body.
//
// Round-46 code-reviewer #2 follow-up: the signature-shape
// destructured-parameter ORDER (e.g. `{ token, queue, styleOverride }`)
// is pinned by tests at the BOTTOM of this file. A future
// refactor that introduced an unused-first-arg shape
// (`(_, { token, queue, styleOverride })`) would still extract
// here (because `[^)]*` matches any single-level paren group)
// but the BEHAVIOURAL tests below would fail at runtime with a
// clear error. The bottom signature-grep tests are the catching
// net, and they'd fire before the runtime errors became
// user-visible.

const AI_RX = /^async function fetchAIAnswers\([^)]*\)\s*\{[\s\S]+?^\}/m
const BATCH_RX = /^async function fetchBatchAIAnswers\([^)]*\)\s*\{[\s\S]+?^\}/m

const aiMatch = SOURCE.match(AI_RX)
const batchMatch = SOURCE.match(BATCH_RX)

test('extraction: the source-grep regex must locate fetchAIAnswers', () => {
  // If a refactor renames the function, this assertion fires.
  // The vm-test downstream would silently extract nothing
  // useful and the behavioral assertions would all pass for
  // the wrong reason — this guard prevents that.
  assert.ok(aiMatch,
    'fetchAIAnswers regex failed — the function was renamed or its `^async function fetchAIAnswers(` declaration changed. Update both the regex AND the vm test together.')
})
test('extraction: the source-grep regex must locate fetchBatchAIAnswers', () => {
  assert.ok(batchMatch,
    'fetchBatchAIAnswers regex failed — same drift-warning as fetchAIAnswers above.')
})

// ---------- 2. Build the minimal sandbox ----------
//
// Anything the extracted code touches has to be present. The
// extracted bodies call:
//   - fetch(url, opts)                     → mocked
//   - JSON.stringify                       → built-in
//   - AbortController / setTimeout         → injected from Node
//   - PROMO_BASE_URL constant              → mocked
//   - PROD_ALLOWED_ORIGINS for assertOrigin → not needed, stub
//   - setInputValue(obj, str)              → stub returning true
//   - paintField / paintAsAiGenerated      → stub
//   - showToast                            → stub
//   - getFieldMeta(obj)                    → stub
//   - AI_FETCH_TIMEOUT_MS                  → injected (small)
//   - assertOriginAllowed(url)             → stub

const sandbox = {
  // Node primitives — vm sandboxes start empty; Promise + global
  // types must be passed in explicitly.
  Promise,
  AbortController: globalThis.AbortController,
  setTimeout,
  clearTimeout,
  // Round-46 code-reviewer #1: lowered from 10ms to 1ms so the
  // AbortController abort-path fires effectively instantly on
  // CI runners. The behavioural tests below don't depend on the
  // abort handler actually firing (the fetch spy resolves before
  // the timer can race) — the production constant is 6000ms, we
  // shrink it for speed, not for behavioural fidelity.
  AI_FETCH_TIMEOUT_MS: 1,
  PROD_BASE_URL: 'https://jobbpiloten.se',
  PROD_ALLOWED_ORIGINS: ['https://jobbpiloten.se'],
  // Captured fetch — set on every call so the test reads opts.body
  // back to verify what the body contained. We treat `_lastFetch`
  // as a "spy": the stub overwrites it on every call.
  _lastFetch: null,
  fetch: async function fetchSpy(_url, opts) {
    sandbox._lastFetch = opts
    // Object spread — the production code reads .ok + .json().
    return {
      ok: true,
      status: 200,
      json: async () => ({
        answer: 'mock AI answer for round-trip',
        answers: { custom: { answer: 'mock', source: 'groq' } },
      }),
    }
  },
  // Helpers the extracted code calls after fetch resolves.
  assertOriginAllowed: (_url) => true, // origin OK
  getFieldMeta: () => 'mock label',
  setInputValue: () => true,
  paintField: () => {},
  paintAsAiGenerated: () => {},
  showToast: () => {},
}
const ctx = vm.createContext(sandbox)

// Wrap the extracted function bodies inside an IIFE so we can
// surface the inner helpers as named exports. The trailing return
// object is the contract with the caller — if either function
// gets renamed, the assignment `fetchAIAnswers = …` would throw
// at run-time and the test fails loudly.
const code = `
(() => {
  ${aiMatch ? aiMatch[0] : '/* fetchAIAnswers missing — fails next line */ throw new Error("fetchAIAnswers extraction failed")'}
  ${batchMatch ? batchMatch[0] : '/* fetchBatchAIAnswers missing */ throw new Error("fetchBatchAIAnswers extraction failed")'}
  return { fetchAIAnswers, fetchBatchAIAnswers };
})()
`

const helpers = vm.runInNewContext(code, ctx)
const { fetchAIAnswers, fetchBatchAIAnswers } = helpers

// ---------- 3. Behavioral smoke tests ----------

test('fetchAIAnswers: styleOverride="lagom" is attached as body.style (Round-46 positive case)', async () => {
  sandbox._lastFetch = null
  await fetchAIAnswers({
    token: 'tkt-123',
    queue: [{ input: { tagName: 'TEXTAREA' }, field: 'whyThisCompany' }],
    styleOverride: 'lagom',
  })
  assert.ok(sandbox._lastFetch, 'fetch was not invoked — insertion bug')
  const body = JSON.parse(sandbox._lastFetch.body)
  assert.equal(body.style, 'lagom',
    'styleOverride="lagom" must land in request body.style so the server-applied getStyleBlock() picks it up')
  assert.equal(body.field, 'whyThisCompany')
  assert.ok(body.question && body.question.length > 0,
    'body.question must be present (sliced to ≤ 1500 chars; from stub getFieldMeta)')
})

test('fetchAIAnswers: empty styleOverride must NOT attach body.style (Round-46 negative case)', async () => {
  // Bug scenario: a careless refactor that always sets
  // `body.style = styleOverride` would send `style: ''` and
  // fail Zod's `z.string().min(1).max(64).optional()` (the
  // min(1) requirement rejects empty strings even when the
  // field is optional and absent). The Round-44 fix gates the
  // assignment on a truthy value; this test enforces that
  // gate at runtime.
  sandbox._lastFetch = null
  await fetchAIAnswers({
    token: 'tkt-123',
    queue: [{ input: { tagName: 'TEXTAREA' }, field: 'whyThisCompany' }],
    styleOverride: '',
  })
  assert.ok(sandbox._lastFetch, 'fetch was not invoked')
  const body = JSON.parse(sandbox._lastFetch.body)
  assert.equal(body.style, undefined,
    'empty styleOverride must omit body.style entirely (Zod min(1) would reject a literal "")')
  assert.equal(body.field, 'whyThisCompany')
})

test('fetchAIAnswers: whitespace-only styleOverride must be treated as cleared (Round-46 trim coverage)', async () => {
  // The popup's "Standardstil återställd" branch writes ''. A
  // future bug that called setStorage without the trim in the
  // reader side would leak '   ' down here. Defence in depth:
  // the content-script reader ALSO trims (`String(...).trim()`),
  // so a downstream whitespace-only string is impossible — but
  // a defensive test confirms the trim works.
  sandbox._lastFetch = null
  await fetchAIAnswers({
    token: 'tkt-123',
    queue: [{ input: { tagName: 'TEXTAREA' }, field: 'whyThisCompany' }],
    styleOverride: '   ',
  })
  const body = JSON.parse(sandbox._lastFetch.body)
  assert.equal(body.style, undefined,
    'whitespace-only styleOverride must NOT appear in body.style (String(...).trim() guard)')
})

test('fetchBatchAIAnswers: styleOverride="proffsig" is attached as payload.style (Round-46 positive case)', async () => {
  sandbox._lastFetch = null
  await fetchBatchAIAnswers({
    token: 'tkt-123',
    queue: [{ input: {}, id: 'custom', label: 'mock label', lang: 'sv' }],
    styleOverride: 'proffsig',
  })
  assert.ok(sandbox._lastFetch)
  const body = JSON.parse(sandbox._lastFetch.body)
  assert.equal(body.style, 'proffsig',
    'batch endpoint: styleOverride must land in payload.style so the server applies it to every per-field answer')
  assert.ok(Array.isArray(body.fields))
  assert.equal(body.fields.length, 1)
  assert.equal(body.fields[0].id, 'custom')
})

test('fetchBatchAIAnswers: empty styleOverride must NOT attach payload.style (Round-46 negative case)', async () => {
  sandbox._lastFetch = null
  await fetchBatchAIAnswers({
    token: 'tkt-123',
    queue: [{ input: {}, id: 'custom', label: 'mock label', lang: 'sv' }],
    styleOverride: '',
  })
  const body = JSON.parse(sandbox._lastFetch.body)
  assert.equal(body.style, undefined,
    'empty styleOverride must omit payload.style entirely (Zod min(1) rejection)')
})

test('fetchBatchAIAnswers: lang heuristic keeps batch in Swedish when no EN-flagged field is present', async () => {
  // A regression in `queue.some(...)` would flip the language
  // flag for the whole batch — a single EN field should mark
  // the whole batch as English (heuristic). Empty batch / no
  // EN flag = Swedish (matching soft-launch market).
  sandbox._lastFetch = null
  await fetchBatchAIAnswers({
    token: 'tkt-123',
    queue: [
      { input: {}, id: 'a', label: 'l', lang: 'sv' },
      { input: {}, id: 'b', label: 'l', lang: 'sv' },
    ],
    styleOverride: '',
  })
  const body = JSON.parse(sandbox._lastFetch.body)
  assert.equal(body.lang, 'sv')
})

test('fetchBatchAIAnswers: lang heuristic flips to English when any field is EN', async () => {
  sandbox._lastFetch = null
  await fetchBatchAIAnswers({
    token: 'tkt-123',
    queue: [
      { input: {}, id: 'a', label: 'l', lang: 'sv' },
      { input: {}, id: 'b', label: 'l', lang: 'en' }, // EN-flagged field
    ],
    styleOverride: '',
  })
  const body = JSON.parse(sandbox._lastFetch.body)
  assert.equal(body.lang, 'en',
    'at least one EN-flagged field must flip the entire batch to English')
})

// ---------- 4. Signature-shape grep locks ----------
//
// Anchored regex pinning the destructured-parameter-order for
// both fetch helpers. A refactor that introduced an
// unused-first-arg shape (e.g. `(_, { token, queue,
// styleOverride })`) would fail both this test AND the
// behavioural tests above. The behavioural assertions catch
// the runtime symptom; this test catches the source-level
// regression with a clearer failure message before any code
// runs.

test('fetchAIAnswers signature must accept styleOverride (Round-46 signature lock)', () => {
  // The 3rd parameter is `$0`-style "styleOverride" — a typo
  // would change either the name or the ordering (keeping the
  // arg as `style` or re-ordering to `{ queue, token, ... }`)
  // and would cause the Round-44 fillAll() destructuring to
  // silently pass `undefined`.
  assert.ok(/async\s+function\s+fetchAIAnswers\s*\(\s*\{\s*token\s*,\s*queue\s*,\s*styleOverride\s*\}/.test(SOURCE),
    'fetchAIAnswers must accept `{ token, queue, styleOverride }` so fillAll() can thread the override through')
})

test('fetchBatchAIAnswers signature must accept styleOverride (Round-46 signature lock)', () => {
  assert.ok(/async\s+function\s+fetchBatchAIAnswers\s*\(\s*\{\s*token\s*,\s*queue\s*,\s*styleOverride\s*\}/.test(SOURCE),
    'fetchBatchAIAnswers must accept `{ token, queue, styleOverride }`')
})
