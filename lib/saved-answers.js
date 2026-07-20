// lib/saved-answers.js
//
// Round-38 / Part 2 — Answer memory backend.
//
// The user can save AI-generated answers (cover letters, motivation-class
// answers from the extension, free-form "Varför vill du jobba här?")
// and reuse them later when a similar question comes up. Each saved
// answer lives as one Mongo document keyed by `{clerkId, id}` where
// `id` is a client-generated UUID so the same answer can be re-saved
// across devices (re-save = upsert).
//
// Soft-launch design choices
// -------------------------
// • Similarity is plain Jaccard over tokenised Swedish text — no
//   embeddings, no vector store, no extra dependency. At 0-50 saved
//   answers per user the in-memory scan is sub-millisecond. Embedding
//   quality would only matter past ~1k saved answers, well above the
//   soft-launch scale.
// • Threshold 0.7 (strict) — false-positive matches in a job-application
//   context are much worse than missed matches. The extension's UI
//   fills ONE answer, not a "pick from N" picker.
// • Field-constrained search — when `/api/extension/answer` looks up a
//   memory match, it only scans saved answers with the SAME `field`
//   value (e.g. `whyThisRole` won't match a `strengths` answer). The
//   client can still save any field via `/api/saved-answers` (open
//   schema: `custom`, `coverLetter`, etc. are all allowed).
// • No "use this answer" prompt on the client — the memory is
//   first-past-the-post. If a higher-similarity match arrives later,
//   the upsert overwrites the previous one. Idempotent + simple.
//
// This module is the pure-logic surface: Zod schema, tokenize/jaccard,
// upsert/list/delete. The API route in app/api/saved-answers/route.js
// wraps these with `requireAuth` and JSON IO.
import { z } from 'zod'

// ---- Zod schemas ----

// The field is intentionally open: the canonical 6 motivation fields
// from lib/extension-profile.js + 'custom' + 'coverLetter'. We accept
// any non-empty string ≤ 64 chars so a future motivation field can
// be added without a schema bump.
export const SavedAnswerFieldSchema = z.string().min(1).max(64)

export const SavedAnswerSchema = z.object({
  id: z.string().min(1).max(80),
  field: SavedAnswerFieldSchema,
  // Question text — required. Drives the similarity lookup.
  question: z.string().min(1).max(2_000),
  // Answer text — required. Capped at 5 000 chars so a misbehaving
  // client can't write a multi-megabyte doc to Mongo.
  answer: z.string().min(1).max(5_000),
  // Quality star — 4 (default) or 5. The UI toggles between the two
  // values; we don't accept other numbers so the filter (`quality>=5`
  // → "saved & good") stays meaningful.
  quality: z.number().int().min(4).max(5).default(4),
  // Round-42 (Part 3 polish): per-answer style preference. Set when
  // the answer was generated under a per-question style override
  // (popup dropdown) so the consistency check (same company,
  // different style) can warn later. Optional — answers written
  // before this field was added land with style: undefined and
  // are still readable.
  style: z.string().min(1).max(64).optional(),
  // Round-42 (Part 2 polish): auto-managed by the server on each
  // memory match. NOT settable by the client — the upsert helper
  // drops any client-supplied value to keep this field authoritative.
})

// ---- Tokenise + Jaccard ----

// Tokeniser — keeps Swedish diacritics (å, ä, ö) intact because
// stripping them conflates *får* / *far*, *lån* / *lan* — real
// Swedish semantic differences. We lowercase + replace anything that
// isn't a Unicode letter or digit with whitespace, then split.
// Non-string inputs (numbers, objects, arrays, booleans) all return
// an empty Set so the caller never sees a tokenised `42` or
// `[object Object]`.
export function tokenize(text) {
  if (text == null) return new Set()
  if (typeof text !== 'string') return new Set()
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\d]+/gu, ' ')
    .trim()
  if (!cleaned) return new Set()
  return new Set(cleaned.split(/\s+/).filter(Boolean))
}

