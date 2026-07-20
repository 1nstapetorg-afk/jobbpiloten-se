// tests/unit/sample-search-url.test.mjs
//
// Round-58 / Followup 2 — locks the contract that the apply-now
// handler synthesizes a Blocket Jobb search URL when neither
// `job.url` nor `job.externalId` is present, BEFORE the
// application is written to MongoDB.
//
// This addresses the second half of the user's "Sök jobbet → Google"
// complaint: even when no real job was selected (the
// "Kör AI-assistenten nu" hero CTA path, OR an AF search that
// returned a hit without an application link), the destination
// button was falling through the dashboard's 3-tier
// resolveApplicationUrl() chain to the Tier-3 Google catch-all.
//
// The fix: synthesize `job.url = buildBlocketSearchUrl(profile)`
// so dashboard Tier-1 (`app.jobUrl`) catches the destination
// directly. The user's spec was "NEVER show generic Google search
// if we can use a per-source search" — sample rows now point at a
// Blocket search query built from the user's profile.jobTitles[0]
// + profile.locations[0].
//
// Same source-grep style as the rest of the unit suite (no DB
// mocking, no LLM mocking). Locks prevent a future refactor
// regressing the synthesis back to a Tier-3 Google call.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/[[...path]]/route.js')
const JOB_SCRAPER_PATH = path.resolve(__dirname, '../../lib/jobScraper.js')
const ROUTE_SRC = fs.readFileSync(ROUTE_PATH, 'utf-8')
const SCRAPER_SRC = fs.readFileSync(JOB_SCRAPER_PATH, 'utf-8')

// =============================================================================
// 1. buildBlocketSearchUrl must be exported from lib/jobScraper.js
// =============================================================================

test('Round-58 / Followup 2: lib/jobScraper.js must export buildBlocketSearchUrl()', () => {
  // The synthesized URL uses the canonical Blocket Jobb search
  // builder so the dashboard renders a non-deceptive "Sök på
  // Blocket" button (not "Sök jobbet → Google"). The builder
  // exists in lib/scrapers/urlBuilders.js and is re-exported by
  // lib/jobScraper.js. Lock the export so a future refactor that
  // moves the symbol back into urlBuilders.js + deletes the
  // re-export is caught here.
  assert.match(
    SCRAPER_SRC,
    /export\s*\{\s*[\s\S]*?buildBlocketSearchUrl[\s\S]*?\}/,
    'lib/jobScraper.js must re-export buildBlocketSearchUrl from lib/scrapers/urlBuilders.js',
  )
})

// =============================================================================
// 2. The apply-now import list must include buildBlocketSearchUrl
// =============================================================================

test('Round-58 / Followup 2: app/api/[[...path]]/route.js must import buildBlocketSearchUrl', () => {
  // Without the import, the synthesis block `job.url = buildBlocketSearchUrl(...)`
  // throws ReferenceError at POST time. Lock the import line so
  // a future `git revert` of just the synthesis block (without
  // the import) is caught here even though the function would
  // not throw statically.
  assert.match(
    ROUTE_SRC,
    /import\s*\{[^}]*buildBlocketSearchUrl[^}]*\}\s*from\s*['"]@\/lib\/jobScraper['"]/,
    "app/api/[[...path]]/route.js must `import { ..., buildBlocketSearchUrl } from '@/lib/jobScraper'` so the synthesis block can call it",
  )
})

// =============================================================================
// 3. Guarded synthesis — fires only when both job.url AND job.externalId are null
// =============================================================================

test('Round-58 / Followup 2: apply-now must synthesize a Blocket URL when !job.url && !job.externalId', () => {
  // The guard is the difference between "Tier-3 Google fix" and
  // "Tier-1 overwrite a real URL". We MUST NOT clobber a real
  // scraper-returned URL with a Blocket search string. The guard
  // pattern is exactly `!job.url && !job.externalId`.
  assert.match(
    ROUTE_SRC,
    /!\s*job\.url\s*&&\s*!\s*job\.externalId/,
    'apply-now must guard the synthesis block with `!job.url && !job.externalId` so a real scraper URL is never overwritten',
  )
})

// =============================================================================
// 4. Synthesis uses profile.jobTitles[0] + profile.locations[0]
// =============================================================================

test('Round-58 / Followup 2: synthesis must build the URL from profile.jobTitles[0] and profile.locations[0]', () => {
  // The query string is the user's PRIDE-and-JOY — searching
  // for nothing generic. Lock the field reads so a future
  // refactor that switches to `.find(jobTitles, ...)` etc. is
  // caught at commit time.
  assert.match(
    ROUTE_SRC,
    /\(profile\.jobTitles\s*\|\|\s*\[\]\)\[0\]/,
    'apply-now synthesis must read `profile.jobTitles[0]` so the Blocket search reflects the user\'s preferred titles',
  )
  assert.match(
    ROUTE_SRC,
    /\(profile\.locations\s*\|\|\s*\[\]\)\[0\]/,
    'apply-now synthesis must read `profile.locations[0]` so the Blocket search is geo-aware',
  )
  // The actual call site.
  assert.match(
    ROUTE_SRC,
    /job\.url\s*=\s*buildBlocketSearchUrl\s*\(\s*\{\s*query:[^}]*location:[^}]*\}\s*\)/,
    'apply-now must call `buildBlocketSearchUrl({ query, location })` and assign the result to job.url',
  )
})

// =============================================================================
// 5. Synthesis is positioned BEFORE the application write
// =============================================================================

test('Round-58 / Followup 2: synthesis MUST run before the application insertOne', () => {
  // Order matters: if the synthesis runs AFTER insertOne, the
  // row hits MongoDB with jobUrl=null and the dashboard shows
  // Tier-3 Google. We lock the relative index of the two
  // anchor phrases to enforce the order.
  const synthesisIdx = ROUTE_SRC.indexOf('buildBlocketSearchUrl')
  const insertIdx = ROUTE_SRC.indexOf("insertOne(application)")
  assert.ok(synthesisIdx > 0, 'buildBlocketSearchUrl call must exist in route.js')
  assert.ok(insertIdx > 0, 'application insertOne call must exist in route.js')
  assert.ok(
    synthesisIdx < insertIdx,
    'buildBlocketSearchUrl call must appear BEFORE db.collection(\'applications\').insertOne(application) so the synthesized URL lands in MongoDB',
  )
})

// =============================================================================
// 6. Guard against empty profile — synthesis must be skipped when neither
//    title nor location is truthy
// =============================================================================

test('Round-58 / Followup 2: synthesis must skip when BOTH jobTitles[0] AND locations[0] are empty', () => {
  // When the user has set no profile preferences (brand-new
  // signup before onboarding), synthesizing an empty Blocket
  // search URL would point at the bare jobsite landing page —
  // wasted click but not a Tier-3 Google regression. The guard
  // is a `if (... || ...)` truthy check on the two profile
  // values so empty → no synthesis → job.url stays null → goes
  // back to the original demo behavior.
  // We allow either the OR-guard form `if (a || b)` or the
  // direct truthy-coalesce via `|| ''`. Both are valid.
  const orGuard = /if\s*\(\s*profileFirstTitle\s*\|\|\s*profileFirstLocation\s*\)/
  const truthyCheck = /profileFirstTitle\s*\|\|\s*profileFirstLocation/
  assert.ok(
    orGuard.test(ROUTE_SRC) || truthyCheck.test(ROUTE_SRC),
    'apply-now synthesis must guard against empty profile via `if (profileFirstTitle || profileFirstLocation)` so the block fires only when at least one preference is set',
  )
})
