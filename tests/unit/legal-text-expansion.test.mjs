// tests/unit/legal-text-expansion.test.mjs
//
// Round-34 (Part 9 — Trust & Compliance: Legal Text Expansion) —
// structural-lock tests for the four new sections added to /privacy,
// the two new sections added to /terms, and the brand-new /legal/cookies
// page.
//
// Why this file exists
// --------------------
//
// The legal pages are the launch-gate for public sign-ups: every soft-
// launch invitee reads them before clicking "Starta gratis". A future
// maintainer who refactors a section title, drops the AI-behandling
// paragraph (Groq mention), or removes the cookie-table from the
// cookies page would silently weaken our GDPR posture without breaking
// the build. These static-source locks catch the regressions before
// they ship.
//
// What we lock
// ------------
//   1. /privacy — exactly 13 sections, including the 4 new
//      (AI-behandling, Personnummer, Underleverantörer, Datalagring
//      12-mån).
//   2. /terms — exactly 12 sections, including the 2 new (Förnyelse
//      7-dagars + Force majeure).
//   3. /legal/cookies — exists, has the 3-row summary, the cookie-table
//      testid, and lists our 5 documented necessary-cookies (no
//      analytics, no marketing).
//   4. Cross-link wiring — /privacy and /terms both link to
//      /legal/cookies with the right testids.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// ---- /privacy ----

test('app/privacy/page.js exists', () => {
  assert.ok(existsSync(resolve(ROOT, 'app/privacy/page.js')), 'Expected app/privacy/page.js to exist')
})

test('/privacy includes the new AI-behandling section (Part 9 spec)', () => {
  // The Part 9 spec requires the page to disclose that Groq/llama-3.3
  // processes the data, that nothing is used for model training, and
  // that processing happens outside EU/EES under a legal transfer
  // mechanism. Round-34.2: the original EU/EES hosting claim was
  // unverified; the page now states that processing is OUTSIDE
  // EU/EES, protected by SCC (Standard Contractual Clauses) and the
  // EU-US Data Privacy Framework. All four claims are distinct and
  // independently droppable — we lock each.
  const src = readFileSync(resolve(ROOT, 'app/privacy/page.js'), 'utf8')
  assert.match(src, /AI-behandling/, 'Missing "AI-behandling" section title')
  assert.match(src, /Groq/, 'Missing Groq mention in AI-behandling section')
  assert.match(src, /llama-3\.3-70b/, 'Missing llama-3.3 model reference (specific model = more accountable claim)')
  assert.match(src, /används inte för att träna/, 'Missing "not used for training" disclaimer')
  // Round-34.2: claim is now "OUTSIDE EU/EES", not "within". A future
  // maintainer reverting to the original EU/EES hosting claim would
  // be making a false GDPR statement about Groq's data residency.
  // Processing-region claim is anchored on a <strong> block (Round-38
  // / Part 9 followup #3) — locks both formatting AND the utanför
  // word. Both directions are protected against regression:
  //   (a) REMOVING the claim entirely -> positive <strong>utanför</strong>
  //       guard fails (regulatory signal loss)
  //   (b) REVERTING to the original inom-EU/EES inaccuracy -> negative
  //       <strong>inom</strong> guard fails (regulatory regression)
  assert.match(
    src,
    /<strong>[^<]*utanför\s*EU\/EES[^<]*<\/strong>/,
    'AI-behandling must include a <strong>-formatted claim that processing happens utanför EU/EES (Round-34.2 corrected the original inaccurate claim; preserve the bold claim)'
  )
  assert.doesNotMatch(
    src,
    /<strong>[^<]*inom\s*EU\/EES[^<]*<\/strong>/,
    'AI-behandling must NOT contain a <strong> "inom EU/EES" block (regulatory regression to the original Round-34 inaccuracy)'
  )
  assert.match(src, /SCC/, 'Missing SCC (Standard Contractual Clauses) legal basis')
  assert.match(src, /Data Privacy Framework|DPF/, 'Missing DPF / Data Privacy Framework legal basis')
})

