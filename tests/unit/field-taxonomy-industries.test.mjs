// tests/unit/field-taxonomy-industries.test.mjs
//
// Round-82 — direct unit test of lib/field-taxonomy.js's per-industry
// field projection (the tiered-taxonomy wiring). Complements
// tests/unit/extension-taxonomy-parity.test.mjs (which locks the
// app-side source of truth against the extension's bundled copy) by
// asserting the CONTRACT the onboarding step + settings page + API
// route + popup all rely on:
//
//   1. Exactly 9 canonical industries, ids stable + display order stable
//   2. Every industry exposes a Tier 2 (industry-core) field set, and
//      every field key has a Swedish label
//   3. Every field key is either an INDUSTRY_BOOLEAN_KEYS key or a
//      base ROUND12 key (hasDriversLicense / hasForkliftLicense /
//      hasCustomerExperience / hasHighSchoolDiploma /
//      hasTechnicalEducation / isBilingual) — so the API route's
//      validation loop can coerce every key it receives
//   4. fieldsForIndustry() honours the empty/unknown industry case
//   5. INDUSTRY_BOOLEAN_KEYS and INDUSTRY_BOOLEAN_LABELS agree 1:1
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INDUSTRIES,
  INDUSTRY_IDS,
  INDUSTRY_LABELS,
  INDUSTRY_BOOLEAN_KEYS,
  INDUSTRY_BOOLEAN_LABELS,
  INDUSTRY_FIELDS,
  fieldsForIndustry,
  UNIVERSAL_FIELDS,
  INDUSTRY_STRUCTURED_FIELDS,
  STRUCTURED_TO_BOOLEAN,
  structuredFieldsFor,
  sanitizeIndustryFields,
  industryFieldsToBooleans,
  structuredAnswerToBoolean,
  RARE_FIELDS,
  RARE_FIELD_LABELS,
  sanitizeRareFields,
} from '../../lib/field-taxonomy.js'
import { ROUND12_BOOLEAN_KEYS } from '../../lib/extension-profile-fields.js'

// Base Round-12 keys that also appear in per-industry sets (they are
// NOT in INDUSTRY_BOOLEAN_KEYS — they predate the taxonomy and live
// in lib/extension-profile-fields.js). Kept inline so this test
// documents the full allowed-key universe without importing the
// Round-12 module (the parity test already imports it).
const BASE_ROUND12_KEYS = [
  'hasDriversLicense',
  'hasForkliftLicense',
  'hasCustomerExperience',
  'hasHighSchoolDiploma',
  'hasTechnicalEducation',
  'isBilingual',
]

const EXPECTED_IDS = ['lager', 'vård', 'kontor', 'IT', 'bygg', 'restaurang', 'sälj', 'industri', 'transport']

test('exactly 9 canonical industries in stable display order', () => {
  assert.equal(INDUSTRIES.length, 9, `expected 9 industries, got ${INDUSTRIES.length}`)
  assert.deepEqual(
    INDUSTRY_IDS,
    EXPECTED_IDS,
    'industry ids must be the 9 canonical ids in dropdown display order',
  )
  // INDUSTRY_LABELS mirrors the dropdown labels (settings + onboarding
  // + the extension popup select all read from the same object).
  for (const ind of INDUSTRIES) {
    assert.equal(INDUSTRY_LABELS[ind.id], ind.label, `label mismatch for ${ind.id}`)
  }
})

test('every industry exposes a Tier 2 field set with labelled keys', () => {
  for (const id of INDUSTRY_IDS) {
    const fields = INDUSTRY_FIELDS[id]
    assert.ok(Array.isArray(fields), `INDUSTRY_FIELDS[${id}] must be an array`)
    assert.ok(fields.length > 0, `INDUSTRY_FIELDS[${id}] must be non-empty (industry-core fields)`)
    const seenKeys = new Set()
    for (const f of fields) {
      assert.equal(typeof f.key, 'string', `field key must be a string in ${id}`)
      assert.ok(f.key.length > 0, `field key must be non-empty in ${id}`)
      assert.equal(typeof f.label, 'string', `field label must be a string in ${id}`)
      assert.ok(f.label.length > 0, `field label must be non-empty in ${id}`)
      assert.ok(!seenKeys.has(f.key), `duplicate key ${f.key} in ${id}`)
      seenKeys.add(f.key)
    }
  }
})

