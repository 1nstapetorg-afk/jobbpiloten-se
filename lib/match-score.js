// lib/match-score.js
//
// Part 7 — Arbetsförmedlingen deepening. Match-score computation
// for AF jobs against a profile.
//
// Returns { score: 0-100, explanation: { roll, ort, erfarenhet, anställning, remote, språk } }
// — the breakdown drives the "Matchar: roll (100%), ort (100%)…"
// user-facing copy on the dashboard card.
//
// Scoring algorithm (soft-launch, no ML):
//   1. roll (job title) — 40 points
//      Does the title include any of the profile's jobTitles? Case-
//      insensitive substring match. Multi-word matches weighted
//      proportionally.
//   2. ort (location) — 25 points
//      Reuses doesJobMatchUserLocation from lib/swedishLocations.js.
//      Bonus if the job is remote-friendly + the profile has
//      "Distans" / "Remote" in locations.
//   3. erfarenhet (experience) — 15 points
//      AF jobs often expose seniority via the headline (Junior /
//      Medior / Senior). If the profile.experience matches the
//      detected seniority → full points; else 0.
//   4. anställningstyp (employment type) — 10 points
//      AF's employment_type maps to one of the canonical 6 slugs
//      (lib/jobScraper.normalizeEmploymentType). If the user has
//      the matching slug in profile.employmentType → full points.
//      Empty profile.employmentType = no filter = full points.
//   5. remote bonus — 5 points
//      If the profile says "Distans" AND the job allows remote
//      → +5. Capped at 100.
//
// Returns 0 for fields the profile hasn't set yet (so a brand-new
// profile still gets a 0-100 number rather than a 0-from-missing).
//
// The helper is pure-JS so it's testable in node --test without
// Mongo / network.

import { doesJobMatchUserLocation, isRemoteFriendlyText } from './swedishLocations.js'
import { normalizeEmploymentType } from './jobScraper.js'

// ---- Seniority detection ----
//
// The AF headline often includes Swedish seniority markers. We
// check for them as substrings AFTER the diacritic-strip pass so
// "Senior" / "senior" / "SENIOR" all match.
const SENIORITY_KEYWORDS = {
  Junior: /\b(junior|jun\.?|nybörjare|entry[- ]level)\b/i,
  Medior: /\b(medior|med\.?|mid[- ]level|intermediate)\b/i,
  Senior: /\b(senior|sen\.?|lead|principal|staff|expert)\b/i,
}

function detectSeniority(text) {
  const t = String(text || '').toLowerCase()
  if (!t) return ''
  for (const [level, re] of Object.entries(SENIORITY_KEYWORDS)) {
    if (re.test(t)) return level
  }
  return ''
}

function rollScore(jobTitle, jobTitles) {
  if (!jobTitle || !Array.isArray(jobTitles) || jobTitles.length === 0) return 0
  const t = jobTitle.toLowerCase()
  let hits = 0
  for (const title of jobTitles) {
    const needle = String(title || '').toLowerCase().trim()
    if (!needle) continue
    if (t.includes(needle)) {
      // Full-title match. The full-title hit is the strongest
      // signal we can give without an LLM — assign the full
      // 40 points (caller caps the sum at 100 anyway).
      hits = Math.max(hits, 40)
    } else {
      // Word-level partial: any of the title's words appears in the
      // job's title. We weight 4 per matched word, capped at 16 —
      // a single keyword match is a weaker signal than a full
      // title match.
      const words = needle.split(/\s+/).filter((w) => w.length >= 4)
      let wordHits = 0
      for (const w of words) {
        if (t.includes(w)) wordHits += 1
      }
      hits = Math.max(hits, Math.min(16, wordHits * 4))
    }
  }
  return Math.min(40, hits)
}

function ortScore(job, userLocations) {
  if (!job || !Array.isArray(userLocations) || userLocations.length === 0) return 0
  if (doesJobMatchUserLocation(job, userLocations)) return 25
  // Partial credit: the job is in a known Swedish municipality
  // but the user hasn't listed it. 0 is the honest answer — better
  // to surface the mismatch than to give a false positive.
  return 0
}

function erfarenhetScore(job, experience) {
  if (!experience) return 0
  const detected = detectSeniority(job?.title)
  if (!detected) {
    // AF job without a seniority marker — can't penalise, can't
    // reward. Return 7 (partial) so the overall score doesn't
    // tank a "good" job just because the headline was bare.
    return 7
  }
  return detected === experience ? 15 : 0
}

