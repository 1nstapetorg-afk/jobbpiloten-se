// app/api/cv-enhance/route.js
//
// Part 5 — CV Enhancement. "Förbättra formulering" endpoint.
//
// POST { summary, focus } where focus ∈ ['resultat', 'teknisk',
// 'ledarskap']. Returns { enhanced, bullets, focus, source }.
//
// The route delegates to lib/cv-enhance.js (Groq + pure fallback).
// Auth: requireAuth (only signed-in users can rewrite their own
// CV — no anonymous rewrites, so a flood of unauthenticated
// requests can't burn LLM tokens).

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { enhanceCvSummaryGroq } from '@/lib/cv-enhance'
import { trackEvent, captureError } from '@/lib/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_FOCUS = new Set(['resultat', 'teknisk', 'ledarskap'])
const SUMMARY_MAX = 1500
// Minimum length — below 50 chars the enhancer can't extract enough
// signal to produce a meaningful improvement. We return 400 instead
// of running the LLM (or pure-fallback) on a one-word input.
const SUMMARY_MIN = 50

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
    const summary = String(body?.summary || '').trim()
    const focus = String(body?.focus || 'resultat').toLowerCase()
    if (!summary) {
      return NextResponse.json({ ok: false, error: 'Tom sammanfattning.' }, { status: 400 })
    }
    if (summary.length < SUMMARY_MIN) {
      return NextResponse.json(
        { ok: false, error: `Sammanfattningen är för kort — minst ${SUMMARY_MIN} tecken krävs för att kunna förbättras.` },
        { status: 400 },
      )
    }
    if (summary.length > SUMMARY_MAX) {
      return NextResponse.json(
        { ok: false, error: `Sammanfattningen är för lång — max ${SUMMARY_MAX} tecken.` },
        { status: 400 },
      )
    }
    if (!VALID_FOCUS.has(focus)) {
      return NextResponse.json(
        { ok: false, error: `Ogiltigt fokus: ${focus}. Välj en av resultat, teknisk, ledarskap.` },
        { status: 400 },
      )
    }
    const result = await enhanceCvSummaryGroq(summary, focus)
    trackEvent('cv_enhanced', {
      focus,
      source: result.source || 'pure',
      summaryLength: summary.length,
      enhancedLength: result.enhanced.length,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    captureError(err, { route: 'cv-enhance' })
    return NextResponse.json(
      { ok: false, error: 'Tillfälligt fel — försök igen.' },
      { status: 500 },
    )
  }
}
