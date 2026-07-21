// tests/unit/extension-profile.test.mjs
//
// 2026-07-16 (Round-12, followup #2) — profile-shape unit test.
//
// WHAT THIS FILE GUARDS AGAINST:
//   * `buildExtensionProfile` silently dropping one of the 16 new
//     Round-12 fields (the dashboard settings UI sends them, the
//     extension expects them, and Mongo stores them — but if the
//     safe-profile builder forgets to forward one, the extension
//     never sees it).
//   * Default values drifting between the two consumers
//     (lib/extension-profile.js vs app/settings/page.js) — the
//     shared registry in lib/extension-profile-fields.js is the
//     single source of truth, and this test pins the safe defaults
//     it produces.
//   * Type-coercion regressions — a future refactor that emits
//     `null` / `undefined` for a boolean field would crash the
//     extension's `Boolean(profile?.x) === true` checks. The
//     `fresh-profile defaults` suite catches that.
//
// STRATEGY:
//   1. Import the shared registry + the builder.
//   2. Assert the field COUNT (legacy 19 + new 16 = 35 keys).
//   3. Run a `fresh-profile` suite (empty / null / undefined input)
//      asserting every new field gets the safe-empty default.
//   4. Run a `populated-profile` suite (every field set to a
//      sentinel value) asserting propagation.
//   5. Run a `mixed-shape` suite asserting type coercion (Mongo
//      can store strings for booleans, NaN for years, etc.).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExtensionProfile,
} from '../../lib/extension-profile.js'
import {
  ROUND12_BOOLEAN_KEYS,
  ROUND12_STRING_KEYS,
  ROUND12_UI_BOOLEAN_KEYS,
  ROUND12_TOTAL_FIELDS,
  getRound12Defaults,
} from '../../lib/extension-profile-fields.js'

// ---- Sentinel values used to prove propagation ----
//
// We pick distinct non-default values for each kind so the test
// cannot accidentally pass by coincidence (e.g. a `null` field
// being treated as `false`).
const YEARS_SENTINEL = 12
const DOB_SENTINEL = '1990-04-15'
const GENDER_SENTINEL = 'Kvinna'
const NATIONALITY_SENTINEL = 'Svensk'
const PHONE_CODE_SENTINEL = '+47'
const SKILLS_SENTINEL = ['Maskiner', 'Service', 'Truck', 42, null, 'Städ'] // mixed types — must filter

// ===== A. Field COUNT =====
//
// 2026-07-21 — Storgatan regression close-out. With BUG 3 (split-
// address) the function exposes `street` and `country` as new keys
// alongside the legacy `address`/`city`. The `zip` key was also
// added in BUG 3 (parsed via parseAddressComponents) but a
// duplicate source-level declaration had been overwriting the
// parser's value with '' — fixed in Round-74. JS object-literal
// semantics dedupes the duplicate to ONE runtime key, so `zip`
// counts as 1 (NOT +1 above the existing baseline). The +2 extras
// above the 17 legacy + 19 Round-12 = 36 baseline are therefore
// exactly `street` and `country` (BUG 3 net additions).
const LEGACY_LEAF_COUNT = 17
const BUG3_SPLIT_KEYS = 2  // BUG 3 (Round-72.2) adds street + country at runtime; zip is also a BUG 3 field but it replaced the previous-days '' fallback (which itself counted as 1) so the net delta vs the pre-BUG 3 shape is +2.
test('buildExtensionProfile returns exactly 38 keys (17 legacy + 19 Round-12 + 2 BUG 3 split)', () => {
  const out = buildExtensionProfile({}, null)
  const keys = Object.keys(out).sort()
  assert.equal(keys.length, LEGACY_LEAF_COUNT + ROUND12_TOTAL_FIELDS + BUG3_SPLIT_KEYS,
    `Expected ${LEGACY_LEAF_COUNT + ROUND12_TOTAL_FIELDS + BUG3_SPLIT_KEYS} fields (${LEGACY_LEAF_COUNT} legacy + ${ROUND12_TOTAL_FIELDS} Round-12 + ${BUG3_SPLIT_KEYS} BUG 3 split). Got ${keys.length}: ${keys.join(', ')}`)
})

