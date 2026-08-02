// tests/unit/cv-extract.test.mjs
//
// 2026-08-02 — locks lib/cv-extract.js: the pure
// parseExtractedFields() sanitizer (LLM JSON → canonical profile
// fields) plus the static contract of extractCvFields()'s prompt
// (strict-JSON requirement). The AI extraction powers the editable
// "Granska extraherade uppgifter" review panel in CVFileUpload.jsx —
// a regression here would dump malformed data into the user's
// profile fields.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseExtractedFields,
  EXPERIENCE_LEVELS,
  SUMMARY_MAX_CHARS,
} from '../../lib/cv-extract.js'

// ---- parseExtractedFields: happy path ----

test('parses a valid JSON payload into canonical fields', () => {
  const out = parseExtractedFields(JSON.stringify({
    skills: ['React', 'Node.js', 'TypeScript'],
    experience: 'Medior',
    yearsExperience: 6,
    currentJobTitle: 'Frontend-utvecklare',
    currentOrganization: 'Acme AB',
    education: 'Civilingenjör Datateknik',
    summary: 'Erfaren frontendutvecklare med fokus på React.',
  }))
  assert.deepEqual(out.skills, ['Node.js', 'React', 'TypeScript']) // sorted
  assert.equal(out.experience, 'Medior')
  assert.equal(out.yearsExperience, 6)
  assert.equal(out.currentJobTitle, 'Frontend-utvecklare')
  assert.equal(out.currentOrganization, 'Acme AB')
  assert.equal(out.education, 'Civilingenjör Datateknik')
  assert.equal(out.summary, 'Erfaren frontendutvecklare med fokus på React.')
})

// ---- sanitisation ----

test('skills are deduped, trimmed, capped at 50 items of ≤100 chars', () => {
  const dupes = ['React', ' react ', 'React', 'a'.repeat(101), '', 'Node']
  const out = parseExtractedFields(JSON.stringify({ skills: dupes }))
  assert.deepEqual(out.skills, ['Node', 'React'])
  const many = Array.from({ length: 80 }, (_, i) => `skill-${i}`)
  const out2 = parseExtractedFields(JSON.stringify({ skills: many }))
  assert.equal(out2.skills.length, 50)
})

test('experience is normalised to Junior | Medior | Senior', () => {
  assert.equal(parseExtractedFields('{"experience":"junior"}').experience, 'Junior')
  assert.equal(parseExtractedFields('{"experience":"SENIOR"}').experience, 'Senior')
  assert.equal(parseExtractedFields('{"experience":"med"}').experience, 'Medior')
  assert.equal(parseExtractedFields('{"experience":"okänt"}').experience, '')
  assert.equal(parseExtractedFields('{"experience":null}').experience, '')
})

test('yearsExperience is floored and clamped to 0..60', () => {
  assert.equal(parseExtractedFields('{"yearsExperience":"7.9"}').yearsExperience, 7)
  assert.equal(parseExtractedFields('{"yearsExperience":-3}').yearsExperience, null)
  assert.equal(parseExtractedFields('{"yearsExperience":200}').yearsExperience, null)
  assert.equal(parseExtractedFields('{"yearsExperience":"abc"}').yearsExperience, null)
  assert.equal(parseExtractedFields('{}').yearsExperience, null)
})

test('education / currentJobTitle / currentOrganization are capped at 300 chars', () => {
  const long = 'x'.repeat(400)
  const out = parseExtractedFields(JSON.stringify({ education: long, currentJobTitle: long, currentOrganization: long }))
  assert.equal(out.education, '')
  assert.equal(out.currentJobTitle, '')
  assert.equal(out.currentOrganization, '')
  assert.equal(parseExtractedFields('{"education":"KTH"}').education, 'KTH')
})

test('summary is clamped to the settings cap (1500 chars)', () => {
  const long = 'y'.repeat(2000)
  const out = parseExtractedFields(JSON.stringify({ summary: long }))
  assert.equal(out.summary.length, SUMMARY_MAX_CHARS)
})

// ---- robustness / fallbacks ----

test('markdown-fenced JSON is parsed (code fences stripped)', () => {
  const raw = '```json\n{"skills":["A"],"experience":"Senior"}\n```'
  const out = parseExtractedFields(raw)
  assert.deepEqual(out.skills, ['A'])
  assert.equal(out.experience, 'Senior')
})

