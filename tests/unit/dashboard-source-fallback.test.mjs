// Round-58 / Bug 2 -- per-source search-fallback contract-lock test.
//
// Pre-Round-58: SEARCH_VIEW had a single label ('Sok pa Google') that
// fired for EVERY Tier-3 fallback (no direct URL, no externalId).
// The complaint: clicking 'Sok pa Google' for a Blocket-sourced job
// opened a Google search for "{title} {company}" instead of the
// actual Blocket listing -- a label/behaviour mismatch.
//
// Round-58: SOURCE_FALLBACKS array replaces SEARCH_VIEW. Each entry
// has `{ key, match(app), label, Icon, className, title, buildUrl }`.
// resolveSearchFallback(app, profile) picks the first matching
// entry -- 'blocket' for Blocket jobs, 'ledigajobb' for Ledigajobb,
// 'generic' (Google search) as a true last resort for everything
// else.
//
// This file uses the same source-grep / regex pattern as
// tests/unit/af-job-url-resolver.test.mjs so pure node --test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'dashboard', 'page.js'),
  'utf8',
)

// ---------- 1. The SOURCE_FALLBACKS structure ----------

test('Round-58 / Bug 2: dashboard/page.js must declare SOURCE_FALLBACKS (replacing SEARCH_VIEW)', () => {
  assert.match(
    SRC,
    /const\s+SOURCE_FALLBACKS\s*=\s*\[/,
    'dashboard/page.js must declare SOURCE_FALLBACKS as the per-source lookup (Round-58 replacement for SEARCH_VIEW)',
  )
})

test('Round-58 / Bug 2: SEARCH_VIEW must be REMOVED to avoid dual source-of-truth drift', () => {
  // We want the monolithic SEARCH_VIEW object to be gone, so a future
  // maintainer cannot accidentally add a 5th source by editing it.
  assert.doesNotMatch(
    SRC,
    /^const SEARCH_VIEW\s*=\s*\{/m,
    'SEARCH_VIEW must be removed -- SOURCE_FALLBACKS is the new single source of truth (no monolith plus lookup)',
  )
})

test('Round-58 / Bug 2: SOURCE_FALLBACKS must include a Blocket entry', () => {
  assert.match(
    SRC,
    /key:\s*['"]blocket['"][\s\S]{0,400}buildBlocketSearchUrl/,
    'SOURCE_FALLBACKS must have a blocket entry that calls buildBlocketSearchUrl() so Blocket-sourced jobs open Blocket Jobb',
  )
})

test('Round-58 / Bug 2: SOURCE_FALLBACKS must include a Ledigajobb entry', () => {
  assert.match(
    SRC,
    /key:\s*['"]ledigajobb['"][\s\S]{0,400}buildLedigaJobbSearchUrl/,
    'SOURCE_FALLBACKS must have a ledigajobb entry that calls buildLedigaJobbSearchUrl() so Ledigajobb-sourced jobs open Ledigajobb.se',
  )
})

test('Round-58 / Bug 2: SOURCE_FALLBACKS must include a generic Google last-resort entry', () => {
  // The generic entry delegates to buildGoogleSearchUrl() helper -- the literal
  // google.com/search lives in the helper definition, not in the entry body, so the
  // previous in-entry regex is wrong. We assert that the helper is referenced + that
  // a generic catch-all entry exists with the appropriate match function.
  assert.match(
    SRC,
    /key:\s*['"]generic['"][\s\S]{0,800}buildGoogleSearchUrl/,
    'SOURCE_FALLBACKS must have a generic catch-all entry that uses buildGoogleSearchUrl() (the helper that produces google.com/search)',
  )
  assert.match(
    SRC,
    /const\s+buildGoogleSearchUrl\s*=/,
    'buildGoogleSearchUrl() helper must exist so the generic fallback can construct the URL',
  )
})

test('Round-58 / Bug 2: SOURCE_FALLBACKS entries must own their own presentation (className)', () => {
  assert.match(
    SRC,
    /key:\s*['"]blocket['"][\s\S]{0,400}border-blue-300/,
    'blocket entry must use brand-matching blue border (same as BroaderSearchCard) so colour matches source identity',
  )
  assert.match(
    SRC,
    /key:\s*['"]ledigajobb['"][\s\S]{0,400}border-emerald-300/,
    'ledigajobb entry must use brand-matching emerald border for the same reason',
  )
})

// ---------- 2. The resolveSearchFallback helper ----------

test('Round-58 / Bug 2: dashboard/page.js must declare resolveSearchFallback(app, profile)', () => {
  assert.match(
    SRC,
    /function\s+resolveSearchFallback\s*\(\s*app\s*,\s*profile\s*\)/,
    'dashboard/page.js must declare resolveSearchFallback(app, profile) -- pure function for testability',
  )
})

// ---------- 3. The render integration ----------

test('Round-58 / Bug 2: render code must use searchFallback (not SEARCH_VIEW) for Tier-3 fallback', () => {
  // Look for ternary `view = isSearch ? searchFallback : HAS_URL_VIEW` line
  assert.match(
    SRC,
    /view\s*=\s*isSearch\s*\?\s*searchFallback\s*:\s*HAS_URL_VIEW/,
    'render must use searchFallback when isSearch (Tier-3) and HAS_URL_VIEW otherwise -- single display source',
  )
})

test('Round-58 / Bug 2: render code must derive finalHref from searchFallback.buildUrl()', () => {
  assert.match(
    SRC,
    /finalHref\s*=\s*fallbackUrl\s*\|\|/,
    'render must derive finalHref from fallbackUrl || prepAppUrl.url so per-source URLs win over prepAppUrl.url',
  )
})

test('Round-58 / Bug 2: <a href={finalHref}> not <a href={prepAppUrl.url}>', () => {
  assert.match(
    SRC,
    /<a\s+href=\{finalHref\}/,
    'render must use finalHref so the per-source URL is wired through',
  )
  assert.doesNotMatch(
    SRC,
    /<a\s+href=\{prepAppUrl\.url\}/,
    'render must NOT use prepAppUrl.url directly (would lose per-source routing)',
  )
})

// ---------- 4. Contract preservation ----------

test('Round-58 / Bug 2: resolveApplicationUrl 3-tier chain must still return source: search', () => {
  // Round-56 contract-lock test -- this confirms we did NOT remove
  // the 3-tier resolver just because we changed the presentation.
  assert.match(
    SRC,
    /function\s+resolveApplicationUrl\s*\([^)]*\)\s*\{[\s\S]{0,800}source:\s*['"]search['"]/,
    'resolveApplicationUrl must STILL return source: search so the Tier-3 branch lights up',
  )
})

test('Round-58 / Bug 2: Per-source match must be case-insensitive substring (handles "Blocket Jobb", "Ledigajobb.se")', () => {
  assert.match(
    SRC,
    /(app|app\?)\s*\.\s*source[\s\S]{0,80}\.toLowerCase\(\)\s*\.\s*includes/,
    'matchesJobSource must use case-insensitive substring (handles "Blocket Jobb", "Ledigajobb.se")',
  )
})