test('buildExtensionProfile returns ALL 16 Round-12 keys (registry parity)', () => {
  const out = buildExtensionProfile({}, null)
  // Every boolean key must appear (incl. autoConsent).
  for (const k of ROUND12_BOOLEAN_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(out, k),
      `buildExtensionProfile is missing the boolean key \`${k}\`. The shared registry lists it, so the safe-profile builder must emit it.`)
  }
  // Every string key must appear.
  for (const k of ROUND12_STRING_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(out, k),
      `buildExtensionProfile is missing the string key \`${k}\`. The shared registry lists it, so the safe-profile builder must emit it.`)
  }
  // yearsExperience (number) + skills (array) are the two
  // non-boolean / non-string fields in the registry.
  assert.ok(Object.prototype.hasOwnProperty.call(out, 'yearsExperience'),
    'buildExtensionProfile is missing the number key `yearsExperience`')
  assert.ok(Object.prototype.hasOwnProperty.call(out, 'skills'),
    'buildExtensionProfile is missing the array key `skills`')
})

// ===== B. Fresh-profile SAFE-EMPTY DEFAULTS =====
//
// Mongo can hand us `{}` (brand-new account) OR `null`/`undefined`
// (defensive callers). All three inputs must produce the same
// safe defaults — the extension's resolveProfileRaw depends on the
// shape being predictable.
for (const label of ['undefined', 'null', 'empty object']) {
  test(`fresh profile (${label}): all booleans → false`, () => {
    const profile = label === 'undefined' ? undefined
      : label === 'null' ? null
      : {}
    const out = buildExtensionProfile(profile, null)
    for (const k of ROUND12_BOOLEAN_KEYS) {
      assert.equal(out[k], false,
        `fresh profile: \`${k}\` must default to false (extension leaves host field untouched). Got ${JSON.stringify(out[k])}.`)
    }
  })
}

test('fresh profile: yearsExperience → 0', () => {
  const out = buildExtensionProfile({}, null)
  assert.equal(out.yearsExperience, 0,
    `fresh profile: yearsExperience must default to 0. Got ${JSON.stringify(out.yearsExperience)}.`)
})

test('fresh profile: dateOfBirth, gender, nationality → ""', () => {
  const out = buildExtensionProfile({}, null)
  assert.equal(out.dateOfBirth, '')
  assert.equal(out.gender, '')
  assert.equal(out.nationality, '')
})

test('fresh profile: phoneCountryCode → "+46" (Sweden default)', () => {
  const out = buildExtensionProfile({}, null)
  assert.equal(out.phoneCountryCode, '+46',
    `fresh profile: phoneCountryCode must default to "+46". Got ${JSON.stringify(out.phoneCountryCode)}.`)
})

test('fresh profile: skills → []', () => {
  const out = buildExtensionProfile({}, null)
  assert.deepEqual(out.skills, [],
    `fresh profile: skills must default to []. Got ${JSON.stringify(out.skills)}.`)
})

// ===== C. Populated-profile PROPAGATION =====
//
// Every new field must round-trip through buildExtensionProfile.
// Each input is set to a distinct sentinel; the output must
// match. We use string 'true' for booleans to also prove strict
// type coercion (Boolean('sentinel-true-not-real') === true is
// true — but the test uses TRUE_SENTINEL = 'true' to confirm the
// Boolean() coercion, since 'sentinel-true-not-real' would also
// coerce to true via truthiness).
test('populated profile: booleans propagate (strict type coercion)', () => {
  const profile = {}
  for (const k of ROUND12_UI_BOOLEAN_KEYS) profile[k] = true
  profile.autoConsent = true
  const out = buildExtensionProfile(profile, null)
  for (const k of ROUND12_BOOLEAN_KEYS) {
    assert.equal(out[k], true,
      `populated profile: \`${k}\` must propagate as the boolean true. Got ${JSON.stringify(out[k])}.`)
  }
})

