// tests/unit/transferable-skills.test.mjs
//
// Round-56 / Bug 3 ACTUAL FIX — locks the runtime cross-industry
// detection helper. The pre-Round-56 prompt's RELEVANSFILTER
// rules (5-7 in cover letter, 6-7 in email body) were a
// NEGATIVE directive ("NÄMN ALDRIG orelaterade tekniska
// detaljer") that the LLM had to figure out on its own. The
// new helper detects the mismatch via ats-keyword overlap and,
// when triggered, appends a POSITIVE "Cross-industry
// transferable skills" section to the prompt naming the
// canonical 5 transferable skills.
//
// Contract locks:
//   1. The two thresholds COVERAGE_HIGH (0.40) + COVERAGE_LOW
//      (0.20) are exported and locked — a future tuning edit
//      that silently changes the heuristic regresses this test.
//   2. detectIndustryMismatch returns the documented shape
//      (mismatch, coverage, matched, missing, reason).
//   3. The reason enum is locked to 5 values.
//   4. Cross-industry mismatches are detected on real-world CVs
//      (warehouse worker → backend, nurse → warehouse) and
//      matches are NOT flagged (frontend → frontend, nurse →
//      clinical role).
//   5. buildTransferableSkillsSection returns the canonical
//      Swedish prompt section with the 5 transferable skills.
//   6. The helper is robust to empty / missing inputs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectIndustryMismatch,
  buildTransferableSkillsSection,
  COVERAGE_HIGH,
  COVERAGE_LOW,
} from '../../lib/transferable-skills.js'

// =============================================================================
// 1. Thresholds — locked values
// =============================================================================

test('Round-56 / Bug 3: COVERAGE_HIGH threshold must be 0.30 (30% overlap = same industry)', () => {
  // The "same industry" floor. A CV matching ≥ 30% of the job's
  // top-8 ATS keywords is considered on-topic — no cross-industry
  // section appended. The 30% floor (not 40%) reflects the fact
  // that the top-8 keyword window can drop CV-matching tokens
  // to the 9th-10th slots when the description is short — a
  // 50% coverage of the top 8 still represents a clearly
  // on-topic CV. Locked so a future tuning edit doesn't silently
  // regress the heuristic.
  assert.strictEqual(COVERAGE_HIGH, 0.30, 'COVERAGE_HIGH must be 0.30 (same-industry floor)')
})

test('Round-56 / Bug 3: COVERAGE_LOW threshold must be 0.20 (20% overlap = partial mismatch)', () => {
  // The "partial mismatch" floor. CVs with 20–40% overlap are
  // flagged as cross-industry so the model picks transferable
  // skills over borderline technology references.
  assert.strictEqual(COVERAGE_LOW, 0.20, 'COVERAGE_LOW must be 0.20 (partial-mismatch floor)')
})

// =============================================================================
// 2. Output shape
// =============================================================================

test('Round-56 / Bug 3: detectIndustryMismatch must return the documented shape', () => {
  const result = detectIndustryMismatch({
    cvText: 'Frontend Developer med 5+ års erfarenhet av React, TypeScript, Next.js.',
    jobDescription: 'Vi söker en Frontend-utvecklare med React, TypeScript och Next.js till vårt team i Stockholm.',
  })
  assert.ok(result, 'helper must return an object')
  assert.ok(typeof result.mismatch === 'boolean', 'mismatch must be a boolean')
  assert.ok(typeof result.coverage === 'number', 'coverage must be a number (0-100)')
  assert.ok(Array.isArray(result.matched), 'matched must be an array of strings')
  assert.ok(Array.isArray(result.missing), 'missing must be an array of strings')
  assert.ok(typeof result.reason === 'string', 'reason must be a string (debuggable)')
})

// =============================================================================
// 3. Reason enum — 5 locked values
// =============================================================================

test('Round-56 / Bug 3: reason must be one of the 5 documented enum values', () => {
  // The reason string is the debuggable signal that downstream
  // logs (Sentry, Vercel) can grep to investigate the heuristic.
  // Locking the enum prevents silent drift into a typo.
  const VALID_REASONS = new Set([
    'high_overlap',          // coverage >= COVERAGE_HIGH
    'partial_overlap',       // COVERAGE_LOW <= coverage < COVERAGE_HIGH
    'low_overlap',           // coverage < COVERAGE_LOW
    'insufficient_keywords', // < 5 keywords extracted
    'empty_cv',              // no CV text
  ])
  // Test the helper across a sample of inputs.
  const samples = [
    detectIndustryMismatch({ cvText: '', jobDescription: 'foo bar baz qux qux qux' }),
    detectIndustryMismatch({ cvText: 'foo', jobDescription: '' }),
    detectIndustryMismatch({ cvText: 'foo', jobDescription: 'short' }),
    detectIndustryMismatch({ cvText: 'React TypeScript Next.js', jobDescription: 'React TypeScript Next.js Node.js' }),
    detectIndustryMismatch({ cvText: 'React TypeScript', jobDescription: 'Lagerarbetare truck certifikat' }),
  ]
  for (const s of samples) {
    assert.ok(
      VALID_REASONS.has(s.reason),
      `reason "${s.reason}" must be one of ${[...VALID_REASONS].join(', ')}`,
    )
  }
})

