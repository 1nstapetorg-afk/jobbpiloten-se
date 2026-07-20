/**
 * GET /api/applications/recent
 *
 * Round-52 / Issue 1 (P0) — surface the user's recent applications
 * to the popup's Mejlutkast "Vilket jobb gäller det?" picker.
 *
 * The popup also fetches this list as part of the email-draft
 * response (recentJobs[]) but exposing it as its own endpoint
 * keeps the matching affordance decoupled from AI generation —
 * the popup can list candidates without burning LLM tokens when
 * the recipient email doesn't match anything.
 *
 * Auth: same opaque extension-token scheme as /api/extension/*
 * (Authorization: Bearer <64-hex>). 401 on missing / invalid /
 * expired. Mirrors the resolveClerkId pattern from /api/extension/
 * profile so a token revoked server-side immediately surfaces in the
 * popup.
 *
 * Response shape (safe subset — no PII beyond jobTitle + company):
 *   {
 *     applications: [
 *       { id, jobTitle, companyName, source, createdAt }
 *     ]
 *   }
 *
 * Cap: 5 most-recent (the popup picker renders at most 5 chips
 * before scrolling). Matches the /api/email-draft recentJobs
 * payload so the two are interchangeable.
 */

import { NextResponse } from 'next/server'
import { MongoClient } from 'mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

async function resolveClerkId(request) {
  const auth = request.headers.get('authorization') || ''
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth)
  if (!match) return null
  const token = match[1]
  const db = await getDb()
  const tokenDoc = await db.collection('extension_tokens').findOne({ token })
  if (!tokenDoc) return null
  if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt).getTime() <= Date.now()) {
    return null
  }
  await db
    .collection('extension_tokens')
    .updateOne({ token }, { $set: { lastUsedAt: new Date() } })
    .catch(() => {})
  return { clerkId: tokenDoc.clerkId, token }
}

export async function GET(request) {
  const auth = await resolveClerkId(request)
  if (!auth) {
    return NextResponse.json(
      { error: 'Ogiltig eller saknad token — anslut tillägget från /dashboard.' },
      { status: 401 },
    )
  }

  const db = await getDb()
  const rows = await db.collection('applications')
    .find({ clerkId: auth.clerkId })
    .sort({ createdAt: -1 })
    .limit(5)
    .project({
      jobTitle: 1,
      companyName: 1,
      source: 1,
      createdAt: 1,
    })
    .toArray()

  // Project to a SAFE shape — no emailAddress / bodyText / subject
  // leaks into chrome.storage.local. Keep id + jobTitle + companyName
  // + source + the createdAt ISO so the popup can show "1 dag sedan".
  const applications = rows.map((r) => ({
    id: String(r._id),
    jobTitle: String(r.jobTitle || '').slice(0, 200),
    companyName: String(r.companyName || '').slice(0, 200),
    source: String(r.source || 'unknown').slice(0, 40),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  }))

  return NextResponse.json({ applications })
}
