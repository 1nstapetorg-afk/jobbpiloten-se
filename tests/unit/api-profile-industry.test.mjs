// tests/unit/api-profile-industry.test.mjs
//
// Round-82 — locks the API contract for the tiered industry taxonomy:
// the catch-all route (app/api/[[...path]]/route.js) must accept and
// return industry-specific profile fields.
//
// The route is a 1700+ line server handler that cannot be imported
// without a running Next.js + Mongo environment, so — following the
// project's structural-lock convention — this test pins the CONTRACT
// by source inspection:
//
//   1. POST /api/profile persists `industry` + every
//      INDUSTRY_BOOLEAN_KEYS boolean (Round-81 $set spread)
//   2. POST /api/profile-update ALLOW-list includes `industry` + every
//      INDUSTRY_BOOLEAN_KEYS key (Round-81 ALLOWED spread)
//   3. profile-update validates industry against INDUSTRY_IDS (a
//      hand-rolled POST can never persist a free-text industry)
//   4. profile-update coerces every industry boolean to strict boolean
//   5. lib/extension-profile.js (the extension-facing GET response)
//      surfaces industry + all booleans with safe defaults — locked
//      behaviourally via import (no Mongo needed: buildExtensionProfile
//      is a pure shape function)
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')
const ROUTE = readFileSync(resolve(ROOT, 'app/api/[[...path]]/route.js'), 'utf8')

import { INDUSTRY_IDS, INDUSTRY_BOOLEAN_KEYS, INDUSTRY_STRUCTURED_FIELDS } from '../../lib/field-taxonomy.js'

test('POST /api/profile persists industry + all industry booleans', () => {
  assert.match(
    ROUTE,
    /industry: INDUSTRY_IDS\.includes\(source\.industry\) \? source\.industry : ''/,
    'POST profile must persist industry only when it is a canonical id',
  )
  assert.match(
    ROUTE,
    /INDUSTRY_BOOLEAN_KEYS\n\s*\.filter\(\(k\) => Object\.prototype\.hasOwnProperty\.call\(source, k\)\)\n\s*\.map\(\(k\) => \[k, Boolean\(source\[k\]\) === true\]\)/,
    'POST profile must $set each industry boolean as a strict boolean (conditional merge)',
  )
})

test('profile-update ALLOW list includes industry + every industry boolean', () => {
  assert.match(
    ROUTE,
    /'industry',\n\s*\.\.\.INDUSTRY_BOOLEAN_KEYS/,
    'profile-update ALLOWED must include industry + the industry boolean spread',
  )
})

test('profile-update rejects non-canonical industry payloads', () => {
  assert.match(
    ROUTE,
    /hasOwnProperty\.call\(\$set, 'industry'\) && !INDUSTRY_IDS\.includes\(\$set\.industry\)/,
    'profile-update must guard industry against INDUSTRY_IDS',
  )
  assert.match(
    ROUTE,
    /delete \$set\.industry/,
    'profile-update must drop a non-canonical industry from $set',
  )
})

