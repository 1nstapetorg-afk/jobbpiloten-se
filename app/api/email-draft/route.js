/**
 * POST /api/email-draft
 *
 * Round-52 / Issue 1 (P0) — AI-generated SUBJECT + BODY for the
 * Mejlutkast popup flow.
 *
 * Three distinct flows compared to the existing /api/extension/email-body:
 *   1. Caller is composing an email to a recruiter from the Gmail /
 *      Outlook compose surface (not visiting a job posting). The
 *      recipient email + page context is the only signal.
 *   2. We match the recipient against the user's RECENT applications
 *      (5 most-recent, source: 'af'/'blocket'/'email'/'ledigajobb')
 *      to surface a previously-applied-to job as the matchedJob.
 *      If no match, caller falls back to "Vilket jobb gäller det?".
 *   3. Output is BOTH subject and body (not just body) because the
 *      Mejlutkast flow expects a ready-to-send package. Subject
 *      format: "Ansökan: [Jobbtitel] — [Förnamn] [Efternamn]".
 *
 * Auth: same opaque extension-token scheme as /api/extension/*
 * (Authorization: Bearer <64-hex>). 401 on missing/invalid/expired
 * token. The 90-day TTL is enforced the same way /api/extension/
 * profile does it.
 *
 * Rate limit: in-memory sliding window, 20/hr/token. Higher than
 * /api/extension/email-body (10/hr) because the Mejlutkast flow
 * is THE primary apply-by-email surface — not the legacy fallback.
 *
 * **KNOWN LIMITATION — per-process scope.** The rate-limit buckets
 * live in `global.__jobbpilotenEmailDraftBuckets` which is scoped
 * to the current Node process. On Vercel's serverless runtime a
 * cold start spins up a new process and the Map starts empty —
 * a determined attacker could in theory trigger 20×(process-count)
 * requests by spreading them across cold starts. The 20/hr cap is
 * a SOFT ceiling, not a HARD one. For the soft-launch scope (a few
 * hundred users on a single Vercel region) the process-local
 * count is well within the budget; promote to a shared KV/Redis
 * store before the public launch. The same limitation applies to
 * the `/api/extension/email-body` route (10/hr, 5-bucket size)
 * — both routes share the same per-process budget pattern.
 *
 * Body shape (Zod-validated by ExtensionEmailDraftSchema):
 *   {
 *     recipientEmail: string,    // required — used for matching
 *     jobId?: string,            // optional — if user picked a specific job
 *     companyHint?: string,      // optional — "Spotify" etc.
 *     lang?: 'sv' | 'en',
 *   }
 *
 * Response shape:
 *   {
 *     subject:   "Ansökan: Frontend-utvecklare — Anna Andersson",
 *     body:      "<AI Swedish body>",
 *     matchedJob: { id, jobTitle, companyName, source } | null,
 *     recentJobs: [{ id, jobTitle, companyName, source }]   // up to 5
 *     source:    'groq'|'openai'|'emergent'|'fallback',
 *     cvShortWarning: boolean,
 *     remaining: number | null,
 *     monthKey:  'YYYY-MM',
 *   }
 */

import { NextResponse } from 'next/server'
import { MongoClient } from 'mongodb'
import { generateEmailBody, fallbackEmailBody } from '@/lib/groq'
import { ExtensionEmailDraftSchema } from '@/lib/extension-profile'
// Round-46 / Followup 3 (2026-07-20 Monday): central profile-
// completeness predicate. See lib/profile-check.js for the canonical
// definition. Used here so the email-draft endpoint treats an
// empty-but-saved profile (only `_id` + `clerkId`) the same way as
// every other endpoint that drains chrome.storage.local -- a
// profile with at least one of fullName / email is considered
// complete.
import { isProfileComplete } from '@/lib/profile-check'
import {
  getCurrentCount,
  incrementUsage,
  getMonthlyLimitFor,
  isWithinLimit,
  monthKey,
} from '@/lib/ai-usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---- Mongo singleton ----
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

// ---- Rate limit (in-memory, per-token sliding window) ----
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 20
if (!global.__jobbpilotenEmailDraftBuckets) {
  global.__jobbpilotenEmailDraftBuckets = new Map()
}
const rateBuckets = global.__jobbpilotenEmailDraftBuckets

function checkRateLimit(token) {
  const now = Date.now()
  const bucket = rateBuckets.get(token) || []
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (fresh.length >= RATE_LIMIT_MAX) {
    const oldest = fresh[0]
    rateBuckets.set(token, fresh)
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - oldest) }
  }
  fresh.push(now)
  rateBuckets.set(token, fresh)
  return { allowed: true }
}

