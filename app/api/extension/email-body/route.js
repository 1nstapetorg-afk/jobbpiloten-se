/**
 * POST /api/extension/email-body
 *
 * Round-46 / Bug 1 — AI-generated email-application body for the
 * extension's "Ansök via mejl" compose panel.
 *
 * Pre-fix: popup.js's `setupComposePanel()` pre-filled the body
 * with a static \`COMPOSE_BODY_TEMPLATE_DEFAULT\` template. The
 * user could click "Ansök via mejl" → mailto: opened → but the
 * body was a generic "Hej, jag heter X..." template, NOT a
 * personalised cover letter referencing the user's CV. Recruiters
 * reported receiving dozens of similar-looking emails. The fix
 * introduces this endpoint so the compose body is AI-generated
 * with the candidate's CV + job description context.
 *
 * Auth: same opaque-token scheme as the other /api/extension/*
 * routes. Token in \`Authorization: Bearer <token>\`. 401 on
 * missing/invalid/expired. Identical Mongo lookup pattern as
 * /api/extension/profile so the two endpoints share token-state.
 *
 * Rate limit: in-memory sliding window, 10 calls per token per
 * rolling hour. Lower than the per-field answer endpoint (20/hr)
 * because each call generates a 2-3 paragraph email body which
 * consumes ~3x the tokens of a 220-char answer.
 *
 * Body shape (Zod-validated by ExtensionEmailBodySchema):
 *   {
 *     jobUrl?: string,        // HTML scrape source for job description
 *     jobTitle?: string,
 *     company?: string,
 *     lang?: 'sv' | 'en',
 *   }
 *
 * Response shape:
 *   {
 *     body:      "<AI-generated Swedish email body>",
 *     subject?:  "<optional pre-build suggestion>",
 *     source:    'groq'|'openai'|'emergent'|'fallback'|'error',
 *     cvShortWarning: boolean, // true if profile.cvText < 500 chars
 *     remaining: number | null,
 *     monthKey:  'YYYY-MM',
 *   }
 *
 * Tier cap: Basic=10/mo, Professional=50/mo, Elite=∞ — mirrors
 * /api/extension/ai-answers. PreLLM check (\`isWithinLimit\`)
 * rejects BEFORE burning tokens if it would push the user over.
 *
 * Cost guard: \`max_tokens: 350\` ≈ 200 Swedish words at the Groq
 * llama ratio (5-6 chars per token). The compose panel re-fetches
 * ONLY when the mailto signals list changes (rate-limited in
 * extension/content.js via writeEmailSignalsIfChanged), so a
 * single page open triggers ≤1 call.
 */

import { NextResponse } from 'next/server'
import { MongoClient } from 'mongodb'
import { generateEmailBody } from '@/lib/groq'
import { ExtensionEmailBodySchema } from '@/lib/extension-profile'
import { assertSafeExternalUrl } from '@/lib/ssrf-guard'
import {
  getCurrentCount,
  incrementUsage,
  getMonthlyLimitFor,
  isWithinLimit,
  monthKey,
} from '@/lib/ai-usage'
import { trackEvent } from '@/lib/analytics'
import { requireCompleteProfile } from '@/lib/profile-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---- Mongo singleton (mirrors /api/extension/answer/route.js) ----
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
const RATE_LIMIT_MAX = 10
if (!global.__jobbpilotenEmailBodyBuckets) {
  global.__jobbpilotenEmailBodyBuckets = new Map()
}
const rateBuckets = global.__jobbpilotenEmailBodyBuckets

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
  // lastUsedAt is debug-only; swallow blips so a flaky write
  // never blocks a real email-body call.
  await db
    .collection('extension_tokens')
    .updateOne({ token }, { $set: { lastUsedAt: new Date() } })
    .catch(() => {})
  return { clerkId: tokenDoc.clerkId, token }
}

