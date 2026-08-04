// tests/unit/extension-popup-industry.test.mjs
//
// Round-82 — structural lock for the popup's tiered-taxonomy wiring.
//
// The popup renders three industry-aware surfaces:
//   1. Tier 1 "Universella fält" — always visible when connected
//      (name / email / phone / address / LinkedIn / CV summary /
//      cover letter), the fields EVERY application form asks for.
//   2. Tier 2 "Bransch & relevanta fält" — the Round-81 industry
//      selector + per-industry field list (existing, kept).
//   3. Tier 3 "Sällsynta frågor" — one-time prompt driven by
//      content.js's apply-time detection (jobbpiloten_tier3Seen).
//
// Chrome MV3 popup code cannot be imported as ESM (DOM + chrome.*
// surface), so — following the project's structural-lock convention
// (see popup-esm-parse / popup-handshake / extension-content) — this
// test pins the HTML/JS contracts by source inspection instead of
// runtime execution:
//   • popup.html carries the three sections with their data-testids
//   • popup.js renders Tier 1 from a UNIVERSAL_FIELDS list
//   • the selector persists BOTH the canonical `industry` key and the
//     legacy override key
//   • content.js writes the detection keys the popup reads
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const POPUP_HTML = readFileSync(resolve(ROOT, 'extension/popup.html'), 'utf8')
const POPUP_JS = readFileSync(resolve(ROOT, 'extension/popup.js'), 'utf8')
const CONTENT_JS = readFileSync(resolve(ROOT, 'extension/content.js'), 'utf8')

test('popup.html renders the Tier 1 universal fields section', () => {
  assert.match(POPUP_HTML, /id="jp-universal"/, 'Tier 1 section must have id jp-universal')
  assert.match(POPUP_HTML, /data-testid="jp-universal"/, 'Tier 1 section must be testid-locked')
  assert.match(POPUP_HTML, /id="jp-universal-list"/, 'Tier 1 section must render into jp-universal-list')
  assert.match(POPUP_HTML, /Universella fält/, 'Tier 1 section must be titled "Universella fält"')
})

test('popup.html renders the detected-industry chip + Tier 3 prompt', () => {
  assert.match(POPUP_HTML, /id="jp-industry-detect"/, 'detected-industry chip must exist')
  assert.match(POPUP_HTML, /data-testid="jp-industry-detect"/, 'detected-industry chip must be testid-locked')
  assert.match(POPUP_HTML, /id="jp-tier3"/, 'Tier 3 prompt section must exist')
  assert.match(POPUP_HTML, /data-testid="jp-tier3"/, 'Tier 3 prompt must be testid-locked')
  assert.match(POPUP_HTML, /id="jp-tier3-dismiss-btn"/, 'Tier 3 Förstått button must exist')
  assert.match(POPUP_HTML, /data-testid="jp-tier3-dismiss"/, 'Tier 3 dismiss button must be testid-locked')
})

test('popup.html renders the Tier-3 save UI (Round-84 answer capture)', () => {
  assert.match(POPUP_HTML, /id="jp-tier3-answers"/, 'Tier 3 per-field answer container must exist')
  assert.match(POPUP_HTML, /id="jp-tier3-save-check"/, 'Tier 3 save checkbox must exist')
  assert.match(POPUP_HTML, /data-testid="jp-tier3-save-check"/, 'Tier 3 save checkbox must be testid-locked')
  assert.match(POPUP_HTML, /id="jp-tier3-save-btn"/, 'Tier 3 save button must exist')
  assert.match(POPUP_HTML, /data-testid="jp-tier3-save"/, 'Tier 3 save button must be testid-locked')
  assert.match(POPUP_HTML, /Spara svar för framtida ansökningar/, 'Tier 3 save row must be labelled')
})