async function resolveClerkId(request) {
  const auth = request.headers.get('authorization') || ''
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth)
  if (!match) return null
  const token = match[1]
  const db = await getDb()
  const tokenDoc = await db.collection('extension_tokens').findOne({ token })
  if (!tokenDoc) return null
  if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt).getTime() <= Date.now()) {
    console.warn('[email-draft] rejecting expired token', {
      clerkId: tokenDoc.clerkId,
      expiresAt: tokenDoc.expiresAt,
    })
    return null
  }
  await db
    .collection('extension_tokens')
    .updateOne({ token }, { $set: { lastUsedAt: new Date() } })
    .catch(() => {})
  return { clerkId: tokenDoc.clerkId, token }
}

/**
 * Match `recipientEmail` against the user's recent applications so
 * the Mejlutkast panel can surface a "best guess" of which job the
 * email refers to. Matching tiers (most-confident first):
 *   1. Exact email match (case-insensitive) on applications.emailAddress
 *      — the user clicked "Skicka utkast" previously for this exact recruiter.
 *   2. Domain match — both recruiter emails end with a shared domain
 *      (e.g. recruiter@fortnox.se ↔ hr@fortnox.se).
 *
 * Returns null if no match. The caller surfaces a
 * "Vilket jobb gäller det? — välj från listan" affordance when null.
 */
async function findMatchingRecentApplication(db, clerkId, recipientEmail) {
  if (!recipientEmail || !clerkId) return null
  const recipient = String(recipientEmail).toLowerCase().trim()
  if (!recipient) return null
  const recent = await db.collection('applications')
    .find({ clerkId })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray()
  if (!recent.length) return null

  // Tier 1: exact emailAddress match
  const exact = recent.find((a) => String(a.emailAddress || '').toLowerCase().trim() === recipient)
  if (exact) return exact

  // Tier 2: domain match — the recipient's domain overlaps with a
  // recent application that has companyName + emailAddress hints.
  const recipientDomain = recipient.split('@')[1]
  if (!recipientDomain) return null
  const domainHit = recent.find((a) => {
    const addr = String(a.emailAddress || '').toLowerCase().trim()
    if (!addr || !addr.includes('@')) return false
    const appDomain = addr.split('@')[1]
    return appDomain === recipientDomain && (a.companyName || a.jobTitle)
  })
  return domainHit || null
}

/**
 * Fetch the 5 most recent applications for the Mejlutkast "Vilket
 * jobb gäller det?" picker — only the safe subset is shipped so
 * chrome.storage.local doesn't blow up.
 *
 * Safe subset: id (mongo ObjectId as hex string), jobTitle,
 * companyName, source. We omit emailAddress/subject/bodyText/etc.
 * because the picker UI shows just job+company.
 */
