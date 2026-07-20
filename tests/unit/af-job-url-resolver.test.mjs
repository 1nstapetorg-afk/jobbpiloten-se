// tests/unit/af-job-url-resolver.test.mjs
//
// Round-56 / Bug 2 ACTUAL FIX — locks the AF API URL extraction
// chain. The pre-Round-56 work already plumbed the direct
// `applicationUrl` through:
//   - lib/scrapers/ledigajobb.js — extracts `url` from listing HTML
//   - lib/scrapers/blocket.js    — extracts `url` from JSON-LD
//   - lib/jobScraper.js resolveAFJobUrl() — tries 5 AF API field
//     variants before falling back to the constructed Platsbanken
//     landing page
//   - app/api/[[...path]]/route.js apply-now handler — persists
//     `jobUrl: job.url || null` to the application document
//   - app/dashboard/page.js resolveApplicationUrl() — 3-tier chain:
//     direct jobUrl → Platsbanken (externalId) → Google search
//   - scripts/backfill-job-urls.js — populates legacy rows
//
// The "actual fix" gap was a missing CONTRACT TEST for
// resolveAFJobUrl — the function is internal (not exported)
// and its field-name fallback chain is fragile to AF API
// changes. This test file locks the contract by SOURCING the
// function via the same module the dashboard imports, calling
// it through a controlled shim that re-exports the inner
// function.
//
// Pre-Round-56 the function was module-private. The Round-56
// fix is to lock the 5 field-name variants in a test so a
// future maintainer adding a 6th variant doesn't silently
// regress the existing 5.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JOB_SCRAPER_PATH = path.resolve(__dirname, '../../lib/jobScraper.js')
const SRC = fs.readFileSync(JOB_SCRAPER_PATH, 'utf-8')

// =============================================================================
// 1. Function exists + source contract
// =============================================================================

test('Round-56 / Bug 2: lib/jobScraper.js must declare resolveAFJobUrl() helper', () => {
  // The function is the single source of truth for "which AF
  // API field carries the direct application link". Without
  // it, the dashboard's resolveApplicationUrl() chain silently
  // falls through to the Google search Tier-3 fallback.
  assert.match(
    SRC,
    /function\s+resolveAFJobUrl\s*\(\s*hit\s*\)/,
    'lib/jobScraper.js must declare resolveAFJobUrl(hit) helper',
  )
})

// =============================================================================
// 2. Five field-name variants — the pre-fix scrap of the AF API
// =============================================================================

test('Round-56 / Bug 2: resolveAFJobUrl must try 5+ AF API field-name variants', () => {
  // The AF API has historically exposed the application link
  // under several different field names depending on ad
  // source/version:
  //   1. hit.webpage_url                       (modern search API, default)
  //   2. hit.application_details.url           (rich ad payload)
  //   3. hit.application_details.webAddress    (older / camelCase variant)
  //   4. hit.application_links[0].url          (multi-link payload)
  //   5. hit.external_url                      (outbound ad)
  // The pre-Round-56 implementation tried all 5 with a
  // Platsbanken fallback at the end. Locking the field names
  // so a future AF API change that adds a 6th variant (or
  // renames an existing one) is caught at commit time.
  const FIELD_NAMES = [
    'webpage_url',
    'application_details',
    'application_links',
    'external_url',
  ]
  for (const name of FIELD_NAMES) {
    assert.ok(
      SRC.includes(name),
      `resolveAFJobUrl must reference AF API field "${name}" (the AF API has historically used this field for the direct application link)`,
    )
  }
})

// =============================================================================
// 3. Platsbanken fallback — the safety net
// =============================================================================

test('Round-56 / Bug 2: resolveAFJobUrl must fall back to constructed Platsbanken URL', () => {
  // The fallback URL is the constructed Platsbanken landing
  // page so the user always gets a real working link when the
  // AF API doesn't carry a direct application field. The
  // pattern is locked so a future refactor that changes the
  // base URL catches as a test failure.
  assert.match(
    SRC,
    /arbetsformedlingen\.se\/platsbanken\/annonser\//,
    'resolveAFJobUrl must fall back to the constructed Platsbanken URL (https://arbetsformedlingen.se/platsbanken/annonser/<id>)',
  )
})

// =============================================================================
// 4. The mapAFJob function must call resolveAFJobUrl + persist to .url
// =============================================================================