// Jaccard similarity — intersection / union. Returns 1 when both sets
// are empty (so two empty questions are "identical"); 0 when one is
// empty and the other is not (no signal to compare on).
export function jaccardSimilarity(textA, textB) {
  const setA = tokenize(textA)
  const setB = tokenize(textB)
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// Find the best saved-answer match for a given question + field.
// `answers` is the array of saved answers (already filtered by
// `clerkId` at the route layer). Returns the matching answer with
// the highest Jaccard score, or null if no answer clears the
// threshold. The threshold is the ONE knob the extension route
// uses — keep it strict (≥0.7) so we never autofill a wrong
// answer silently.
export const SAVED_ANSWER_MATCH_THRESHOLD = 0.7

export function findBestMemoryMatch(question, field, answers) {
  if (!Array.isArray(answers) || answers.length === 0) return null
  if (!question || typeof question !== 'string') return null
  let best = null
  for (const ans of answers) {
    if (!ans || typeof ans !== 'object') continue
    if (ans.field && field && ans.field !== field) continue
    const score = jaccardSimilarity(question, ans.question || '')
    if (score >= SAVED_ANSWER_MATCH_THRESHOLD) {
      if (!best || score > best.score) {
        best = { answer: ans, score }
      }
    }
  }
  return best
}

// ---- Mongo helpers ----
//
// Single source of truth for the saved-answers collection. The route
// imports these so the shape + access pattern never drifts. All
// helpers take an already-connected `db` and the `clerkId` (from
// requireAuth) — they never read auth headers themselves.

const COLLECTION = 'saved_answers'

// Strip internal-only Mongo fields (e.g. `_id`) from a document so
// the JSON-serialised response shape is clean. Matches the
// `strip` pattern used in app/api/[[...path]]/route.js.
function stripInternal(doc) {
  if (!doc) return doc
  if (Array.isArray(doc)) return doc.map(stripInternal)
  const { _id, ...rest } = doc
  return rest
}

// listSavedAnswers — returns the user's full saved-answers corpus
// (newest first). The extension route calls this on every fill and
// the /settings page hydrates its list from the same call. A 100-doc
// upper cap guards against a runaway client — the soft-launch
// per-user ceiling is well below that.
export async function listSavedAnswers(db, clerkId, { limit = 100 } = {}) {
  if (!db || !clerkId) return []
  const docs = await db
    .collection(COLLECTION)
    .find({ clerkId })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(limit, 100)))
    .toArray()
  return docs.map(stripInternal)
}

// upsertSavedAnswer — POST handler. Same id = overwrite (e.g. edit),
// new id = new doc. We never delete a doc on upsert so an idempotent
// retry from the client doesn't lose data.
export async function upsertSavedAnswer(db, clerkId, payload) {
  if (!db || !clerkId) throw new Error('db and clerkId are required')
  // The payload is already Zod-validated at the route layer; we
  // re-validate here as a defence-in-depth (so a future caller
  // doesn't have to remember).
  const parsed = SavedAnswerSchema.parse(payload)
  const now = new Date()
  const doc = {
    clerkId,
    id: parsed.id,
    field: parsed.field,
    question: parsed.question,
    answer: parsed.answer,
    quality: parsed.quality ?? 4,
    // `style` is optional; default to undefined so the doc is
    // shaped the same as pre-Round-42 rows (the consistency check
    // treats undefined as "no per-question override was active").
    style: parsed.style || undefined,
    // usageCount is server-managed — set on first insert, NEVER
    // overwritten by an upsert so a client round-tripping the
    // same doc can't reset the match counter.
    updatedAt: now,
  }
  await db.collection(COLLECTION).updateOne(
    { clerkId, id: parsed.id },
    {
      $set: doc,
      $setOnInsert: { createdAt: now, usageCount: 0, lastUsedAt: null },
    },
    { upsert: true },
  )
  return stripInternal(doc)
}

/**
 * Round-42 (Part 2 polish) — Increment the usage counter for a
 * saved answer that just served a memory match. Atomic via Mongo
 * `$inc` so concurrent matches can't double-increment or skip a
 * value. `lastUsedAt` is also bumped so the consistency check
 * (Part 3 polish) can detect "the same company was answered
 * with a different style within N days" by walking lastUsedAt.
 *
 * Failure mode: a Mongo blip here is a soft optimization, NOT a
 * correctness issue. The caller (the /api/extension/answer route)
 * already returned the match; this just logs the touch. We
 * deliberately do NOT throw — the route wraps in a try/catch and
 * logs a warning rather than bouncing the user-visible match.
 */
export async function recordMemoryUse(db, clerkId, id) {
  if (!db || !clerkId || !id) return
  try {
    await db.collection(COLLECTION).updateOne(
      { clerkId, id },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
    )
  } catch (err) {
    console.warn('[saved-answers] recordMemoryUse failed (non-fatal):', err?.message || err)
  }
}

// deleteSavedAnswer — DELETE handler. Idempotent: a missing id
// returns `false` (no row deleted) rather than throwing, so the
// route can return 200 with `{ deleted: 0 }` without 404-ing the
// client.
export async function deleteSavedAnswer(db, clerkId, id) {
  if (!db || !clerkId) throw new Error('db and clerkId are required')
  if (!id || typeof id !== 'string') return false
  const result = await db.collection(COLLECTION).deleteOne({ clerkId, id })
  return result.deletedCount > 0
}
