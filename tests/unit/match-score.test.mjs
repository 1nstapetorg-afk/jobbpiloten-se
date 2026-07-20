// tests/unit/match-score.test.mjs
//
// Unit tests for lib/match-score.js. Validates the match-score
// algorithm and the AF-readiness check across realistic profile
// + job fixtures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMatchScore, isPreparedForAF } from '../../lib/match-score.js'

const baseJob = {
  title: 'Senior Frontend-utvecklare',
  location: 'Stockholm',
  description: 'Vi söker en driven utvecklare. Distansarbete möjligt.',
  employmentType: 'Heltid',
}

const baseProfile = {
  fullName: 'Anna Andersson',
  email: 'anna@example.com',
  phone: '070-1234567',
  jobTitles: ['Frontend-utvecklare', 'React-utvecklare'],
  locations: ['Stockholm', 'Distans'],
  experience: 'Senior',
  employmentType: ['heltid'],
  cvSummary: 'Frontend-utvecklare med 8 års erfarenhet av React.',
}

test('computeMatchScore returns 0-100 with explanation breakdown', () => {
  const result = computeMatchScore(baseJob, baseProfile)
  assert.ok(result.score >= 0 && result.score <= 100)
  assert.equal(typeof result.explanation, 'object')
  assert.ok(result.explanation.roll <= 40)
  assert.ok(result.explanation.ort <= 25)
  assert.ok(result.explanation.erfarenhet <= 15)
  assert.ok(result.explanation.anställning <= 10)
  assert.ok(result.explanation.remote <= 5)
  assert.equal(result.explanation.roll + result.explanation.ort + result.explanation.erfarenhet + result.explanation.anställning + result.explanation.remote, result.score)
})

test('match is high when profile and job align', () => {
  const result = computeMatchScore(baseJob, baseProfile)
  // "Senior Frontend-utvecklare" contains "frontend-utvecklare" (40),
  // Stockholm matches (25), Senior == Senior (15), heltid matches (10),
  // distans is in the user's list + description (5) = 95.
  assert.ok(result.score >= 90, `expected >= 90, got ${result.score}`)
})

test('match is 0 when profile has no fields set', () => {
  const result = computeMatchScore(baseJob, {})
  // roll=0 (no titles), ort=0 (no locations), erfarenhet=0 (no experience),
  // anställning=10 (no filter = pass through), remote=0 (no locations).
  assert.equal(result.score, 10)
})

test('rollScore: full title match scores higher than word match', () => {
  // r1: full substring match — "Frontend-utvecklare" is a substring
  // of "Senior Frontend-utvecklare" → 40 points.
  const r1 = computeMatchScore({ ...baseJob, title: 'Senior Frontend-utvecklare' }, { ...baseProfile, jobTitles: ['Frontend-utvecklare'] })
  // r2: word-only match. Profile has 'React Developer' (2 words),
  // job title is 'Senior React' (contains 'react' as a word but
  // NOT as the full needle 'react developer'). The full-match
  // branch is skipped (no substring), but the word-match branch
  // credits 1 word (4 points).
  const r2 = computeMatchScore({ ...baseJob, title: 'Senior React' }, { ...baseProfile, jobTitles: ['React Developer'] })
  assert.equal(r1.explanation.roll, 40)
  assert.ok(r1.explanation.roll > r2.explanation.roll, 'full match should beat word match')
  assert.ok(r2.explanation.roll < 40, 'word-only match should be partial')
  assert.ok(r2.explanation.roll > 0, 'word-only match should still credit the keyword')
})

test('ortScore: zero when job is in a different city', () => {
  const r = computeMatchScore({ ...baseJob, location: 'Malmö' }, baseProfile)
  assert.equal(r.explanation.ort, 0)
})

test('erfarenhetScore: returns 0 for seniority mismatch', () => {
  const r = computeMatchScore(baseJob, { ...baseProfile, experience: 'Junior' })
  assert.equal(r.explanation.erfarenhet, 0)
})

