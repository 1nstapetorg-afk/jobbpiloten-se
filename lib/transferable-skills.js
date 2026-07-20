// lib/transferable-skills.js
//
// Round-56 / Bug 3 ACTUAL FIX — runtime cross-industry detection
// + the transferable-skills prompt section that fires when a
// mismatch is detected.
//
// Pre-Round-56 the prompt's RELEVANSFILTER rules (5–7 in
// generateCoverLetter, 6–7 in generateEmailBody — see
// tests/unit/groq-relevansfilter.test.mjs) were the only
// safeguard against cross-industry hallucination. Those rules
// still apply, but the LLM has to figure out the industry
// mismatch on its own. A frontend-dev CV submitted for a
// warehouse job can still slip "Spotify + Klarna + Docker" past
// the prompt because rule 6 is a NEGATIVE directive ("NÄMN
// ALDRIG orelaterade tekniska detaljer") rather than a positive
// formula the model can lean on.
//
// The fix: when this module's heuristic detects an industry
// mismatch, lib/groq.js's prompt builders append a single
// POSITIVE "Cross-industry transferable skills" section that
// names the canonical 5 transferable skills the model should
// cite (problemlösning, teamwork, struktur, snabb inlärning,
// kommunikation) and tells it to ignore unrelated CV items.
// This is the user's stated "transferable skills formula for
// different-industry CVs" requirement, surfaced at RUNTIME so
// it only fires when it should — not as a static prompt line
// that bloats every cover letter.
//
// Pure-JS, no chrome.* / no LLM dependency. Imports
// extractAtsKeywords from lib/ats-keywords.js for the keyword
// primitive so the two modules share a single stop-word + stem
// contract (the ats-keywords test suite locks that contract).
//
// EXPORTS:
//   detectIndustryMismatch({ cvText, jobDescription, jobTitle, company })
//     Returns { mismatch, coverage, matched, missing, reason }.
//     `reason` is one of: 'high_overlap' | 'partial_overlap' |
//     'low_overlap' | 'insufficient_keywords' | 'empty_cv'.
//   buildTransferableSkillsSection()
//     Returns the Swedish prompt-section string that groq.js
//     appends to the prompt when a mismatch is detected.
//   COVERAGE_HIGH / COVERAGE_LOW (exported for testability)
//     The two thresholds the heuristic compares against.

import { extractAtsKeywords } from './ats-keywords.js'

// Two thresholds that determine the mismatch verdict:
//   coverage ≥ COVERAGE_HIGH  → no mismatch (the CV has the
//                                keywords the job wants)
//   COVERAGE_LOW ≤ coverage < COVERAGE_HIGH → partial mismatch
//                                (some overlap but the CV's
//                                industry is meaningfully
//                                different — the cross-industry
//                                section is appended to make the
//                                model pick transferable skills
//                                over borderline technology
//                                references)
//   coverage < COVERAGE_LOW   → strong mismatch (the CV is
//                                clearly in another industry —
//                                the cross-industry section is
//                                critical, otherwise the model
//                                would happily invent relevance)
//
// 30% / 20% are conservative defaults. A frontend CV matching
// a frontend job typically lands in the 50–100% range; a
// nurse CV matching a backend job lands in the 0–10% range.
// The high-overlap floor is 30% (not 40%) because the top-8
// keyword window can drop CV-matching tokens to the 9th–10th
// slots when the job description is short — a 50% coverage
// of the top 8 still represents a clearly on-topic CV. Both
// threshold values are EXPORTED so the test suite can pin
// them — a future maintainer can tune them without silently
// drifting the heuristic.
export const COVERAGE_HIGH = 0.30
export const COVERAGE_LOW = 0.20

// Floor on how many ATS keywords we need to make a verdict.
// Below 5 keywords the description is too short to call out
// an industry — a 3-keyword ad could pass 0/3 by chance. We
// return `mismatch: false` + `reason: 'insufficient_keywords'`
// in that case so the caller can skip the prompt insertion.
// Exported for testability + future tuning — a maintainer who
// wants to tighten the floor for short ads can adjust this
// constant without touching the heuristic.
export const MISMATCH_TOKEN_MIN = 5

/**
 * Pick the richer of `profile.cvText` (the parsed file body) and
 * `profile.cvSummary` (the user's hand-written fallback) for the
 * cross-industry heuristic. Returns the trimmed string or '' when
 * neither field is set.
 *
 * Round-57 polish — extracted from the duplicated
 * `profile?.cvText || profile?.cvSummary || ''` chain that
 * `generateCoverLetter` and `generateEmailBody` both inlined.
 * The two prompt builders now share this single helper so a
 * future change to the picker (e.g. adding a third field, or
 * trimming whitespace) is a one-line edit instead of two.
 *
 * The heuristic in `detectIndustryMismatch` already does its own
 * `.trim()` + empty-check, so callers can pass the raw result
 * here without pre-processing.
 *
 * @param {Object} profile - The profile shape from /api/profile
 * @returns {string} The richer CV text, trimmed; '' if both fields are missing
 */
