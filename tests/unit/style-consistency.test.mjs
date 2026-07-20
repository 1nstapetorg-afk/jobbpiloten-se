// tests/unit/style-consistency.test.mjs
//
// Unit tests for lib/style-consistency.js. Validates the
// "same company + different styles" warning logic + the
// Swedish copy renderer.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findStyleInconsistencies,
  renderInconsistencyCopy,
  STYLE_CONSISTENCY_WINDOW_DAYS,
} from '../../lib/style-consistency.js'

const NOW = new Date('2024-06-15T12:00:00Z').getTime()
const dayBefore = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

test('returns empty warnings for empty / null input', () => {
  assert.deepEqual(findStyleInconsistencies([]), { warnings: [] })
  assert.deepEqual(findStyleInconsistencies(null), { warnings: [] })
  assert.deepEqual(findStyleInconsistencies(undefined), { warnings: [] })
})

test('returns empty warnings when all answers lack a company', () => {
  const answers = [
    { id: '1', style: 'lagom', updatedAt: dayBefore(1) },
    { id: '2', style: 'direkt', updatedAt: dayBefore(1) },
  ]
  assert.deepEqual(findStyleInconsistencies(answers, { now: NOW }).warnings, [])
})

test('flags warn when same company has two distinct user-chosen styles', () => {
  const answers = [
    { id: '1', company: 'Spotify', style: 'lagom', updatedAt: dayBefore(2) },
    { id: '2', company: 'Spotify', style: 'direkt', updatedAt: dayBefore(1) },
  ]
  const r = findStyleInconsistencies(answers, { now: NOW })
  assert.equal(r.warnings.length, 1)
  assert.equal(r.warnings[0].company, 'Spotify')
  assert.equal(r.warnings[0].severity, 'warn')
  assert.deepEqual(Object.keys(r.warnings[0].styles).sort(), ['direkt', 'lagom'])
})

test('no warning when same company + same style', () => {
  const answers = [
    { id: '1', company: 'Spotify', style: 'lagom', updatedAt: dayBefore(2) },
    { id: '2', company: 'Spotify', style: 'lagom', updatedAt: dayBefore(1) },
  ]
  const r = findStyleInconsistencies(answers, { now: NOW })
  assert.equal(r.warnings.length, 0)
})

test('flags info when company has one style + no-style entries', () => {
  const answers = [
    { id: '1', company: 'Spotify', style: 'lagom', updatedAt: dayBefore(2) },
    { id: '2', company: 'Spotify', updatedAt: dayBefore(1) }, // no style
  ]
  const r = findStyleInconsistencies(answers, { now: NOW })
  assert.equal(r.warnings.length, 1)
  assert.equal(r.warnings[0].severity, 'info')
})

test('merges "Spotify" + "Spotify AB" + "spotify" into one group', () => {
  const answers = [
    { id: '1', company: 'Spotify', style: 'lagom', updatedAt: dayBefore(2) },
    { id: '2', company: 'Spotify AB', style: 'direkt', updatedAt: dayBefore(1) },
    { id: '3', company: 'spotify', style: 'engagerad', updatedAt: dayBefore(1) },
  ]
  const r = findStyleInconsistencies(answers, { now: NOW })
  assert.equal(r.warnings.length, 1, 'normalised merge should collapse to one warning')
  assert.equal(r.warnings[0].company, 'Spotify', 'first-seen casing wins')
  assert.equal(Object.keys(r.warnings[0].styles).length, 3)
})

test('skips entries outside the 30-day window', () => {
  const answers = [
    { id: '1', company: 'Spotify', style: 'lagom', updatedAt: dayBefore(45) },
    { id: '2', company: 'Spotify', style: 'direkt', updatedAt: dayBefore(1) },
  ]
  const r = findStyleInconsistencies(answers, { now: NOW })
  // The 45-day-old entry is outside the window; the recent entry
  // is the only one in scope, so no inconsistency.
  assert.equal(r.warnings.length, 0)
})

test('exposes window constant for tests', () => {
  assert.equal(STYLE_CONSISTENCY_WINDOW_DAYS, 30)
})

test('renderInconsistencyCopy: produces Swedish copy for warn severity', () => {
  const warning = {
    company: 'Spotify',
    severity: 'warn',
    styles: { lagom: 1, direkt: 2 },
    entries: [],
  }
  const copy = renderInconsistencyCopy(warning)
  assert.ok(copy.includes('Spotify'))
  assert.ok(copy.includes('lagom'))
  assert.ok(copy.includes('direkt'))
  assert.ok(copy.includes('olika skrivstilar'))
})

test('renderInconsistencyCopy: handles info severity + no-style', () => {
  const warning = {
    company: 'Klarna',
    severity: 'info',
    styles: { lagom: 1, __no_style__: 3 },
    entries: [],
  }
  const copy = renderInconsistencyCopy(warning)
  assert.ok(copy.includes('Klarna'))
  assert.ok(copy.includes('3'))
  assert.ok(copy.includes('skrivstil'))
})