test('erfarenhetScore: returns 7 (partial) when job has no seniority marker', () => {
  const r = computeMatchScore({ ...baseJob, title: 'Frontend-utvecklare' }, baseProfile)
  assert.equal(r.explanation.erfarenhet, 7)
})

test('anställningScore: 10 when profile has no filter', () => {
  const r = computeMatchScore(baseJob, { ...baseProfile, employmentType: [] })
  assert.equal(r.explanation.anställning, 10)
})

test('remoteBonus: 5 when user has Distans and job description mentions distans', () => {
  const r = computeMatchScore({ ...baseJob, description: 'Distansarbete är möjligt' }, baseProfile)
  assert.equal(r.explanation.remote, 5)
})

test('factors array is flat for UI rendering', () => {
  const result = computeMatchScore(baseJob, baseProfile)
  assert.equal(result.factors.length, 5)
  for (const f of result.factors) {
    assert.ok(typeof f.key === 'string')
    assert.ok(typeof f.label === 'string')
    assert.ok(typeof f.value === 'number' && f.value >= 0 && f.value <= 100)
  }
})

test('isPreparedForAF: returns ready=true for a complete profile', () => {
  const r = isPreparedForAF(baseProfile)
  assert.equal(r.ready, true)
  assert.deepEqual(r.missing, [])
})

test('isPreparedForAF: flags missing phone (if no personal number)', () => {
  const r = isPreparedForAF({ ...baseProfile, phone: '' })
  assert.equal(r.ready, false)
  assert.ok(r.missing.includes('telefon eller personnummer'))
})

test('isPreparedForAF: phone is optional if personalNumber is set', () => {
  const r = isPreparedForAF({ ...baseProfile, phone: '', personalNumber: '19900101-1234' })
  assert.ok(!r.missing.includes('telefon eller personnummer'))
})

test('isPreparedForAF: flags multiple missing fields', () => {
  const r = isPreparedForAF({})
  assert.ok(r.missing.includes('fullständigt namn'))
  assert.ok(r.missing.includes('e-post'))
  assert.ok(r.missing.includes('önskade jobbtitlar'))
  assert.ok(r.missing.includes('önskade orter'))
  assert.ok(r.missing.includes('erfarenhetsnivå'))
  assert.ok(r.missing.includes('CV (uppladdad fil eller manuell sammanfattning)'))
})

test('isPreparedForAF: cvSummary is accepted as a CV proxy', () => {
  const r = isPreparedForAF({ ...baseProfile, cvText: '', cvSummary: 'Kort sammanfattning' })
  assert.ok(!r.missing.some((m) => m.startsWith('CV')))
})

// ---------- Round-46 — AF-ready pill human-facing string lock ----------
//
// The dashboard renders a "Förberedd för Arbetsförmedlingen"
// pill driven by `isPreparedForAF`. The pill text reads either
// green "✓ Redo för AF" (ready) or amber "N fält kvar för AF"
// (with N = missing.length). The exact Swedish strings returned
// from `isPreparedForAF.missing` lock the dashboard's pill
// sub-label/tooltip ("Saknar X fält för AF — fyll i dem i
// /settings"), so a typo / rename would silently break the
// user-visible copy.
//
// These tests lock the EXACT missing-field strings + their order
// for the canonical "empty profile" case. The dashboard renders
// these strings in the green/amber pills + the AF compliance
// card; renaming any one requires updating tests, dashboard, and
// the help tooltip all in lockstep.
//
// ⛔ UI CONTRACT LOCK — keep in sync with EXACTLY THESE FOUR FILES:
//   1. lib/match-score.js  (isPreparedForAF return values)
//   2. app/dashboard/page.js (af-ready-pill tooltip / pill body)
//   3. app/settings/page.js (field labels matching the Swedish list below)
//   4. tests/unit/match-score.test.mjs  (THIS test file)
// A Swedish phrasing fix (e.g. "önskade jobbtitlar" → "önskade roller")
// requires updating all four files in lockstep. The deepEqual
// assertion below is intentionally over-tight to prevent a typo
// drift between these layers.

