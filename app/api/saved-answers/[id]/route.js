// app/api/saved-answers/[id]/route.js
//
// Round-42 (Part 2 polish) — Explicit PUT for a single saved
// answer by its client-generated id. The existing POST upsert
// already handles "create or overwrite" — this PUT is the
// idempotent explicit-form so a future client can use the
// REST-y "PUT /api/saved-answers/:id" shape without the POST
// upsert's body-merge ambiguity.
//
// Auth: requireAuth. Body: full SavedAnswer shape (the same
// Zod schema as POST). On success returns the canonical doc.
//
// Why this exists alongside POST: the dashboard's "Redigera"
// action on the AnswerMemoryCard calls POST today; the popup's
// per-question style override will use PUT because the id is
// already known client-side. Two endpoints, one underlying
// helper (upsertSavedAnswer) so the validation + Mongo logic
// stays in one place.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { SavedAnswerSchema, upsertSavedAnswer } from '@/lib/saved-answers'
import { trackEvent } from '@/lib/analytics'

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

export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request)
    if (auth.error) return auth.error
    const id = String(params?.id || '').trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Saknar id i URL.' }, { status: 400 })
    }
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Ogiltig JSON.' }, { status: 400 })
    }
    // The URL id is authoritative — overwrite any id in the body so
    // a malformed client can't rewrite a different doc.
    const parsed = SavedAnswerSchema.safeParse({ ...body, id })
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Ogiltigt payload.', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const db = await getDb()
    const doc = await upsertSavedAnswer(db, auth.userId, parsed.data)
    trackEvent('saved_answer_updated', {
      id,
      field: doc.field,
      hasStyle: !!doc.style,
    })
    return NextResponse.json({ ok: true, answer: doc })
  } catch (err) {
    console.error('[saved-answers PUT] error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Kunde inte uppdatera svaret.' },
      { status: 500 },
    )
  }
}
