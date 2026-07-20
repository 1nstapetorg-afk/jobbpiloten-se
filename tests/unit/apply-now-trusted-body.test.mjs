// tests/unit/apply-now-trusted-body.test.mjs
//
// Round-58 / Bug 2 — locks the `apply-now` trusted-body branch
// that was added to fix the "Sök jobbet → Google search" complaint
// for Blocket and Ledigajobb-sourced jobs.
//
// Pre-Round-58: the apply-now handler unconditionally fell into the
// legacy `af-` branch or the re-search + sample fallback whenever
// the body's jobId didn't start with `af-`. A Blocket card click
// (`jobId: 'blocket-123'`) sent to the handler was rewritten with
// a freshly-searched AF job matching the user's profile, and any
// row that survived all fallbacks had no `externalId` or `url`,
// so the dashboard's resolveApplicationUrl() 3-tier chain hit the
// Tier-3 Google search branch. The user-visible symptom was
// "Sök jobbet → Google" for an obviously-Blocket listing.
//
// This file is a source-grep contract — same shape as
// tests/unit/af-job-url-resolver.test.mjs and
// tests/unit/round51-soft-launch-bugs.test.mjs. We don't mock
// mongodb/MongoClient/NextResponse; the static-grep pattern is
// the established repo convention (no DB tests in this codebase).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/[[...path]]/route.js')
const SRC = fs.readFileSync(ROUTE_PATH, 'utf-8')

// =============================================================================
// 1. Known source prefixes — must include af-, blocket-, AND ledigajobb-
// =============================================================================

test('Round-58 / Bug 2: apply-now must recognise af-, blocket-, and ledigajobb- jobId prefixes', () => {
  // The trusted-body branch fires for any of these three prefixes.
  // Locking them prevents a future maintainer from dropping one
  // prefix (the most likely footgun when a new scraper is added)
  // and silently regressing that source's "Sök jobbet → Google"
  // symptom.
  for (const prefix of ['af-', 'blocket-', 'ledigajobb-']) {
    const re = new RegExp(`jobId\\.startsWith\\(['"]${prefix.replace(/[-]/g, '\\-')}['"]\\)`)
    assert.ok(
      re.test(SRC),
      `apply-now must check jobId.startsWith('${prefix}') so ${prefix}xxx jobs are trusted without a re-search`,
    )
  }
  // AND the three must be combined into a single gate so the
  // branches fire together. Either via an `||` cascade OR via an
  // `isKnownSource` boolean — both shapes are accepted, but the
  // cascade must be exhaustive.
  const cascadeMatch = /jobId\.startsWith\(['"]af-['"][^|]*\|{2}[^|]*jobId\.startsWith\(['"]blocket-['"][^|]*\|{2}[^|]*jobId\.startsWith\(['"]ledigajobb-['"]\)/s
  assert.ok(
    cascadeMatch.test(SRC),
    'apply-now must combine af- + blocket- + ledigajobb- into one trusted-body gate',
  )
})

// =============================================================================
// 2. Trust gate — body must have non-empty title AND (url OR externalId)
// =============================================================================

test('Round-58 / Bug 2: apply-now trusted-body gate must require title + (jobUrl OR externalId)', () => {
  // The trust gate is the Line of Defense against a "thin body"
  // Blocket/Ledigajobb payload shipping a 1:1 application with
  // no usable application link. The dashboard's Tier-3 Google
  // fallback would then fire. The gate fires only when:
  //   - title is a non-empty string
  //   - bodyUrl is truthy OR parsedExternalId is truthy
  assert.match(
    SRC,
    /canTrustBody/,
    'apply-now must declare a canTrustBody gate variable',
  )
  assert.match(
    SRC,
    /title\.trim\(\)\.length\s*>\s*0/,
    'canTrustBody must require a non-empty trimmed title so blank-title payloads fall through to re-search',
  )
  // The body-url OR externalId branch.
  assert.match(
    SRC,
    /\(bodyUrl\s*\|\|\s*parsedExternalId\)/,
    'canTrustBody must accept bodyUrl OR parsedExternalId as the application link source',
  )
})

// =============================================================================
// 3. Direct job assignment — must build a 1:1 record WITHOUT falling through to re-search
// =============================================================================

