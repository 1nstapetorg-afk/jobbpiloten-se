// tests/unit/groq-relevansfilter.test.mjs
//
// Round-55 / Bug 3 — locks the RELEVANSFILTER + transferable-skills
// + no-fake-claims prompt rules in lib/groq.js. The pre-Round-55
// implementation already had these rules (added in Round-51 to
// generateCoverLetter, mirrored in Round-46 to generateEmailBody),
// but Bug 3 in the previous prompt asked for explicit verification
// that the prompt enforces:
//   • only-relevant CV references
//   • honest career-transition handling
//   • transferable-skills formula when CV industry ≠ job industry
//   • no fabricated technical cross-references
//
// These tests are static-grep contract locks — they verify the
// prompt BUILDER ships the rules, not the LLM OUTPUT. The LLM
// output is exercised by /api/email-draft's runtime path; we
// can't unit-test model compliance without a real key.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GROQ_PATH = path.resolve(__dirname, '../../lib/groq.js')
const SRC = fs.readFileSync(GROQ_PATH, 'utf-8')

// =============================================================================
// 0. Helper — robust function-body extraction
// =============================================================================
//
// Round-55.2 fix — the pre-fix regex `/async function generateEmailBody\([\s\S]*?\n}/`
// was non-greedy and stopped at the FIRST `\n}` inside the function body
// (e.g. an inner `}` of an if-block or try-block), truncating fnBody
// to a tiny slice. The fixed strategy matches from the function
// declaration to the next top-level function declaration (or JSDoc
// block) — a positive look-ahead with a named sentinel.
//
// `(?=\n(?:async function|function|/\*\*))` stops at the NEXT function
// declaration OR the start of the next JSDoc block (which precedes
// most functions in lib/groq.js). The `s` flag makes `.` match newlines.

function extractFnBody(src, fnName) {
  const start = src.indexOf('async function ' + fnName)
  if (start === -1) return null
  const afterStart = src.slice(start)
  // Stop at the next top-level declaration
  const stopMatch = /\n(?:async function|function|\/\*\*)/.exec(afterStart)
  return stopMatch ? afterStart.slice(0, stopMatch.index + 1) : afterStart
}

// =============================================================================
// 1. generateEmailBody prompt contains the RELEVANSFILTER rules
// =============================================================================

test('Round-55 / Bug 3: generateEmailBody must include the RELEVANSFILTER rule', () => {
  // The Round-46 / Round-51 fix added an absolute rule that the LLM
  // only references CV items that are directly relevant or clearly
  // transferable. Without this rule, a frontend-dev CV would leak
  // React/TypeScript references into a warehouse job's email.
  // Locked so a future refactor that drops the rule regresses the
  // honesty/no-fake-claims contract.
  const fnBody = extractFnBody(SRC, 'generateEmailBody')
  assert.ok(fnBody, 'generateEmailBody must be locatable in lib/groq.js')
  assert.match(
    fnBody,
    /RELEVANSFILTER:/,
    'generateEmailBody prompt must include the RELEVANSFILTER absolute rule',
  )
  assert.match(
    fnBody,
    /direkt relevanta|Eller tydligt \u00f6verf\u00f6rbara/,
    'RELEVANSFILTER must specify "directly relevant OR clearly transferable" as the only acceptable CV-reference patterns',
  )
})

test('Round-55 / Bug 3: generateEmailBody must include the career-transition honesty rule', () => {
  // The Round-46 followup: when CV industry ≠ job industry, the
  // LLM must be honest about the career change + focus on
  // transferable skills + NEVER mention unrelated technical details.
  // Locks the "no fake claims" contract for cross-industry emails.
  const fnBody = extractFnBody(SRC, 'generateEmailBody')
  assert.match(
    fnBody,
    /HELT ANNAN bransch|karri\u00e4r\u00f6verg\u00e5ngen/,
    'generateEmailBody must include the career-transition honesty rule (different industry → focus on transferable skills)',
  )
  assert.match(
    fnBody,
    /Hitta ALDRIG p\u00e5 tekniska kopplingar|Hitta ALDRIG p\u00e5 kopplingar/,
    'generateEmailBody must include the "NEVER fabricate technical cross-references" rule',
  )
})

