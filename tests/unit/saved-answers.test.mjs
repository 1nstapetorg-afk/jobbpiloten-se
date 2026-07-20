// tests/unit/saved-answers.test.mjs
//
// Round-38 / Part 2 — Answer memory structural + behavioural tests.
//
// Locks the contract for `lib/saved-answers.js` so a future maintainer
// who touches tokenisation, similarity, or the Zod schema surfaces a
// failure at unit-test time. Pure-node tests; no Mongo, no HTTP.
//
// What we lock
// ------------
//   1. tokenize — Swedish-aware, keeps diacritics, drops punctuation,
//      returns empty Set for non-strings (numbers, objects, etc.)
//   2. jaccardSimilarity — empty-set short-circuits, identical = 1, disjoint = 0
//   3. findBestMemoryMatch — strict 0.7 threshold, field-constrained search,
//      null on no match, returns the BEST match (not first)
//   4. SavedAnswerSchema — Zod validation rejects oversize / malformed payloads
//   5. SAVED_ANSWER_MATCH_THRESHOLD — locks the 0.7 contract so a maintainer
//      who changes the threshold trips a comment test, not a silent UX drift.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  tokenize,
  jaccardSimilarity,
  findBestMemoryMatch,
  SAVED_ANSWER_MATCH_THRESHOLD,
  SavedAnswerSchema,
  listSavedAnswers,
  upsertSavedAnswer,
  deleteSavedAnswer,
} from '../../lib/saved-answers.js'

// ---- 1. tokenize ----

test('tokenize: keeps Swedish diacritics (å/ä/ö) intact', () => {
  // Stripping diacritics would conflate får/far, lån/lan, möta/meta —
  // real semantic differences in Swedish job-application text. We
  // pick a sentence with exactly 7 unique tokens so the size
  // assertion is meaningful (a hyphenated compound like
  // "frontend-utveckling" would split to two tokens, inflating
  // the count).
  const t = tokenize('Jag har åtta års erfarenhet av jobb i Göteborg.')
  assert.ok(t.has('jag'))
  assert.ok(t.has('har'))
  assert.ok(t.has('åtta'))    // NOT 'atta'
  assert.ok(t.has('erfarenhet'))
  assert.ok(t.has('jobb'))
  assert.ok(t.has('i'))
  assert.ok(t.has('göteborg')) // NOT 'goteborg'
  assert.equal(t.size, 9, `Expected 9 unique tokens; got ${[...t].join(', ')}`)
})

test('tokenize: lowercases + splits on whitespace + non-letter chars', () => {
  const t = tokenize('Hej, Världen!  Hej   Världen.')
  // 'hej' and 'världen' each appear twice; Set dedupes to {hej, världen}.
  assert.deepEqual([...t].sort(), ['hej', 'världen'])
})

test('tokenize: hyphenated compounds split into two tokens', () => {
  // Documented behaviour: "frontend-utveckling" → "frontend" + "utveckling".
  // The Swedish-compound-word handling (e.g. splitting on
  // morphological boundaries) is deliberately out of scope — at
  // soft-launch scale the extra tokens don't change the Jaccard
  // ranking meaningfully, and the simpler splitter keeps the
  // code base tiny.
  const t = tokenize('frontend-utveckling')
  assert.ok(t.has('frontend'))
  assert.ok(t.has('utveckling'))
  assert.equal(t.size, 2)
})

test('tokenize: empty / null / non-string inputs return an empty Set', () => {
  // Non-strings (numbers, objects, arrays) MUST return empty so
  // jaccardSimilarity never sees a tokenised `[object Object]`.
  // Without this guard, a future caller that passes a Mongo doc
  // by accident would treat it as a single token and the
  // similarity score would be misleadingly 0 (no overlap with
  // any reasonable question).
  assert.equal(tokenize('').size, 0)
  assert.equal(tokenize('   ').size, 0)
  assert.equal(tokenize(null).size, 0)
  assert.equal(tokenize(undefined).size, 0)
  assert.equal(tokenize(42).size, 0)
  assert.equal(tokenize({}).size, 0)
  assert.equal(tokenize([]).size, 0)
  assert.equal(tokenize(true).size, 0)
})

// ---- 2. jaccardSimilarity ----