/**
 * Cheap pre-flight job-description scrape — mirrors the helper
 * in /api/extension/ai-answers/route.js so we don't duplicate
 * the regex strip logic. The helper is intentionally NOT
 * hoisted into a shared module because the two callers can drift
 * independently (different size caps, different abort timings).
 *
 * 4 KB on the wire is enough for a Swedish job posting's
 * intro/description; the LLM will dedupe against the post mpp.
 *
 * Round-46.1 / Bug 1 followup (security-hardening): the route
 * is now SSRF-guarded via lib/ssrf-guard.js. The validator runs
 * BEFORE the fetch() so a malicious `jobUrl` pointing at
 * `http://169.254.169.254/latest/meta-data/` (cloud metadata),
 * `http://localhost:6379/`, or any RFC1918 host is rejected at
 * scheme / DNS resolution time. We also disallow IP literals
 * that classify as private/loopback/link-local/multicast/CGN
 * directly, so DNS-rebinding via a hostname that resolves to a
 * private IP is caught post-resolution.
 *
 * Validation failures silently degrade to `''` (no description
 * → LLM prompts without job-specific context), and the failure
 * reason is logged at `warn` level so SSRF attempts surface in
 * monitoring dashboards without breaking the happy path.
 */
async function fetchJobDescription(jobUrl) {
  if (!jobUrl || typeof jobUrl !== 'string') return ''
  // SSRF guard — scheme + hostname + DNS + private-range check.
  // `https:` is the only scheme we ever accept; the validator's
  // `allowHttp` flag stays OFF here so a future bug in another
  // caller can't accidentally downgrade this surface.
  //
  // Round-48 — `pinIp: true` opts into IP-pinning. When the
  // guard returns `{ ok: true, ip, dispatcher }` we use the
  // dispatcher to bypass DNS at TCP-connect time (closing the
  // Round-47 TOCTOU window) and force `redirect: 'error'` so a
  // benign-looking URL cannot transparently redirect to a
  // private address even after passing the guard. The connect
  // hook inside the dispatcher REFUSES any connection whose host
  // doesn't match the original URL hostname.
  //
  // If undici can't be imported (rare; bundled with Node 18+),
  // the guard returns `{ ok: false, error: 'IP-pinning stöds
  // inte... }`. We DO NOT silently downgrade to plain fetch
  // because the user opted into pinning — fail closed.
  const guard = await assertSafeExternalUrl(jobUrl, { pinIp: true })
  if (!guard.ok) {
    console.warn('[extension/email-body] SSRF guard rejected jobUrl:', guard.error)
    return ''
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4_000)
    const res = await fetch(jobUrl, {
      method: 'GET',
      // Round-48 — `redirect: 'error'` is mandatory under IP-pinning
      // because the connect hook can only reject a redirect that
      // 'follow' would have silently followed. We let undici throw
      // a TypeError on redirect; the catch block surfaces it as
      // a 'no description' fallback.
      redirect: 'error',
      signal: ctrl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; JobbPilotenBot/1.0)',
      },
      // Round-48 — inject the pinned-IP dispatcher. undici's
      // connect hook bypasses DNS at TCP time and refuses
      // redirect-bypass (host mismatch). The cert validation
      // still runs against the original hostname via SNI
      // because the hook sets `servername` for tls.connect().
      ...(guard.dispatcher ? { dispatcher: guard.dispatcher } : {}),
    })
    clearTimeout(timer)
    if (!res.ok) return ''
    const buf = await res.arrayBuffer()
    const chunk = Buffer.from(buf).slice(0, 4096).toString('utf-8')
    return String(
      chunk
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' '),
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200)
  } catch (err) {
    console.warn('[extension/email-body] jobDescription fetch failed:', err?.message)
    return ''
  }
}

