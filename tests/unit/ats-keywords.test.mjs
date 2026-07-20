// tests/unit/ats-keywords.test.mjs
//
// Unit tests for lib/ats-keywords.js. Validates keyword extraction
// (Swedish stop-words filtered, short tokens ignored), ATS match
// (coverage + missing/matched), and formatting-issues detection.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractAtsKeywords,
  atsMatch,
  detectCvFormattingIssues,
} from '../../lib/ats-keywords.js'

test('extractAtsKeywords: returns empty for missing / short input', () => {
  assert.deepEqual(extractAtsKeywords(''), { tokens: [], top: [] })
  assert.deepEqual(extractAtsKeywords(null), { tokens: [], top: [] })
  assert.deepEqual(extractAtsKeywords('   '), { tokens: [], top: [] })
})

test('extractAtsKeywords: filters Swedish stop-words', () => {
  const { top } = extractAtsKeywords('Frontend utvecklare med erfarenhet av React och TypeScript')
  assert.ok(top.includes('react') || top.includes('typescript'), 'tech tokens should be in top')
  assert.ok(!top.includes('och'), 'stop-word "och" should be filtered')
  assert.ok(!top.includes('med'), 'stop-word "med" should be filtered')
  assert.ok(!top.includes('av'), 'stop-word "av" should be filtered')
})

test('extractAtsKeywords: ignores tokens shorter than 4 chars', () => {
  const { top } = extractAtsKeywords('vi söker en bra utvecklare med stark kompetens')
  // "vi", "en", "är", "bra" — all 1-3 chars — should be dropped.
  // "stark" and "kompetens" and "utvecklare" are >= 4 chars.
  assert.ok(!top.includes('vi'))
  assert.ok(!top.includes('en'))
  assert.ok(!top.includes('bra'))
  assert.ok(top.includes('utvecklare') || top.includes('kompetens') || top.includes('stark'))
})

test('extractAtsKeywords: returns top N sorted by frequency', () => {
  const desc = 'React React React TypeScript TypeScript Python Java Java Java Java'
  const { top } = extractAtsKeywords(desc, { max: 3 })
  assert.equal(top.length, 3)
  assert.equal(top[0], 'java', 'most frequent first')
  assert.equal(top[1], 'react', 'next most frequent')
  assert.equal(top[2], 'typescript', 'next')
})

test('extractAtsKeywords: respects max option', () => {
  const desc = 'apple banana cherry date elder fig grape'
  const { top } = extractAtsKeywords(desc, { max: 2 })
  assert.equal(top.length, 2)
})

test('atsMatch: returns 0% when no keywords in description', () => {
  const r = atsMatch('whatever', '')
  assert.equal(r.coverage, 0)
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.matched, [])
})

test('atsMatch: high coverage when CV contains all keywords', () => {
  const cv = 'Frontend-utvecklare med erfarenhet av React, TypeScript och Node.js. Agil miljö.'
  const desc = 'Vi söker en React-utvecklare med TypeScript-erfarenhet för vårt agila team.'
  const r = atsMatch(cv, desc)
  assert.ok(r.coverage >= 50, `expected >= 50, got ${r.coverage}`)
})

test('atsMatch: returns missing list for uncovered keywords', () => {
  const cv = 'Frontend-utvecklare med React-erfarenhet'
  const desc = 'Vi söker Kubernetes- och Terraform-specialist med Python-bakgrund'
  const r = atsMatch(cv, desc)
  assert.ok(r.missing.length > 0, 'should have at least one missing')
  // At least one of the listed techs should be missing.
  assert.ok(r.missing.some((k) => /kubernetes|terraform|python/.test(k)))
})

test('atsMatch: matched list is non-empty for partial overlap', () => {
  const cv = 'Frontend-utvecklare med React-erfarenhet'
  const desc = 'Vi söker en React-utvecklare med Kubernetes-erfarenhet'
  const r = atsMatch(cv, desc)
  assert.ok(r.matched.length > 0, 'should have at least one match')
})

test('detectCvFormattingIssues: returns empty for empty text', () => {
  assert.deepEqual(detectCvFormattingIssues('').issues, [])
  assert.deepEqual(detectCvFormattingIssues(null).issues, [])
})

test('detectCvFormattingIssues: flags too-short summary', () => {
  const r = detectCvFormattingIssues('Frontend-utvecklare')
  assert.ok(r.issues.some((i) => i.key === 'too-short'))
})

test('detectCvFormattingIssues: flags mixed date separators', () => {
  const text = `Anna Andersson
2019-2020 Senior Developer
2021–2023 Tech Lead
2023-2024 Principal`
  const r = detectCvFormattingIssues(text)
  assert.ok(r.issues.some((i) => i.key === 'date-separator-mix'))
})

test('detectCvFormattingIssues: passes for clean CV', () => {
  // Pad to well over 200 chars to clear the "too-short" check
  // and isolate the section/separator checks.
  const text = `Anna Andersson — senior mjukvaruutvecklare med tio års erfarenhet av storskaliga system, mikrotjänster och team-arbete i agila miljöer.
Erfarenhet
2019-2024 Senior Developer
2015-2019 Tech Lead
Utbildning
2011-2015 KTH Civilingenjör
Kompetenser
React, TypeScript, Node.js
Språk
Svenska, Engelska`
  const r = detectCvFormattingIssues(text)
  // No "too-short", no mixed separators, has 4 sections.
  assert.equal(r.issues.length, 0, `expected 0 issues, got ${JSON.stringify(r.issues)}`)
})

test('detectCvFormattingIssues: flags missing sections', () => {
  const text = `Anna Andersson
React, TypeScript, Node.js
Some more content to get past the length check so we can isolate the section test. Adding more text here.`
  // Pad to > 200 chars.
  const padded = text + ' ' + 'x'.repeat(300)
  const r = detectCvFormattingIssues(padded)
  assert.ok(r.issues.some((i) => i.key === 'sections-missing'))
})