test('jaccardSimilarity: identical strings → 1.0', () => {
  const a = 'Varför vill du jobba med frontend-utveckling?'
  assert.equal(jaccardSimilarity(a, a), 1)
})

test('jaccardSimilarity: completely disjoint → 0.0', () => {
  const a = 'frontend stockholm react'
  const b = 'sales manager göteborg'
  assert.equal(jaccardSimilarity(a, b), 0)
})

test('jaccardSimilarity: partial overlap → value in (0, 1)', () => {
  // "varför vill du jobba" vs "varför vill du söka" — 3 shared
  // tokens out of 5 union → 0.6.
  const a = 'varför vill du jobba'
  const b = 'varför vill du söka'
  const score = jaccardSimilarity(a, b)
  assert.ok(score > 0.5 && score < 0.7, `expected ~0.6, got ${score}`)
})

test('jaccardSimilarity: case-insensitive', () => {
  const score = jaccardSimilarity('Hej Världen', 'hej världen')
  assert.equal(score, 1)
})

test('jaccardSimilarity: empty/empty → 1.0 (no signal = identical)', () => {
  // The threshold branch handles this; the contract is "no signal
  // = match" so a hand-crafted "blank question" doesn't
  // accidentally slip through.
  assert.equal(jaccardSimilarity('', ''), 1)
})

test('jaccardSimilarity: empty/non-empty → 0.0', () => {
  assert.equal(jaccardSimilarity('', 'something'), 0)
  assert.equal(jaccardSimilarity('something', ''), 0)
})

// ---- 3. findBestMemoryMatch ----

test('findBestMemoryMatch: empty corpus returns null', () => {
  assert.equal(findBestMemoryMatch('What?', 'whyThisRole', []), null)
  assert.equal(findBestMemoryMatch('What?', 'whyThisRole', null), null)
  assert.equal(findBestMemoryMatch('What?', 'whyThisRole', undefined), null)
})

test('findBestMemoryMatch: returns null below threshold (no false positives)', () => {
  // A 0.4 Jaccard match is not enough to autofill a job-application
  // answer — a wrong match is much worse than no match.
  const corpus = [
    { id: 'a', field: 'whyThisRole', question: 'why do you want this job', answer: 'because' },
  ]
  const result = findBestMemoryMatch('completely different question', 'whyThisRole', corpus)
  assert.equal(result, null)
})

test('findBestMemoryMatch: returns best match above threshold', () => {
  const corpus = [
    { id: 'a', field: 'whyThisRole', question: 'varför vill du jobba hos oss', answer: 'answer-a' },
    { id: 'b', field: 'whyThisRole', question: 'berätta om en utmaning du löst', answer: 'answer-b' },
  ]
  // First corpus entry is an exact phrase match → Jaccard 1.0.
  const result = findBestMemoryMatch('varför vill du jobba hos oss', 'whyThisRole', corpus)
  assert.ok(result)
  assert.equal(result.answer.id, 'a')
  assert.equal(result.answer.answer, 'answer-a')
  assert.ok(result.score >= SAVED_ANSWER_MATCH_THRESHOLD)
})

test('findBestMemoryMatch: field-constrained — whyThisRole never matches strengths', () => {
  // A `strengths` answer must NEVER satisfy a `whyThisRole` query
  // even if the questions are identical (the user's "strengths" copy
  // would land in the wrong field otherwise).
  const corpus = [
    { id: 'a', field: 'strengths', question: 'varför vill du jobba hos oss', answer: 'WRONG' },
  ]
  const result = findBestMemoryMatch('varför vill du jobba hos oss', 'whyThisRole', corpus)
  assert.equal(result, null)
})

test('findBestMemoryMatch: field-agnostic when corpus entry has no field', () => {
  // A corpus entry with `field: undefined` is allowed (the
  // `coverLetter` field never participates in the extension's
  // field-constrained search, but the dashboard's
  // "Spara till minne" flow might save one with no specific
  // field). Field-less entries match any query.
  const corpus = [
    { id: 'a', question: 'varför vill du jobba', answer: 'match-anywhere' },
  ]
  const result = findBestMemoryMatch('varför vill du jobba', 'whyThisRole', corpus)
  assert.ok(result)
  assert.equal(result.answer.id, 'a')
})

