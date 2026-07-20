// tests/unit/groq-cover-letter-cv-refs.test.mjs
//
// Round-46 / Bug 2 — cover letter prompt must reference CV content.
//
// The pre-fix prompt passively listed \`CV-sammanfattning: <text>\` in
// the candidate profile block but never commanded the LLM to actually
// USE that content. Output was a generic "Min erfarenhet inom X..."
// letter with no concrete references to skills, technologies, projects,
// or past employers — the user reported "Generic, no reference to CV
// specifics".
//
// The fix adds:
//   • A §CV-INNEHÅLL § marker block so the LLM knows it must mine
//     this exact text for concrete references.
//   • An absolute Regler block ("DU MÅSTE referera till 2–3 specifika
//     saker…") at the END of the prompt so Groq Llama-3 weights
//     recent tokens.
//   • A cvText-too-short branch (~500 char cap) that surfaces an
//     honest disclosure rather than padding with generic claims.
//
// These tests are static-grep source locks — they pin the contract in
// lib/groq.js so a future maintainer can't quietly drop the rules
// without updating the test in lockstep.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GROQ_PATH = path.resolve(__dirname, '../../lib/groq.js')
const GROQ_SRC = fs.readFileSync(GROQ_PATH, 'utf-8')

// =============================================================================
// 1. The §CV-INNEHÅLL § marker must wrap the cvSummary block.
// =============================================================================

test('Bug 2: lib/groq.js covers letter prompt must wrap cvSummary in §CV-INNEHÅLL § marker', () => {
  // The marker is the structural change — it tells the LLM to MINE
  // this exact text for concrete references. Without the marker the
  // model falls back to glowing generalities.
  assert.ok(GROQ_SRC.includes('§CV-INNEHÅLL'), 'lib/groq.js must include the "§CV-INNEHÅLL" text marker (Round-46 / Bug 2 fix)')
  assert.ok(GROQ_SRC.includes('§SLUT PÅ CV-INNEHÅLL§'), 'lib/groq.js must include the "§SLUT PÅ CV-INNEHÅLL§" closing marker (Round-46 / Bug 2 fix)')
})

// =============================================================================
// 2. The absolute Regler block ("DU MÅSTE referera till 2–3 specifika saker").
// =============================================================================

test('Bug 2: cover letter prompt must include the "DU MÅSTE referera till 2–3 specifika saker" rule', () => {
  // Hard absolute rule — without this directive the LLM freely
  // ignores the CV content. Locked because it's THE single line
  // that flips generic → concrete. The test requires "2" + "3" +
  // "specifika" in the same Regler line (allowing variable spacing).
  assert.ok(
    /DU M[ÅA]STE\s+referera\s+till\s+2[\s\-–]+3\s+specifika/i.test(GROQ_SRC),
    'lib/groq.js cover-letter prompt must include an absolute "DU MÅSTE referera till 2–3 specifika" rule',
  )
})

test('Bug 2: cover letter prompt must include the "ALDRIG skriv generiska fraser" anti-generic rule', () => {
  // Mirror rule — forbids "min erfarenhet inom X" without concrete
  // backup. Without this Ngative prompt the LLM still produces
  // generic Swedish phrases even when the absolute rule is present.
  assert.ok(
    /ALDRIG\s+skriv\s+generiska\s+fraser/i.test(GROQ_SRC),
    'lib/groq.js must include the negative "ALDRIG skriv generiska fraser" rule — backup-generic guard',
  )
})

test('Bug 2: cover letter prompt must include the "regler (ABSOLUTA):" header', () => {
  // The "Regler (ABSOLUTA)" header is the structural cue that
  // groups the four rules together. Without the explicit header
  // the LLM treats the rules as a continuation of the loose
  // agent-tone text above and ignores them.
  assert.ok(
    /Regler\s*\(ABSOLUTA\)/i.test(GROQ_SRC),
    'lib/groq.js must include the "Regler (ABSOLUTA):" header above the rule list — required for the model to weight them as anchors',
  )
})

// =============================================================================
// 3. Cover letter must reference cvSummary via normaliseProfile.
// =============================================================================