function anstallningScore(job, employmentTypes) {
  if (!Array.isArray(employmentTypes) || employmentTypes.length === 0) {
    // No filter = pass through. This matches the dashboard's
    // "tomt = alla typer visas" semantics.
    return 10
  }
  const slug = normalizeEmploymentType(job?.employmentType)
  return employmentTypes.includes(slug) ? 10 : 0
}

function remoteBonus(job, userLocations) {
  if (!Array.isArray(userLocations)) return 0
  const userHasRemote = userLocations.some(isRemoteFriendlyText)
  if (!userHasRemote) return 0
  // Job supports remote if either (a) the description mentions
  // distans / remote, or (b) the location is set to a "Remote"
  // sentinel. The location sentinel is rare in AF; description
  // is the common path.
  const desc = String(job?.description || '').toLowerCase()
  if (/(distans|remote|hemifr[åa]n|var som helst|hela sverige)/i.test(desc)) {
    return 5
  }
  return 0
}

/**
 * computeMatchScore — pure function. Takes a job (the internal
 * format from lib/jobScraper) + a profile (the shape from
 * /api/profile), returns a { score, explanation, factors } object
 * suitable for direct rendering on a job card.
 *
 * Edge cases:
 *   - profile.jobTitles empty / missing → rollScore = 0 (don't
 *     pretend to know what the user wants).
 *   - job.title missing → rollScore = 0 + erfarenhetScore = 7
 *     (partial credit, see comment).
 *   - job.employmentType missing → normalizeEmploymentType falls
 *     back to 'heltid' which is the "passes the filter" outcome
 *     for the 90% of users who don't list employmentType.
 */
export function computeMatchScore(job, profile) {
  const explanation = {
    roll: 0,
    ort: 0,
    erfarenhet: 0,
    anställning: 0,
    remote: 0,
  }
  explanation.roll = rollScore(job?.title, profile?.jobTitles)
  explanation.ort = ortScore(job, profile?.locations)
  explanation.erfarenhet = erfarenhetScore(job, profile?.experience)
  explanation.anställning = anstallningScore(job, profile?.employmentType)
  explanation.remote = remoteBonus(job, profile?.locations)
  const raw = explanation.roll + explanation.ort + explanation.erfarenhet + explanation.anställning + explanation.remote
  const score = Math.max(0, Math.min(100, raw))
  return {
    score,
    explanation,
    // Flat list of "X%" copy for the dashboard card subtitle.
    factors: [
      { key: 'roll', label: 'roll', value: Math.round((explanation.roll / 40) * 100) },
      { key: 'ort', label: 'ort', value: Math.round((explanation.ort / 25) * 100) },
      { key: 'erfarenhet', label: 'erfarenhet', value: Math.round((explanation.erfarenhet / 15) * 100) },
      { key: 'anställning', label: 'anställningstyp', value: Math.round((explanation.anställning / 10) * 100) },
      { key: 'remote', label: 'distans', value: Math.round((explanation.remote / 5) * 100) },
    ],
  }
}

/**
 * isPreparedForAF — whether the profile has enough information for
 * an AF compliance journey. Returns { ready, missing: [field, …] }.
 *
 * The dashboard surfaces this as a "Förberedd för Arbetsförmedlingen"
 * pill (green = ready, amber = missing N fields). The list is what
 * the user can act on in the /settings page.
 */
export function isPreparedForAF(profile) {
  const missing = []
  if (!profile?.fullName) missing.push('fullständigt namn')
  if (!profile?.email) missing.push('e-post')
  if (!profile?.phone && !profile?.personalNumber) missing.push('telefon eller personnummer')
  if (!Array.isArray(profile?.jobTitles) || profile.jobTitles.length === 0) {
    missing.push('önskade jobbtitlar')
  }
  if (!Array.isArray(profile?.locations) || profile.locations.length === 0) {
    missing.push('önskade orter')
  }
  if (!profile?.experience) missing.push('erfarenhetsnivå')
  if (!profile?.cvText && !profile?.cvSummary) {
    missing.push('CV (uppladdad fil eller manuell sammanfattning)')
  }
  return { ready: missing.length === 0, missing }
}