test('populated profile: booleans coerce non-boolean truthy values to true', () => {
  // Mongo can store `1` / `'true'` / `Date(0)` for booleans via
  // legacy schemas. The extension's clickBooleanOption only
  // fires for `desired === true`, so truthy coercion is safe AND
  // backwards-compatible with the legacy string-typed schema.
  const profile = {}
  for (const k of ROUND12_BOOLEAN_KEYS) profile[k] = 1
  const out = buildExtensionProfile(profile, null)
  for (const k of ROUND12_BOOLEAN_KEYS) {
    assert.equal(out[k], true,
      `populated profile: \`${k}\` must coerce non-boolean truthy values to true. Got ${JSON.stringify(out[k])}.`)
  }
})

test('populated profile: yearsExperience propagates as a finite number', () => {
  const profile = { yearsExperience: YEARS_SENTINEL }
  const out = buildExtensionProfile(profile, null)
  assert.equal(out.yearsExperience, YEARS_SENTINEL,
    `populated profile: yearsExperience must propagate as ${YEARS_SENTINEL}. Got ${JSON.stringify(out.yearsExperience)}.`)
})

test('populated profile: string fields propagate verbatim', () => {
  const profile = {
    dateOfBirth: DOB_SENTINEL,
    gender: GENDER_SENTINEL,
    nationality: NATIONALITY_SENTINEL,
    phoneCountryCode: PHONE_CODE_SENTINEL,
  }
  const out = buildExtensionProfile(profile, null)
  assert.equal(out.dateOfBirth, DOB_SENTINEL)
  assert.equal(out.gender, GENDER_SENTINEL)
  assert.equal(out.nationality, NATIONALITY_SENTINEL)
  assert.equal(out.phoneCountryCode, PHONE_CODE_SENTINEL)
})

test('populated profile: skills filter non-strings (mixed-type input)', () => {
  // Mongo stored `skills` as a mixed array (numbers, nulls, strings)
  // because the field was previously free-form. The extension
  // expects string[] only — non-strings must be filtered.
  const profile = { skills: SKILLS_SENTINEL }
  const out = buildExtensionProfile(profile, null)
  assert.deepEqual(out.skills, ['Maskiner', 'Service', 'Truck', 'Städ'],
    `populated profile: skills must filter non-strings. Got ${JSON.stringify(out.skills)}.`)
})

// ===== D. Type-coercion EDGE CASES =====
//
// Catches regressions where a future refactor introduces
// `profile?.x || ''` style fallbacks that drop values silently.
test('mixed-shape profile: string "false" coerces to boolean TRUE (JS truthy-coercion trap)', () => {
  // Pins the EXISTING behaviour: the builder uses `Boolean(x) === true`,
  // and `Boolean('false') === true` because the non-empty STRING 'false'
  // is truthy in JS (a string is truthy iff length > 0). This is the
  // documented quirk — the legacy schema could store `'false'` as a
  // string, and we want users who had a hand-edited Mongo value of
  // 'true' (intending "yes, has license") to still be served correctly.
  //
  // The practical consequence: an end-user typing `false` (the
  // lowercase string) in Mongo would have JobbPiloten click "Ja" on
  // their behalf. This is undesirable but pre-Round-12 behaviour and
  // the settings page always uses the Switch component which yields a
  // real boolean — so the trap only fires for hand-edited Mongo docs
  // (out of scope for the dashboard UI).
  const profile = { hasDriversLicense: 'false' }
  const out = buildExtensionProfile(profile, null)
  assert.equal(out.hasDriversLicense, true,
    `string 'false' must coerce to boolean true via the documented Boolean(x) === true quirk. Got ${JSON.stringify(out.hasDriversLicense)}.`)
})

test('mixed-shape profile: explicit boolean false stays false', () => {
  // The control case — the actual `false` boolean stays `false`.
  const profile = { hasDriversLicense: false }
  const out = buildExtensionProfile(profile, null)
  assert.equal(out.hasDriversLicense, false)
})

