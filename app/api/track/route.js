// app/api/track/route.js
//
// Part 10 — Analytics tracking endpoint.
//
// Receives client-side events (via navigator.sendBeacon from
// lib/analytics.js) and re-emits them through the server-side
// trackEvent() so the same Vercel log stream carries both server
// events and browser events. JSON-only, no DB writes — the goal
// is observability, not durable analytics storage.
//
// Public route: no requireAuth. The endpoint is rate-limited to
// prevent abuse but accepts anonymous events (landing_page_view
// fires before sign-in). The event name + props shape is the
// same as the server-side trackEvent contract — Zod-style
// validation lives in the helper.

import { NextResponse } from 'next/server'
import { trackEvent, captureError, recordTiming } from '@/lib/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// In-memory rate limit: 60 events / minute / IP. A landing page
// can fire 5-6 events in a session; 60/min covers an active
// tester without leaving room for a runaway loop.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
const buckets = new Map() // ip -> [ts]

function checkRateLimit(ip) {
  const now = Date.now()
  const arr = buckets.get(ip) || []
  const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (fresh.length >= RATE_LIMIT_MAX) return false
  fresh.push(now)
  buckets.set(ip, fresh)
  return true
}

function getIp(request) {
  // x-forwarded-for is the canonical Vercel / proxy header. The
  // first IP in the chain is the client (left-most). Falls back
  // to a single 'unknown' bucket so the rate limit is per-route
  // rather than per-IP for clients behind stripped proxies.
  const xff = request.headers.get('x-forwarded-for') || ''
  return xff.split(',')[0]?.trim() || 'unknown'
}

export async function POST(request) {
  // Part 10: recordTiming — capture the request's total
  // wall-clock time so the rolling p95 tracker has data to
  // aggregate. startMs is read first (before any other work)
  // so the measurement includes the JSON-parse + IP-extract
  // overhead too.
  const startMs = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now()
  const ip = getIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const name = String(body?.name || '').trim()
  const props = (body?.props && typeof body.props === 'object') ? body.props : {}
  if (!name) {
    return NextResponse.json({ ok: false, error: 'missing_name' }, { status: 400 })
  }
  // Wrap in try/catch so a malformed event never throws to the
  // client (the event is fire-and-forget; the browser just logs
  // a 400 and carries on).
  try {
    trackEvent(name, { ...props, source: 'client', ip })
  } catch (err) {
    captureError(err, { event: name })
  }
  // Part 10: record the request's total wall-clock time so the
  // rolling p95 tracker has data points to aggregate. Recorded
  // after the event has been logged so the timing reflects the
  // full happy-path cost, not just the route entry.
  const elapsed = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() - startMs
    : Date.now() - startMs
  recordTiming('POST', '/api/track', elapsed)
  return NextResponse.json({ ok: true })
}

export async function GET() {
  // Health check — useful for uptime monitors.
  return NextResponse.json({ ok: true, service: 'track' })
}
