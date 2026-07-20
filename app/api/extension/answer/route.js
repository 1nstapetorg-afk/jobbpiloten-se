/**
 * POST /api/extension/answer
 *
 * AI-adaptive field-fill for the JobbPiloten Auto-Fill extension.
 * When the content script lands on a textarea matching one of the
 * motivation-class patterns (whyThisCompany / whyThisRole /
 * strengths / weaknesses / challenge / availability) and the
 * profile.answers.* slot is empty, it posts the question text
 * here. We pull the user's profile, hit Groq with a small
 * Swedish-language prompt, return a 2-3 sentence answer.
 *
 * Auth: same opaque-token scheme as /api/extension/profile. The
 * extension sends `Authorization: Bearer <token>` and we look the
 * token up in Mongo. 401 if missing/invalid/expired.
 *
 * Rate limit: in-memory sliding window, 20 calls per token per
 * rolling hour. Stops a runaway content script from burning the
 * LLM budget on a single page. Stale entries are evicted on every
 * access so the map can never grow unbounded in a long-lived
 * serverless instance.
 *
 * CORS: no Access-Control-Allow-Origin header is needed here.
 * Content scripts in MV3 can fetch cross-origin whenever the
 * manifest's host_permissions list covers the target — and our
 * manifest lists `<all_urls>`. Adding a wildcard ACAO header
 * would actually be a downgrade because it'd let any page in
 * a browser tab hit this endpoint without going through the
 * extension token check. We deliberately keep this route
 * extension-only.
 *
 * Cost guard: LLM max_tokens is small (180 ≈ 2-3 short Swedish
 * sentences) so even a hot answering loop costs pennies. The
 * gating rate limit covers the rest. Input-side question max
 * grew 240 -> 2000 chars via the Zod schema in
 * lib/extension-profile.js so richer motivation copy survives
 * the round-trip.
 */

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { generateAnswer } from '@/lib/groq';
import { ExtensionAnswerBodySchema } from '@/lib/extension-profile';
import { listSavedAnswers, findBestMemoryMatch, recordMemoryUse } from '@/lib/saved-answers';
import { trackEvent } from '@/lib/analytics';
import { requireCompleteProfile } from '@/lib/profile-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---- Mongo singleton (mirrors /api/extension/profile/route.js) ----
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

// ---- Rate limit (in-memory, per-token sliding window) ----
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 20;
if (!global.__jobbpilotenAnswerBuckets) {
  global.__jobbpilotenAnswerBuckets = new Map();
}
const rateBuckets = global.__jobbpilotenAnswerBuckets;

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

  await db.collection('extension_tokens').updateOne(
    { token },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => {
    // Non-fatal: the token validated, lastUsedAt is debug only.
  });

  return { clerkId: tokenDoc.clerkId, token };
}

export async function POST(request) {
  const auth = await resolveClerkId(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'Ogiltig eller saknad token — anslut tillägget från /dashboard.' },
      { status: 401 },
    );
  }

  const rl = checkRateLimit(auth.token);
  if (!rl.allowed) {
    const retrySec = Math.ceil((rl.retryAfterMs || RATE_LIMIT_WINDOW_MS) / 1000);
    return NextResponse.json(
      {
        error: `För många AI-förfrågningar — försök igen om ${retrySec}s.`,
        retryAfter: retrySec,
      },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ogiltig JSON' }, { status: 400 });
  }

  // Zod validation owns the field-enum contract plus the question
  // length budget (1..2000). safeParse (vs parse) so a malformed
  // payload surfaces a 400 with structured issues for the extension
  // to log + fall back, never throws inside the route handler.
  const parseResult = ExtensionAnswerBodySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Ogiltigt answer-payload.',
        issues: parseResult.error.issues,
      },
      { status: 400 },
    );
  }
  const { question, field, style: styleOverride } = parseResult.data;
  if (!question.trim()) {
    // Zod min(1) accepts a single space; we want "real text" only.
    return NextResponse.json(
      { error: 'Tom fråga — vi behöver etiketten för att kunna svara rätt.' },
      { status: 400 },
    );
  }

  const db = await getDb();
  // Bug 1 fix (2026-07-20): see lib/profile-check.js. The helper
  // makes the "complete enough for AI" decision (fullName OR email
  // set) once, instead of each endpoint deciding whether an empty
  // profile triggers a 404. Canonical 404 message is shared across
  // email-preview / token / email-body / ai-answers / cv-pdf /
  // email-draft / ai-usage.
  const lookup = await requireCompleteProfile(db, auth.clerkId);
  if (!lookup.ok) return lookup.error;
  const profile = lookup.profile;

  const profileAnswer = profile?.answers?.[field];
  if (profileAnswer && String(profileAnswer).trim()) {
    return NextResponse.json({
      answer: String(profileAnswer),
      source: 'profile',
      field,
    });
  }

  // Round-38 / Part 2: memory-first retrieval. Before calling Groq
  // (the expensive path), check the user's saved-answers corpus for
  // a Jaccard-similar question in the same field. Strict 0.7
  // threshold keeps false-positives out of a job-application
  // context — a wrong autofill is much worse than a missed match.
  // The corpus is a single Mongo find() over the user's saved
  // answers; at soft-launch scale (0-50 per user) this is
  // sub-millisecond, no caching needed.
  try {
    const corpus = await listSavedAnswers(db, auth.clerkId, { limit: 100 })
    const match = findBestMemoryMatch(question, field, corpus)
    if (match && match.answer) {
      // Round-42 (Part 2 polish): record the match in the user's
      // usage stats. Non-blocking — a Mongo blip here MUST NOT
      // affect the user-visible answer.
      if (match.answer.id) {
        recordMemoryUse(db, auth.clerkId, match.answer.id).catch(() => {})
        trackEvent('answer_memory_used', {
          field,
          score: Number(match.score?.toFixed?.(2) ?? match.score),
        })
      }
      return NextResponse.json({
        answer: String(match.answer.answer || ''),
        source: 'memory',
        field,
        memoryScore: match.score,
      })
    }
  } catch (memErr) {
    // Memory lookup is a soft optimization — a Mongo blip MUST NOT
    // block the Groq fallback. Log + continue to the LLM path.
    console.warn('[extension/answer] memory lookup failed (non-fatal):', memErr?.message || memErr)
  }

  try {
    // Round-42 (Part 3 polish): per-question style override. When
    // the popup sends `style: 'lagom'` (etc.) we wrap the profile
    // in a shallow copy that overrides stylePreference so the
    // prompt builder's getStyleBlock() reads the override. The
    // profile object itself is never mutated.
    const profileForPrompt = styleOverride
      ? { ...(profile || {}), stylePreference: styleOverride }
      : profile
    const result = await generateAnswer({ question, field, profile: profileForPrompt });
    return NextResponse.json({
      answer: result.answer,
      source: result.source,
      field,
      styleUsed: styleOverride || profile?.stylePreference || 'lagom',
    });
  } catch (err) {
    console.error('[extension/answer] generateAnswer failed:', err?.message);
    return NextResponse.json(
      { error: 'Tillfälligt fel — försök igen om en stund.' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST.' }, { status: 405 });
}
