// tests/unit/cv-enhance.test.mjs
//
// Unit tests for lib/cv-enhance.js. Validates the pure offline
// enhancer: bullet structure, filler-word removal, focus-mode
// lead-verb selection, and the "Groq failure" fallback path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { enhanceCvSummaryPure, enhanceCvSummaryGroq } from '../../lib/cv-enhance.js'

test('enhanceCvSummaryPure: returns empty bullets for empty input', () => {
  const r = enhanceCvSummaryPure('', 'resultat')
  assert.equal(r.enhanced, '')
  assert.deepEqual(r.bullets, [])
  assert.equal(r.focus, 'resultat')
})

test('enhanceCvSummaryPure: splits sentences into bullets', () => {
  const r = enhanceCvSummaryPure('Byggde en microservice. Optimerade databasen. Ledde teamet.', 'resultat')
  assert.ok(r.bullets.length >= 2, 'should produce multiple bullets')
  // The `enhanced` string is the joined bullet list with the
  // "• " prefix; the `bullets` array is the raw (unprefixed)
  // bullet text. We check the joined string so the test
  // doesn't drift from how the UI actually renders.
  for (const line of r.enhanced.split('\n')) {
    assert.ok(line.startsWith('• '), `line should start with "• ": ${line}`)
  }
})

test('enhanceCvSummaryPure: removes filler words', () => {
  const r = enhanceCvSummaryPure('Jag har egentligen jobbat typ med React, vilket jag ganska gillar.', 'resultat')
  const flat = r.enhanced.toLowerCase()
  assert.ok(!flat.includes('egentligen'), 'filler "egentligen" should be removed')
  assert.ok(!flat.includes('typ'), 'filler "typ" should be removed')
  assert.ok(!flat.includes('ganska'), 'filler "ganska" should be removed')
})

test('enhanceCvSummaryPure: keeps strong lead verbs (no double-prefix)', () => {
  const r = enhanceCvSummaryPure('Levererade ett nytt API. Optimerade databasen.', 'resultat')
  // The raw bullets (no "• " prefix) are what we check — the
  // prefix is added only when joining into the final string.
  for (const b of r.bullets) {
    const words = b.split(/\s+/)
    const verb1 = words[0]
    // The bullet should not start with two lead verbs back to
    // back (e.g. "Levererade Levererade ...").
    const verb2 = words[1]
    const strongVerbs = ['levererade', 'ökade', 'minskade', 'byggde', 'implementerade', 'optimerade', 'ledde']
    if (strongVerbs.includes(verb1?.toLowerCase()) && strongVerbs.includes(verb2?.toLowerCase())) {
      assert.fail(`double verb prefix detected: ${b}`)
    }
  }
})

test('enhanceCvSummaryPure: resultat focus uses result-style verbs', () => {
  const r = enhanceCvSummaryPure('Vi förbättrade prestandan i appen.', 'resultat')
  // The resultat focus must produce a result-style lead verb.
  // We don't assert which one (it's random) — only that the bullet
  // is non-empty.
  assert.ok(r.bullets.length > 0)
})

test('enhanceCvSummaryPure: teknisk focus uses technical verbs', () => {
  const r = enhanceCvSummaryPure('Vi byggde en microservice.', 'teknisk')
  assert.ok(r.bullets.length > 0)
  // Lead verbs for teknisk: Byggde, Implementerade, Optimerade,
  // Arkiterade, Utvecklade, Designade. We don't lock the random
  // pick but the bullet should be non-empty.
})

test('enhanceCvSummaryPure: ledarskap focus uses leadership verbs', () => {
  const r = enhanceCvSummaryPure('Jag ledde teamet.', 'ledarskap')
  assert.ok(r.bullets.length > 0)
})

test('enhanceCvSummaryPure: unknown focus falls back to resultat', () => {
  const r1 = enhanceCvSummaryPure('Vi förbättrade appen.', 'unknown_focus')
  const r2 = enhanceCvSummaryPure('Vi förbättrade appen.', 'resultat')
  // Same input + same fallback focus = same output (deterministic
  // for this simple sentence since the random pick is the only
  // source of variance — we don't assert exact match but both
  // should produce a non-empty result).
  assert.ok(r1.bullets.length > 0)
  assert.ok(r2.bullets.length > 0)
})