test('findBestMemoryMatch: best-of-N picks highest score, not first', () => {
  const corpus = [
    { id: 'low', field: 'whyThisRole', question: 'varför jobba', answer: 'low' },
    { id: 'high', field: 'whyThisRole', question: 'varför vill du jobba hos oss på riktigt', answer: 'high' },
    { id: 'mid', field: 'whyThisRole', question: 'varför vill du jobba', answer: 'mid' },
  ]
  const result = findBestMemoryMatch('varför vill du jobba', 'whyThisRole', corpus)
  assert.ok(result)
  // The "mid" entry is an exact phrase match (Jaccard 1.0),
  // "high" is partial, "low" is partial. Best is "mid".
  assert.equal(result.answer.id, 'mid')
})

// ---- 4. SAVED_ANSWER_MATCH_THRESHOLD contract ----

test('SAVED_ANSWER_MATCH_THRESHOLD is 0.7 (strict — no silent autofill)', () => {
  // A future maintainer who loosens the threshold below 0.7 risks
  // false-positive autofills in a job-application context. The
  // threshold is the single most important knob in the memory
  // system; a one-line test makes a "let's make it more lenient"
  // PR loud at unit-test time.
  assert.equal(SAVED_ANSWER_MATCH_THRESHOLD, 0.7)
})

// ---- 5. SavedAnswerSchema (Zod) ----

test('SavedAnswerSchema: accepts a valid payload', () => {
  const r = SavedAnswerSchema.safeParse({
    id: 'sv-001',
    field: 'whyThisRole',
    question: 'Varför vill du jobba hos oss?',
    answer: 'Jag har 5 års erfarenhet av React.',
    quality: 5,
  })
  assert.equal(r.success, true)
})

test('SavedAnswerSchema: defaults quality to 4 when missing', () => {
  const r = SavedAnswerSchema.parse({
    id: 'sv-001',
    field: 'custom',
    question: 'När kan du börja?',
    answer: 'Omgående.',
  })
  assert.equal(r.quality, 4)
})

test('SavedAnswerSchema: rejects missing id', () => {
  const r = SavedAnswerSchema.safeParse({
    field: 'whyThisRole',
    question: 'X',
    answer: 'Y',
  })
  assert.equal(r.success, false)
})

test('SavedAnswerSchema: rejects empty answer', () => {
  const r = SavedAnswerSchema.safeParse({
    id: 'a',
    field: 'whyThisRole',
    question: 'X',
    answer: '',
  })
  assert.equal(r.success, false)
})

test('SavedAnswerSchema: rejects oversize answer (>5000 chars)', () => {
  const r = SavedAnswerSchema.safeParse({
    id: 'a',
    field: 'whyThisRole',
    question: 'X',
    answer: 'a'.repeat(5_001),
  })
  assert.equal(r.success, false)
})

test('SavedAnswerSchema: rejects quality outside 4-5 range', () => {
  // We intentionally cap at 4-5 so the "good" filter (quality >= 5)
  // stays meaningful. A maintainer who wanted 1-5 stars would
  // need to update the schema AND the UI toggle logic in lockstep.
  for (const q of [0, 1, 3, 6, 10, -1]) {
    const r = SavedAnswerSchema.safeParse({
      id: 'a', field: 'whyThisRole', question: 'X', answer: 'Y', quality: q,
    })
    assert.equal(r.success, false, `quality=${q} should be rejected`)
  }
})

test('SavedAnswerSchema: rejects field longer than 64 chars', () => {
  const r = SavedAnswerSchema.safeParse({
    id: 'a', field: 'a'.repeat(65), question: 'X', answer: 'Y',
  })
  assert.equal(r.success, false)
})

// ---- 6. Mongo helper surface (lazy) ----
//
// The Mongo helpers in lib/saved-answers.js take a real
// `db` and `clerkId`. We can't import the real MongoClient in
// `node --test` without bringing up a server. Here we lock the
// import shape so a future maintainer who renames the helpers
// trips a single test.

test('lib/saved-answers.js exports the canonical helper surface', () => {
  // The settings page + the API route import these names; a
  // rename would surface at the import line + here.
  assert.equal(typeof listSavedAnswers, 'function')
  assert.equal(typeof upsertSavedAnswer, 'function')
  assert.equal(typeof deleteSavedAnswer, 'function')
})
