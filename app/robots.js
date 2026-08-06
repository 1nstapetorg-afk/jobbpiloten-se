// app/robots.js — Next.js App Router metadata route (robots.txt).
//
// Round-91 (P1 #1) — crawler directives. Round-89 added metadata tags
// but no crawler files; this route generates /robots.txt with:
//
//   ALLOW    → the 6 public pages only (landing + legal + extension
//              install/privacy pages). These are the only pages worth
//              indexing — everything else requires auth (dashboard,
//              settings, onboarding) or is an API/utility surface.
//   DISALLOW → /api/* (never indexable), /dashboard, /settings,
//              /onboarding, /test-form, and the `/*?*` query-param
//              wildcard (Google's own guidance: avoid crawling every
//              filter/sort permutation of a page — a classic soft-404 /
//              duplicate-content trap for a job feed).
//   SITEMAP  → the canonical sitemap location derived from
//              lib/siteConfig.js#SITE_URL so a host override (dev /
//              Codespaces / prod) is honored automatically.
//
// The page list MUST stay in sync with app/sitemap.js — a single
// source (the PUBLIC_PATHS array there) keeps the two metadata routes
// from drifting. Locked by
// tests/unit/round91-robots-sitemap.test.mjs.

import { SITE_URL } from '@/lib/siteConfig'

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms', '/legal/cookies', '/extension-install', '/extension-privacy'],
        disallow: ['/api/', '/dashboard', '/settings', '/onboarding', '/test-form', '/*?*'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