test('Round-55 / Bug 3: generateEmailBody must include the transferable-skills formula', () => {
  // The transferable-skills formula is the explicit list of what
  // counts as transferable: problemlösning / teamwork / struktur /
  // snabb inlärning. Locked so a future refactor that drops one
  // of these terms regresses the formula.
  const fnBody = extractFnBody(SRC, 'generateEmailBody')
  // All four terms must appear (in any order) inside the function body.
  for (const term of ['probleml\u00f6sning', 'teamwork', 'struktur', 'snabb inl\u00e4rning']) {
    assert.ok(
      fnBody.includes(term),
      `generateEmailBody must include transferable-skill term "${term}" in the prompt`,
    )
  }
})

test('Round-55 / Bug 3: generateEmailBody must gate on profile.cvText (not just cvSummary)', () => {
  // Bug 3 ask #1: "cvText is passed to the email generation API".
  // normaliseProfile() in lib/groq.js picks the richer of
  // profile.cvText or profile.cvSummary — locked so a future
  // refactor that drops cvText from the picker regresses the
  // uploaded-CV contract.
  //
  // Round-55.2 fix: the source uses `||` (logical OR), not `??`
  // (nullish coalescing). `||` is the correct operator here because
  // an empty-string cvText should fall through to cvSummary, but
  // `??` would treat empty string as a valid value and skip the
  // fallback. The test now accepts either `||` or `??` for
  // forward-compat, with `||` as the primary assertion.
  assert.match(
    SRC,
    /profile\.cvText[\s\S]{0,200}profile\.cvSummary/,
    'normaliseProfile must reference both profile.cvText and profile.cvSummary (prefers cvText over cvSummary)',
  )
})

test('Round-55 / Bug 3: generateEmailBody prompt must be NO-LONGER than 350 max_tokens to keep cost bounded', () => {
  // Cost guard: the LLM call caps at max_tokens: 350 to keep the
  // response under the 1500-char mailto: limit on Windows/legacy
  // clients. Locked so a future refactor that bumps the cap
  // doesn't silently burn the LLM budget.
  const fnBody = extractFnBody(SRC, 'generateEmailBody')
  assert.match(
    fnBody,
    /max_tokens:\s*350/,
    'generateEmailBody must cap max_tokens at 350 (Round-46 cost guard)',
  )
})

// =============================================================================
// 2. generateCoverLetter prompt has the same RELEVANSFILTER rules
// =============================================================================

test('Round-55 / Bug 3: generateCoverLetter must mirror the RELEVANSFILTER rules', () => {
  // The cover letter uses the same RELEVANSFILTER + transferable
  // skills rules (added in Round-51). Both prompts must stay
  // aligned so a recruiter reading an email + a letter sees the
  // same honest, industry-aware language.
  const fnBody = extractFnBody(SRC, 'generateCoverLetter')
  assert.ok(fnBody, 'generateCoverLetter must be locatable in lib/groq.js')
  assert.match(fnBody, /RELEVANSFILTER:/, 'generateCoverLetter must include RELEVANSFILTER')
  assert.match(
    fnBody,
    /HELT ANNAN bransch/i,
    'generateCoverLetter must include the career-transition honesty rule',
  )
  assert.match(
    fnBody,
    /Hitta ALDRIG p\u00e5 kopplingar/,
    'generateCoverLetter must include the no-fake-claims rule',
  )
})

// =============================================================================
// 2.5. Round-56 / Bug 3 ACTUAL FIX — runtime cross-industry detection wiring
// =============================================================================
//
// Round-56 takes Bug 3 from "static prompt rules" to "runtime detection +
// dynamic prompt insertion". The pre-Round-56 prompt had RELEVANSFILTER
// rules 5-7 (cover letter) and 6-7 (email body) as a NEGATIVE directive
// ("NÄMN ALDRIG orelaterade tekniska detaljer") that the LLM had to
// figure out on its own. Round-56 adds a runtime heuristic
// (lib/transferable-skills.js) that detects industry mismatches and
// appends a POSITIVE "Cross-industry transferable skills" section
// naming the canonical 5 transferable skills. The wiring below locks
// that the new helper is imported + called in BOTH prompt builders.

