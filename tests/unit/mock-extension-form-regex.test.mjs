// tests/unit/mock-extension-form-regex.test.mjs
//
// Round-12 — validator that reads /app/mock-extension-form.html and
// /extension/content.js, extracts every FIELD_PATTERNS entry via an
// anchored regex, and asserts each mock field's meta routes to the
// expected pattern.
//
// Strategy: PURE REGEX extraction (no vm sandbox) keeps the test
// hermetic — the validator only needs the regex literal from each
// entry, which it rebuilds via `new RegExp(body, 'i')` from the
// source. The pattern list itself is locked by
// tests/unit/extension-content.test.mjs#count-exactly-39, so a new
// pattern automatically extends this validator's expected behaviour.
//
// Run via `yarn test:unit`. The 4 tests cover:
//   (1) the FIELD_PATTERNS extraction itself
//   (2) mock HTML field inventory
//   (3) end-to-end pattern routing (the load-bearing test)
//   (4) boolean + select + multiselect + consent coverage

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_PATH = path.resolve(__dirname, '../../extension/content.js')
const MOCK_PATH = path.resolve(__dirname, '../../app/mock-extension-form.html')
const CONTENT = fs.readFileSync(CONTENT_PATH, 'utf-8')
const MOCK = fs.readFileSync(MOCK_PATH, 'utf-8')

// ----------------------------------------------------------------------
// 1. Extract every FIELD_PATTERNS entry as { regexSource, profileKey }
// ----------------------------------------------------------------------
//
// Anchor on `pattern:` and capture until newline. Every entry is on a
// single line (locked by tests/unit/extension-content.test.mjs's
// findEntryPatternLiteral + the Round-12 count lock), so a regex over
// the rest of the line suffices. The `profileKey: 'X'` capture locks
// the entry route; the regex body is rebuilt via `new RegExp(body, 'i')`.
// Entries are single-line (locked by tests/unit/extension-content.test.mjs#count-exactly-39)
// but the property order is not constant: file entries have
// `{ pattern: /…/i, type: 'file', profileKey: 'cvFile' }` while text
// entries have `{ pattern: /…/i, profileKey: 'firstName' }`. The regex
// makes `type:` optional so both shapes route correctly.
const ENTRY_RX = /\bpattern:\s*(\/[^\n]+\/i)\s*,(?:\s*type:\s*'[^']+'\s*,)?\s*profileKey:\s*'([^']+)'/g
const entries = []
{
  let m
  while ((m = ENTRY_RX.exec(CONTENT)) !== null) {
    entries.push({ regexSource: m[1], profileKey: m[2] })
  }
}

test('(1) validator extracts exactly 41 FIELD_PATTERNS entries from content.js', () => {
  assert.equal(entries.length, 41, `expected 42 entries; got ${entries.length}. The Round-46 count lock lives here — splits: address split into 4 sub-patterns (gata + gatuadress + street + simple-street + city-närhet-rejection) per the Monday Bug-2 fix; zip and city use the existing projiect pattern. If this fails, the content.js #FIELD_PATTERNS table moved.`)
})

// ----------------------------------------------------------------------
// 2. Extract each mock field's expectedKey + meta text
// ----------------------------------------------------------------------
//
// Mimic getFieldMeta's heuristic: each <fieldset data-jobbpiloten-
// mock-field="X"> has a <legend>Y</legend> with the question text Y;
// the validator uses Y as the meta string. For file inputs (which
// don't live inside fieldsets), the validator matches the data attr
// against a sibling <label>'s text — sufficient because the mock
// uses `<label for="X"><strong>…</strong></label>` form with the
// matching `<input type="file" data-jobbpiloten-mock-field="X">`.
function extractMockFields(html) {
  const out = []
  const fieldsetRx = /<fieldset[^>]*data-jobbpiloten-mock-field="([^"]+)"[^>]*>([\s\S]*?)<\/fieldset>/g
  let m
  while ((m = fieldsetRx.exec(html)) !== null) {
    const expectedKey = m[1]
    const inner = m[2]
    const legend = inner.match(/<legend>([\s\S]*?)<\/legend>/)
    out.push({ expectedKey, meta: legend ? legend[1].trim() : '' })
  }
  // File inputs live in <label>…</label><input type="file"> pairs.
  // File inputs live OUTSIDE <fieldset>s in this mock. Strip all
  // fieldset blocks before running labelRx so the regex can't span
  // across </fieldset> boundaries (the non-greedy [\s\S]*? would
  // otherwise match a label in one fieldset with an input in
  // another, e.g. Födelseår: → <input type=file cv>).
  const htmlNoFieldsets = html.replace(/<fieldset[\s\S]*?<\/fieldset>/g, '')
  const labelRx = /<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>\s*<input\b([^>]*)>/g
  while ((m = labelRx.exec(htmlNoFieldsets)) !== null) {
    const attrs = m[3]
    const dfMatch = attrs.match(/data-jobbpiloten-mock-field="([^"]+)"/)
    if (!dfMatch) continue
    if (!/type="file"/.test(attrs)) continue
    out.push({ expectedKey: dfMatch[1], meta: m[2].replace(/<[^>]+>/g, '').trim() })
  }
  return out
}

