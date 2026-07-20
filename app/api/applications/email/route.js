// app/api/applications/email/route.js
//
// Round-38 hotfix — Email-prepared application endpoint.
//
// Persists an AI-composed email-application to the `applications`
// collection tagged with `source: 'email'` so the dashboard can
// render a distinct Mail icon + filter chip (data-testid="application-source-email"
// + data-testid="filter-email") separately from the scraped-AF flow.
// Auth-only (no anonymous writes) — soft-launch users are always
// signed-in via Clerk/demo-cookie. The body is stored as-is; the
// user reviews + clicks the host mailto: link themselves, so we
// never submit an outgoing email on their behalf.
//
// Why this is a STANDALONE route file instead of an inline branch
// in app/api/[[...path]]/route.js:
//  • The catch-all's previous inline handler called three helpers
//    that did not exist in that module (`safeJsonBody`,
//    `resolveUserId`, `stripInternal`), so a POST to
//    /api/applications/email would silently 500 at runtime
//    (caught by the Round-38 code-reviewer — see
//    last_response.txt Round-38 / Fix #1).
//  • Moving the handler to its own file is the canonical Next.js
//    App Router pattern for non-catching routes; the pattern
//    mirrors app/api/saved-answers/route.js for consistency.
//  • The dashboard's filter chip + Mail tag, the extension
//    popup's "Spara utkast" action, and the e2e spec
//    tests/e2e/dashboard-email-source.spec.js all POST to this
//    endpoint; isolating the handler here means future maintainers
//    can grep one file for the email-source contract.
//
// Body parsing: hand-rolled .catch → 400 with a Swedish message
// mirroring the rest of the API surface. We deliberately accept
// only JSON bodies — a multipart or urlencoded POST from an old
// client returns 400 without silently dropping the email.
//
// Field caps (defence-in-depth against a malformed curl POST
// pushing multi-MB rows into Mongo):
//   • subject       → 200 chars (fits one email subject line)
//   • jobTitle      → 200 chars (matches SAMPLE_JOBS shapes)
//   • companyName   → 200 chars
//   • bodyText      → 5 000 chars (matches the popup UI's textarea max)

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---- Mongo singleton (mirrors app/api/saved-answers/route.js) ----
let clientPromise
if (!global._mongoClientPromise) {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten')
  global._mongoClientPromise = client.connect()
}
clientPromise = global._mongoClientPromise

async function getDb() {
  const client = await clientPromise
  return client.db(process.env.DB_NAME)
}

export async function POST(request) {
  try {
    const authRes = await requireAuth(request)
    if (authRes.error) return authRes.error

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Ogiltig JSON.' },
        { status: 400 },
      )
    }

    // Mandatory fields — the popup's compose panel never lets the
    // user save an empty draft, but a logged-in tester hitting the
    // endpoint directly with a malformed curl should NOT be able to
    // write empty-string rows.
    const emailAddress = String(body?.emailAddress || '').trim()
    const subject = String(body?.subject || '').trim()
    const bodyText = String(body?.bodyText || '').trim()
    // Optional fields. Trimmed; if empty, written as `undefined`
    // (which Mongo treats as absent — landing on a row with
    // `jobTitle === undefined` instead of `jobTitle === ''`).
    const jobTitle = String(body?.jobTitle || '').trim()
    const companyName = String(body?.companyName || '').trim()

    if (!emailAddress || !subject || !bodyText) {
      return NextResponse.json(
        { ok: false, error: 'Saknar e-postadress, ämne eller brödtext.' },
        { status: 400 },
      )
    }
    // Lightweight email-shape check. The popup composes a stricter
    // regex client-side; this is a defence-in-depth floor so a
    // logged-in user can't accidentally store a malformed row.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
      return NextResponse.json(
        { ok: false, error: 'Ogiltig e-postadress.' },
        { status: 400 },
      )
    }

    const db = await getDb()
    const now = new Date()
    const doc = {
      clerkId: authRes.userId,
      source: 'email',
      emailAddress,
      subject: subject.slice(0, 200),
      bodyText: bodyText.slice(0, 5_000),
      jobTitle: jobTitle.slice(0, 200) || undefined,
      companyName: companyName.slice(0, 200) || undefined,
      // Default status: 'prepared' — the user flips to 'applied'
      // via /api/mark-applied once they click their mail client.
      // We pre-set status to align with the existing STATUS_MAP
      // shape (email-prepared rows render as "Förberedd" with the
      // blue palette, distinct from the indigo AF-sourced badge).
      status: 'prepared',
      preparedAt: now,
      sentAt: null,
      saved: false,
      savedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const result = await db.collection('applications').insertOne(doc)
    return NextResponse.json({ ok: true, application: { ...doc, _id: result.insertedId } })
  } catch (err) {
    console.error('[applications/email] POST error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Kunde inte spara e-postutkast — försök igen.' },
      { status: 500 },
    )
  }
}