test('embedded JSON inside prose is extracted via the brace block', () => {
  const raw = 'Här är resultatet: {"skills":["Python"],"education":"Lund"} och klart.'
  const out = parseExtractedFields(raw)
  assert.deepEqual(out.skills, ['Python'])
  assert.equal(out.education, 'Lund')
})

test('garbage input yields safe defaults — never throws', () => {
  const out = parseExtractedFields('totally not json', 'Men här nämns Senior i brödtexten')
  assert.equal(out.experience, 'Senior') // regex fallback on source text
  assert.deepEqual(out.skills, [])
  assert.equal(out.yearsExperience, null)

  const empty = parseExtractedFields('')
  assert.deepEqual(empty.skills, [])
  assert.equal(empty.experience, '')
})

test('EXPERIENCE_LEVELS is exactly the canonical three levels', () => {
  assert.deepEqual(EXPERIENCE_LEVELS, ['Junior', 'Medior', 'Senior'])
})

// ---- Round-80 edge-case additions ----

test('non-string skill items (numbers / null / nested arrays) are skipped', () => {
  const out = parseExtractedFields(JSON.stringify({
    skills: ['React', 42, null, ['Nested'], { x: 1 }, true, 'Node'],
  }))
  assert.deepEqual(out.skills, ['Node', 'React'])
})

test('unknown / extra JSON keys are ignored (never crash, never leak into output)', () => {
  const out = parseExtractedFields(JSON.stringify({
    skills: ['A'],
    hobbies: ['kayaking'],
    favoriteColor: 'blue',
    $dangerous: 'x',
  }))
  assert.deepEqual(out.skills, ['A'])
  assert.equal(out.experience, '')
  assert.equal(out.yearsExperience, null)
  // No unexpected keys on the output object.
  assert.deepEqual(Object.keys(out).sort(), [
    'currentJobTitle',
    'currentOrganization',
    'education',
    'experience',
    'skills',
    'summary',
    'yearsExperience',
  ])
})

test('skills are case-insensitively deduped (keep first-seen casing)', () => {
  const out = parseExtractedFields(JSON.stringify({ skills: ['React', 'react', 'REACT', 'Vue', 'vue'] }))
  assert.deepEqual(out.skills, ['React', 'Vue']) // sorted, first-seen casing preserved
})

test('summary is whitespace-trimmed and stays clamped to the cap', () => {
  const padded = '  Erfaren utvecklare.\n\n  '
  const out = parseExtractedFields(JSON.stringify({ summary: padded }))
  assert.equal(out.summary, 'Erfaren utvecklare.')

  const long = 'y'.repeat(1600)
  assert.equal(parseExtractedFields(JSON.stringify({ summary: long })).summary.length, SUMMARY_MAX_CHARS)
})

test('regex fallback maps junior/senior plural forms to canonical levels', () => {
  assert.equal(parseExtractedFields('no json here', 'Han är senior utvecklare').experience, 'Senior')
  assert.equal(parseExtractedFields('no json here', 'Vi söker juniorer').experience, 'Junior')
  assert.equal(parseExtractedFields('no json here', 'Ingen nivå nämns').experience, '')
})

test('whitespace-only short strings are rejected (not just length-capped)', () => {
  const out = parseExtractedFields(JSON.stringify({
    currentJobTitle: '   ',
    currentOrganization: '\t\n',
    education: 'KTH',
  }))
  assert.equal(out.currentJobTitle, '')
  assert.equal(out.currentOrganization, '')
  assert.equal(out.education, 'KTH')
})

// ---- static contract: extractCvFields prompt ----

const CV_EXTRACT_SRC = readFileSync('lib/cv-extract.js', 'utf8')

test('extractCvFields demands STRICT JSON with the canonical field set', () => {
  assert.match(CV_EXTRACT_SRC, /ENDAST\s+ett\s+giltigt\s+JSON-objekt/, 'prompt must demand strict JSON only')
  for (const key of ['"skills"', '"experience"', '"yearsExperience"', '"currentJobTitle"', '"currentOrganization"', '"education"', '"summary"']) {
    assert.ok(CV_EXTRACT_SRC.includes(key), `prompt must include field ${key}`)
  }
  assert.match(CV_EXTRACT_SRC, /Hitta\s+INTE\s+på\s+uppgifter/, 'prompt must forbid hallucinated facts')
})

test('extractCvFields returns null for empty / missing text (no LLM call)', async () => {
  const { extractCvFields } = await import('../../lib/cv-extract.js')
  assert.equal(await extractCvFields(''), null)
  assert.equal(await extractCvFields('   '), null)
  assert.equal(await extractCvFields(null), null)
})