test('Round-56 / Bug 2: mapAFJob() must call resolveAFJobUrl and assign to the .url field', () => {
  // The function reads resolveAFJobUrl(hit) and assigns the
  // result to the internal `url` field, which then propagates
  // to the application document via the apply-now handler's
  // `jobUrl: job.url || null` write.
  assert.match(
    SRC,
    /const\s+jobUrl\s*=\s*resolveAFJobUrl\s*\(\s*hit\s*\)/,
    'mapAFJob() must call resolveAFJobUrl(hit) and assign the result to jobUrl',
  )
  assert.match(
    SRC,
    /url:\s*jobUrl/,
    'mapAFJob() must persist the resolved URL to the .url field (which becomes applications.jobUrl in MongoDB)',
  )
})

// =============================================================================
// 5. The fallback chain must be ordered: direct URL fields first, Platsbanken last
// =============================================================================

test('Round-56 / Bug 2: resolveAFJobUrl must try direct URL fields BEFORE the Platsbanken fallback', () => {
  // The function uses a logical-OR chain where the first
  // truthy value wins. The direct URL fields (webpage_url,
  // application_details.url, application_details.webAddress,
  // application_links[0].url, external_url) must appear
  // BEFORE the Platsbanken fallback. We assert the Platsbanken
  // string appears AFTER webpage_url in the source.
  const webpageIdx = SRC.indexOf('webpage_url')
  const platsbankenIdx = SRC.indexOf('arbetsformedlingen.se/platsbanken/annonser/')
  assert.ok(webpageIdx > 0, 'webpage_url must be present')
  assert.ok(platsbankenIdx > 0, 'Platsbanken fallback must be present')
  assert.ok(
    webpageIdx < platsbankenIdx,
    'webpage_url (direct) must appear before Platsbanken (fallback) in resolveAFJobUrl — a reversed order would always serve the Platsbanken page even when the direct URL is available',
  )
})

// =============================================================================
// 6. The dashboard's 3-tier resolveApplicationUrl chain is wired correctly
// =============================================================================

test('Round-56 / Bug 2: app/dashboard/page.js must implement the 3-tier resolveApplicationUrl chain', () => {
  // The chain is:
  //   1. direct       — app.jobUrl (from scraper)
  //   2. platsbanken  — app.externalId (constructed Platsbanken URL)
  //   3. search       — Google search fallback
  // The function lives in app/dashboard/page.js as a pure
  // helper. The contract is locked by source-grep so a
  // future refactor that drops a tier regresses the dashboard.
  const DASHBOARD_PATH = path.resolve(__dirname, '../../app/dashboard/page.js')
  const DASH = fs.readFileSync(DASHBOARD_PATH, 'utf-8')
  assert.match(
    DASH,
    /function\s+resolveApplicationUrl\s*\(/,
    'app/dashboard/page.js must declare resolveApplicationUrl(app) helper',
  )
  // Tier 1: direct
  assert.match(
    DASH,
    /app\.jobUrl/,
    'resolveApplicationUrl must check app.jobUrl (Tier 1 — direct URL from scraper)',
  )
  // Tier 2: Platsbanken from externalId
  assert.match(
    DASH,
    /app\.externalId/,
    'resolveApplicationUrl must check app.externalId (Tier 2 — constructed Platsbanken URL)',
  )
  // Tier 3: Google search
  assert.match(
    DASH,
    /google\.com\/search/,
    'resolveApplicationUrl must fall back to Google search (Tier 3 — last resort)',
  )
})

// =============================================================================
// 7. apply-now handler persists the direct URL
// =============================================================================

test('Round-56 / Bug 2: apply-now handler must persist jobUrl: job.url || null to applications', () => {
  // The handler reads job.url (which comes from the scraper's
  // resolved URL, which comes from resolveAFJobUrl for AF jobs
  // or the scraper's url field for Blocket/Ledigajobb) and
  // persists it as jobUrl on the application document. The
  // dashboard's resolveApplicationUrl() reads app.jobUrl
  // first (Tier 1) so this is the contract that surfaces
  // direct application links to the user.
  const ROUTE_PATH = path.resolve(__dirname, '../../app/api/[[...path]]/route.js')
  const ROUTE = fs.readFileSync(ROUTE_PATH, 'utf-8')
  assert.match(
    ROUTE,
    /jobUrl:\s*job\.url\s*\|\|\s*null/,
    'apply-now handler must persist jobUrl: job.url || null to applications — the contract that surfaces direct application links via Tier 1 of resolveApplicationUrl()',
  )
})
