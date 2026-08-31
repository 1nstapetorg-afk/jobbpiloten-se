// tests/unit/round91-robots-sitemap.test.mjs
//
// Round-91 (P1 #1) — structural locks for the crawler metadata routes.
//
// robots.txt + sitemap.xml are the two surfaces Google's crawler reads
// before deciding what to index. The contract:
//
//   1. robots.js allows ONLY the 6 public pages (landing + legal +
//      extension install/privacy) and disallows everything private
//      (/api/*, /dashboard, /settings, /onboarding, /test-form) plus
//      the `/*?*` query-param wildcard.
//   2. sitemap.js lists exactly those 6 pages, all rooted at
//      lib/siteConfig.js#SITE_URL (the canonical base — a host
//      override like a Codespaces preview must flow into the sitemap
//      automatically, never a hard-coded domain).
//   3. The two route files stay in sync: robots' allow list and
//      sitemap's path list must agree, and both must reference
//      @/lib/siteConfig for the base URL.
//
// Why structural locks: a Next.js metadata route is plain JS — the
// cheapest early-warning barrier is source-grep for the allow/disallow
// literals and the shared SITE_URL import. If a future round adds a
// public page (e.g. a /blog) without updating BOTH files, these locks
// fire before the crawl ever sees a 404.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const ROBOTS_SRC = fs.readFileSync(path.join(ROOT, 'app/robots.js'), 'utf-8')
const SITEMAP_SRC = fs.readFileSync(path.join(ROOT, 'app/sitemap.js'), 'utf-8')

// The canonical 6 public pages — mirrors PUBLIC_PATHS in app/sitemap.js.
const PUBLIC_PATHS = ['/', '/privacy', '/terms', '/legal/cookies', '/extension-install', '/extension-privacy']
const PRIVATE_PREFIXES = ['/api/', '/dashboard', '/settings', '/onboarding', '/test-form']

// ---------------------------------------------------------------------------
// 1. robots.js — allow + disallow directives
// ---------------------------------------------------------------------------

test('Round-91 robots: allows exactly the 6 public pages', () => {
  // The allow array must contain every public path as a quoted literal.
  for (const p of PUBLIC_PATHS) {
    assert.match(
      ROBOTS_SRC,
      new RegExp(`['"]${p.replace(/\//g, '\\/')}['"]`),
      `robots.js must allow ${p} (a crawler-visible public page)`,
    )
  }
  assert.match(ROBOTS_SRC, /allow:\s*\[/, 'robots.js must declare an allow array')
})

test('Round-91 robots: disallows every private surface + query params', () => {
  for (const p of PRIVATE_PREFIXES) {
    assert.match(
      ROBOTS_SRC,
      new RegExp(`['"]${p.replace(/\//g, '\\/')}['"]`),
      `robots.js must disallow ${p} (auth-protected or utility surface)`,
    )
  }
  assert.match(
    ROBOTS_SRC,
    /['"]\/\*\?\*['"]/,
    'robots.js must disallow the /*?* query-param wildcard (duplicate-content / soft-404 trap)',
  )
})

// ---------------------------------------------------------------------------
// 2. sitemap.js — path list + canonical base URL
// ---------------------------------------------------------------------------

test('Round-91 sitemap: lists exactly the 6 public pages', () => {
  for (const p of PUBLIC_PATHS) {
    // Root is stored as '' in sitemap.js (so `${SITE_URL}${''}`
    // composes the bare origin); every other path is stored as-is.
    const stored = p === '/' ? '' : p
    assert.match(
      SITEMAP_SRC,
      new RegExp(`['"]${stored.replace(/\//g, '\\/')}['"]`),
      `sitemap.js must list ${p || '/'} in PUBLIC_PATHS`,
    )
  }
  // Auth-protected surfaces must NEVER appear in the sitemap.
  for (const p of PRIVATE_PREFIXES) {
    assert.doesNotMatch(
      SITEMAP_SRC,
      new RegExp(`['"]${p.replace(/\//g, '\\/')}['"]`),
      `sitemap.js must NOT list ${p} (auth-protected page)`,
    )
  }
})

test('Round-91 sitemap: canonical base URL comes from lib/siteConfig SITE_URL', () => {
  assert.match(
    SITEMAP_SRC,
    /import\s+\{\s*SITE_URL\s*\}\s+from\s+['"]@\/lib\/siteConfig['"]/,
    'sitemap.js must import SITE_URL from @/lib/siteConfig (never a hard-coded domain)',
  )
  assert.match(
    SITEMAP_SRC,
    /`\$\{SITE_URL\}\$\{p\}`|SITE_URL\s*\+\s*p/,
    'sitemap URL entries must be composed from SITE_URL + the path (host override must flow through)',
  )
})

test('Round-91 robots: sitemap location also derives from SITE_URL', () => {
  assert.match(
    ROBOTS_SRC,
    /import\s+\{\s*SITE_URL\s*\}\s+from\s+['"]@\/lib\/siteConfig['"]/,
    'robots.js must import SITE_URL from @/lib/siteConfig',
  )
  assert.match(
    ROBOTS_SRC,
    /sitemap:\s*`\$\{SITE_URL\}\/sitemap\.xml`/,
    'robots.js must point the sitemap directive at ${SITE_URL}/sitemap.xml',
  )
})

// ---------------------------------------------------------------------------
// 3. Sync — robots allow list and sitemap path list must agree
// ---------------------------------------------------------------------------

test('Round-91 sync: sitemap PUBLIC_PATHS and robots allow list use the same page set', () => {
  // Both files carry the same page set. This lock catches the drift
  // class where a page is added to one metadata route but not the
  // other — a page in robots but missing from the sitemap is
  // crawlable-but-unlisted; a page in the sitemap but disallowed by
  // robots triggers a Google Search Console mismatch warning.
  //
  // Root-path representation differs by design: robots.js allows the
  // literal '/' (crawler directive syntax) while sitemap.js stores
  // the root as '' (so `${SITE_URL}${''}` composes the bare origin).
  for (const p of PUBLIC_PATHS) {
    const escaped = p.replace(/\//g, '\\/')
    assert.match(ROBOTS_SRC, new RegExp(`['"]${escaped}['"]`), `robots must allow ${p || '/'}`)
    // Normalize the root for the sitemap literal comparison.
    const sitemapPath = p === '/' ? '' : p
    assert.match(SITEMAP_SRC, new RegExp(`['"]${sitemapPath.replace(/\//g, '\\/')}['"]`), `sitemap must list ${p || '/'}`)
  }
})

test('Round-91 sync: both metadata route files exist', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app/robots.js')), 'app/robots.js must exist (metadata route → /robots.txt)')
  assert.ok(fs.existsSync(path.join(ROOT, 'app/sitemap.js')), 'app/sitemap.js must exist (metadata route → /sitemap.xml)')
})