export async function POST(request) {
  const auth = await resolveClerkId(request)
  if (!auth) {
    return NextResponse.json(
      { error: 'Ogiltig eller saknad token — anslut tillägget från /dashboard.' },
      { status: 401 },
    )
  }

  // Rate-limit BEFORE any DB work — a 50/sec burst is cheaper to
  // gate here than to read the profile on every call.
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

  // Zod validation. safeParse (vs parse) so a malformed payload
  // surfaces a structured 400 — never throws inside the handler.
  let parsed
  try {
    parsed = ExtensionEmailBodySchema.safeParse(body)
  } catch (err) {
    console.error('[extension/email-body] Zod parse threw:', err)
    return NextResponse.json({ error: 'Ogiltigt payload' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Ogiltigt payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const db = await getDb()
  // Bug 1 fix (2026-07-20): route the profile lookup through the
  // shared `requireCompleteProfile` helper so the canonical 404
  // message is shared across /api/email-preview, cv-pdf,
  // extension/token, extension/answer, extension/ai-answers,
  // email-draft, ai-usage. The helper additionally allows a profile
  // through if fullName OR email is set, per spec — previously
  // empty-doc-with-just-clerkId was treated as "missing".
  const lookup = await requireCompleteProfile(db, auth.clerkId)
  if (!lookup.ok) return lookup.error
  const profile = lookup.profile

  // Server-side toggle gate — mirror the /api/extension/ai-answers
  // behaviour for the aiFallbackEnabled flag. The cover-letter /
  // email-apply flow does NOT opt-out via the same toggle because
  // the user explicitly opened an apply-by-email affordance;
  // a separate toggle would just be UX friction. Until the user
  // explicitly disables it, generate. We still include the empty
  // / disabled branch for parity with the rest of the API.
  if (profile.aiEmailBodyEnabled === false) {
    return NextResponse.json({
      body: '',
      source: 'disabled',
      cvShortWarning: false,
      remaining: null,
      monthKey: monthKey(),
    })
  }

  const tier = profile.tier || 'Basic'
  const limit = getMonthlyLimitFor(tier)
  const m = monthKey()
  const currentCount = await getCurrentCount(db, auth.clerkId, m)
  // Each call costs ~1 unit (vs the batch endpoint's per-field
  // count). The 350-token output means tier caps should be
  // conservative — Basic users get ~10 emails/month which is a
  // reasonable ceiling for hand-picked email applications.
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

  // Scrape the job description once — same string feeds the LLM
  // and the [Jobbtitel]/[Källa] regex matcher in popup.js.
  const jobUrl = parsed.data.jobUrl || ''
  const jobTitle = parsed.data.jobTitle || ''
  const company = parsed.data.company || ''
  const lang = parsed.data.lang || 'sv'
  const jobDescription = await fetchJobDescription(jobUrl)

  try {
    const result = await generateEmailBody({
      jobTitle,
      company,
      jobDescription,
      profile,
      lang,
    })

    // Increment the AI-usage counter ONLY for real LLM spend.
    // fallback/error don't burn tokens so they don't count. The
    // AI_SOURCES allow-list mirrors lib/groq.js's provider.name
    // values so adding e.g. 'claude' is a one-line change.
    const AI_SOURCES = new Set(['groq', 'openai', 'emergent'])
    if (AI_SOURCES.has(result.source)) {
      await incrementUsage(db, auth.clerkId, 1, m)
    }

    // Track analytics event so we can monitor the new product
    // surface. Non-blocking — failure here MUST NOT 500 the call.
    // Round-46.1 polish: log a warning on trackEvent failure
    // instead of dropping silently. Failed analytics still
    // shouldn't bubble, but the warn-level line keeps dev-mode
    // debugging effective when the clickhouse insert pipeline
    // is misconfigured (the downstream trace is otherwise
    // invisible).
    trackEvent('extension_email_body', {
      source: result.source,
      lang,
      cvShortWarning: !!result.cvShortWarning,
      jobUrlLength: jobUrl.length,
    }).catch((err) => {
      console.warn('[extension/email-body] trackEvent failed:', err?.message || String(err))
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
    console.error('[extension/email-body] generateEmailBody failed:', err?.message)
    // 2026-07-21 (Round-72.2 / BUG 4) — actionable Swedish copy
    // on AI-generation failure. Pre-fix shape returned a generic
    // "Tillfälligt fel — försök igen om en stund." that left the
    // user stranded on the "Förhandsvisa AI-mejl" panel with no
    // clear retry path. The new copy:
    //   1. Tells the user WHAT failed (AI-utkast)
    //   2. Tells them what they CAN DO (write their own OR retry)
    //   3. Tells them WHERE to retry ("Generera igen" button +
    //      static template fallback)
    // The popup's composeStaticBody() fallback path (Round-46)
    // already handles the AI-unavailable case end-to-end; this
    // server-side change just surfaces the action in Swedish so
    // a CV-less user sees a usable prompt instead of a dead-end
    // toast. Status stays 503 (Service Unavailable) so the popup
    // can distinguish "AI failed" from "non-recoverable server
    // error" (4xx codes).
    return NextResponse.json(
      {
        ok: false,
        reason: 'ai_fallback',
        message: 'AI-utkast kunde inte genereras just nu. Du kan skriva ett eget mejl eller klicka "Generera igen" om en stund.',
        hint: 'Klicka "Generera igen" eller kopiera mallen nedan och anpassa den manuellt.',
        retryable: true,
      },
      { status: 503 },
    )
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST.' }, { status: 405 })
}
