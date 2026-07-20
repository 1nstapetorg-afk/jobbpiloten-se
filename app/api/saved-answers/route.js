// app/api/saved-answers/route.js
//
// Round-38 / Part 2 — Answer memory API.
//
// Endpoints (all require the caller's Clerk session via requireAuth):
//   • GET  /api/saved-answers          — list the caller's saved answers
//                                       (newest first, capped at 100)
//   • POST /api/saved-answers          — upsert one answer (id + payload).
//                                       Same id = overwrite, new id = new doc.
//   • DELETE /api/saved-answers?id=X  — delete one of the caller's answers
//                                       by id. Idempotent (no 404 on missing).
//
// The route is intentionally thin — the canonical helpers live in
// `lib/saved-answers.js` so a future second caller (e.g. an admin
// tool, a /dashboard cover-letter-modal "Spara" button) reads from
// the same source.
//
// Body validation goes through the Zod schema in lib/saved-answers.js
// so a malformed payload (oversize answer, empty question, bad id)
// surfaces a 400 with structured issues instead of throwing inside
// the route handler.
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  SavedAnswerSchema,
  listSavedAnswers,
  upsertSavedAnswer,
  deleteSavedAnswer,
} from '@/lib/saved-answers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---- Mongo singleton (mirrors the other API routes) ----
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

export async function GET(req) {
  try {
    const auth = await requireAuth(req)
    if (auth.error) return auth.error
    const db = await getDb()
    const answers = await listSavedAnswers(db, auth.userId)
    return NextResponse.json({ ok: true, answers })
  } catch (err) {
    console.error('[saved-answers] GET error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Kunde inte läsa sparade svar.' },
      { status: 500 },
    )
  }
}

export async function POST(req) {
  try {
    const auth = await requireAuth(req)
    if (auth.error) return auth.error
    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Ogiltig JSON.' },
        { status: 400 },
      )
    }
    // Zod safeParse (not parse) so a malformed payload surfaces a
    // 400 with structured issues — never throws inside the handler.
    const parsed = SavedAnswerSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Ogiltigt payload.', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const db = await getDb()
    const doc = await upsertSavedAnswer(db, auth.userId, parsed.data)
    return NextResponse.json({ ok: true, answer: doc })
  } catch (err) {
    console.error('[saved-answers] POST error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Kunde inte spara svaret.' },
      { status: 500 },
    )
  }
}

export async function DELETE(req) {
  try {
    const auth = await requireAuth(req)
    if (auth.error) return auth.error
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Saknar id i query.' },
        { status: 400 },
      )
    }
    const db = await getDb()
    const deleted = await deleteSavedAnswer(db, auth.userId, id)
    return NextResponse.json({ ok: true, deleted })
  } catch (err) {
    console.error('[saved-answers] DELETE error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Kunde inte radera svaret.' },
      { status: 500 },
    )
  }
}