test('profile-update coerces industry booleans to strict booleans', () => {
  assert.match(
    ROUTE,
    /for \(const k of INDUSTRY_BOOLEAN_KEYS\) \{/,
    'profile-update must iterate INDUSTRY_BOOLEAN_KEYS for coercion',
  )
  assert.match(
    ROUTE,
    /typeof \$set\[k\] !== 'boolean'/,
    'profile-update must drop non-boolean industry payloads',
  )
})

test('INDUSTRY_IDS + INDUSTRY_BOOLEAN_KEYS still match the canonical 9-industry taxonomy', () => {
  assert.equal(INDUSTRY_IDS.length, 9, 'must be 9 canonical industries')
  assert.ok(INDUSTRY_BOOLEAN_KEYS.length >= 16, `expected ≥16 industry booleans, got ${INDUSTRY_BOOLEAN_KEYS.length}`)
})

// ---- Round-83 — complete structured industry answers (industryFields) ----

test('POST /api/profile conditionally persists industryFields sanitized for the payload industry', () => {
  assert.match(
    ROUTE,
    /hasOwnProperty\.call\(source, 'industryFields'\)/,
    'POST profile must conditionally merge industryFields (never clobber on omission)',
  )
  assert.match(
    ROUTE,
    /sanitizeIndustryFields\(source\.industry, source\.industryFields\)/,
    'POST profile must sanitize industryFields against the taxonomy for the selected industry',
  )
})

test('profile-update ALLOW list includes industryFields', () => {
  assert.match(
    ROUTE,
    /\.\.\.INDUSTRY_BOOLEAN_KEYS,[\s\S]{0,800}'industryFields',/,
    'profile-update ALLOWED must include industryFields (after the industry boolean spread)',
  )
})

test('profile-update sanitizes industryFields for the effective industry', () => {
  assert.match(
    ROUTE,
    /hasOwnProperty\.call\(\$set, 'industryFields'\)/,
    'profile-update must guard the industryFields key',
  )
  assert.match(
    ROUTE,
    /rawFields = nested \? \$set\.industryFields\[effIndustry\] : \$set\.industryFields/,
    'profile-update must accept BOTH the flat payload shape and the nested GET round-trip shape',
  )
  assert.match(
    ROUTE,
    /sanitizeIndustryFields\(effIndustry, rawFields\)/,
    'profile-update must sanitize the chosen industryFields slice against the effective industry taxonomy',
  )
  assert.match(
    ROUTE,
    /delete \$set\.industryFields/,
    'profile-update must drop industryFields when no canonical industry applies',
  )
})

test('profile-update wipes stale industryFields when the industry changes without a new answer set', () => {
  assert.match(
    ROUTE,
    /prev\.industry !== \$set\.industry/,
    'profile-update must detect an industry change against the stored profile',
  )
  assert.match(
    ROUTE,
    /!Object\.prototype\.hasOwnProperty\.call\(body, 'industryFields'\)/,
    'the stale wipe must only fire when the patch carries NO new industryFields',
  )
})

test('INDUSTRY_STRUCTURED_FIELDS covers every canonical industry with labelled, typed defs', () => {
  for (const id of INDUSTRY_IDS) {
    const fields = INDUSTRY_STRUCTURED_FIELDS[id]
    assert.ok(Array.isArray(fields) && fields.length > 0, `industry ${id} must expose structured fields`)
    for (const f of fields) {
      assert.equal(typeof f.id, 'string')
      assert.equal(typeof f.label, 'string')
      assert.ok(f.label.length > 0, `label for ${id}.${f.id} must be non-empty`)
      assert.equal(typeof f.required, 'boolean')
    }
  }
})

// ---- Behavioural half: buildExtensionProfile (pure, no Mongo) ----
import { buildExtensionProfile } from '../../lib/extension-profile.js'

test('buildExtensionProfile returns industry + all booleans with safe defaults', () => {
  const out = buildExtensionProfile({}, null)
  assert.equal(out.industry, '', 'industry must default to empty string')
  for (const k of INDUSTRY_BOOLEAN_KEYS) {
    assert.equal(out[k], false, `${k} must default to false`)
  }
})

test('buildExtensionProfile echoes a populated industry + booleans', () => {
  const source = {
    industry: 'lager',
    canLiftHeavy: true,
    canShiftWork: true,
    hasTruckLicenseCE: true,
  }
  const out = buildExtensionProfile(source, null)
  assert.equal(out.industry, 'lager', 'industry must pass through when canonical')
  assert.equal(out.canLiftHeavy, true)
  assert.equal(out.canShiftWork, true)
  assert.equal(out.hasTruckLicenseCE, true)
  // Untouched industry booleans stay false.
  assert.equal(out.hasHLRCertification, false)
  assert.equal(out.hasNursingExperience, false)
})

test('buildExtensionProfile rejects a free-text industry', () => {
  const out = buildExtensionProfile({ industry: 'nonsense-branch' }, null)
  assert.equal(out.industry, '', 'non-canonical industry must fall back to empty string')
})

test('buildExtensionProfile defaults industryFields to {} and echoes a populated industryFields object', () => {
  assert.deepEqual(buildExtensionProfile({}, null).industryFields, {}, 'industryFields must default to {}')
  assert.deepEqual(
    buildExtensionProfile({ industry: 'nonsense', industryFields: { lager: { forklift_license: 'Ja' } } }, null).industryFields,
    {},
    'non-canonical industry must not leak industryFields',
  )
  const out = buildExtensionProfile({
    industry: 'lager',
    industryFields: {
      lager: { forklift_license: 'Ja', shift_work: 'Endast dagtid', forklift_types: ['A1 - låglyftande'] },
      vård: { care_certificate: 'Ja' }, // wrong industry — must be dropped
    },
  }, null)
  assert.deepEqual(
    out.industryFields,
    {
      lager: {
        forklift_license: 'Ja',
        shift_work: 'Endast dagtid',
        forklift_types: ['A1 - låglyftande'],
      },
    },
    'the extension profile carries the nested per-industry shape with only the profile industry\'s sanitized fields',
  )
})