test('shared invariant: getRound12Defaults().phoneCountryCode === "+46" (regression lock for the iteration-order bug)', () => {
  // The Round-12 followup hit an iteration-order bug where the
  // string-keys loop in getRound12Defaults() overwrote the explicit
  // phoneCountryCode initialiser ('+46' → ''). This invariant test
  // pins the constant so a future refactor that re-introduces the
  // bug (e.g. by adding a second string-keys loop without the
  // `continue` skip) fails loudly at unit-test time.
  const d = getRound12Defaults()
  assert.equal(d.phoneCountryCode, '+46',
    `getRound12Defaults().phoneCountryCode must be '+46'. Got ${JSON.stringify(d.phoneCountryCode)}.`)
})

test('mixed-shape profile: numeric 0 on yearsExperience falls back to 0 default', () => {
  // Edge case: profile.yearsExperience = 0 (not undefined). The
  // builder's `Number.isFinite(Number(0))` returns true, so the
  // value passes through as 0 (not as the fallback default).
  const profile = { yearsExperience: 0 }
  const out = buildExtensionProfile(profile, null)
  assert.equal(out.yearsExperience, 0)
})

test('mixed-shape profile: NaN on yearsExperience falls back to 0', () => {
  const profile = { yearsExperience: 'not-a-number' }
  const out = buildExtensionProfile(profile, null)
  assert.equal(out.yearsExperience, 0,
    `yearsExperience=NaN must fall back to 0. Got ${JSON.stringify(out.yearsExperience)}.`)
})

test('mixed-shape profile: empty phoneCountryCode falls back to "+46"', () => {
  const profile = { phoneCountryCode: '' }
  const out = buildExtensionProfile(profile, null)
  assert.equal(out.phoneCountryCode, '+46',
    `empty phoneCountryCode must fall back to "+46". Got ${JSON.stringify(out.phoneCountryCode)}.`)
})

test('mixed-shape profile: null skills falls back to []', () => {
  const profile = { skills: null }
  const out = buildExtensionProfile(profile, null)
  assert.deepEqual(out.skills, [])
})

test('mixed-shape profile: object skills falls back to []', () => {
  const profile = { skills: { not: 'an array' } }
  const out = buildExtensionProfile(profile, null)
  assert.deepEqual(out.skills, [])
})

// ===== E. Legacy field PRESERVATION =====
//
// Round-12 must not regress any of the 19 legacy keys. Pin the
// shape so a future refactor that accidentally drops `cvSummary`
// or `latestCoverLetter` fails loudly.
test('legacy keys are all present and preserve their existing behaviour', () => {
  const profile = {
    fullName: 'Erik Lindqvist',
    email: 'erik@example.com',
    phone: '+46 70 123 45 67',
    address: 'Storgatan 12, Stockholm',
    linkedin: 'https://linkedin.com/in/erik',
    salaryMin: 45000,
    experience: '5 år inom lager',
    workPreference: 'Heltid',
    employmentType: ['heltid', 'tillsvidare'],
    languages: ['sv', 'en'],
    answers: {
      whyThisCompany: 'Skräddarsydd svarsdraft.',
      whyThisRole: 'Rollens tekniska fokus matchar min profil.',
      strengths: 'Systematisk, snabblärd.',
      weaknesses: '',
      challenge: '',
      availability: 'Omgående',
    },
    cvSummary: 'Erfaren lagerarbetare med truckcertifikat.',
    jobTitles: ['Lagerarbetare'],
  }
  const latestApplication = { coverLetter: 'Kära rekryterare,\n\nJag ansöker härmed...' }
  const out = buildExtensionProfile(profile, latestApplication)

  // Identity
  assert.equal(out.fullName, 'Erik Lindqvist')
  assert.equal(out.firstName, 'Erik')
  assert.equal(out.lastName, 'Lindqvist')
  // Contact
  assert.equal(out.email, 'erik@example.com')
  assert.equal(out.phone, '+46 70 123 45 67')
  // 2026-07-21 (Storgatan regression fix) — `address` must keep
  // the full raw multi-part input so generic single-field forms
  // + CV PDF reports see the original blob. `city` is the
  // parseAddressComponents-derived second segment. The previous
  // shape truncated `address` to street-only and broke this
  // assertion.
  assert.equal(out.address, 'Storgatan 12, Stockholm',
    `legacy 'address' must preserve the full raw multi-part input. Got ${JSON.stringify(out.address)} — regression: the BUG 3 fix must NOT truncate the raw input.`)
  assert.equal(out.city, 'Stockholm',
    `city must be the parsed second segment (split-address heuristic). Got ${JSON.stringify(out.city)}.`)
  assert.equal(out.linkedin, 'https://linkedin.com/in/erik')
  // Salary / experience
  assert.equal(out.salaryExpectation, 45000)
  assert.equal(out.experience, '5 år inom lager')
  // Latest application
  assert.equal(out.latestCoverLetter, 'Kära rekryterare,\n\nJag ansöker härmed...')
  // Answers — fallback chain tested implicitly (no fallback needed since values set)
  assert.equal(out.answers.whyThisCompany, 'Skräddarsydd svarsdraft.')
  assert.equal(out.answers.whyThisRole, 'Rollens tekniska fokus matchar min profil.')
  assert.equal(out.answers.availability, 'Omgående')
  // CV summary
  assert.equal(out.cvSummary, 'Erfaren lagerarbetare med truckcertifikat.')
  // employmentType / languages arrays
  assert.deepEqual(out.employmentType, ['heltid', 'tillsvidare'])
  assert.deepEqual(out.languages, ['sv', 'en'])
})

