// app/api/cv-pdf/route.js
//
// Part 5 — CV Enhancement. Fallback download for an optimized
// CV as a one-page PDF. Reuses pdf-lib (same dep as the
// Aktivitetsrapport) so we don't add a new package.
//
// The PDF is intentionally minimal: a single A4 page with the
// user's cvSummary (rewritten or raw) and a header with the
// profile.fullName. Not a full CV layout — that's a v0.4
// stretch. The endpoint exists so a user who can't install the
// browser extension can still download a clean, one-page
// printable version of their saved CV.

import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { requireAuth } from '@/lib/auth'
import { trackEvent } from '@/lib/analytics'
import { requireCompleteProfile } from '@/lib/profile-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---- Mongo singleton (mirrors /api/saved-answers/route.js) ----
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

export async function GET(request) {
  try {
    const auth = await requireAuth(request)
    if (auth.error) return auth.error
    const db = await getDb()
    // Bug 1 fix (2026-07-20): route the lookup through the shared
    // helper so the canonical 404 message ("Profil hittades inte —
    // slutför /onboarding först.") is shared with email-preview /
    // extension/token / extension/email-body / extension/answer /
    // extension/ai-answers / email-draft / ai-usage.
    // cv-pdf historically returned `{ ok: false, error: '...' }` so
    // legacy callers branch on `resp.ok` — unwrap the helper's
    // NextResponse and rewrap so the JSON shape stays identical.
    const lookup = await requireCompleteProfile(db, auth.userId)
    if (!lookup.ok) {
      const canonical = lookup.error ? await lookup.error.clone().json() : { error: 'Profil hittades inte' }
      return NextResponse.json({ ok: false, error: canonical.error }, { status: 404 })
    }
    const profile = lookup.profile
    const name = String(profile.fullName || 'Kandidaten')
    const email = String(profile.email || '')
    const phone = String(profile.phone || '')
    const city = String(profile.address || '').split(',').slice(-1)[0]?.trim() || ''
    // Prefer cvText (the parsed file body) — falls back to cvSummary.
    const summary = String(profile.cvText || profile.cvSummary || '').trim()
    if (!summary) {
      return NextResponse.json(
        { ok: false, error: 'Inget CV eller sammanfattning att ladda ner.' },
        { status: 400 },
      )
    }
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const page = pdf.addPage([595.28, 841.89]) // A4 in points
    const MARGIN = 50
    const PAGE_WIDTH = page.getWidth()
    const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2
    const LINE_HEIGHT = 14
    // Header — name + contact
    let y = 800
    page.drawText(name, {
      x: MARGIN, y, size: 22, font: fontBold, color: rgb(0.1, 0.1, 0.15),
    })
    y -= 26
    const contact = [email, phone, city].filter(Boolean).join('  ·  ')
    if (contact) {
      page.drawText(contact, {
        x: MARGIN, y, size: 10, font, color: rgb(0.35, 0.35, 0.4),
      })
      y -= 18
    }
    // Divider
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: PAGE_WIDTH - MARGIN, y: y + 4 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.75),
    })
    y -= 14
    // Wrap summary to MAX_WIDTH. pdf-lib doesn't have a built-in
    // text-wrap helper so we hand-roll a word-wrap that respects
    // ASCII + Swedish chars. Lines exceeding ~95 chars get split.
    const words = summary.replace(/\s+/g, ' ').split(' ').filter(Boolean)
    const lines = []
    let current = ''
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w
      const width = font.widthOfTextAtSize(candidate, 11)
      if (width > MAX_WIDTH && current) {
        lines.push(current)
        current = w
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
    for (const line of lines) {
      if (y < MARGIN + LINE_HEIGHT) break
      page.drawText(line, {
        x: MARGIN, y, size: 11, font, color: rgb(0.15, 0.15, 0.2),
      })
      y -= LINE_HEIGHT
    }
    // Footer — generated timestamp + JobbPiloten brand
    page.drawText('Genererad av JobbPiloten', {
      x: MARGIN, y: MARGIN / 2, size: 8, font, color: rgb(0.55, 0.55, 0.6),
    })
    const pdfBytes = await pdf.save()
    trackEvent('cv_pdf_downloaded', { summaryLength: summary.length })
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="jobbpiloten-cv-${new Date().toISOString().slice(0, 10)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[cv-pdf] error:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Kunde inte generera CV-PDF.' },
      { status: 500 },
    )
  }
}