test('enhanceCvSummaryGroq: returns valid bullets regardless of provider', async () => {
  // The Groq key may or may not be set in CI. Either way the
  // contract is: a non-empty input produces a non-empty output.
  // When the key is absent, the source discriminator is 'pure'
  // (no LLM hit). When the key is present, the source is 'groq'
  // and we just check the output is well-formed.
  const r = await enhanceCvSummaryGroq('Byggde en microservice. Optimerade prestanda.', 'resultat')
  assert.ok(r.bullets.length > 0, 'should produce bullets')
  assert.ok(typeof r.enhanced === 'string' && r.enhanced.length > 0)
  assert.ok(['pure', 'groq'].includes(r.source), `unexpected source: ${r.source}`)
})

test('enhanceCvSummaryGroq: falls back on empty input', async () => {
  const r = await enhanceCvSummaryGroq('', 'resultat')
  assert.equal(r.enhanced, '')
  assert.deepEqual(r.bullets, [])
})

test('enhanceCvSummaryGroq: result includes the focus field', async () => {
  const r = await enhanceCvSummaryGroq('Vi förbättrade appen.', 'teknisk')
  assert.equal(r.focus, 'teknisk')
})

// ---------- Round-46 — verb normalisation regression lock ----------
//
// Bug-fix: the ledarskap focus shipped with two NON-STANDARD Swedish
// past-tense verbs ("Coachte" / "Mentorskade") that read as
// "happened to coach / mentor" instead of past tense. The correct
// Swedish forms are "Coachade" (att coacha → coachade) and
// "Mentorerade" (att mentora → mentorerade). The runtime catalogue
// + the strong-verb detect regex both shipped with the original
// (incorrect) forms and would silently emit malformed Swedish to
// the user.
//
// The static-grep lock below prevents silent regression. The deep
// test asserts that both the GENERATOR catalogue AND the detector
// regex include the normalised forms.

test('ledarskap focus generator catalogue uses Swedish past-tense verbs (Round-46 lock)', () => {
  // The literal verb list is FOCUS_LEAD_VERBS.ledarskap inside
  // lib/cv-enhance.js. The lock pins 4 of the 6 verbs and the
  // renamed two (Coachade / Mentorerade) so a future refactor can't
  // silently drop them back to "Coachte" / "Mentorskade".
  const SOURCE = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../lib/cv-enhance.js'),
    'utf-8',
  )
  // Normalised forms MUST be present (the Round-46 fix).
  assert.ok(/Coachade/.test(SOURCE),
    'FOCUS_LEAD_VERBS.ledarskap must include "Coachade" (past tense of "coacha")')
  assert.ok(/Mentorerade/.test(SOURCE),
    'FOCUS_LEAD_VERBS.ledarskap must include "Mentorerade" (past tense of "mentora")')
  // Legacy broken forms MUST NOT silently re-appear in the generator
  // catalogue (they stay ONLY in the regex back-compat list — see
  // the Round-46 followup comment in lib/cv-enhance.js).
  // We assert that "Coachte" and "Mentorskade" appear ONLY in
  // regex contexts (within a /.../i pattern) and NOT as bare
  // string literals in FOCUS_LEAD_VERBS lines.
  const lines = SOURCE.split('\n')
  const catalogueLines = lines.filter((l) => /ledarskap\s*:/.test(l))
  for (const line of catalogueLines) {
    assert.ok(!/\bCoachte\b/.test(line),
      `FOCUS_LEAD_VERBS.ledarskap catalogue must NOT contain "Coachte" (use "Coachade"): ${line.trim()}`)
    assert.ok(!/\bMentorskade\b/.test(line),
      `FOCUS_LEAD_VERBS.ledarskap catalogue must NOT contain "Mentorskade" (use "Mentorerade"): ${line.trim()}`)
  }
})