const mockFields = extractMockFields(MOCK)

test('(2) mock HTML exposes one example per Round-12 field type', () => {
  // 11 boolean + 4 select + 1 multiselect + 1 consent + 3 file = 20 fields.
  const expectedKeys = [
    'hasDriversLicense', 'isEuCitizen', 'hasWorkPermit', 'yearsExperience',
    'hasHighSchoolDiploma', 'hasForkliftLicense', 'hasSecurityClearance',
    'hasLeadershipExperience', 'isBilingual', 'hasTechnicalEducation',
    'hasCustomerExperience',
    'dateOfBirth', 'gender', 'nationality', 'phoneCountryCode',
    'skills', 'autoConsent',
    'cvFile', 'coverLetterFile', 'additionalDocuments',
  ]
  for (const key of expectedKeys) {
    assert.ok(
      mockFields.some((f) => f.expectedKey === key),
      `mock HTML must include a field with data-jobbpiloten-mock-field="${key}"`,
    )
  }
  assert.equal(mockFields.length, expectedKeys.length,
    `mock HTML should have exactly ${expectedKeys.length} mock fields; found ${mockFields.length}`)
})

// ----------------------------------------------------------------------
// 3. End-to-end pattern routing (the load-bearing assertion)
// ----------------------------------------------------------------------
//
// For every mock field, the validator runs ALL 39 patterns against its
// meta string and asserts:
//   (a) the expected pattern's regex matches the meta
//   (b) the matched-set size is bounded (a safety bound against the
//       over-permissive alternations like "i have experience with"
//       shadowing unrelated fields). cap is 3 — covers legitimate
//       cross-cutting phrases like "X years of experience leading a
//       team" (yearsExperience + hasLeadershipExperience) without
//       flagging realistic pages as broken.
test('(3) each mock field matches its expected FIELD_PATTERNS profileKey (regex routing)', () => {
  const failures = []
  for (const f of mockFields) {
    const matching = []
    for (const e of entries) {
      try {
        const body = e.regexSource.slice(1, -2) // strip leading `/` + trailing `/i`
        const re = new RegExp(body, 'i')
        if (re.test(f.meta)) matching.push(e.profileKey)
      } catch (_) { /* defensive only */ }
    }
    if (!matching.includes(f.expectedKey)) {
      failures.push(`${f.expectedKey} (meta: "${f.meta.slice(0, 60)}") — expected pattern NOT in matched set: [${matching.join(', ')}]`)
    }
    if (matching.length > 3) {
      failures.push(`${f.expectedKey} — over-match (${matching.length} patterns matched): [${matching.join(', ')}]`)
    }
  }
  assert.equal(
    failures.length,
    0,
    `Mock field routing failures (${failures.length}):\n` + failures.join('\n'),
  )
})

// ----------------------------------------------------------------------
// 4. Detailed per-priority coverage
// ----------------------------------------------------------------------

test('(4a) every Round-12 boolean pattern has a mock example', () => {
  const booleanKeys = [
    'hasDriversLicense', 'isEuCitizen', 'hasWorkPermit', 'yearsExperience',
    'hasHighSchoolDiploma', 'hasForkliftLicense', 'hasSecurityClearance',
    'hasLeadershipExperience', 'isBilingual', 'hasTechnicalEducation',
    'hasCustomerExperience',
  ]
  for (const key of booleanKeys) {
    const entry = entries.find((e) => e.profileKey === key)
    assert.ok(entry, `boolean pattern ${key} missing from content.js FIELD_PATTERNS`)
    assert.ok(mockFields.some((f) => f.expectedKey === key),
      `boolean pattern ${key} has no mock example in /app/mock-extension-form.html`)
  }
})

test('(4b) consent pattern has a real Swedish / English GDPR label in the mock', () => {
  const consent = mockFields.find((f) => f.expectedKey === 'autoConsent')
  assert.ok(consent, 'autoConsent mock field missing')
  // The pattern requires Swedish "jag har läst" / "godkänner" or
  // English "i have read" + "agree" wording — verify the mock meta
  // actually contains those tokens.
  assert.ok(
    /(jag har läst|har läst och godkänner|i have read)/i.test(consent.meta),
    `autoConsent meta must include Swedish "jag har läst" or English "I have read" wording; got "${consent.meta}"`,
  )
})

test('(4c) multi-select checklist mock contains 5+ skill checkboxes', () => {
  const skills = mockFields.find((f) => f.expectedKey === 'skills')
  assert.ok(skills, 'skills mock field missing')
  assert.ok(/jag har erfarenhet av/i.test(skills.meta),
    `skills meta must contain "jag har erfarenhet av"; got "${skills.meta}"`)
  // Count the checkboxes inside the skills fieldset
  const block = MOCK.match(/data-jobbpiloten-mock-field="skills"[\s\S]*?<\/fieldset>/m)
  if (block) {
    const count = (block[0].match(/<input[^>]*type="checkbox"/g) || []).length
    assert.ok(count >= 5, `skills mock must contain 5+ checkboxes; found ${count}`)
  }
})