test('every industry field key is either an industry boolean or a base ROUND12 key', () => {
  const industryKeys = new Set(INDUSTRY_BOOLEAN_KEYS)
  const baseKeys = new Set(BASE_ROUND12_KEYS)
  for (const id of INDUSTRY_IDS) {
    for (const { key } of INDUSTRY_FIELDS[id]) {
      assert.ok(
        industryKeys.has(key) || baseKeys.has(key),
        `INDUSTRY_FIELDS[${id}] references ${key} which is neither an INDUSTRY_BOOLEAN_KEYS key nor a base ROUND12 key`,
      )
    }
  }
})

test('fieldsForIndustry honours empty / unknown industry', () => {
  assert.deepEqual(fieldsForIndustry(''), [], 'fieldsForIndustry("") must return []')
  assert.deepEqual(fieldsForIndustry(undefined), [], 'fieldsForIndustry(undefined) must return []')
  assert.deepEqual(fieldsForIndustry('nonsense'), [], 'fieldsForIndustry("nonsense") must return []')
  assert.deepEqual(fieldsForIndustry('lager'), INDUSTRY_FIELDS.lager, 'fieldsForIndustry("lager") returns the lager set')
})

test('INDUSTRY_BOOLEAN_KEYS and INDUSTRY_BOOLEAN_LABELS agree 1:1', () => {
  for (const k of INDUSTRY_BOOLEAN_KEYS) {
    assert.equal(
      typeof INDUSTRY_BOOLEAN_LABELS[k],
      'string',
      `INDUSTRY_BOOLEAN_LABELS must carry a label for ${k}`,
    )
    assert.ok(INDUSTRY_BOOLEAN_LABELS[k].length > 0, `label for ${k} must be non-empty`)
  }
  // No orphan labels (a label without a registry key would silently
  // never surface in the settings form's toggle list).
  for (const k of Object.keys(INDUSTRY_BOOLEAN_LABELS)) {
    assert.ok(
      INDUSTRY_BOOLEAN_KEYS.includes(k),
      `INDUSTRY_BOOLEAN_LABELS carries ${k} which is missing from INDUSTRY_BOOLEAN_KEYS`,
    )
  }
})

test('lager + vård expose the expected key fields (industry-core spot check)', () => {
  const lager = INDUSTRY_FIELDS.lager.map((f) => f.key)
  assert.ok(lager.includes('hasForkliftLicense'), 'lager must include truckförarbevis')
  assert.ok(lager.includes('canLiftHeavy'), 'lager must include fysisk arbetsförmåga')
  assert.ok(lager.includes('canShiftWork'), 'lager must include skiftarbete')

  const vard = INDUSTRY_FIELDS['vård'].map((f) => f.key)
  assert.ok(vard.includes('hasCareAssistantEducation'), 'vård must include vårdbiträdesutbildning')
  assert.ok(vard.includes('hasHLRCertification'), 'vård must include HLR-certifikat')
})

// =====================================================================
// Round-83 — complete structured (typed) taxonomy
// =====================================================================

test('UNIVERSAL_FIELDS carries the 14 complete schema fields with types', () => {
  assert.equal(UNIVERSAL_FIELDS.length, 14, 'the complete schema has exactly 14 universal fields')
  const ids = new Set()
  for (const f of UNIVERSAL_FIELDS) {
    assert.equal(typeof f.id, 'string', 'universal field id must be a string')
    assert.equal(typeof f.label, 'string', 'universal field label must be a string')
    assert.ok(['text', 'email', 'tel', 'url', 'textarea', 'file', 'select'].includes(f.type),
      `unexpected universal field type ${f.type}`)
    assert.ok(!ids.has(f.id), `duplicate universal field id ${f.id}`)
    ids.add(f.id)
  }
})