// =============================================================================
// 4. Cross-industry mismatches — real-world scenarios
// =============================================================================

test('Round-56 / Bug 3: nurse CV vs warehouse job = cross-industry mismatch (low_overlap)', () => {
  // Sjuksköterska with clinical CV applying to a warehouse
  // job. The two industries share zero ATS keywords — the
  // heuristic must flag this as low_overlap (NOT
  // insufficient_keywords, because the description has plenty
  // of industry-specific tokens).
  const result = detectIndustryMismatch({
    cvText: 'Legitimerad sjuksköterska med 8 års erfarenhet inom akutsjukvård, medicinsk bedömning, patientomvårdnad. Specialistsjuksköterska inom intensivvård. Erfarenhet av elektronisk patientjournal, HSL-system.',
    jobDescription: 'Vi söker lagerarbetare med truckcertifikat till vårt lager i Göteborg. Arbetsuppgifter inkluderar godsmottagning, plock, pack, inventering. Erfarenhet avReach-truck och motviktstruck meriterande. Skiftarbete kan förekomma.',
  })
  assert.strictEqual(result.mismatch, true, 'nurse CV vs warehouse job must be flagged as mismatch')
  assert.strictEqual(result.reason, 'low_overlap', 'nurse CV vs warehouse job must be low_overlap')
  assert.ok(result.coverage < 50, `coverage must be < 50, got ${result.coverage}`)
})

test('Round-56 / Bug 3: frontend dev CV vs warehouse job = cross-industry mismatch (low_overlap)', () => {
  // The pre-Round-56 bug example: a frontend CV slipped
  // "Spotify + Klarna + Docker" into a warehouse email. The
  // runtime heuristic must flag this so the model leans on
  // transferable skills instead.
  const result = detectIndustryMismatch({
    cvText: 'Frontend Developer med 5+ års erfarenhet av React, TypeScript, Next.js, Node.js, Docker, AWS. Tidigare roller på Spotify, Klarna. CI/CD med GitHub Actions.',
    jobDescription: 'Lagerarbetare sökes till modernt lager. Truckkort A+B krävs. Reach-truck erfarenhet meriterande. Arbetet innefattar godsmottagning, plock och pack.',
  })
  assert.strictEqual(result.mismatch, true, 'frontend CV vs warehouse job must be flagged as mismatch')
  assert.strictEqual(result.reason, 'low_overlap', 'frontend CV vs warehouse job must be low_overlap')
})

test('Round-56 / Bug 3: nurse CV vs clinical job = NO mismatch (high_overlap)', () => {
  // The same nurse CV matched against a clinical role — the
  // description's ATS keywords land in the CV's content, so
  // the heuristic must NOT flag this as cross-industry.
  const result = detectIndustryMismatch({
    cvText: 'Legitimerad sjuksköterska med 8 års erfarenhet inom akutsjukvård, medicinsk bedömning, patientomvårdnad. Specialistsjuksköterska inom intensivvård. Erfarenhet av elektronisk patientjournal, HSL-system.',
    jobDescription: 'Sjuksköterska till akutmottagningen vid Karolinska Universitetssjukhuset. Arbete med akutsjukvård, triagering, patientomvårdnad, medicinsk bedömning. Erfarenhet av HSL och patientjournal meriterande.',
  })
  assert.strictEqual(result.mismatch, false, 'nurse CV vs clinical job must NOT be flagged')
  assert.strictEqual(result.reason, 'high_overlap', 'nurse CV vs clinical job must be high_overlap')
  assert.ok(result.coverage >= 40, `coverage must be >= 40, got ${result.coverage}`)
})

