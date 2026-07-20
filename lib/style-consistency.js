// lib/style-consistency.js
//
// Part 3 — Consistency check. Warns when a user has answered the
// same company with two different writing styles within a short
// window. Soft-launch design: this is a *flag* surfaced in the
// AnswerMemoryCard ("Du har använt olika skrivstilar för Spotify:
// 'lagom' 3 jan, 'direkt' 9 jan. Vill du harmonisera?") — the
// user can either ignore it or pick the "harmonize" action which
// triggers a server-side rewrite of the older entries.
//
// The helper is pure-JS so the unit tests can lock the contract
// without Mongo. The /settings page calls it with the user's
// saved_answers corpus + a per-answer `company` field; pre-Round-42
// answers have no `company` set and are skipped (the consistency
// check is opt-in by virtue of having a company to compare on).

import { ALLOWED_STYLE_IDS } from './style-presets.mjs'

const WINDOW_DAYS = 30

// Normalise a company string for grouping. The form hosts we care
// about (Workday, Greenhouse, Teamtailor, Platsbanken) all
// capitalise the first letter but the user's saved answers may
// have lower-case. We also strip trailing ".com" / "AB" / "Inc"
// to merge "Spotify" / "Spotify AB" into one bucket.
function normaliseCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(ab|inc|llc|ltd|svenska|sweden)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find companies with mixed-style answers within the last
 * WINDOW_DAYS days. Returns:
 *   { warnings: [{ company, styles: { id: count }, entries: [...] }] }
 *
 * Entries without a `company` field are skipped (the check is
 * opt-in). Entries without a `style` field are grouped under
 * `__no_style__` and surfaced as a separate warning so the user
 * knows some of their older answers are styleless.
 *
 * `now` defaults to Date.now() so tests can inject a fixed time
 * without touching the system clock.
 */
export function findStyleInconsistencies(answers, { now = Date.now() } = {}) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return { warnings: [] }
  }
  const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000
  const cutoff = now - WINDOW_MS
  // Group by normalised company name. Each group holds the
  // distinct style ids that appeared + a count per style + the
  // raw entries (so the UI can deep-link to a "harmonize" view).
  const groups = new Map()
  for (const a of answers) {
    if (!a || typeof a !== 'object') continue
    const company = a.company || a.jobCompany
    if (!company || !String(company).trim()) continue
    const key = normaliseCompany(company)
    if (!key) continue
    // The check is "within window"; entries with a future
    // updatedAt are clamped to now (test data hygiene).
    const updatedTs = a.updatedAt ? new Date(a.updatedAt).getTime() : null
    if (updatedTs != null && Number.isFinite(updatedTs) && updatedTs < cutoff) {
      continue
    }
    const styleKey = (a.style && ALLOWED_STYLE_IDS.has(a.style)) ? a.style : '__no_style__'
    let group = groups.get(key)
    if (!group) {
      group = {
        company: String(company).trim(),
        styles: {},
        entries: [],
      }
      groups.set(key, group)
    }
    group.styles[styleKey] = (group.styles[styleKey] || 0) + 1
    group.entries.push({
      id: a.id,
      field: a.field,
      style: a.style || null,
      updatedAt: a.updatedAt || null,
    })
  }
  const warnings = []
  for (const group of groups.values()) {
    const distinctStyles = Object.keys(group.styles).filter((k) => k !== '__no_style__')
    const hasNoStyle = !!group.styles['__no_style__']
    // Two distinct user-chosen styles (excluding the no-style
    // bucket) → real inconsistency. One user style + older
    // no-style entries → a "soft" warning so the user can decide
    // whether to upgrade.
    if (distinctStyles.length > 1) {
      warnings.push({
        company: group.company,
        severity: 'warn',
        styles: group.styles,
        entries: group.entries,
      })
    } else if (distinctStyles.length === 1 && hasNoStyle) {
      warnings.push({
        company: group.company,
        severity: 'info',
        styles: group.styles,
        entries: group.entries,
      })
    }
  }
  return { warnings }
}

/**
 * Render a Swedish-language warning line for a single group. The
 * settings card concatenates these. Pure function so the unit
 * tests can lock the exact copy.
 */
export function renderInconsistencyCopy(warning) {
  const styleList = Object.entries(warning.styles || {})
    .filter(([k]) => k !== '__no_style__')
    .map(([k, n]) => `${n}× ${k}`)
    .join(', ')
  const noStyle = warning.styles?.__no_style__ || 0
  if (warning.severity === 'warn') {
    return `Du har använt olika skrivstilar för ${warning.company}: ${styleList}. Vill du harmonisera?`
  }
  if (noStyle > 0) {
    return `${warning.company} har ${noStyle} äldre svar utan vald skrivstil — välj en stil för att harmonisera.`
  }
  return `${warning.company}: ${styleList}`
}

// ---- Pure constants (exported for tests) ----
export const STYLE_CONSISTENCY_WINDOW_DAYS = WINDOW_DAYS
