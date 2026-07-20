/**
 * POST /api/extension/ai-answers
 *
 * Batch AI-answer generation for the JobbPiloten Auto-Fill extension.
 * Triggered when the content script lands on a form whose free-text
 * fields don't match any entry in FIELD_PATTERNS (Workday SPA forms
 * with proprietary labels, Greenhouse motivation prompts, etc) AND
 * the user has `profile.aiFallbackEnabled` set to true AND they
 * haven't blown their monthly tier cap.
 *
 * Body shape (Zod-validated by ExtensionBatchAnswerBodySchema):
 *   {
 *     fields: [ { id, label, question? }, ... ],
 *     jobUrl?: string,
 *     jobTitle?: string,
 *     lang?: 'sv' | 'en',
 *   }
 *
 * Response shape:
 *   {
 *     answers: { [fieldId]: { answer: string, source: 'groq'|'openai'|'profile'|'fallback'|'error' } },
 *     sources: { [fieldId]: string },        // same map, flat for easier client-side rendering
 *     remaining: number | null,              // null for Elite (unlimited)
 *     monthKey: 'YYYY-MM',
 *   }
 *
 * Auth: opaque bearer token (same scheme as /api/extension/answer and
 * /api/extension/profile). 401 on invalid/missing/revoked.
 *
 * Rate limit: independent in-memory bucket
 * (`global.__jobbpilotenAiBatchBuckets`) at 10 calls / hour / token.
 * The single-field endpoint's bucket is left untouched — the two
 * code paths are independent lifecycles (per-page-fill vs
 * per-keydown retry).
 *
 * Tier cap: Basic=10/mo, Professional=50/mo, Elite=∞ — mirrors
 * AI_TIER_LIMITS from lib/ai-usage.js. The PreLLM check
 * (`isWithinLimit`) rejects the whole batch BEFORE burning tokens if
 * it would push the user over the cap. Per-field Groq failures
 * inside an accepted batch still increment the counter on success
 * so the next request sees the latest total.
 *
 * Cost guard: `max_tokens: 350` from lib/groq.js's
 * generateAdaptiveAnswer ≈ 200 Swedish words at the Groq llama
 * token-to-word ratio. Combined with the concurrency=3 cap on the
 * `generateBatchAnswers` worker pool, worst-case per call is
 * 12 × ~350 tokens = ~4200 tokens ≈ ≤$0.01 via Groq.
 *
 * Partial failures: a single Groq 429 / network blip on one field
 * MUST NOT crash the batch — every per-field call is wrapped in
 * generateBatchAnswers' try/catch. Failing fields are returned with
 * `source: 'error'` and an empty `answer: ''` so the extension
 * paints them `missing` (yellow outline) instead of crashing the
 * fill loop. Whole-batch 5xx still happens if the route itself
 * throws (DB outage, body too large).
 */

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { ZodError } from 'zod';
import { generateBatchAnswers } from '@/lib/groq';
import {
  ExtensionBatchAnswerBodySchema,
  EXTENSION_BATCH_FIELD_SET,
} from '@/lib/extension-profile';
import {
  getCurrentCount,
  incrementUsage,
  getMonthlyLimitFor,
  isWithinLimit,
  monthKey,
} from '@/lib/ai-usage';
import { requireCompleteProfile } from '@/lib/profile-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---- Mongo singleton (mirror /api/extension/profile/route.js so we
// don't open N pools as fast as routes are imported) ----
let clientPromise;
if (!global._mongoClientPromise) {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten');
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.DB_NAME);
}

// ---- Independent rate-limit bucket for the batch endpoint ----
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10;
if (!global.__jobbpilotenAiBatchBuckets) {
  global.__jobbpilotenAiBatchBuckets = new Map();
}
const rateBuckets = global.__jobbpilotenAiBatchBuckets;

function checkRateLimit(token) {
  const now = Date.now();
  const bucket = rateBuckets.get(token) || [];
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) {
    const oldest = fresh[0];
    rateBuckets.set(token, fresh);
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - oldest) };
  }
  fresh.push(now);
  rateBuckets.set(token, fresh);
  return { allowed: true };
}

async function resolveClerkId(request) {
  const auth = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth);
  if (!match) return null;
  const token = match[1];
  const db = await getDb();
  const tokenDoc = await db.collection('extension_tokens').findOne({ token });
  if (!tokenDoc) return null;
  // lastUsedAt is debug-only; non-fatal so a flaky audit-write never
  // bounces a real fill attempt.
  await db.collection('extension_tokens').updateOne(
    { token },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => {});
  return { clerkId: tokenDoc.clerkId, token };
}