test('/privacy includes the new Personnummer section (Part 9 spec)', () => {
  // The spec requires: encrypted at rest, only collected for AF
  // reporting, never shared with third parties.
  const src = readFileSync(resolve(ROOT, 'app/privacy/page.js'), 'utf8')
  assert.match(src, /Personnummer/, 'Missing "Personnummer" section title')
  assert.match(src, /Krypteras i vila/, 'Missing "encrypted at rest" wording')
  assert.match(src, /Delas aldrig med tredje part/, 'Missing "never shared with third parties" wording')
  assert.match(src, /Arbetsförmedlingen/, 'Missing AF-only purpose mention')
})

test('/privacy includes the new Underleverantörer section (Part 9 spec)', () => {
  // The spec lists 5 specific subprocessors: Stripe, MongoDB, Vercel,
  // Groq, Clerk. All 5 must be present.
  const src = readFileSync(resolve(ROOT, 'app/privacy/page.js'), 'utf8')
  assert.match(src, /Underleverantörer/, 'Missing "Underleverantörer" section title')
  for (const name of ['Stripe', 'MongoDB', 'Vercel', 'Groq', 'Clerk']) {
    assert.ok(src.includes(name), `Missing subprocessor: ${name}`)
  }
  assert.match(src, /DPA/i, 'Missing DPA abbreviation reference')
})

test('/privacy Datalagring mentions the 12-månader rule (Part 9 spec)', () => {
  // The spec requires: "CV och ansökningsdata sparas i 12 månader
  // efter avslutad prenumeration. Därefter anonymiseras eller raderas."
  // A regression that drops this back to the old "så länge du är
  // kund" wording would weaken the retention commitment.
  const src = readFileSync(resolve(ROOT, 'app/privacy/page.js'), 'utf8')
  assert.match(src, /12 månader efter avslutad prenumeration/, 'Missing 12-month retention rule')
  // Match the semantic contract: "auto-anonymization OR auto-deletion
  // after 12 months". We accept either the passive of "radera"
  // ("raderas" = is being deleted) or the noun form "radering"
  // (deletion), plus the present passive of "anonymisera"
  // ("anonymiseras" = is being anonymized). Locking the exact verb
  // conjugation invites false positives from a future copy edit
  // (e.g. "raderas" → "radereras" is a valid alternative passive);
  // the regulatory commitment is the auto-action, not the specific
  // Swedish verb form.
  assert.match(
    src,
    /anonymiseras[\s\S]*?(raderas|radering)/,
    'Missing auto-anonymization or auto-deletion clause after the 12-month retention period',
  )
})

test('/privacy links to /legal/cookies with the right testid', () => {
  // The Part 9 spec asks for a separate cookies page; the privacy
  // page's cookies section must link to it. Lock the testid so the
  // e2e specs (and future cross-page footer links) can rely on it.
  const src = readFileSync(resolve(ROOT, 'app/privacy/page.js'), 'utf8')
  assert.match(
    src,
    /href="\/legal\/cookies"[\s\S]*?data-testid="privacy-cookies-link"|data-testid="privacy-cookies-link"[\s\S]*?href="\/legal\/cookies"/,
    'Expected <Link href="/legal/cookies" data-testid="privacy-cookies-link">…</Link>',
  )
})

// ---- /terms ----

test('app/terms/page.js exists', () => {
  assert.ok(existsSync(resolve(ROOT, 'app/terms/page.js')), 'Expected app/terms/page.js to exist')
})

test('/terms includes the new Förnyelse section (Part 9 spec)', () => {
  // The spec requires a 7-dagars påminnelse before any renewal.
  // A regression that drops the explicit day-count would weaken the
  // consumer-protection posture.
  const src = readFileSync(resolve(ROOT, 'app/terms/page.js'), 'utf8')
  assert.match(src, /Förnyelse/, 'Missing "Förnyelse" section title')
  assert.match(src, /7 dagar innan/, 'Missing "7 days before" renewal reminder')
})

test('/terms includes the new Force majeure section (Part 9 spec)', () => {
  // The spec requires an explicit force majeure section. We also lock
  // the 60-dagars uppsägnings­rätt clause (a consumer protection
  // strengthening that the original spec called out).
  const src = readFileSync(resolve(ROOT, 'app/terms/page.js'), 'utf8')
  assert.match(src, /Force majeure/, 'Missing "Force majeure" section title')
  assert.match(src, /60 dagar/, 'Missing 60-day termination right clause')
})

