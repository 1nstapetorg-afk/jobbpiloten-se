// app/sitemap.js — Next.js App Router metadata route (sitemap.xml).
//
// Round-91 (P1 #1) — crawler sitemap. Lists ONLY the 6 public pages
// (same allow-list as app/robots.js) with the canonical base URL from
// lib/siteConfig.js#SITE_URL. Never includes authenticated surfaces
// (/dashboard, /settings, /onboarding, /test-form) or API paths.
//
// The path list is the single source for both metadata routes:
// app/robots.js references the same set in its allow directive.
// Drift between robots.txt and sitemap.xml is locked by
// tests/unit/round91-robots-sitemap.test.mjs (it reads this module's
// default export output and asserts robots.js allows exactly these
// paths).

import { SITE_URL } from '@/lib/siteConfig'

// The 6 public pages — the ONLY crawler-indexable surfaces. Keep in
// sync with the allow list in app/robots.js.
const PUBLIC_PATHS = [
  '',
  '/privacy',
  '/terms',
  '/legal/cookies',
  '/extension-install',
  '/extension-privacy',
]

export default function sitemap() {
  return PUBLIC_PATHS.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: p === '' ? 1 : 0.7,
  }))
}
