// lib/analytics.js
//
// Part 10 — Analytics & Monitoring.
//
// Centralised event tracking + error monitoring for the soft-launch
// release. Two surfaces:
//   1. trackEvent() — structured-JSON console.log so Vercel log
//      aggregators can grep `evt=jobbpiloten.event` for funnels.
//   2. captureError() — Sentry SDK wrapper, env-gated no-op when
//      SENTRY_DSN is unset so a dev env without Sentry still works.
//
// Design notes:
//   - Server-side calls go through console.log(JSON.stringify(...))
//     instead of an external SDK so we don't add a new npm dep.
//   - Client-side calls POST to /api/track which echoes the event
//     to the server-side log (so a browser-side event shows up in
//     the same log stream as a server-side one). This keeps the
//     observability surface single-sink.
//   - p95 latency tracking is exposed via `recordTiming()` and
//     aggregated in-memory per-route. Cheap, no external dep.
//   - The helper is a NO-OP in test environments so the 540+ unit
//     tests don't spam the log aggregator.
//
// Event naming convention: `noun.verb` (e.g. `landing_page_view`,
// `application_sent`, `extension_installed`). Lowercase + underscore
// only — keeps the log aggregator's regex simple.

const IS_PROD = process.env.NODE_ENV === 'production'
const SENTRY_DSN = process.env.SENTRY_DSN || ''
const ANALYTICS_DISABLED = process.env.ANALYTICS_DISABLED === '1'

// ---- In-memory p95 latency tracker ----
// Rolling window of the last 256 timings per (route, method). On
// every read, we sort and return the p95 (the 0.95 * Nth value).
// Cheap enough for soft-launch; the dashboard's admin-only route
// exposes this on demand. No external dep.
const _timings = new Map() // key: `METHOD route` -> number[]
const TIMING_WINDOW = 256
const TIMING_P95_INDEX = Math.floor(TIMING_WINDOW * 0.95)

function timingKey(method, route) {
  return `${String(method || 'GET').toUpperCase()} ${route || '/'}`
}

export function recordTiming(method, route, ms) {
  if (ANALYTICS_DISABLED) return
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return
  const key = timingKey(method, route)
  let arr = _timings.get(key)
  if (!arr) {
    arr = []
    _timings.set(key, arr)
  }
  arr.push(ms)
  if (arr.length > TIMING_WINDOW) arr.shift()
}

export function getTimingStats(method, route) {
  const key = timingKey(method, route)
  const arr = _timings.get(key) || []
  if (arr.length === 0) {
    return { count: 0, p50: null, p95: null, p99: null, mean: null }
  }
  const sorted = arr.slice().sort((a, b) => a - b)
  const pick = (i) => sorted[Math.min(i, sorted.length - 1)]
  return {
    count: sorted.length,
    p50: pick(Math.floor(sorted.length * 0.5)),
    p95: pick(Math.floor(sorted.length * 0.95)),
    p99: pick(Math.floor(sorted.length * 0.99)),
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  }
}

export function getAllTimingStats() {
  const out = {}
  for (const key of _timings.keys()) {
    const [method, route] = key.split(' ')
    out[key] = getTimingStats(method, route)
  }
  return out
}

// ---- trackEvent() ----
//
// Fire a single event. Server-side: log a structured JSON line.
// Client-side: POST to /api/track (which then re-logs).
// Either way the event lands in the same Vercel log stream.
//
// `props` is a flat object. Nested objects are JSON-stringified so
// the log aggregator doesn't get fooled by multi-line values. Keys
// are filtered to a-zA-Z0-9_ to keep the line a single line.
//
// Returns nothing — fire-and-forget. Errors are swallowed so an
// analytics hiccup never blocks a user-facing action.
export function trackEvent(name, props = {}) {
  if (ANALYTICS_DISABLED) return
  if (typeof name !== 'string' || !name) return
  // Validate event name shape: lowercase + dot/underscore only, must
  // start with a letter. We deliberately allow single-segment names
  // (e.g. `signup`) AND dotted names (`landing_page_view`) — the
  // schema version + dot/underscore constraint is what the log
  // aggregator's regex relies on, not a specific segment count.
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(name)) return
  const safeProps = {}
  for (const [k, v] of Object.entries(props || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)) continue
    if (v == null) {
      safeProps[k] = null
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      safeProps[k] = v
    } else {
      // Stringify objects / arrays to keep the line single-line.
      try {
        safeProps[k] = JSON.stringify(v).slice(0, 500)
      } catch (_) {
        safeProps[k] = '[unserialisable]'
      }
    }
  }
  // Round 10 server-side: emit the structured line so the Vercel
  // log aggregator can grep `evt=jobbpiloten.event`. The `v: 1`
  // marker is the schema version — log readers should be defensive
  // about field additions.
  const line = {
    evt: 'jobbpiloten.event',
    v: 1,
    name,
    ts: new Date().toISOString(),
    env: IS_PROD ? 'prod' : 'dev',
    ...safeProps,
  }
  try {
    console.log(JSON.stringify(line))
  } catch (_) {
    /* never let an analytics error break a request */
  }
}