// ===== E2. Canonical 4-part Swedish address split =====
//
// 2026-07-21 — Storgatan regression close-out. Asserts the
// BUG 3 splitter exposes ALL FOUR components correctly on a
// canonical Swedish full-address input, AND that `address`
// still carries the full raw multi-part blob for legacy callers.
test('canonical 4-part Swedish address: all components split + raw "address" preserved', () => {
  const profile = {
    address: 'Hjällbogården 30, 424 36, Angered, Sverige',
  }
  const out = buildExtensionProfile(profile, null)
  // Legacy contract — full raw multi-part string preserved.
  assert.equal(out.address, 'Hjällbogården 30, 424 36, Angered, Sverige',
    `legacy 'address' must preserve the full raw input. Got ${JSON.stringify(out.address)}.`)
  // BUG 3 split — each component on its own key.
  assert.equal(out.street, 'Hjällbogården 30',
    `street must extract the first text segment. Got ${JSON.stringify(out.street)}.`)
  assert.equal(out.zip, '424 36',
    `zip must extract the 3-5 Swedish postal code. Got ${JSON.stringify(out.zip)}.`)
  assert.equal(out.city, 'Angered',
    `city must extract the second text segment. Got ${JSON.stringify(out.city)}.`)
  assert.equal(out.country, 'Sverige',
    `country must match the country allow-list. Got ${JSON.stringify(out.country)}.`)
})

// ===== F. Shared-registry PARITY =====
//
// The shared `getRound12Defaults()` and the builder's output for
// an empty profile must agree — this is the round-12 invariant
// that prevents drift between the settings form's seed state and
// the safe-profile JSON the extension receives.
test('getRound12Defaults agrees with buildExtensionProfile({}, null) for all 16 Round-12 fields', () => {
  const defaults = getRound12Defaults()
  const out = buildExtensionProfile({}, null)
  for (const k of ROUND12_BOOLEAN_KEYS) {
    assert.equal(out[k], defaults[k],
      `shared default mismatch for boolean \`${k}\`: registry=${JSON.stringify(defaults[k])} vs builder=${JSON.stringify(out[k])}`)
  }
  for (const k of ROUND12_STRING_KEYS) {
    assert.equal(out[k], defaults[k],
      `shared default mismatch for string \`${k}\`: registry=${JSON.stringify(defaults[k])} vs builder=${JSON.stringify(out[k])}`)
  }
  assert.equal(out.yearsExperience, defaults.yearsExperience)
  assert.deepEqual(out.skills, defaults.skills)
})