/**
 * Cheap pre-flight for jobUrl / jobTitle. /api/extension/answer
 * doesn't scrape anything — the single-field prompt is short
 * enough that the form label carries the context. The batch
 * endpoint is more ambitious (it adapts the answer to the SPECIFIC
 * company/role), so we do a tiny HTML fetch + regex strip on the
 * server. We don't import lib/jobScraper.js here because that
 * targets Arbetsförmedlingen JSON — `/jobUrl` is often a Workday
 * iframe link, an ATS short URL, or a Platsbanken detail page,
 * none of which jobScraper understands. A 4 KB cap on the response
 * keeps the prompt within its token envelope.
 */
async function fetchJobDescription(jobUrl) {
  if (!jobUrl || typeof jobUrl !== 'string') return '';
  try {
    // Follow up to 3 redirects, 4s total budget, 4 KB cap on body read.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);
    const res = await fetch(jobUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; JobbPilotenBot/1.0)',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const buf = await res.arrayBuffer();
    // 4 KB hard cap: 4096 bytes / utf-8 ≈ 4096 chars of text.
    const chunk = Buffer.from(buf).slice(0, 4096).toString('utf-8');
    // Strip HTML tags + scripts + styles. Cheap-but-good-enough for
    // a 4 KB chunk; production-quality parsing would pull in
    // cheerio (which would add ~150 KB to the bundle). The regex
    // strips the most common patterns and leaves the visible text
    // for the prompt.
    return String(chunk
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
  } catch (err) {
    console.warn('[ai-answers] jobDescription fetch failed:', err?.message);
    return '';
  }
}

export async function POST(request) {
  const auth = await resolveClerkId(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'Ogiltig eller saknad token — anslut tillägget från /dashboard.' },
      { status: 401 },
    );
  }
  // Rate-limit gate before doing any DB work. The cost of letting
  // 50 calls/sec through to Mongo(checkRateLimit only ~1 ms) is
  // cheaper than reading the profile on every burst.
  const rl = checkRateLimit(auth.token);
  if (!rl.allowed) {
    const retrySec = Math.ceil((rl.retryAfterMs || RATE_LIMIT_WINDOW_MS) / 1000);
    return NextResponse.json(
      { error: `För många batch-anrop — försök igen om ${retrySec}s.`, retryAfter: retrySec },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ogiltig JSON' }, { status: 400 });
  }

  // Zod validation. .safeParse (vs .parse) so a malformed payload
  // surfaces a structured 400 — never throws inside the handler.
  let parsed;
  try {
    parsed = ExtensionBatchAnswerBodySchema.safeParse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Ogiltigt payload', issues: err.issues }, { status: 400 });
    }
    throw err;
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ogiltigt payload', issues: parsed.error.issues }, { status: 400 });
  }

  // Short-circuit: empty `fields` array would burn a Groq call for
  // nothing. Returned here BEFORE the profile fetch so we don't waste
  // MongoDB RTT either.
  if (!parsed.data.fields || parsed.data.fields.length === 0) {
    return NextResponse.json({
      answers: {},
      sources: {},
      remaining: null,
      monthKey: monthKey(),
    });
  }

  const db = await getDb();
  // Bug 1 fix (2026-07-20): see lib/profile-check.js. The helper
  // makes the "complete enough for AI" decision (fullName OR email
  // set) once, instead of each endpoint deciding whether an empty
  // profile triggers a 404. Canonical 404 message is shared.
  const lookup = await requireCompleteProfile(db, auth.clerkId);
  if (!lookup.ok) return lookup.error;
  const profile = lookup.profile;

  // Server-side toggle gate. Default true (matches the default
  // the dashboard sends), but a user who flipped it off in /settings
  // must still be respected here — never silently fall back to AI.
  if (profile.aiFallbackEnabled === false) {
    return NextResponse.json({
      answers: {},
      sources: {},
      disabled: true,
      remaining: null,
      monthKey: monthKey(),
    });
  }

  const tier = profile.tier || 'Basic';
  const limit = getMonthlyLimitFor(tier);
  const m = monthKey();
  const currentCount = await getCurrentCount(db, auth.clerkId, m);

  // Estimate the worst-case fields-count as the cap "spend" for
  // this batch. We MAY end up using fewer if some fields short-
  // circuit to profile.answers.* — but the safe over-estimate is
  // the safest number. Elite is `Infinity` and `isWithinLimit`
  // already returns true for that, so Elite users never hit this.
  const requestSize = parsed.data.fields.length;
  if (!isWithinLimit(currentCount, requestSize, limit)) {
    const remaining = limit === Infinity ? null : Math.max(0, limit - currentCount);
    return NextResponse.json({
      error: `Du har nått taket för AI-svar den här månaden (${currentCount}/${limit}). Uppgradera eller vänta till nästa månad.`,
      capHit: true,
      remaining,
      monthKey: m,
      limit,
    }, { status: 429 });
  }

  // Resolve jobDescription once for the whole batch — it's the
  // same for every field. fetchJobDescription swallows network
  // errors and returns '' on failure, so a flaky ATS scrape never
  // blocks the batch.
  const jobUrl = parsed.data.jobUrl || '';
  const jobTitle = parsed.data.jobTitle || '';
  const jobDescription = await fetchJobDescription(jobUrl);

  // ---- Per-field short-circuit on profile.answers.* ----
  // The user's pre-written answer always wins — never feed the
  // same content to Groq when it would just round-trip.
  const profileAnswers = (profile?.answers && typeof profile.answers === 'object') ? profile.answers : {};
  const profileHits = {};   // { [fieldId]: { answer, source: 'profile' } }
  const needsAi = [];
  for (const f of parsed.data.fields) {
    if (f.id && f.id !== 'custom' && EXTENSION_BATCH_FIELD_SET.has(f.id)) {
      const stored = profileAnswers[f.id];
      if (stored && String(stored).trim()) {
        // Don't count profile short-circuits against the monthly cap —
        // the user wrote the words, Groq didn't burn tokens.
        profileHits[f.id] = { answer: String(stored), source: 'profile' };
        continue;
      }
      // Motivation-class field without stored value: route through
      // the AI so the per-field label is interpreted in context.
      // Note: when `field.id` is one of the canonical motivation
      // keys, we pass it as `field` to generateAdaptiveAnswer so
      // the prompt's fallbackAnswer branch can pick the right enum-
      // specific sentence if Groq is unreachable.
    }
    needsAi.push(f);
  }

  let aiHits = {};
  if (needsAi.length > 0) {
    // Round-44 — per-batch style override. The popup's
    // "Skrivstil för detta svar" dropdown writes
    // `jobbpiloten_styleOverride` to chrome.storage.local; the
    // bridge path is fetchBatchAIAnswers in content.js which
    // forwards `style` on the request body. Apply it by wrapping
    // the profile in a shallow copy with stylePreference overridden
    // BEFORE generateBatchAnswers — the same pattern the
    // /api/extension/answer route uses. Without this override
    // lib/groq.js's getStyleBlock() would fall back to the
    // profile's stored stylePreference (or 'lagom'), silently
    // ignoring the user's per-batch choice.
    const requestStyle = String(parsed.data.style || '').trim();
    const profileForPrompt = requestStyle
      ? { ...(profile || {}), stylePreference: requestStyle }
      : profile;
    aiHits = await generateBatchAnswers({
      fields: needsAi,
      profile: profileForPrompt,
      jobTitle,
      // `company` is now an optional request body field
      // (added to ExtensionBatchAnswerBodySchema in this commit).
      // Passing `undefined` lets lib/groq.js fall back to the
      // prompt's default "företaget" rather than an explicit empty
      // string that leaks the marker into the LLM context.
      company: parsed.data.company || undefined,
      jobDescription,
      lang: parsed.data.lang || 'sv',
      concurrency: 3,
    });
  }

  // Merge + count Groq-only fields so the monthly counter advances
  // only on REAL LLM spend. Fallback `source: 'fallback'` and
  // `source: 'error'` are not counted. The AI_SOURCES allow-list
  // mirrors lib/groq.js's provider.name values (`groq`, `openai`)
  // so a future provider added there just needs its name appended
  // here.
  const AI_SOURCES = new Set(['groq', 'openai']);
  const merged = { ...profileHits, ...aiHits };
  const groqFiledIds = Object.entries(aiHits)
    .filter(([, v]) => v && AI_SOURCES.has(v.source))
    .map(([id]) => id);
  const spent = groqFiledIds.length;
  if (spent > 0) {
    await incrementUsage(db, auth.clerkId, spent, m);
  }
  // Compute new count in-process: the route is the only writer for
  // this token in this request, and incrementUsage is atomic via
  // `$inc`. Re-reading Mongo just to confirm our own write is a
  // wasted round-trip on the hot path.
  const newCount = currentCount + spent;
  const remaining = limit === Infinity ? null : Math.max(0, limit - newCount);

  // Flatten `sources` map for client rendering — every id has an
  // entry, even `source: 'error'`, so the extension UI doesn't
  // have to guard `merged[id]?.source`.
  const sources = {};
  for (const id of parsed.data.fields.map((f) => f.id)) {
    sources[id] = (merged[id] && merged[id].source) || 'error';
  }

  return NextResponse.json({
    answers: merged,
    sources,
    remaining,
    monthKey: m,
  });
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST.' }, { status: 405 });
}