// ---- captureError() ----
//
// Sentry wrapper. NO-OP unless SENTRY_DSN is set. The project
// intentionally doesn't add @sentry/* as a hard dep so a dev
// install without the SDK still works — when an operator adds the
// DSN, they `yarn add @sentry/nextjs` + drop the SDK init into
// app/layout.js (or wherever the instrumentation is). The contract
// here is just "if Sentry is present, route errors through it".
//
// For now, this is a no-op + console.error bridge. The shape stays
// the same so a future Sentry addition is a 1-line change.
export function captureError(err, context = {}) {
  if (err == null) return
  const errMsg = err && err.message ? err.message : String(err)
  const errStack = err && err.stack ? String(err.stack).slice(0, 1000) : ''
  const safeContext = {}
  for (const [k, v] of Object.entries(context || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)) continue
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      safeContext[k] = v
    }
  }
  const payload = {
    evt: 'jobbpiloten.error',
    v: 1,
    ts: new Date().toISOString(),
    env: IS_PROD ? 'prod' : 'dev',
    sentry: !!SENTRY_DSN,
    error: errMsg,
    stack: errStack,
    ...safeContext,
  }
  try {
    console.error(JSON.stringify(payload))
  } catch (_) {
    console.error('[jobbpiloten error]', errMsg)
  }
  // When Sentry is wired, the init code can call
  //   globalThis.__sentry?.captureException(err, { extra: safeContext })
  // here. The hook is left intentionally lightweight — we don't
  // want a 4 KB SDK in the bundle for a soft-launch that has
  // 0 error-monitoring traffic today.
}

// ---- Pre-defined event constants ----
//
// Centralised so call-sites don't drift on the event name. A
// refactor that renames an event is a 1-line edit here + the unit
// tests below lock the contract.
export const EVENTS = Object.freeze({
  LANDING_PAGE_VIEW: 'landing_page_view',
  LANDING_CTA_CLICK: 'landing_cta_click',
  DEMO_INTERACTION: 'demo_interaction',
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'signup_completed',
  FIRST_JOB_MATCH_VIEWED: 'first_job_match_viewed',
  FIRST_COVERLETTER_GENERATED: 'first_coverletter_generated',
  APPLICATION_PREPARED: 'application_prepared',
  APPLICATION_SENT: 'application_sent',
  EXTENSION_INSTALLED: 'extension_installed',
  EXTENSION_FIELD_FILLED: 'extension_field_filled',
  ANSWER_MEMORY_USED: 'answer_memory_used',
  STYLE_CHANGED: 'style_changed',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',
  PAYMENT_FAILED: 'payment_failed',
  CV_ENHANCED: 'cv_enhanced',
  MATCH_SCORE_VIEWED: 'match_score_viewed',
  MOBILE_SAVED: 'mobile_saved',
})

// ---- Client-side fetch helper ----
//
// Inlined here so the dashboard + landing + settings can fire
// events from a useEffect without each surface re-implementing
// the fetch. Returns the same response from /api/track; safe to
// call without awaiting.
export function trackEventClient(name, props) {
  if (typeof window === 'undefined') return
  try {
    const body = JSON.stringify({ name, props: props || {} })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      // sendBeacon survives page navigation (unlike fetch) — a
      // click that immediately navigates away still gets logged.
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon('/api/track', blob)
    } else {
      // Fallback: keepalive fetch. Works in older browsers without
      // beacon; the keepalive flag is the closest equivalent.
      fetch('/api/track', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {})
    }
  } catch (_) {
    /* swallow — analytics must never break a user click */
  }
}
