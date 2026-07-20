// app/api/saved-jobs/route.js
//
// Part 8 — Mobile Companion. "Spara till JobbPiloten" endpoint.
//
// Persists a mobile-saved job into a `saved_jobs` collection
// tagged with the clerkId + a tiny job snapshot (title, company,
// location, url, source) so the dashboard can render a "Sparad —
// förbered på dator" card the next time the user opens the
// desktop dashboard. DELETE removes the row.
//
// Soft-launch design: this is a one-tap save, not a full job
// scrape. The mobile view sends whatever the rendered job card
// already has (title + company + url), and the desktop dashboard
// re-resolves the job via getJobById when the user opens it.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { trackEvent, captureError } from '@/lib/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

const TITLE_MAX = 200
const COMPANY_MAX = 200
const LOCATION_MAX = 200
const URL_MAX = 2_000
const SOURCE_MAX = 100

// Zod schema for the POST body — consistent with /api/saved-answers
// which uses Zod too. Coerces to strings + clamps via .max() so a
// misbehaving client can't write a multi-megabyte doc to Mongo.
const SavedJobSchema = z.object({
  jobId: z.string().min(1).max(200),
  title: z.string().min(1).max(TITLE_MAX),
  company: z.string().min(1).max(COMPANY_MAX),
  location: z.string().max(LOCATION_MAX).optional().default(''),
  url: z.string().max(URL_MAX).optional().default(''),
  source: z.string().max(SOURCE_MAX).optional().default('Arbetsförmedlingen'),
})

export async function POST(request) {
  try {
    const auth = await requireAuth(request)
    if (auth.error) return auth.error
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Ogiltig JSON.' }, { status: 400 })
    }
    const jobId = String(body?.jobId || '').trim()
    const title = String(body?.title || '').trim()
    const company = String(body?.company || '').trim()
    const location = String(body?.location || '').trim()
    const url = String(body?.url || '').trim()
    const source = String(body?.source || 'Arbetsförmedlingen').trim()
    // Zod validation owns the type / length budget contract. We
    // safeParse so a malformed payload surfaces a 400 with structured
    // issues for the client to log + fall back, never throws inside
    // the route handler.
    const parsed = SavedJobSchema.safeParse({ jobId, title, company, location, url, source })
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Ogiltigt payload.', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const safe = parsed.data
    const db = await getDb()
    const now = new Date()
    const doc = {
      clerkId: auth.userId,
      jobId: safe.jobId,
      title: safe.title,
      company: safe.company,
      location: safe.location,
      url: safe.url,
      source: safe.source,
      // The status that powers the "Sparad — förbered på dator"
      // badge on the desktop dashboard.
      status: 'saved-mobile',
      savedAt: now,
      // `preparedAt` is set when the user actually applies from the
      // desktop dashboard. Initially null so the dashboard can
      // render the "needs prep" affordance.
      preparedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    // Upsert by (clerkId, jobId) so a duplicate tap doesn't double-save.
    await db.collection('saved_jobs').updateOne(
      { clerkId: auth.userId, jobId: safe.jobId },
      {
        $set: { ...doc, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )
    trackEvent('mobile_saved', {
      source,
      jobId,
      hasUrl: !!url,
    })
    return NextResponse.json({ ok: true, savedJob: { ...doc, updatedAt: now } })
  } catch (err) {
    captureError(err, { route: 'saved-jobs POST' })
    return NextResponse.json(
      { ok: false, error: 'Kunde inte spara jobb — försök igen.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request)
    if (auth.error) return auth.error
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')
    if (!jobId) {
      return NextResponse.json({ ok: false, error: 'Saknar jobId.' }, { status: 400 })
    }
    const db = await getDb()
    const result = await db.collection('saved_jobs').deleteOne({ clerkId: auth.userId, jobId })
    return NextResponse.json({ ok: true, deleted: result.deletedCount > 0 })
  } catch (err) {
    captureError(err, { route: 'saved-jobs DELETE' })
    return NextResponse.json(
      { ok: false, error: 'Kunde inte ta bort sparat jobb.' },
      { status: 500 },
    )
  }
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request)
    if (auth.error) return auth.error
    const db = await getDb()
    const jobs = await db
      .collection('saved_jobs')
      .find({ clerkId: auth.userId })
      .sort({ savedAt: -1 })
      .limit(100)
      .toArray()
    const clean = jobs.map((j) => {
      const { _id, ...rest } = j
      return rest
    })
    return NextResponse.json({ ok: true, savedJobs: clean })
  } catch (err) {
    captureError(err, { route: 'saved-jobs GET' })
    return NextResponse.json(
      { ok: false, error: 'Kunde inte läsa sparade jobb.' },
      { status: 500 },
    )
  }
}