test('Round-58 / Bug 2: apply-now must assign the trusted-body job object directly without a re-search call', () => {
  // The pre-fix code only had `if (jobId && jobId.startsWith('af-'))`
  // which used the same near-identical shape but missed
  // blocket-/ledigajobb-, AND `if (!job) { realPicked = ... }` which
  // re-searched AF for any non-af jobId. Both branches must NOT
  // re-post the user's clicked card. The trusted-body branch
  // shape is verified by the proximity of three field literals
  // to the SAME `job = {` block:
  //   (a) `id: jobId` — uses the body's jobId verbatim (no re-derivation)
  //   (b) `externalId: parsedExternalId` — the body-preferred-or-prefix-derived id
  //   (c) `url: bodyUrl` — uses the dual-read jobUrl/url body field
  // Whitespace + inline comments can sit between tokens, so we
  // simply assert each literal is present AND that all three
  // live within a single 1000-char window of each other (small
  // enough that they must be in the same `job = {...}` literal).
  // Belt-and-braces: the re-search fallback assigns
  // `id: realPicked.id`, NOT `id: jobId`, so the `id: jobId`
  // token is unique to the trusted-body branch.
  const idJobIdIdx = SRC.indexOf('id: jobId,')
  const externalIdIdx = SRC.indexOf('externalId: parsedExternalId')
  const urlBodyUrlIdx = SRC.indexOf('url: bodyUrl')
  assert.ok(
    idJobIdIdx > 0,
    'apply-now trusted-body branch must assign `id: jobId` so the body\'s jobId is preserved verbatim (no re-search)',
  )
  assert.ok(
    externalIdIdx > 0,
    'apply-now trusted-body branch must assign `externalId: parsedExternalId` (body-preferred, prefix-derived fallback)',
  )
  assert.ok(
    urlBodyUrlIdx > 0,
    'apply-now trusted-body branch must assign `url: bodyUrl` (dual-read jobUrl/url)',
  )
  // Proximity check: all three live in the SAME `job = {...}` literal.
  // 1000 chars is generous enough to span inline comment blocks but
  // tight enough that a re-search branch's job object (which uses
  // `id: realPicked.id`) can't accidentally satisfy the lock.
  const minIdx = Math.min(idJobIdIdx, externalIdIdx, urlBodyUrlIdx)
  const maxIdx = Math.max(idJobIdIdx, externalIdIdx, urlBodyUrlIdx)
  assert.ok(
    maxIdx - minIdx < 1000,
    `apply-now trusted-body job-object literals must live in the SAME block; spread was ${maxIdx - minIdx} chars (limit 1000)`,
  )
})

// =============================================================================
// 4. Dual-read jobUrl — accept canonical jobUrl OR legacy url
// =============================================================================

test('Round-58 / Bug 2: apply-now must accept either jobUrl OR legacy url from the body', () => {
  // Belt-and-braces so the dashboard can rename its field across
  // deploys without a server-side coordinated cutover. The dual
  // read pattern is: `body.jobUrl || body.url || null`.
  assert.match(
    SRC,
    /body\.jobUrl\s*\|\|\s*body\.url\s*\|\|\s*null/,
    'apply-now must read candidateUrl from "body.jobUrl || body.url || null" so legacy clients still work',
  )
  // externalId must be coerced via String() so a number typed in
  // accidentally doesn't crash the Mongo write.
  assert.match(
    SRC,
    /body\.externalId\s*!=\s*null\s*\?\s*String\(body\.externalId\)\s*:\s*null/,
    'apply-now must coerce candidateExternalId via String() before writing to MongoDB',
  )
})

// =============================================================================
// 5. Re-search fallback must NOT fire when the trusted-body branch claims the job
// =============================================================================

test('Round-58 / Bug 2: apply-now re-search fallback must be guarded by `if (!job)`', () => {
  // After the trusted-body branch sets `job`, the re-search +
  // sample block must be gated by `if (!job)` so a successful
  // 1:1 trust write doesn't trigger the AF re-search waterfall
  // (which would silently overwrite the user's clicked card with
  // a freshly-searched AF job). We assert the `if (!job)` guard
  // sits BEFORE the `realPicked` assignment.
  const reSearchIdx = SRC.indexOf('realPicked')
  const noJobGuardIdx = SRC.lastIndexOf('if (!job)', reSearchIdx)
  assert.ok(reSearchIdx > 0, 'the re-search `realPicked` block must exist')
  assert.ok(
    noJobGuardIdx > 0 && noJobGuardIdx < reSearchIdx,
    'the re-search / sample fallback block must be guarded by `if (!job)` so trusted-body writes aren\'t overwritten',
  )
})

// =============================================================================
// 6. Application write must include BOTH jobUrl AND externalId (Tier-1 + Tier-2)
// =============================================================================

test('Round-58 / Bug 2: apply-now application write must persist jobUrl AND externalId', () => {
  // The application record needs both fields so the dashboard's
  // resolveApplicationUrl() 3-tier chain can find:
  //   - Tier 1: applications.jobUrl  — direct application link
  //   - Tier 2: applications.externalId — constructed Platsbanken fallback
  // Missing externalId would collapse Tier-2 also to Tier-3 Google.
  assert.match(
    SRC,
    /jobUrl:\s*job\.url\s*\|\|\s*null/,
    'apply-now must persist `jobUrl: job.url || null` so Tier-1 always has a non-undefined field',
  )
  assert.match(
    SRC,
    /externalId:\s*job\.externalId\s*\|\|\s*null/,
    'apply-now must persist `externalId: job.externalId || null` so Tier-2 (Platsbanken) can be constructed when no direct URL is present',
  )
})