test('every industry exposes a non-empty structured field set with labelled, typed, option-validated defs', () => {
  const allowedTypes = ['select', 'multiselect', 'text', 'url', 'textarea', 'file']
  for (const id of INDUSTRY_IDS) {
    const fields = INDUSTRY_STRUCTURED_FIELDS[id]
    assert.ok(Array.isArray(fields), `INDUSTRY_STRUCTURED_FIELDS[${id}] must be an array`)
    assert.ok(fields.length > 0, `INDUSTRY_STRUCTURED_FIELDS[${id}] must be non-empty`)
    const seen = new Set()
    for (const f of fields) {
      assert.equal(typeof f.id, 'string', `field id must be a string in ${id}`)
      assert.ok(f.id.length > 0, `field id must be non-empty in ${id}`)
      assert.equal(typeof f.label, 'string', `field label must be a string in ${id}`)
      assert.ok(f.label.length > 0, `field label must be non-empty in ${id}`)
      assert.ok(allowedTypes.includes(f.type), `unexpected type ${f.type} for ${id}.${f.id}`)
      assert.equal(typeof f.required, 'boolean', `required must be boolean for ${id}.${f.id}`)
      if (f.type === 'select' || f.type === 'multiselect') {
        assert.ok(Array.isArray(f.options) && f.options.length > 0,
          `${id}.${f.id} (${f.type}) must carry a non-empty options list`)
      }
      assert.ok(!seen.has(f.id), `duplicate field id ${f.id} in ${id}`)
      seen.add(f.id)
    }
  }
})

test('structuredFieldsFor honours empty / unknown industry', () => {
  assert.deepEqual(structuredFieldsFor(''), [], 'structuredFieldsFor("") must return []')
  assert.deepEqual(structuredFieldsFor(undefined), [], 'structuredFieldsFor(undefined) must return []')
  assert.deepEqual(structuredFieldsFor('nonsense'), [], 'structuredFieldsFor("nonsense") must return []')
  assert.deepEqual(structuredFieldsFor('lager'), INDUSTRY_STRUCTURED_FIELDS.lager, 'lager set must round-trip')
})

test('sanitizeIndustryFields keeps valid values, drops unknown ids + non-option values', () => {
  // Unknown id → dropped. Non-option select value → dropped.
  const cleaned = sanitizeIndustryFields('lager', {
    forklift_license: 'Ja',
    forklift_types: ['A1 - låglyftande', 'totally-not-a-truck'],
    shift_work: 'Helt okänt alternativ',
    nonexistent_field: 'x',
  })
  assert.deepEqual(cleaned, {
    forklift_license: 'Ja',
    forklift_types: ['A1 - låglyftande'],
  }, 'only canonical ids + option-list values survive')
  // Multiselect dedupes + text caps.
  const cleaned2 = sanitizeIndustryFields('IT', {
    programming_languages: ['Python', 'Python', 'Rust'],
    github_portfolio: 'x'.repeat(700),
  })
  assert.deepEqual(cleaned2.programming_languages, ['Python', 'Rust'], 'multiselect must dedupe')
  assert.equal(cleaned2.github_portfolio.length, 500, 'text/url answers are capped at 500 chars')
  // Unknown industry / non-object → {}.
  assert.deepEqual(sanitizeIndustryFields('nonsense', { forklift_license: 'Ja' }), {})
  assert.deepEqual(sanitizeIndustryFields('lager', null), {})
  assert.deepEqual(sanitizeIndustryFields('lager', ['not-an-object']), {})
})