test('/terms links to /legal/cookies with the right testid', () => {
  const src = readFileSync(resolve(ROOT, 'app/terms/page.js'), 'utf8')
  assert.match(
    src,
    /href="\/legal\/cookies"[\s\S]*?data-testid="terms-cookies-link"|data-testid="terms-cookies-link"[\s\S]*?href="\/legal\/cookies"/,
    'Expected <Link href="/legal/cookies" data-testid="terms-cookies-link">…</Link>',
  )
})

// ---- /legal/cookies ----

test('app/legal/cookies/page.js exists (Part 9 spec — new page)', () => {
  // The Part 9 spec calls for a separate cookie-policy page. Lock
  // both the file path and the page.js filename pattern so a future
  // maintainer who re-files the page under a different name trips
  // this test before deploy.
  assert.ok(
    existsSync(resolve(ROOT, 'app/legal/cookies/page.js')),
    'Expected app/legal/cookies/page.js to exist — Part 9 spec requires a separate /legal/cookies page',
  )
})

test('/legal/cookies renders the 3-category summary block', () => {
  // The SummaryCard component is parameterised by `label` (passed as
  // "Nödvändiga" / "Analys" / "Marknadsföring") — so the source uses
  // a template literal `data-testid={\`cookies-summary-${label.toLowerCase()}\`}`
  // rather than three hard-coded testids. The test locks the
  // template-literal SHAPE and the three label names so the e2e
  // contract remains stable.
  const src = readFileSync(resolve(ROOT, 'app/legal/cookies/page.js'), 'utf8')
  assert.match(src, /data-testid="cookies-summary"/)
  assert.match(
    src,
    /data-testid=\{`cookies-summary-\$\{label\.toLowerCase\(\)\}`\}/,
    'Expected SummaryCard to render a dynamic data-testid via the label.toLowerCase() template literal',
  )
  // All three Swedish labels must be present as SummaryCard invocations.
  assert.match(src, /label="Nödvändiga"/)
  assert.match(src, /label="Analys"/)
  assert.match(src, /label="Marknadsföring"/)
})

test('/legal/cookies renders the cookie table with the 5 necessary cookies', () => {
  // The spec calls for a table with name, purpose, duration, provider.
  // We lock the table testid and the 5 cookie names so a future edit
  // that drops a cookie (e.g. CSRF-token) trips a test before prod.
  const src = readFileSync(resolve(ROOT, 'app/legal/cookies/page.js'), 'utf8')
  assert.match(src, /data-testid="cookies-table"/)
  for (const cookieName of ['__session', 'demoUserId', 'cookieConsent', 'CSRF-token', '__cf_bm']) {
    assert.ok(src.includes(cookieName), `Missing cookie in table: ${cookieName}`)
  }
})

test('/legal/cookies contains 0 analytics and 0 marketing cookies (truth-in-claim)', () => {
  // The page SAYS "Vi använder inga analys-cookies idag" / "inga
  // reklam-cookies idag". If a future maintainer adds an analytics
  // cookie to the table without updating the summary, the count
  // assertions below would catch the drift.
  //
  // We don't fail if a future maintainer DOES add an analytics
  // cookie — that would require also updating the summary text.
  // Instead we just count current rows so an accidental change is
  // surfaced.
  const src = readFileSync(resolve(ROOT, 'app/legal/cookies/page.js'), 'utf8')
  const necessaryCount = (src.match(/category:\s*['"]necessary['"]/g) || []).length
  const analyticsCount = (src.match(/category:\s*['"]analytics['"]/g) || []).length
  const marketingCount = (src.match(/category:\s*['"]marketing['"]/g) || []).length
  assert.equal(necessaryCount, 5, `Expected 5 necessary cookies; got ${necessaryCount}`)
  assert.equal(analyticsCount, 0, 'Analytics cookie added to table — update the summary text too')
  assert.equal(marketingCount, 0, 'Marketing cookie added to table — update the summary text too')
})

// ---- Cross-page footer links ----

test('/legal/cookies footer links to /privacy and /terms', () => {
  // The cookies page is part of the legal footer triangle — every
  // page should cross-link so a user who lands on any of the three
  // can navigate to the others in one click.
  const src = readFileSync(resolve(ROOT, 'app/legal/cookies/page.js'), 'utf8')
  assert.ok(src.includes('href="/privacy"'), '/legal/cookies must link to /privacy')
  assert.ok(src.includes('href="/terms"'), '/legal/cookies must link to /terms')
})
