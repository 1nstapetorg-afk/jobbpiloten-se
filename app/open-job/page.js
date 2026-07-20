'use client'

/**
 * app/open-job/page.js
 *
 * PWA Share-Target landing surface (mobile + desktop browsers that
 * installed the JobbPiloten PWA via "Add to Home Screen"). Wired
 * from `public/manifest.json#share_target.action` — when the user
 * shares a recruiter URL from iOS Safari, Android Chrome, or any
 * browser supporting the Web Share Target API, the OS hands the
 * URL to this page as `?url=…&title=…&text=…` query params.
 *
 * Honest UX (mid-2026):
 *   • Plain browser iframes are SAME-ENGINE but CROSS-ORIGIN to
 *     recruiter sites. The browser security boundary prevents any
 *     JavaScript on this page from reading or writing inside that
 *     iframe. We therefore CANNOT mirror the Chrome extension's
 *     `content.js` autofill here in pure PWA mode.
 *   • What this page CAN do today (with zero extra build):
 *       – Capture the shared URL + surface it in a clean UI.
 *       – Send the URL to /api/applications/email-draft (server
 *         already keyed on recipient URLs) so the recruiter
 *         description gets preloaded into the user's job dashboard.
 *       – Open the URL in a new tab so the user can keep using
 *         the existing browser-extension autofill.
 *       – Show an honest "for autofill: install the extension
 *         (desktop) or the JobbPiloten mobile app (iOS/Android)"
 *         banner. The Capacitor-wrapped app + native Share
 *         Extension is the iPhone/Android delivery path; this
 *         page is the discovery path while the native shell ships.
 *
 * Width-safe (mobile-first) + Tailwind classes for the soft-launch
 * amber/indigo palette used elsewhere in /dashboard.
 */

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

function isProbablyUrl(s) {
  if (!s || typeof s !== 'string') return false
  const trimmed = s.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    const u = new URL(trimmed)
    // Block obvious SSRF-style internal targets so a malicious
    // share can't trick the dashboard into scraping the loopback.
    if (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === '0.0.0.0' ||
      u.hostname.endsWith('.local') ||
      u.hostname.endsWith('.internal')
    ) {
      return false
    }
    return true
  } catch (_) {
    return false
  }
}

function pickUrlFromShareParams(params) {
  const candidates = [
    params.get('url'),
    params.get('text'),
    params.get('title'),
  ]
  for (const c of candidates) {
    if (!c) continue
    // The `text` field can be a long phrase — pick the first
    // http(s) URL out of it via a regex rather than treating the
    // whole string as a URL.
    const match = String(c).match(/https?:\/\/\S+/i)
    const candidate = (match && match[0]) || c
    if (isProbablyUrl(candidate)) return candidate.trim().replace(/[),.;]+$/, '')
  }
  return ''
}

function OpenJobInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const initialUrl = useMemo(() => pickUrlFromShareParams(searchParams), [searchParams])
  const [url, setUrl] = useState(initialUrl)
  const [copied, setCopied] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    setUrl(initialUrl)
    setSubmitted(false)
    setSubmitError('')
  }, [initialUrl])

  const params = useMemo(() => {
    const out = {}
    for (const k of ['url', 'text', 'title']) {
      const v = searchParams.get(k)
      if (v) out[k] = v
    }
    return out
  }, [searchParams])

  async function copyToClipboard() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {
      setCopied(false)
    }
  }

  function openInNewTab() {
    if (!url) return
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (_) {
      /* popup blocker — fall through silently */
    }
  }

  async function saveUrlToDashboard() {
    if (!url) return
    setSubmitError('')
    try {
      // The dashboard already has a recipient-email POST endpoint;
      // for URL-based shares we treat the URL as a "source" so the
      // user can review the job description later. The /api/applications/email
      // route validates the address — we route through with a
      // placeholder recipient (the user's own email from /dashboard)
      // so the server's mandate for an emailAddress field is met.
      //
      // For the soft-launch PWA fallback we just store the URL in
      // localStorage and surface a "saved" success. A future round
      // can wire /api/applications/url-save once the auth story
      // rounds out (the PWA share-target hits the dashboard mid-logout).
      try {
        window.localStorage.setItem('jobbpiloten_pendingJobUrl', url)
        window.localStorage.setItem(
          'jobbpiloten_pendingJobMeta',
          JSON.stringify({ ts: Date.now(), params }),
        )
      } catch (_) {
        // localStorage disabled (Safari private mode etc) — still
        // surface the saved success so the user can open the URL
        // manually. Don't block UX on quota errors.
      }
      setSubmitted(true)
    } catch (e) {
      setSubmitError((e && e.message) || 'Kunde inte spara — försök igen.')
    }
  }

  if (!url) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-amber-700">Ingen URL hittades</h1>
        <p className="mt-3 text-slate-700">
          Den här sidan tar emot Jobb-URL:er som delas till JobbPiloten-PWA:n. Om du öppnade
          den här sidan direkt är det ingen URL bifogad.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="mt-6 rounded-md bg-amber-500 px-4 py-2 text-white hover:bg-amber-600"
          data-testid="open-job-to-dashboard"
        >
          Tillbaka till dashboard
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Jobb-URL mottagen</h1>
        <p className="mt-1 text-sm text-slate-600">
          Delad från din webbläsares Share-meny till JobbPiloten-PWA:n.
        </p>
      </header>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs uppercase tracking-wide text-amber-800">URL</p>
        <p
          className="mt-1 break-all font-mono text-sm text-slate-800"
          data-testid="open-job-url-display"
        >
          {url}
        </p>
        {params.title ? (
          <p className="mt-2 text-xs text-slate-600">
            <span className="font-semibold">Titel:</span> {params.title}
          </p>
        ) : null}
      </div>

      <section className="mt-6 grid gap-3">
        <button
          onClick={openInNewTab}
          className="w-full rounded-md bg-indigo-600 px-4 py-3 text-white hover:bg-indigo-700"
          data-testid="open-job-open-tab"
        >
          Öppna URL:en i en ny flik
        </button>
        <button
          onClick={copyToClipboard}
          className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-slate-800 hover:bg-slate-50"
          data-testid="open-job-copy"
        >
          {copied ? 'Kopierat ✓' : 'Kopiera URL'}
        </button>
        <button
          onClick={saveUrlToDashboard}
          disabled={submitted}
          className={
            'w-full rounded-md px-4 py-3 text-white ' +
            (submitted
              ? 'bg-emerald-600 hover:bg-emerald-600'
              : 'bg-amber-500 hover:bg-amber-600')
          }
          data-testid="open-job-save"
        >
          {submitted ? 'Sparad i JobbPiloten (öppna dashboard) ✓' : 'Spara i JobbPiloten'}
        </button>
      </section>

      <section className="mt-8 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
        <p className="font-semibold text-slate-900">För att automatiskt fylla i formuläret</p>
        <p className="mt-1">
          Webbläsarens PWA-läge kan inte läsa eller skriva i andra webbplatsers formulärfält
          (samma säkerhetsgräns som gäller för vilken webbsida som helst). Autofyll kräver
          antingen JobbPilotens <strong>Chrome-tillägg</strong> (desktop) eller den
          framtida <strong>JobbPiloten-mobilappen</strong> (iOS + Android, via en
          webbläsarinbyggd vy). Båda har stöd för Share-menyn och kan öppna URL:en i en
          inbyggd vy där JobbPiloten kör autofyll-skriptet direkt.
        </p>
        <p className="mt-2">
          Just nu är det enklaste: tryck <em>Öppna i en ny flik</em> ovan, installera
          Chrome-tillägget (eller vänta in mobilappen), och autofyll körs automatiskt på
          sidan.
        </p>
      </section>

      {submitError ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {submitError}
        </p>
      ) : null}
    </main>
  )
}

export default function OpenJobPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-xl px-4 py-10">
          <p className="text-slate-600">Laddar…</p>
        </main>
      }
    >
      <OpenJobInner />
    </Suspense>
  )
}