test('industryFieldsToBooleans dual-writes only mapped fields onto the legacy booleans', () => {
  const bools = industryFieldsToBooleans('lager', {
    forklift_license: 'Ja',
    physical_capacity: 'Nej',
    warehouse_experience: '3-5 år',
    forklift_types: ['A1 - låglyftande'],
  })
  assert.equal(bools.hasForkliftLicense, true, 'forklift_license Ja → hasForkliftLicense true')
  assert.equal(bools.canLiftHeavy, false, 'physical_capacity Nej → canLiftHeavy false')
  assert.equal(bools.canShiftWork, undefined, 'lager has no shift_work answer → no canShiftWork key')
  assert.deepEqual(industryFieldsToBooleans('lager', null), {}, 'null fields → {}')
})

test('structuredAnswerToBoolean maps negative + empty answers to false', () => {
  assert.equal(structuredAnswerToBoolean('Ja'), true)
  assert.equal(structuredAnswerToBoolean('Pågående'), false, 'an in-progress licence must NOT map to true (no auto-click Ja)')
  assert.equal(structuredAnswerToBoolean('Nej'), false)
  assert.equal(structuredAnswerToBoolean('Ingen'), false)
  assert.equal(structuredAnswerToBoolean(['A1 - låglyftande']), true)
  assert.equal(structuredAnswerToBoolean([]), false)
  assert.equal(structuredAnswerToBoolean(''), false)
  assert.equal(structuredAnswerToBoolean(null), false)
})

test('STRUCTURED_TO_BOOLEAN targets only known boolean keys (industry + base ROUND12)', () => {
  const known = new Set([...INDUSTRY_BOOLEAN_KEYS, ...ROUND12_BOOLEAN_KEYS])
  for (const [fieldId, boolKey] of Object.entries(STRUCTURED_TO_BOOLEAN)) {
    assert.ok(known.has(boolKey),
      `STRUCTURED_TO_BOOLEAN[${fieldId}] → ${boolKey} is neither an industry boolean nor a ROUND12 key`)
  }
})

test('lager structured spot check: truckkörkort + fysiskt arbete + skift with option lists', () => {
  const lager = INDUSTRY_STRUCTURED_FIELDS.lager
  const byId = Object.fromEntries(lager.map((f) => [f.id, f]))
  assert.equal(byId.forklift_license.type, 'select')
  assert.deepEqual(byId.forklift_license.options, ['Ja', 'Nej', 'Pågående'])
  assert.equal(byId.physical_capacity.type, 'select')
  assert.equal(byId.shift_work.required, true, 'skiftarbete is required for lager')
  assert.equal(byId.forklift_types.type, 'multiselect')
  assert.ok(byId.forklift_types.options.includes('D1 - skjutstativtruck'))
})

test('RARE_FIELDS: 9 canonical ids with unique, byte-stable labels + sanitizer behaviour', () => {
  assert.equal(RARE_FIELDS.length, 9, 'the rare-field registry must cover the 9 detection rules')
  const ids = RARE_FIELDS.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, 'rare-field ids must be unique')
  for (const r of RARE_FIELDS) {
    assert.equal(typeof r.label, 'string')
    assert.ok(r.label.length > 0)
  }
  // Label↔id mapping helper works for the popup + fill pass.
  assert.equal(RARE_FIELD_LABELS.uppsagningstid, 'Uppsägningstid')
  assert.equal(RARE_FIELD_LABELS.referensperson, 'Referensperson')
  // Sanitizer: drops unknown ids + non-strings + empties; trims + caps.
  assert.deepEqual(sanitizeRareFields({ bogus: 'x' }), {})
  assert.deepEqual(sanitizeRareFields({ uppsagningstid: '' }), {})
  assert.deepEqual(sanitizeRareFields({ uppsagningstid: 7 }), {})
  assert.deepEqual(sanitizeRareFields({ uppsagningstid: '  2 veckor  ' }), { uppsagningstid: '2 veckor' })
  assert.equal(sanitizeRareFields({ uppsagningstid: 'x'.repeat(600) }).uppsagningstid.length, 500)
})