test('popup.js renders Tier 1 from a UNIVERSAL_FIELDS list covering all 7 universal keys', () => {
  assert.match(POPUP_JS, /const UNIVERSAL_FIELDS = \[/, 'Tier 1 list must be a UNIVERSAL_FIELDS constant')
  for (const key of ['fullName', 'email', 'phone', 'address', 'linkedin', 'cvSummary', 'latestCoverLetter']) {
    assert.match(POPUP_JS, new RegExp(`key: '${key}'`), `UNIVERSAL_FIELDS must include ${key}`)
  }
  assert.match(POPUP_JS, /function renderUniversalFields\(profile\)/, 'renderUniversalFields must exist')
  assert.match(
    POPUP_JS,
    /renderUniversalFields\(profile\)\s*\n\s*renderIndustryPanel\(profile\)/,
    'setStatus must render Tier 1 before the industry panel on the connected branch',
  )
})

test('popup.js persists the canonical industry storage key + legacy override', () => {
  assert.match(POPUP_JS, /industry: 'industry'/, 'STORAGE_KEYS must carry the canonical `industry` key')
  assert.match(
    POPUP_JS,
    /\[STORAGE_KEYS\.industry\]: select\.value,\s*\n\s*\[STORAGE_KEYS\.industryOverride\]: select\.value/,
    'the selector change handler must write BOTH the canonical industry key and the legacy override',
  )
  assert.match(
    POPUP_JS,
    /const canon = data && data\[STORAGE_KEYS\.industry\]/,
    'renderIndustryPanel must read the canonical industry key first',
  )
})

test('popup.js reads the content-script detection keys for the chip + Tier 3 prompt', () => {
  assert.match(POPUP_JS, /pageIndustry: 'jobbpiloten_pageIndustry'/, 'popup STORAGE_KEYS must carry pageIndustry')
  assert.match(POPUP_JS, /tier3Seen: 'jobbpiloten_tier3Seen'/, 'popup STORAGE_KEYS must carry tier3Seen')
  assert.match(POPUP_JS, /tier3Dismissed: 'jobbpiloten_tier3Dismissed'/, 'popup STORAGE_KEYS must carry tier3Dismissed')
  assert.match(POPUP_JS, /function renderDetectedIndustry\(\)/, 'renderDetectedIndustry must exist')
  assert.match(POPUP_JS, /function renderTier3Prompt\(/, 'renderTier3Prompt must exist')
})

test('content.js detection keys stay byte-aligned with the popup', () => {
  assert.match(CONTENT_JS, /pageIndustry: 'jobbpiloten_pageIndustry'/, 'content STORAGE_KEYS must carry pageIndustry')
  assert.match(CONTENT_JS, /tier3Seen: 'jobbpiloten_tier3Seen'/, 'content STORAGE_KEYS must carry tier3Seen')
  assert.match(CONTENT_JS, /function detectPageIndustry\(\)/, 'detectPageIndustry must exist')
  assert.match(CONTENT_JS, /function detectTier3Fields\(\)/, 'detectTier3Fields must exist')
  assert.match(CONTENT_JS, /function reportPageContext\(\)/, 'reportPageContext must exist')
})

test('popup.js Tier-3 save flow locks (Round-84)', () => {
  assert.match(POPUP_JS, /function normaliseTier3Seen\(seen\)/, 'normaliseTier3Seen must exist')
  assert.match(POPUP_JS, /async function renderTier3Prompt\(profile\)/, 'renderTier3Prompt must take the profile')
  assert.match(POPUP_JS, /function saveTier3Answers\(\)/, 'saveTier3Answers must exist')
  assert.match(POPUP_JS, /\/api\/profile-update/, 'Tier 3 save must POST to /api/profile-update')
  assert.match(POPUP_JS, /rareFields/, 'Tier 3 save must carry the rareFields payload')
  assert.match(POPUP_JS, /input\.dataset\.testid = 'jp-tier3-answer-' \+ s\.id/, 'Tier 3 answer inputs must be keyed by canonical id')
  assert.match(POPUP_JS, /savedRare\[s\.id\]/, 'renderTier3Prompt must filter already-answered rare fields')
})

test('content.js Tier-3 rare-field autofill + canonical ids (Round-84)', () => {
  assert.match(CONTENT_JS, /function fillRareFields\(profile, handledBooleanGroups\)/, 'fillRareFields must exist')
  assert.match(CONTENT_JS, /filled \+= await fillRareFields\(profile, handledBooleanGroups\)/, 'fillAll must call fillRareFields after the industry fill')
  assert.match(CONTENT_JS, /id: 'standig_natt'/, 'TIER3_KEYWORDS must carry the standig_natt canonical id')
  assert.match(CONTENT_JS, /id: 'uppsagningstid'/, 'TIER3_KEYWORDS must carry the uppsagningstid canonical id')
  assert.match(CONTENT_JS, /hits\.push\(\{ id: rule\.id, label: rule\.label \}\)/, 'detectTier3Fields must return { id, label } objects')
})

test('popup.js universal list covers the complete schema projection (Round-83)', () => {
  // The Round-82 7 keys stay, plus Postnummer/Stad/Tillgänglighet/Löneanspråk.
  for (const key of ['fullName', 'email', 'phone', 'address', 'linkedin', 'cvSummary', 'latestCoverLetter', 'zip', 'city', 'answers.availability', 'salaryExpectation']) {
    assert.match(POPUP_JS, new RegExp(`key: '${key}'`), `UNIVERSAL_FIELDS must include ${key}`)
  }
  assert.match(
    POPUP_JS,
    /function resolveProfileKey\(profile, key\)/,
    'renderUniversalFields must resolve nested keys (answers.availability) via resolveProfileKey',
  )
  assert.match(
    POPUP_JS,
    /resolveProfileKey\(profile, f\.key\)/,
    'renderUniversalFields must read values via resolveProfileKey',
  )
})

test('popup.js renders the structured industry field set with value status (Round-83)', () => {
  assert.match(
    POPUP_JS,
    /\(tx\.structuredFields && tx\.structuredFields\[effective\]\)/,
    'renderIndustryPanel must prefer the structuredFields set for the selected industry',
  )
  assert.match(
    POPUP_JS,
    /profile\.industryFields\[effective\]/,
    'renderIndustryPanel must read stored answers from profile.industryFields[effective]',
  )
  assert.match(
    POPUP_JS,
    /\(tx\.structuredToBoolean && tx\.structuredToBoolean\[fieldId\]\)/,
    'renderIndustryPanel must fall back to the legacy boolean via structuredToBoolean',
  )
})

test('content.js wires the Round-83 targeted industry-field fill into fillAll', () => {
  assert.match(CONTENT_JS, /function fillDetectedIndustryFields\(profile, handledBooleanGroups\)/, 'fillDetectedIndustryFields must exist')
  assert.match(CONTENT_JS, /function metaMatchesIndustryLabel\(meta, label\)/, 'the label matcher must exist')
  assert.match(CONTENT_JS, /function fieldLabelKeywords\(label\)/, 'the keyword extractor must exist')
  assert.match(
    CONTENT_JS,
    /filled \+= await fillDetectedIndustryFields\(profile, handledBooleanGroups\)/,
    'fillAll must call the targeted industry fill after the FIELD_PATTERNS loop',
  )
  assert.match(
    CONTENT_JS,
    /handledBooleanGroups\.has\(booleanGroupKey\(input\)\)/,
    'the targeted fill must respect the shared handledBooleanGroups dedup set (no double-clicks)',
  )
  assert.match(
    CONTENT_JS,
    /globalThis\.FIELD_TAXONOMY/,
    'the targeted fill must read the structured taxonomy from globalThis.FIELD_TAXONOMY',
  )
})

test('content.js detection covers all 9 industries and is wired into the scan', () => {
  for (const id of ['lager', 'vård', 'kontor', 'IT', 'bygg', 'restaurang', 'sälj', 'industri', 'transport']) {
    assert.match(CONTENT_JS, new RegExp(`^\\s{2}${id === 'vård' || id === 'sälj' ? `'${id}'` : id}: \\{`, 'm'),
      `INDUSTRY_KEYWORDS must carry the ${id} industry`)
  }
  assert.match(
    CONTENT_JS,
    /reportPageContext\(\)/,
    'scanAndPaint must call reportPageContext so detection runs on the scan cadence',
  )
})