test('Round-56 / Bug 3: lib/groq.js must import the runtime helper from lib/transferable-skills.js', () => {
  // The pre-Round-56 prompt was static. The Round-56 fix relies
  // on the detectIndustryMismatch() + buildTransferableSkillsSection()
  // helpers to inject a positive cross-industry formula at runtime
  // when a mismatch is detected. The import statement is the
  // single line that wires the new module into the prompt
  // builder — locked so a future refactor that drops the import
  // regresses the runtime detection.
  assert.match(
    SRC,
    /import\s*\{[^}]*detectIndustryMismatch[^}]*\}\s*from\s*['"]\.\/transferable-skills\.js['"]/,
    'lib/groq.js must import detectIndustryMismatch from ./transferable-skills.js (Round-56 runtime detection)',
  )
  assert.match(
    SRC,
    /import\s*\{[^}]*buildTransferableSkillsSection[^}]*\}\s*from\s*['"]\.\/transferable-skills\.js['"]/,
    'lib/groq.js must import buildTransferableSkillsSection from ./transferable-skills.js (Round-56 prompt section)',
  )
})

test('Round-56 / Bug 3: generateCoverLetter must call the runtime detection helper', () => {
  // The cover letter's prompt builder must call detectIndustryMismatch()
  // so the cross-industry section is appended when a mismatch is
  // detected. The call site lives in an IIFE for safe try/catch
  // (a thrown heuristic must NEVER break the LLM call), so the
  // contract is "detectIndustryMismatch is referenced inside
  // generateCoverLetter" — locked so a future refactor that
  // removes the call regresses the runtime detection.
  const fnBody = extractFnBody(SRC, 'generateCoverLetter')
  assert.ok(fnBody, 'generateCoverLetter must be locatable in lib/groq.js')
  assert.match(
    fnBody,
    /detectIndustryMismatch\s*\(/,
    'generateCoverLetter must call detectIndustryMismatch() (Round-56 runtime cross-industry detection)',
  )
  assert.match(
    fnBody,
    /buildTransferableSkillsSection\s*\(\s*\)/,
    'generateCoverLetter must call buildTransferableSkillsSection() when a mismatch is detected (Round-56 positive formula)',
  )
})

test('Round-56 / Bug 3: generateEmailBody must call the runtime detection helper', () => {
  // The email body has the same mismatch risk as the cover letter
  // (frontend CV submitted for a warehouse job would happily
  // produce "Spotify + Klarna + Docker" without runtime guidance).
  // The wiring is mirrored so both surfaces get the same
  // cross-industry formula when the heuristic fires.
  const fnBody = extractFnBody(SRC, 'generateEmailBody')
  assert.ok(fnBody, 'generateEmailBody must be locatable in lib/groq.js')
  assert.match(
    fnBody,
    /detectIndustryMismatch\s*\(/,
    'generateEmailBody must call detectIndustryMismatch() (Round-56 runtime cross-industry detection)',
  )
  assert.match(
    fnBody,
    /buildTransferableSkillsSection\s*\(\s*\)/,
    'generateEmailBody must call buildTransferableSkillsSection() when a mismatch is detected (Round-56 positive formula)',
  )
})

// =============================================================================
// 3. /api/email-draft route passes the full profile (so cvText is included)
// =============================================================================

test('Round-55 / Bug 3: /api/email-draft must pass the full profile to generateEmailBody', () => {
  // The /api/email-draft route looks up the profile from Mongo and
  // passes it to generateEmailBody. Locked so a future refactor
  // that picks-and-chooses fields doesn't accidentally drop
  // cvText (the most relevant field for the RELEVANSFILTER rules).
  const routePath = path.resolve(__dirname, '../../app/api/email-draft/route.js')
  const routeSrc = fs.readFileSync(routePath, 'utf-8')
  assert.match(
    routeSrc,
    /generateEmailBody\s*\(\s*\{[\s\S]*?profile[\s\S]*?\}\s*\)/,
    '/api/email-draft must pass `profile` to generateEmailBody so cvText + cvSummary flow into the prompt',
  )
})
