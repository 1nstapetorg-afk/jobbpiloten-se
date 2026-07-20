/**
 * POST /api/email-preview
 *
 * Round-46 / Bug 1 followup — Onboarding-friendly AI email preview
 * endpoint. Used by the /onboarding wizard so a tester can preview
 * what their AI-generated cover-letter / email-application body
 * will look like BEFORE they hit the dashboard.
 *
 * Key difference from /api/extension/email-body:
 *   - Auth: `requireAuth()` (Clerk-or-demo cookie) — onboarding is
 *     for signed-in users, NOT Chrome-extension users with opaque tokens.
 *   - No opaque Bearer token validation.
 *   - Lighter rate limit (5/hr per user) since this is invoked once
 *     during onboarding's Granska step.
 *   - Defaults to Swedish (onboarding is sv-first).
 *
 * Body shape (Zod-validated by EmailPreviewSchema below):
 *   {
 *     jobTitle?: string,
 *     company?: string,
 *     lang?: 'sv' | 'en',
 *   }
 *
 * Response shape (mirrors /api/extension/email-body for consistency):
 *   {
 *     body: string,           // AI-generated email body (9 lines, Swedish canonical)
 *     source: 'groq' | 'openai' | 'emergent' | 'fallback' | 'error' | 'disabled',
 *     cvShortWarning: boolean,
 *     remaining: number | null,
 *     monthKey: 'YYYY-MM',
 *   }
 *
 * Cost guard: `max_tokens: 350` ≈ 200 Swedish words at Groq llama
 * ratio. Onboarding users get 5 previews/hr + tier-cap cap (Basic
 * users get 10/mo, Professional 50/mo, Elite ∞ — mirrors extension).
 *
 * Tier cap: similar to extension endpoint. PreLLM check
 * (`isWithinLimit`) rejects BEFORE burning tokens if it would push
 * the user over their monthly tier cap.
 *
 * Bleeding changes from sister endpoints (write-once): the rate
 * limit Map (`__jobbpilotenEmailPreviewBuckets`) is module-scoped,
 * mirrors the extension endpoint's pattern. Vercel serverless will
 * reset it between cold-starts which is fine for an onboarding-flow
 * surface that's invoked a few times per user per session.
 */

import { NextResponse } from 'next/server'
import { MongoClient } from 'mongodb'
import { z } from 'zod'
import { generateEmailBody } from '@/lib/groq'
import {
  getCurrentCount,
  incrementUsage,
  getMonthlyLimitFor,
  isWithinLimit,
  monthKey,
} from '@/lib/ai-usage'
import { requireAuth } from '@/lib/auth'
import { requireCompleteProfile } from '@/lib/profile-check'
import { trackEvent } from '@/lib/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---- Zod schema — onboarding-friendly subset ----
// Required to be optional so an onboarding user can preview with
// empty fields (LLM fallbacks to `tjänsten`/`företaget` defaults).
const EmailPreviewSchema = z.object({
  jobTitle: z.string().max(280).optional().or(z.literal('')),
  company: z.string().max(280).optional().or(z.literal('')),
  lang: z.enum(['sv', 'en']).optional(),
})

// ---- Mongo singleton (same shape as /api/extension/email-body) ----
let clientPromise
if (!global._mongoClientPromise) {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten')
  global._mongoClientPromise = client.connect()
}
clientPromise = global._mongoClientPromise

async function getDb() {
  const client = await clientPromise
  return client.db(process.env.DB_NAME)
}

// ---- Rate limit (in-memory sliding window, 5/hr/user) ----
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 5  // Lower than extension (10/hr) — onboarding is a one-time surface
if (!global.__jobbpilotenEmailPreviewBuckets) {
  global.__jobbpilotenEmailPreviewBuckets = new Map()
}
const rateBuckets = global.__jobbpilotenEmailPreviewBuckets

function checkRateLimit(userId) {
  const now = Date.now()
  const bucket = rateBuckets.get(userId) || []
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (fresh.length >= RATE_LIMIT_MAX) {
    const oldest = fresh[0]
    rateBuckets.set(userId, fresh)
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - oldest) }
  }
  fresh.push(now)
  rateBuckets.set(userId, fresh)
  return { allowed: true }
}