async function listRecentApplications(db, clerkId, limit = 5) {
  if (!clerkId) return []
  const rows = await db.collection('applications')
    .find({ clerkId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({
      jobTitle: 1,
      companyName: 1,
      source: 1,
    })
    .toArray()
  return rows.map((r) => ({
    id: String(r._id),
    jobTitle: r.jobTitle || '',
    companyName: r.companyName || '',
    source: r.source || 'unknown',
  }))
}

/**
 * Build the Swedish subject line per the Round-52 spec:
 *   "Ansökan: [Jobbtitel] — [Förnamn] [Efternamn]"
 *
 * Falls back gracefully when the profile or job data is partial —
 * the user can re-edit the subject after the AI completes.
 */
function buildSubject({ jobTitle, profile }) {
  const firstName = String(profile?.firstName || '').trim()
  const lastName = String(profile?.lastName || '').trim()
  const fullName = String(profile?.fullName || '').trim()
  // Prefer firstName/lastName split; fall back to fullName if either is missing.
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || fullName
  const title = String(jobTitle || 'tjänsten').slice(0, 200).trim() || 'tjänsten'
  return `Ansökan: ${title}${name ? ` — ${name}` : ''}`.slice(0, 250)
}

export async function POST(request) {
  const auth = await resolveClerkId(request)
  if (!auth) {
    return NextResponse.json(
      { error: 'Ogiltig eller saknad token — anslut tillägget från /dashboard.' },
      { status: 401 },
    )
  }

  const rl = checkRateLimit(auth.token)
  if (!rl.allowed) {
    const retrySec = Math.ceil((rl.retryAfterMs || RATE_LIMIT_WINDOW_MS) / 1000)
    return NextResponse.json(
      {
        error: `För många e-postutkast — försök igen om ${retrySec}s.`,
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
    parsed = ExtensionEmailDraftSchema.safeParse(body)
  } catch (err) {
    console.error('[email-draft] Zod parse threw:', err)
    return NextResponse.json({ error: 'Ogiltigt payload' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Ogiltigt payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const db = await getDb()
  // Round-46 / Followup 3 (2026-07-20 Monday): gate on
  // isProfileComplete() rather than just `!profile`. A profile
  // document that exists but has only `_id` + `clerkId` (a stub
  // saved before the helper landed) should NOT be a 404 -- the
  // user has a profile, they just haven't completed the onboarding
  // fields yet. This matches the contract used by
  // requireCompleteProfile() in lib/profile-check.js.
  const profile = await db.collection('profiles').findOne({ clerkId: auth.clerkId })
  if (!isProfileComplete(profile)) {
    return NextResponse.json(
      { error: 'Profil hittades inte — slutför /onboarding först. (Saknade fullständigt namn och e-post.)' },
      { status: 404 },
    )
  }

  // Server-side toggle: respect aiEmailBodyEnabled. If the user
  // turned off AI emails in /settings, return a disabled marker
  // so the popup can show its own "AI-mejl är avstängt" chip.
  if (profile.aiEmailBodyEnabled === false) {
    return NextResponse.json({
      subject: '',
      body: '',
      matchedJob: null,
      recentJobs: [],
      source: 'disabled',
      cvShortWarning: false,
      remaining: null,
      monthKey: monthKey(),
    })
  }

  // Tier cap BEFORE burning tokens. Basic=10/mo, Pro=50/mo,
  // Elite=∞. Each email-draft call costs 1 unit (same as
  // /api/extension/email-body's per-call rate).
  const tier = profile.tier || 'Basic'
  const limit = getMonthlyLimitFor(tier)
  const m = monthKey()
  const currentCount = await getCurrentCount(db, auth.clerkId, m)
  if (!isWithinLimit(currentCount, 1, limit)) {
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

  // Match first (cheap Mongo lookup) before calling the LLM so we
  // can short-circuit the prompt with the actual job context.
  const matched = await findMatchingRecentApplication(
    db,
    auth.clerkId,
    parsed.data.recipientEmail,
  )
  const recentJobs = await listRecentApplications(db, auth.clerkId, 5)

  // Caller-provided jobId wins; otherwise fall back to the matched
  // recent application's id (if any); otherwise leave jobTitle
  // empty so the LLM uses generic placeholders.
  let jobTitle = ''
  let company = ''
  if (parsed.data.jobId) {
    // Resolve user-selected application by id.
    try {
      const { ObjectId } = await import('mongodb')
      const doc = await db.collection('applications').findOne({
        _id: new ObjectId(parsed.data.jobId),
        clerkId: auth.clerkId,
      })
      if (doc) {
        jobTitle = doc.jobTitle || ''
        company = doc.companyName || ''
      }
    } catch (_) {
      // Invalid ObjectId — fall through.
    }
  }
  if (!jobTitle && matched) {
    jobTitle = matched.jobTitle || ''
    company = matched.companyName || matched.company || ''
  }
  if (!company && parsed.data.companyHint) {
    company = parsed.data.companyHint
  }

  const lang = parsed.data.lang || 'sv'
  const subject = buildSubject({ jobTitle, profile })

  try {
    const result = await generateEmailBody({
      jobTitle,
      company,
      jobDescription: '',
      profile,
      lang,
    })

    const AI_SOURCES = new Set(['groq', 'openai', 'emergent'])
    if (AI_SOURCES.has(result.source)) {
      await incrementUsage(db, auth.clerkId, 1, m)
    }

    const matchedJob = matched
      ? {
          id: String(matched._id),
          jobTitle: matched.jobTitle || '',
          companyName: matched.companyName || '',
          source: matched.source || 'unknown',
        }
      : null

    return NextResponse.json({
      subject,
      body: result.body || fallbackEmailBody({ jobTitle, company, profile }),
      matchedJob,
      recentJobs,
      source: result.source,
      cvShortWarning: !!result.cvShortWarning,
      remaining: limit === Infinity ? null : Math.max(0, limit - currentCount - 1),
      monthKey: m,
    })
  } catch (err) {
    console.error('[email-draft] generateEmailBody failed:', err?.message)
    return NextResponse.json(
      { error: 'Tillfälligt fel — försök igen om en stund.' },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST.' }, { status: 405 })
}