test('Bug 2: normaliseProfile must extract cvText over cvSummary', () => {
  // The pre-fix behaviour bug: `cvSummary` (manual short summary)
  // was used instead of `cvText` (the rich full-CV body) when cvText
  // was present. The current code-pick already prefers cvText but
  // we lock the contract here so a future refactor can't quietly
  // drop the precedence.
  const normFn = GROQ_SRC.match(/function\s+normaliseProfile[\s\S]*?\n\}/m) || ['']
  assert.ok(normFn[0].includes('cvText'), 'normaliseProfile must inspect cvText')
  assert.ok(normFn[0].includes('cvSummary'), 'normaliseProfile must inspect cvSummary as a fallback')
  // Order: cvText must come BEFORE cvSummary in the || chain so a
  // rich upload wins over the manual short summary.
  const cvTextPos = normFn[0].indexOf('cvText')
  const cvSummaryPos = normFn[0].indexOf('cvSummary')
  assert.ok(cvTextPos > 0 && cvSummaryPos > 0, 'normaliseProfile must reference both cvText and cvSummary')
  assert.ok(cvTextPos < cvSummaryPos, 'normaliseProfile must prefer cvText over cvSummary (rich CV wins over short summary)')
})

// =============================================================================
// 4. CV-char cap must be enforced.
// =============================================================================

test('Bug 2: PROMPT_CV_CHAR_CAP must cap the CV string sent to the LLM', () => {
  // Sending a 20 KB CV verbatim blows out the LLM context and
  // pushes the system instructions out of the message window.
  // 5000 chars ≈ 1-page CV summary section.
  assert.ok(/PROMPT_CV_CHAR_CAP\s*=\s*5\s*_?000/.test(GROQ_SRC), 'lib/groq.js must declare PROMPT_CV_CHAR_CAP = 5000')
  // The slice must actually slice to the cap.
  assert.ok(/sourceCv\.length\s*>\s*PROMPT_CV_CHAR_CAP/.test(GROQ_SRC),
    'lib/groq.js must slice cvSource to PROMPT_CV_CHAR_CAP on overflow')
  assert.ok(/\.slice\(\s*0\s*,\s*PROMPT_CV_CHAR_CAP\s*\)/.test(GROQ_SRC),
    'lib/groq.js must use slice(0, PROMPT_CV_CHAR_CAP) on the CV string')
})

// =============================================================================
// 5. The "cvText too short" warning must exist as a guard.
// =============================================================================

test('Bug 2: cover letter prompt must include a "CV är kort" honest-disclosure branch', () => {
  // The user spec: "If cvText < 500 chars, show warning: Ditt CV
  // är kort. Ladda upp en längre version för bättre resultat."
  // We bake this into the prompt (so the model writes honestly
  // about the missing info) AND return a separate `cvShortWarning`
  // flag for the frontend to surface the chip suggestion.
  assert.ok(
    /CV\s*är\s+kort/i.test(GROQ_SRC) && /<.*500.*tecken|< 500 tecken/.test(GROQ_SRC),
    'lib/groq.js cover-letter prompt must include a "CV är kort (< 500 tecken)" honest-disclosure branch',
  )
})

// =============================================================================
// 6. cover-letter export and fallback path must remain intact.
// =============================================================================

test('Bug 2: generateCoverLetter must remain an async exported function with a fallbackCoverLetter() backstop', () => {
  // The CV-reference rules are an addition, not a replacement.
  // The LLM-error / no-key fallback path must still produce a
  // presentable letter so the user never sees an empty box.
  assert.match(GROQ_SRC, /async\s+function\s+generateCoverLetter\s*\(/, 'generateCoverLetter must remain async')
  assert.match(GROQ_SRC, /function\s+fallbackCoverLetter\s*\(/, 'fallbackCoverLetter must remain as a backstop')
  // The export surface must include the function.
  assert.match(GROQ_SRC, /export\s*\{[^}]*generateCoverLetter[^}]*\}/, 'generateCoverLetter must remain exported')
})