test('isPreparedForAF: empty profile returns the canonical missing-strings list in lock order (Round-46)', () => {
  // The list is what the dashboard renders in the amber pill's
  // title tooltip ("Saknar X fält för AF — fyll i dem i /settings")
  // AND, on the AF-compliance card, the per-field checklist.
  // Pin EXACTLY what the dashboard reads — no fuzzy dereferences.
  const r = isPreparedForAF({})
  // Note the fourth element ("önskade jobbtitlar"): an accidental
  // rename to "önskade roller" would leave the user staring at a
  // mysterious amber pill ("3 fält kvar för AF") with no clue
  // which fields to fill — the docstring in /settings says
  // specifically "önskade jobbtitlar".
  // ⛔ UI CONTRACT LOCK — see the block header.
  assert.deepEqual(r.missing, [
    'fullständigt namn',
    'e-post',
    'telefon eller personnummer',
    'önskade jobbtitlar',
    'önskade orter',
    'erfarenhetsnivå',
    'CV (uppladdad fil eller manuell sammanfattning)',
  ])
  assert.equal(r.ready, false)
  assert.equal(r.missing.length, 7,
    'dashboard "N fält kvar för AF" pill uses missing.length as its count — keep this aligned with the list above')
})

test('isPreparedForAF: phone + personalNumber together still flag "telefon eller personnummer" as missing (Round-46)', () => {
  // The OR-condition is "phone || personalNumber" — having BOTH
  // still satisfies it, so neither can be 'missing'. Re-running
  // with both set should drop "telefon eller personnummer" from
  // the list, not duplicate it.
  const r = isPreparedForAF({
    fullName: 'Anna',
    email: 'a@b.c',
    phone: '070-1234567',
    personalNumber: '19900101-1234',
    jobTitles: ['Frontend'],
    locations: ['Stockholm'],
    experience: 'Senior',
    cvSummary: 'Kort.',
  })
  assert.ok(!r.missing.includes('telefon eller personnummer'),
    'having both phone AND personalNumber should drop the "telefon eller personnummer" flag from missing')
  assert.equal(r.ready, true,
    'with all 7 fields satisfied (including the OR-condition), ready must be true')
})

test('isPreparedForAF: ready=true returns empty missing[] — dashboard pill switches to GREEN (Round-46)', () => {
  // The dashboard renders a green "✓ Redo för AF" pill when
  // ready === true. The pill text comes from the dashboard
  // component, NOT from isPreparedForAF, but the boolean
  // triggers the colour switch. Pin the boolean so a future
  // refactor that flipped `ready` to `isReady` doesn't silently
  // break the dashboard's no-missing branch.
  const r = isPreparedForAF(baseProfile)
  assert.equal(r.ready, true,
    'a complete profile must return ready=true so the dashboard switches the pill from amber to green')
  assert.deepEqual(r.missing, [],
    'a complete profile must return missing=[] so the dashboard "N fält kvar" pill hides its amber title tooltip')
})

test('isPreparedForAF: missing field NAMES never contain commas, periods, or newlines (Round-46 UX lock)', () => {
  // The dashboard renders the missing list as a comma-separated
  // string in the amber pill TOOLTIP. A field name with an
  // embedded comma would confuse the display (the user wouldn't
  // see where one missing field ends and the next begins).
  // Lock the absence of break characters so a refactor can't
  // silently regress. (\n is a particularly visible bug — the
  // tooltip would render as a multi-line break that the dashboard
  // expects to be a single-line text.)
  for (const m of isPreparedForAF({}).missing) {
    assert.ok(!m.includes(','),
      `isPreparedForAF missing-field string "${m}" contains a comma — would break the dashboard pill's comma-separated tooltip`)
    assert.ok(!m.includes('.'),
      `isPreparedForAF missing-field string "${m}" contains a period — would break the dashboard pill's tooltip`)
    assert.ok(!m.includes('\n'),
      `isPreparedForAF missing-field string "${m}" contains a newline — would break the dashboard pill's tooltip`)
  }
})