export async function POST(request) {
  // Onboarding-friendly auth: Clerk-or-demo cookie. The dashboard
  // /settings / onboarding both use this scheme; the Chrome
  // extension uses opaque tokens in /api/extension/*.
  const auth = await requireAuth(request)
  if (auth.error) return auth.error

  // Rate limit BEFORE any DB work.
  const rl = checkRateLimit(auth.userId)
  if (!rl.allowed) {
    const retrySec = Math.ceil((rl.retryAfterMs || RATE_LIMIT_WINDOW_MS) / 1000)
    return NextResponse.json(
      {
        error: `För många förhandsvisningar — försök igen om ${retrySec}s.`,
        retryAfter: retrySec,
      },
      { status: 429 },
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ogiltig JSON' }, { status: 400 })
  }

  let parsed
  try {
    parsed = EmailPreviewSchema.safeParse(body)
  } catch (err) {
    console.error('[email-preview] Zod parse threw:', err)
    return NextResponse.json({ error: 'Ogiltigt payload' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Ogiltigt payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const db = await getDb()
  // Bug 1 (2026-07-20): replaced inline `findOne + isProfilePresent`
  // check with `requireCompleteProfile()` so the "complete enough to
  // use AI" predicate lives in one place. The previous local check
  // here treated "profile doc exists" as required; the new helper
  // additionally allows past-tense docs that have at least fullName
  // OR email set (per tester spec: "treat as complete when basic
  // fields are filled — /settings may have saved them through a
  // different write path").
  const lookup = await requireCompleteProfile(db, auth.userId)
  if (!lookup.ok) {
    return lookup.error
  }
  const profile = lookup.profile

  // Server-side toggle gate — mirrors the extension endpoint. A
  // user who flipped email-body OFF in /settings must still be
  // respected here.
  if (profile.aiEmailBodyEnabled === false) {
    return NextResponse.json({
      body: '',
      source: 'disabled',
      cvShortWarning: false,
      remaining: null,
      monthKey: monthKey(),
    })
  }

  // Tier-cap check via the shared AI-usage module. Reusing the
  // same monthly counter as the extension endpoint so a user
  // who hits the cap on the extension can't bypass it via
  // onboarding. Documents intent: extension + onboarding share
  // the same monthly AI-spend pool.
  const tier = profile.tier || 'Basic'
  const limit = getMonthlyLimitFor(tier)
  const m = monthKey()
  const currentCount = await getCurrentCount(db, auth.userId, m)
  const requestSize = 1
  if (!isWithinLimit(currentCount, requestSize, limit)) {
    const remaining = limit === Infinity ? null : Math.max(0, limit - currentCount)
    return NextResponse.json(
      {
        error: `Du har nått taket för AI-svar den här månaden (${currentCount}/${limit}). Uppgradera eller vänta till nästa månad.`,
        capHit: true,
        remaining,
        monthKey: m,
        limit,
      },
      { status: 429 },
    )
  }

  const jobTitle = parsed.data.jobTitle || ''
  const company = parsed.data.company || ''
  const lang = parsed.data.lang || 'sv'

  try {
    // Reuse generateEmailBody() from lib/groq.js — same prompt
    // contract as the extension endpoint. The onboarding preview
    // and the extension compose panel therefore produce
    // semantically equivalent bodies, which is what the user
    // wants: "what I see in /onboarding is what recruiters see
    // when I click Ansök via mejl later".
    const result = await generateEmailBody({
      jobTitle,
      company,
      jobDescription: '',  // onboarding doesn't have a jobUrl to scrape
      profile,
      lang,
    })

    const AI_SOURCES = new Set(['groq', 'openai', 'emergent'])
    if (AI_SOURCES.has(result.source)) {
      await incrementUsage(db, auth.userId, 1, m)
    }

    trackEvent('onboarding_email_preview', {
      source: result.source,
      lang,
      cvShortWarning: !!result.cvShortWarning,
    }).catch((err) => {
      // Round-46.1 polish: log warn-level on trackEvent failure
      // rather than dropping silently. Analytics failure is
      // still non-fatal, but a dev-mode clickhouse misconfig
      // should leave a debuggable trail.
      console.warn('[email-preview] trackEvent failed:', err?.message || String(err))
    })

    const newCount = currentCount + (AI_SOURCES.has(result.source) ? 1 : 0)
    const remaining = limit === Infinity ? null : Math.max(0, limit - newCount)

    return NextResponse.json({
      body: result.body || '',
      source: result.source,
      cvShortWarning: !!result.cvShortWarning,
      remaining,
      monthKey: m,
    })
  } catch (err) {
    console.error('[email-preview] generateEmailBody failed:', err?.message)
    return NextResponse.json(
      { error: 'Tillfälligt fel — försök igen om en stund.' },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST.' }, { status: 405 })
}
