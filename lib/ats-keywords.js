// lib/ats-keywords.js
//
// Part 5 — CV Enhancement. ATS keyword extraction + matching.
//
// When a job description arrives, we extract the most common
// "hard-skill" tokens (length ≥ 4, no Swedish stop-words) and
// compute the percentage of those tokens that ALSO appear in the
// user's CV summary. The result is the ATS-match score the
// dashboard shows under "Nyckelord från annonsen".
//
// Pure-JS, no deps. The stop-words list is curated for Swedish
// job ads — 60+ common words that EVERY ad contains (och, att,
// för, med, den, etc.) so they don't count as keywords.

const SWEDISH_STOPWORDS = new Set([
  'och', 'att', 'för', 'med', 'den', 'det', 'som', 'har', 'kan',
  'ska', 'från', 'till', 'men', 'också', 'eller', 'samt', 'inom',
  'mot', 'utan', 'över', 'under', 'dina', 'din', 'ditt', 'hos',
  'dig', 'du', 'vi', 'oss', 'era', 'ert', 'er', 'en', 'ett',
  'ett', 'denna', 'detta', 'dessa', 'vilka', 'vilken', 'vilket',
  'samtliga', 'samtliga', 'kunna', 'kommer', 'måste', 'borde',
  'behöver', 'behövs', 'söker', 'sökes', 'sökt', 'anställning',
  'tjänst', 'jobb', 'arbete', 'roll', 'rollen', 'tjänsten',
  'företag', 'företaget', 'kund', 'kunder', 'kandidater',
  'kandidat', 'ansökan', 'ansök', 'ansöker', 'kompetens',
  'kompetenser', 'erfarenhet', 'kunskap', 'kunskaper', 'krav',
  'meriterande', 'plus', 'samt', 'såsom', 'därför', 'eftersom',
  'genom', 'alltid', 'aldrig', 'ofta', 'ibland', 'vanligt',
  'vanligtvis', 'exempelvis', 'cirka', 'ungefär', 'gäller',
])

// Light stemming — strip common Swedish suffixes so "utvecklare"
// and "utvecklarens" don't double-count.
function stem(word) {
  if (word.length < 5) return word
  return word
    .replace(/(arens|arnas|aren|arna|ans|ans|ers|ern|orna)$/u, '')
    .replace(/(ande|ende|ingen|ingen)$/u, '')
    .replace(/(erna|erns)$/u, '')
}

/**
 * Extract ATS keywords from a job description. Returns
 * { tokens: string[], top: string[] } where `top` is the
 * 5 most common (after stop-word + short-token filtering).
 *
 * Tokens are stemmed to merge morphological variants. The original
 * surface form is preserved in `top` so the UI can show readable
 * keywords ("utvecklare") rather than the stemmed base.
 */
export function extractAtsKeywords(description, { max = 5 } = {}) {
  const text = String(description || '').toLowerCase()
  if (!text) return { tokens: [], top: [] }
  // Tokenize: split on non-letters, keep tokens of length ≥ 4.
  const raw = text.split(/[^a-zåäöéüñ0-9+#.]+/u).filter(Boolean)
  // Frequency map keyed by stem, value = { count, surface }
  const freq = new Map()
  for (const tok of raw) {
    const t = tok.trim()
    if (t.length < 4) continue
    if (/^\d+$/.test(t)) continue // pure numbers
    if (SWEDISH_STOPWORDS.has(t)) continue
    const s = stem(t)
    const key = s || t
    const cur = freq.get(key)
    if (cur) {
      cur.count += 1
    } else {
      freq.set(key, { count: 1, surface: t })
    }
  }
  // Sort by count desc, then surface asc (deterministic tiebreak).
  const sorted = Array.from(freq.values())
    .sort((a, b) => (b.count - a.count) || a.surface.localeCompare(b.surface))
  const top = sorted.slice(0, max).map((e) => e.surface)
  return { tokens: sorted.map((e) => e.surface), top }
}

/**
 * Compute ATS-match for a (cvText, description) pair. Returns
 * { coverage: 0-100, missing: string[], matched: string[] }.
 *
 *   coverage = matched / total * 100 (rounded)
 *   missing  = keywords in description NOT found in cvText
 *   matched  = keywords in description found in cvText
 */
export function atsMatch(cvText, description, { max = 5 } = {}) {
  const { top } = extractAtsKeywords(description, { max })
  if (top.length === 0) {
    return { coverage: 0, missing: [], matched: [] }
  }
  const cv = String(cvText || '').toLowerCase()
  const matched = []
  const missing = []
  for (const kw of top) {
    // Stem-compare so "utvecklare" in the ad matches "utvecklarens"
    // experience line in the CV.
    const cvHas = cv.includes(kw) || cv.includes(stem(kw))
    if (cvHas) matched.push(kw)
    else missing.push(kw)
  }
  const coverage = Math.round((matched.length / top.length) * 100)
  return { coverage, missing, matched }
}

/**
 * CV formatting cleanup hints. Returns { issues: [{key, message, severity}] }
 * where severity is 'warn' (amber) or 'info' (slate). Used by the
 * settings page banner to nudge the user toward a clean CV.
 */
export function detectCvFormattingIssues(cvText) {
  const issues = []
  const text = String(cvText || '').trim()
  if (!text) return { issues }
  // Length check — under 200 chars is too short for a real CV.
  if (text.length < 200) {
    issues.push({ key: 'too-short', severity: 'warn', message: 'Din sammanfattning är kort — över 200 tecken hjälper AI:n att skriva bättre brev.' })
  }
  // Date range check — common CV sections use "20XX-20YY" or
  // "20XX–20YY" patterns. Mismatched separators (one - and one –)
  // are a flag.
  const years = text.match(/\b(19|20)\d{2}\b/g) || []
  if (years.length >= 2) {
    const separators = text.match(/\d{4}\s*([-–—])\s*\d{4}/g) || []
    const dashSet = new Set(separators.map((s) => s.match(/([-–—])/)[1]))
    if (dashSet.size > 1) {
      issues.push({ key: 'date-separator-mix', severity: 'info', message: 'Blandade datumstreck (–/-/—) — använd samma typ i hela CV:t.' })
    }
  }
  // Section heading check — common Swedish CV section names.
  const SECTION_PATTERNS = [
    /\b(erfarenhet|experience)\b/i,
    /\b(utbildning|education)\b/i,
    /\b(kompetens|skills)\b/i,
    /\b(språk|languages)\b/i,
  ]
  const foundSections = SECTION_PATTERNS.filter((re) => re.test(text)).length
  if (foundSections < 2) {
    issues.push({ key: 'sections-missing', severity: 'info', message: 'Standard-CV:n har tydliga sektioner (Erfarenhet / Utbildning / Kompetenser).' })
  }
  return { issues }
}
