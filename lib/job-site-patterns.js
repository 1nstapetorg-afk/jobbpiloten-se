/**
 * lib/job-site-patterns.js — "is this page a job application form?" matcher.
 *
 * Round-95 (mobile in-app browser). Reuses the SAME host vocabulary the
 * Chrome extension used for its content-script fetch paths (the former
 * `host_permissions` list in extension/manifest.json) plus the Swedish
 * job boards the app scrapes / deep-links (Arbetsförmedlingen, Jobbland,
 * Ledigajobb, Jobbsafari) and the common ATS platforms Swedish employers
 * actually host applications on (Teamtailor, ReachMee, Visma Recruit,
 * Recman, Greenhouse, Lever, Workday).
 *
 * The mobile in-app browser calls `isKnownJobSite(url)` after every page
 * load to decide whether to inject the autofill script (and to show the
 * "Fyll i automatiskt" floating button in the app chrome).
 *
 * Pure module — no React, no Capacitor, no side effects — so the matcher
 * is unit-testable under node --test (see tests/unit/job-site-patterns.test.mjs).
 */

/**
 * Known application-form host suffixes, matched as `hostname.endsWith(...)`.
 * Order is irrelevant for a suffix check; the list is grouped for
 * readability. Subdomain-safe: `jobs.teamtailor.com` and
 * `careers.mycompany.se.teamtailor.com` both end in `.teamtailor.com`.
 *
 * `www.` prefix is stripped before matching so `www.ledigajobb.se` and
 * `ledigajobb.se` are treated identically.
 */
export const JOB_SITE_HOST_SUFFIXES = [
  // Swedish job boards / public portals
  'arbetsformedlingen.se',
  'jobbland.se',
  'ledigajobb.se',
  'jobbsafari.se',
  'metrojobb.se',
  'monster.se',
  'jobtechdev.se',
  // ATS platforms (where the actual application form lives)
  'teamtailor.com',
  'reachmee.com',
  'visma.com',
  'recman.se',
  'recman.no',
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'jobylon.com',
  'smartrecruiters.com',
  'recruitee.com',
  'talentlyft.com',
]

/**
 * Normalize a URL string into a bare hostname (lowercase, no `www.`,
 * no port, no scheme/path). Returns '' for anything that isn't a real
 * http(s) URL so callers can treat malformed input as "not a job site".
 */
export function hostnameOf(url) {
  if (!url || typeof url !== 'string') return ''
  let parsed
  try {
    parsed = new URL(String(url).trim())
  } catch (_) {
    return ''
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  let host = (parsed.hostname || '').toLowerCase()
  if (host.startsWith('www.')) host = host.slice(4)
  return host
}

/**
 * Return true when `url` is an application form we know how to autofill.
 * Empty / non-http(s) / unknown hosts return false (fail-closed: never
 * inject into an arbitrary page).
 */
export function isKnownJobSite(url) {
  const host = hostnameOf(url)
  if (!host) return false
  return JOB_SITE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix))
}

/**
 * Normalize a user-typed address-bar string into a full URL. Prepends
 * `https://` when no scheme is present ("ledigajobb.se" → "https://ledigajobb.se"),
 * otherwise passes through. Returns '' for empty/whitespace input so the
 * caller can treat it as "nothing to navigate to".
 */
export function normalizeUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return 'https://' + raw
}

/**
 * Human-readable canonical site label for the browser chrome ("Jobbland",
 * "Teamtailor", …). Returns '' for unknown hosts so the UI can fall back
 * to the raw hostname.
 */
export function jobSiteLabel(url) {
  const host = hostnameOf(url)
  if (!host) return ''
  const matchedSuffix = JOB_SITE_HOST_SUFFIXES.find(
    (s) => host === s || host.endsWith('.' + s),
  )
  if (!matchedSuffix) return ''
  // Strip the TLD-ish segment for a short label: "jobbland.se" → "Jobbland".
  const base = matchedSuffix.split('.')[0]
  return base.charAt(0).toUpperCase() + base.slice(1)
}