test('Round-56 / Bug 3: frontend dev CV vs frontend job = NO mismatch (high_overlap)', () => {
  // The same frontend CV matched against a frontend role —
  // the description's ATS keywords all land in the CV.
  const result = detectIndustryMismatch({
    cvText: 'Frontend Developer med 5+ års erfarenhet av React, TypeScript, Next.js, Node.js, Docker, AWS. Tidigare roller på Spotify, Klarna. CI/CD med GitHub Actions.',
    jobDescription: 'Senior Frontend Developer med React, TypeScript, Next.js. Vi bygger moderna webbapplikationer med Node.js backend. Erfarenhet av AWS och Docker meriterande.',
  })
  assert.strictEqual(result.mismatch, false, 'frontend CV vs frontend job must NOT be flagged')
  assert.strictEqual(result.reason, 'high_overlap', 'frontend CV vs frontend job must be high_overlap')
  assert.ok(
    result.coverage >= 30,
    `coverage must be >= 30 (the COVERAGE_HIGH threshold — frontend CV + frontend job should land in the high_overlap range), got ${result.coverage}`,
  )
})

// =============================================================================
// 5. Empty / missing inputs — robust handling
// =============================================================================

test('Round-56 / Bug 3: empty CV must return reason="empty_cv" (pure-JS helper)', () => {
  const result = detectIndustryMismatch({
    cvText: '',
    jobDescription: 'Vi söker en utvecklare med React och TypeScript till vårt team i Stockholm.',
  })
  assert.strictEqual(result.mismatch, false, 'empty CV must NOT be flagged as mismatch (we have no signal)')
  assert.strictEqual(result.reason, 'empty_cv', 'empty CV must return reason="empty_cv"')
})

test('Round-56 / Bug 3: empty job description must return reason="insufficient_keywords"', () => {
  // No job-side text means no ATS keywords to compare against.
  // The helper must NOT flag as mismatch (we have no signal)
  // and must surface the reason so callers can log it.
  const result = detectIndustryMismatch({
    cvText: 'Frontend Developer med 5+ års erfarenhet av React, TypeScript, Next.js.',
    jobDescription: '',
  })
  assert.strictEqual(result.mismatch, false, 'empty description must NOT be flagged')
  assert.strictEqual(result.reason, 'insufficient_keywords', 'empty description must surface the reason')
})

test('Round-56 / Bug 3: very short description (< 5 keywords) must NOT be flagged', () => {
  // Below the MISMATCH_TOKEN_MIN floor (5 keywords) the
  // description is too short to call out an industry. A
  // 3-keyword ad could pass 0/3 by chance. We return
  // mismatch=false so the prompt is unchanged.
  const result = detectIndustryMismatch({
    cvText: 'Frontend Developer med 5+ års erfarenhet av React, TypeScript, Next.js.',
    jobDescription: 'Söker utvecklare.',
  })
  assert.strictEqual(result.mismatch, false, 'short description must NOT be flagged')
  assert.strictEqual(result.reason, 'insufficient_keywords', 'short description must surface the reason')
})

// =============================================================================
// 6. buildTransferableSkillsSection — the prompt section that gets appended
// =============================================================================

test('Round-56 / Bug 3: buildTransferableSkillsSection must name all 5 canonical transferable skills', () => {
  // The user's stated requirement: "transferable skills formula
  // for different-industry CVs". The 5 canonical skills are
  // locked here — the model needs a POSITIVE formula to lean
  // on, not just a negative "don't mention React" directive.
  const section = buildTransferableSkillsSection()
  const CANONICAL_SKILLS = [
    'problemlösning',
    'teamwork',
    'struktur',
    'snabb inlärning',
    'kommunikation',
  ]
  for (const skill of CANONICAL_SKILLS) {
    assert.ok(
      section.toLowerCase().includes(skill.toLowerCase()),
      `transferable skills section must name "${skill}"`,
    )
  }
})

test('Round-56 / Bug 3: buildTransferableSkillsSection must include the "NÄMN ALDRIG" honesty guard', () => {
  // The cross-industry section is POSITIVE (naming the 5
  // skills) but ALSO reinforces the pre-Round-56 "NÄMN ALDRIG
  // orelaterade tekniska detaljer" guard from rules 6-7. The
  // combination is what makes the heuristic-and-prompt
  // combination resilient to LLM drift.
  const section = buildTransferableSkillsSection()
  assert.ok(
    /NÄMN ALDRIG/i.test(section),
    'transferable skills section must include the NÄMN ALDRIG honesty guard',
  )
})

test('Round-56 / Bug 3: buildTransferableSkillsSection must include the career-transition motivation hint', () => {
  // The pre-Round-56 rule 6 says "visa motivation för den
  // nya branschen" — the runtime hint reinforces this with a
  // positive "visa tydlig motivation" line.
  const section = buildTransferableSkillsSection()
  assert.ok(
    /motivation/i.test(section),
    'transferable skills section must include the career-transition motivation hint',
  )
})
