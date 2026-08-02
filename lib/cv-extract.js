// lib/cv-extract.js
//
// 2026-08-02 — structured field extraction from CV text. The upload-cv
// route extracts raw text from a PDF/DOCX/image, but the profile only
// gains value when that text is mapped onto the user's profile fields
// (skills, experience level, current job, education, summary) — and is
// EDITABLE before it's saved. This module:
//
//   1. `extractCvFields(cvText)` — LLM call (via lib/groq.js
//      generateText, same provider priority as everything else) asking
//      for STRICT JSON with the canonical field set, then
//      parseExtractedFields() sanitises it.
//   2. `parseExtractedFields(raw, sourceText)` — pure, unit-testable
//      parser + sanitizer:
//        • strips markdown fences, extracts the first {...} JSON block
//        • falls back to a regex sweep on the raw text when JSON parse
//          fails (the LLM occasionally wraps output in prose)
//        • clamps every field to the profile schema's validators:
//          skills      → ≤ 50 items, each ≤ 100 chars, deduped, sorted
//          experience  → one of Junior | Medior | Senior
//          yearsExperience → int 0..60
//          education / currentJobTitle / currentOrganization → short strings
//          summary     → ≤ 1500 chars (matches the settings cvSummary cap)
//
// Field set mirrors the profile-update ALLOWED list in
// app/api/[[...path]]/route.js so the review-panel "Spara till profil"
// POST can forward the keys verbatim.
//
// Pure helpers are exported for node --test; extractCvFields is I/O.

import { generateText } from './groq.js'

export const EXPERIENCE_LEVELS = ['Junior', 'Medior', 'Senior']

export const SUMMARY_MAX_CHARS = 1500
export const STRING_FIELD_MAX = 300
export const SKILLS_MAX = 50
export const SKILL_ITEM_MAX = 100
export const YEARS_MAX = 60

/**
 * Pure parser + sanitizer for the LLM's JSON output. Never throws —
 * returns a canonical { skills, experience, currentJobTitle,
 * currentOrganization, yearsExperience, education, summary } object
 * with safe defaults for anything unparseable. `sourceText` is used
 * only for the regex fallback sweep when JSON.parse fails.
 */
export function parseExtractedFields(raw, sourceText = '') {
  const out = {
    skills: [],
    experience: '',
    currentJobTitle: '',
    currentOrganization: '',
    yearsExperience: null,
    education: '',
    summary: '',
  }
  const text = String(raw || '').trim()
  let data = null
  if (text) {
    // Try direct JSON first.
    try {
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()
      data = JSON.parse(cleaned)
    } catch (_) {
      // Fallback 1: extract the first balanced { ... } block.
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start !== -1 && end > start) {
        try { data = JSON.parse(text.slice(start, end + 1)) } catch (_) { data = null }
      }
    }
  }
  if (!data || typeof data !== 'object') {
    // Fallback 2: regex sweep over the raw source text for a few
    // high-value fields (skills-like tokens are too noisy to guess).
    const t = String(sourceText || '')
    // Swedish plural forms ("juniorer", "mediorer", "seniorer") plus
    // English-style plurals ("juniors") all map to a canonical level.
    const expMatch = t.match(/\b(Junior|Medior|Senior|junior(?:s|er)?|medior(?:s|er)?|senior(?:s|er)?)\b/i)
    if (expMatch) {
      const norm = expMatch[1].toLowerCase()
      out.experience = norm.startsWith('jun') ? 'Junior' : norm.startsWith('med') ? 'Medior' : 'Senior'
    }
    return out
  }

  // ---- skills ----
  if (Array.isArray(data.skills)) {
    // Case-insensitive dedupe (keep first-seen casing): "React" and
    // "react" from the same CV must collapse to one entry.
    const seen = new Map()
    const clean = []
    for (const raw of data.skills) {
      const s = typeof raw === 'string' ? raw.trim() : ''
      if (!s || s.length > SKILL_ITEM_MAX) continue
      const key = s.toLowerCase()
      if (seen.has(key)) continue
      seen.set(key, true)
      clean.push(s)
    }
    out.skills = clean.sort().slice(0, SKILLS_MAX)
  }

  // ---- experience (level) ----
  const exp = String(data.experience || '')
  const expNorm = exp.toLowerCase()
  if (EXPERIENCE_LEVELS.includes(exp)) {
    out.experience = exp
  } else if (/jun/i.test(expNorm)) {
    out.experience = 'Junior'
  } else if (/med/i.test(expNorm)) {
    out.experience = 'Medior'
  } else if (/sen/i.test(expNorm)) {
    out.experience = 'Senior'
  }

  // ---- yearsExperience ----
  const years = Number(data.yearsExperience)
  if (Number.isFinite(years) && years >= 0 && years <= YEARS_MAX) {
    out.yearsExperience = Math.floor(years)
  }

  // ---- short strings ----
  for (const key of ['currentJobTitle', 'currentOrganization', 'education']) {
    const v = String(data[key] || '').trim()
    if (v && v.length <= STRING_FIELD_MAX) out[key] = v
  }

  // ---- summary (clamped to the settings cvSummary cap) ----
  const summary = String(data.summary || '').trim()
  if (summary) out.summary = summary.slice(0, SUMMARY_MAX_CHARS)

  return out
}

/**
 * AI extraction of structured CV fields. Returns the parsed object, or
 * null when there's no text, no LLM key, or the model returns nothing
 * useful (callers then skip the review panel — the raw cvText is still
 * saved and used by the cover-letter/email prompts).
 */
export async function extractCvFields(cvText) {
  const text = String(cvText || '').trim()
  if (!text) return null
  const prompt = [
    'Du är en rekryteringsassistent som strukturerar CV-text till profildata.',
    '',
    'Extrahera följande från CV:t och returnera ENDAST ett giltigt JSON-objekt (ingen annan text, inga markdown-fences):',
    '{',
    '  "skills": ["...", "..."],            // 5-15 mest relevanta kompetenser, på svenska eller engelska',
    '  "experience": "Junior|Medior|Senior", // samlad erfarenhetsnivå',
    '  "yearsExperience": 0,                 // heltal, antal års arbetslivserfarenhet',
    '  "currentJobTitle": "",                // nuvarande eller senaste yrkestitel',
    '  "currentOrganization": "",            // nuvarande eller senaste arbetsgivare',
    '  "education": "",                      // högsta utbildning, kort (t.ex. "Civilingenjör Datateknik")',
    '  "summary": ""                         // 2-3 meningars sammanfattning (max 1500 tecken)',
    '}',
    '',
    'Regler:',
    '- Hitta INTE på uppgifter som inte finns i CV:t. Okända fält = tom sträng / null.',
    '- skills: bara färdigheter som faktiskt nämns.',
    '- summary: skriv på svenska, tredje person, faktabaserat.',
    '',
    'CV-TEXT:',
    text.slice(0, 8000),
    '',
    'JSON:',
  ].join('\n')
  try {
    const raw = await generateText(prompt, { maxTokens: 700, temperature: 0.2 })
    if (!raw || raw.length < 10) return null
    const parsed = parseExtractedFields(raw, text)
    // Require at least one useful signal; otherwise skip the panel.
    const hasSignal =
      parsed.skills.length > 0 ||
      parsed.experience ||
      parsed.currentJobTitle ||
      parsed.education ||
      parsed.summary
    return hasSignal ? parsed : null
  } catch (err) {
    console.warn('[cv-extract] extractCvFields failed:', err?.message || err)
    return null
  }
}