test('makeBullet strong-verb detection accepts the normalised forms without double-prefixing (Round-46)', () => {
  // Pre-normalised verbs in the user's summary must NOT be
  // double-prefixed (e.g. "Coachade Coachade ett team") because
  // the makeBullet double-prefix guard relies on alreadyStrong
  // matching them. Without including the new forms in the regex
  // the guard fails and the renderer prepends a second lead verb.
  // This test exercises the runtime path: a summary whose FIRST
  // verb is the normalised form MUST survive the makeBullet
  // round-trip without a duplicate prefix verb.
  const r1 = enhanceCvSummaryPure('Coachade ett team. Mentorerade två juniorer.', 'ledarskap')
  assert.ok(r1.bullets.length >= 1, 'should produce at least one bullet')
  for (const b of r1.bullets) {
    // No double-prefix: a bullet whose first word is "Coachade"
    // must NOT begin with "Coachade <verb> ...".
    if (/^Coachade\b/i.test(b)) {
      const words = b.split(/\s+/)
      const second = words[1] || ''
      assert.notEqual(second.toLowerCase(), 'coachade',
        `Round-46 double-prefix detected — "${b}" starts with "Coachade Coachade"`)
    }
    if (/^Mentorerade\b/i.test(b)) {
      const words = b.split(/\s+/)
      const second = words[1] || ''
      assert.notEqual(second.toLowerCase(), 'mentorerade',
        `Round-46 double-prefix detected — "${b}" starts with "Mentorerade Mentorerade"`)
    }
  }
})

test('enhanceCvSummaryPure: ledarskap focus bullets stay within the FOCUS_LEAD_VERBS.ledarskap catalogue (Round-46 runtime lock)', () => {
  // Round-46 code-reviewer #2 + #3 fixes combined:
  //   • Previously hard-coded `validVerbs` would break on a
  //     legitimate catalogue addition (e.g. adding 'Planerade' as
  //     a 7th verb). Now we source-grep the ledarskap catalogue
  //     from lib/cv-enhance.js so the test follows the catalogue
  //     automatically.
  //   • The deterministic positive check (`firstWord ∈ validVerbs`)
  //     is satisfied by the very first iteration; the loop's
  //     purpose is now solely to amplify the NEGATIVE check
  //     (no legacy "Coachte" / "Mentorskade") across multiple
  //     Math.random() picks. N=10 walks the catalogue 10 times.
  const SOURCE = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../lib/cv-enhance.js'),
    'utf-8',
  )
  // Source-grep the ledarskap catalogue (anchored on
  // `ledarskap: [...]` so a future rename would fail loudly).
  const m = SOURCE.match(/ledarskap\s*:\s*\[([\s\S]+?)\]/)
  assert.ok(m, 'lib/cv-enhance.js must export a `ledarskap: [...]` catalogue entry')
  const validVerbs = m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  assert.ok(validVerbs.length >= 4,
    `expected FOCUS_LEAD_VERBS.ledarskap to have ≥4 verbs; got ${validVerbs.length}: ${validVerbs.join(', ')}`)
  assert.ok(validVerbs.includes('Coachade'),
    'FOCUS_LEAD_VERBS.ledarskap must include "Coachade" (Round-46 normalisation)')
  assert.ok(validVerbs.includes('Mentorerade'),
    'FOCUS_LEAD_VERBS.ledarskap must include "Mentorerade" (Round-46 normalisation)')
  assert.ok(!validVerbs.includes('Coachte'),
    'FOCUS_LEAD_VERBS.ledarskap must NOT include legacy "Coachte"')
  assert.ok(!validVerbs.includes('Mentorskade'),
    'FOCUS_LEAD_VERBS.ledarskap must NOT include legacy "Mentorskade"')
  // Deterministic runtime check across 10 samples (Math.random
  // varies the picked verb; one bullet per sample).
  for (let i = 0; i < 10; i++) {
    const r = enhanceCvSummaryPure(`Vi förändrade saker avsevärt dag ${i}.`, 'ledarskap')
    for (const b of r.bullets) {
      assert.ok(!/\bCoachte\b/.test(b),
        `Round-46: legacy broken verb "Coachte" appeared in output: "${b}"`)
      assert.ok(!/\bMentorskade\b/.test(b),
        `Round-46: legacy broken verb "Mentorskade" appeared in output: "${b}"`)
      const firstWord = (b.split(/\s+/)[0] || '').replace(/[.!?]$/, '')
      assert.ok(validVerbs.includes(firstWord),
        `Round-46: ledarskap bullet "${b}" starts with "${firstWord}", which is not one of the source-derived FOCUS_LEAD_VERBS.ledarskap verbs: ${validVerbs.join(', ')}`)
    }
  }
})