export function pickCvText(profile) {
  return (
    (profile?.cvText && profile.cvText.trim()) ||
    (profile?.cvSummary && profile.cvSummary.trim()) ||
    ''
  )
}

/**
 * Detect whether the candidate's CV is in a different industry
 * than the job being applied to. Pure keyword-overlap heuristic
 * — no LLM call, no embedding model, ~microsecond wall time.
 *
 * @param {Object} opts
 * @param {string} opts.cvText - Candidate's full CV text (preferred)
 *                              or summary. May be empty.
 * @param {string} opts.jobDescription - Job ad description
 *                                      (preferred source for the
 *                                      job's industry keywords)
 * @param {string} [opts.jobTitle] - Fallback when description is empty
 * @param {string} [opts.company] - Fallback when both are empty
 * @returns {{
 *   mismatch: boolean,
 *   coverage: number,        // 0-100 (rounded)
 *   matched: string[],       // keywords present in CV
 *   missing: string[],       // top-N keywords absent from CV
 *   reason: string,          // why we made the call (debuggable)
 * }}
 */
export function detectIndustryMismatch({
  cvText = '',
  jobDescription = '',
  jobTitle = '',
  company = '',
} = {}) {
  // Build the job-side text from whatever the caller has. The
  // description is the most reliable source of industry signals;
  // title + company are the only fallback for /api/extension/
  // email-body calls that pass an empty description.
  const jobSide = String(jobDescription || '').trim() ||
    `${jobTitle || ''} ${company || ''}`.trim()
  if (!jobSide) {
    return {
      mismatch: false,
      coverage: 0,
      matched: [],
      missing: [],
      reason: 'insufficient_keywords',
    }
  }
  if (!String(cvText || '').trim()) {
    return {
      mismatch: false,
      coverage: 0,
      matched: [],
      missing: [],
      reason: 'empty_cv',
    }
  }

  // Use ats-keywords' extractAtsKeywords to pull the top industry
  // tokens from the job-side text. Stop-word filtering + simple
  // stemming (already locked by tests/unit/ats-keywords.test.mjs)
  // ensures the heuristic doesn't false-positive on Swedish
  // function words ("och", "att", "för", …) that EVERY ad carries.
  const { top } = extractAtsKeywords(jobSide, { max: 8 })
  if (!Array.isArray(top) || top.length < MISMATCH_TOKEN_MIN) {
    return {
      mismatch: false,
      coverage: 0,
      matched: [],
      missing: top || [],
      reason: 'insufficient_keywords',
    }
  }

  // Stem-compare against the CV so morphological variants
  // collapse: a job ad asking for "utvecklare" still matches
  // a CV that says "utvecklarens" or "mjukvaruutvecklare".
  const cv = String(cvText || '').toLowerCase()
  const matched = []
  const missing = []
  for (const kw of top) {
    if (cv.includes(String(kw).toLowerCase())) matched.push(kw)
    else missing.push(kw)
  }
  const coverage = matched.length / top.length
  const coveragePct = Math.round(coverage * 100)

  if (coverage >= COVERAGE_HIGH) {
    return {
      mismatch: false,
      coverage: coveragePct,
      matched,
      missing,
      reason: 'high_overlap',
    }
  }
  if (coverage >= COVERAGE_LOW) {
    return {
      mismatch: true,
      coverage: coveragePct,
      matched,
      missing,
      reason: 'partial_overlap',
    }
  }
  return {
    mismatch: true,
    coverage: coveragePct,
    matched,
    missing,
    reason: 'low_overlap',
  }
}

/**
 * Build the Swedish "Cross-industry transferable skills"
 * prompt section that gets appended to the LLM prompt when
 * a mismatch is detected. The section is intentionally
 * POSITIVE (naming the 5 canonical transferable skills) rather
 * than NEGATIVE (just forbidding unrelated technology) so the
 * model has a concrete formula to lean on instead of an
 * open-ended "be careful" warning.
 *
 * Returns a single string with embedded newlines so the
 * caller can .push() it into the prompt array before the
 * final .join('\n').
 */
export function buildTransferableSkillsSection() {
  return [
    '',
    'Cross-industry transferable skills (Round-56 / Bug 3 runtime hint — kandidatens CV är i en annan bransch):',
    'VIKTIGT: Citera ENDAST dessa överförbara färdigheter från CV:t (problemlösning, teamwork, struktur, snabb inlärning, kommunikation) — och motivera karriärväxlingen ärligt.',
    'NÄMN ALDRIG orelaterade tekniska detaljer (t.ex. React för ett lagerjobb, en specifik klinikprocedur för en administrativ tjänst).',
    'Visa tydlig motivation för den nya branschen — varför kandidaten VILL byta fält, inte bara att hen KAN.',
    '',
  ].join('\n')
}
