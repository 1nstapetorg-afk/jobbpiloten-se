// tests/unit/extension-email-body-route.test.mjs
//
// Round-46 / Bug 1 — endpoint validation contract tests.
//
// Lock the route's Zod schema (allowing optional jobUrl,
// jobTitle, company, lang) so a future refactor that breaks the
// extension→server contract fails loudly here rather than at
// runtime. Authentication, rate limit, and the actual LLM call
// are exercised against live Mongo / Groq in the e2e suite —
// unit-level locks here cover the SCHEMA only so the test stays
// fast and deterministic.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/extension/email-body/route.js')
const SCHEMA_PATH = path.resolve(__dirname, '../../lib/extension-profile.js')
const ROUTE_SRC = fs.readFileSync(ROUTE_PATH, 'utf-8')
const SCHEMA_SRC = fs.readFileSync(SCHEMA_PATH, 'utf-8')

// =============================================================================
// 1. Route must export POST + GET
// =============================================================================

test('Bug 1: /api/extension/email-body must export POST + GET handlers', () => {
  assert.match(ROUTE_SRC, /export\s+async\s+function\s+POST\s*\(/, 'POST handler must be exported')
  assert.match(ROUTE_SRC, /export\s+async\s+function\s+GET\s*\(/, 'GET handler must be exported (returns 405)')
})

// =============================================================================
// 2. Route must require bearer token (mirror auth pattern of sister routes)
// =============================================================================

test('Bug 1: route must enforce Bearer token auth via resolveClerkId()', () => {
  assert.match(ROUTE_SRC, /resolveClerkId\s*\(/, 'route must gate on resolveClerkId()')
  assert.ok(
    /Ogiltig eller saknad token/.test(ROUTE_SRC),
    'route must return a Swedish 401 error on missing/invalid token',
  )
})

// =============================================================================
// 3. Route must import + use the Zod schema
// =============================================================================

test('Bug 1: route must use ExtensionEmailBodySchema.safeParse', () => {
  assert.ok(
    /ExtensionEmailBodySchema\.safeParse/.test(ROUTE_SRC),
    'route must validate body via ExtensionEmailBodySchema.safeParse (parity with sister routes)',
  )
})

test('Bug 1: Zod schema must accept {jobUrl?, jobTitle?, company?, lang?} with optional defaults', () => {
  // Locate the schema export in lib/extension-profile.js.
  const schemaBlock = SCHEMA_SRC.match(/ExtensionEmailBodySchema[^]*?z\.object[^]*?\}\)\s*$|ExtensionEmailBodySchema[^]*?z\.object[^]*?\n\}\)/m) || ['']
  // All fields are optional (the LLM can produce a useful email
  // even on a near-empty payload — better UX than a 400).
  assert.ok(/jobUrl:[\s\S]*?optional/i.test(schemaBlock[0]), 'jobUrl must be optional in the Zod schema')
  assert.ok(/jobTitle:[\s\S]*?optional/i.test(schemaBlock[0]), 'jobTitle must be optional')
  assert.ok(/company:[\s\S]*?optional/i.test(schemaBlock[0]), 'company must be optional')
  assert.ok(/lang:[\s\S]*?optional/i.test(schemaBlock[0]), 'lang must be optional')
})

// =============================================================================
// 4. Route must rate-limit (in-memory, per-token)
// =============================================================================

test('Bug 1: route must enforce a per-token sliding-window rate limit', () => {
  assert.match(ROUTE_SRC, /checkRateLimit\s*\(/, 'route must call checkRateLimit()')
  assert.match(ROUTE_SRC, /RATE_LIMIT_WINDOW_MS\s*=/, 'route must declare its own RATE_LIMIT_WINDOW_MS')
  assert.match(ROUTE_SRC, /RATE_LIMIT_MAX\s*=/, 'route must declare RATE_LIMIT_MAX')
  // 10/hour — lower than per-field answer route (20/hour) because
  // each call generates ~3x the body tokens.
  assert.match(ROUTE_SRC, /RATE_LIMIT_MAX\s*=\s*10/, 'rate limit must be 10/hr (consumes more tokens than per-field answers)')
  assert.ok(
    /__jobbpilotenEmailBodyBuckets/.test(ROUTE_SRC),
    'route must use a module-scoped Map for rate-limit state (mirrors sibling routes)',
  )
})

// =============================================================================
// 5. Route must scrape job description + call generateEmailBody + increment usage
// =============================================================================

test('Bug 1: route must call fetchJobDescription + generateEmailBody', () => {
  assert.match(ROUTE_SRC, /fetchJobDescription/, 'route must scrape job description when jobUrl is present')
  assert.match(ROUTE_SRC, /generateEmailBody/, 'route must call generateEmailBody with {jobTitle, company, jobDescription, profile, lang}')
  // The args must mirror the message-protocol — locked here so
  // a future refactor that drops `jobDescription` doesn't silently
  // produce generic emails.
  assert.ok(
    /generateEmailBody\s*\(\s*\{[\s\S]*?jobTitle[\s\S]*?company[\s\S]*?jobDescription[\s\S]*?profile[\s\S]*?lang/.test(ROUTE_SRC),
    'generateEmailBody call must thread jobTitle + company + jobDescription + profile + lang through',
  )
})

test('Bug 1: route must increment AI-usage counter when generateEmailBody returns a real-LLM source', () => {
  assert.match(ROUTE_SRC, /incrementUsage\s*\(/, 'route must call incrementUsage when source is a paid LLM')
  assert.match(ROUTE_SRC, /AI_SOURCES/, 'route must have an AI_SOURCES allow-list (so fallback/error sources do NOT count against the tier cap)')
})

// =============================================================================
// 6. Route must respect server-side aiEmailBodyEnabled toggle
// =============================================================================

test('Bug 1: route must respect the aiEmailBodyEnabled server-side toggle', () => {
  // LOCKED: parity with /api/extension/ai-answers route. When the
  // user flips OFF the email-body switch in /settings, the route
  // must return a disabled response (NOT burn a Groq call).
  assert.match(ROUTE_SRC, /aiEmailBodyEnabled/, 'route must consult profile.aiEmailBodyEnabled toggle (parity with aiFallbackEnabled on /api/extension/ai-answers)')
  assert.ok(
    /source:\s*['\"]disabled['\"]/.test(ROUTE_SRC),
    'route must return source=\'disabled\' when aiEmailBodyEnabled is false (so the popup can render the chip)',
  )
})

// =============================================================================
// 7. Response shape contract
// =============================================================================

test('Bug 1: route must SSRF-guard the jobDescription fetch via lib/ssrf-guard.js', () => {
  // Round-46.1 / Bug 1 followup — security-hardening after the
  // Round-46 ship. /api/extension/email-body accepts a user-supplied
  // jobUrl which it then fetches server-side; without an SSRF
  // guard a malicious token holder could direct the fetch at
  // http://169.254.169.254/ (cloud metadata), http://localhost:6379/
  // (Redis on a shared box), or any RFC1918 host. The route MUST
  // import + call assertSafeExternalUrl() before the outbound fetch.
  // The behavioural cases live in tests/unit/ssrf-guard.test.mjs;
  // here we lock that the route is wired to it.
  assert.match(
    ROUTE_SRC,
    /import\s*\{[^}]*\bassertSafeExternalUrl\b[^}]*\}\s*from\s*['"]@\/lib\/ssrf-guard['"]/,
    'route must import assertSafeExternalUrl from @/lib/ssrf-guard (parity with other defensive modules)',
  )
  assert.match(
    ROUTE_SRC,
    /assertSafeExternalUrl\s*\(/,
    'route must invoke assertSafeExternalUrl() — the import alone does not gate the fetch()',
  )
  // The fail-soft posture: a guard rejection must log warn-level
  // + return '' (no description for the LLM). Locked so a future
  // refactor that hard-errors on SSRF doesn't break the route.
  assert.match(
    ROUTE_SRC,
    /SSRF guard rejected/,
    'route must warn-log an SSRF guard rejection (vs. silently degrading)',
  )
})

test('Round-46.1: trackEvent failure must warn-log (not silently swallow)', () => {
  // Round-46.1 polish — both endpoints dropped trackEvent errors
  // via .catch(() => {}). A misconfigured clickhouse pipeline
  // was invisible in dev mode; the fix surfaces a warn-level
  // line. Locked so a future refactor that "improves" the
  // pattern back to silent swallowing is caught.
  assert.match(
    ROUTE_SRC,
    /trackEvent\([^)]*extension_email_body[^)]*\)[\s\S]{0,200}?\.[\s\S]{0,200}?catch\s*\([^)]*\)\s*=>\s*\{[\s\S]{0,200}?console\.warn/,
    'route must chain trackEvent(...).catch((err) => console.warn(...)) on extension_email_body analytics',
  )
})

test('Bug 1: response shape must include body + source + cvShortWarning + remaining + monthKey', () => {
  // The popup reads body + cvShortWarning; the extension uses
  // remaining for the status card. Lock the response keys so a
  // future refactor can't silently drop one.
  // Anchor on the unique literal in the success path's body
  // assertion (the surrounding `body: result.body || ''`).
  // The LAST NextResponse.json return in document order is the
  // GET 405 fallthrough (`{ error: 'Use POST.' }`) which
  // doesn't have the success shape — so we explicitly anchor on
  // the success-path marker.
  const successBlockIdx = ROUTE_SRC.indexOf('body: result.body')
  assert.ok(successBlockIdx > 0, 'route must contain a success-path "body: result.body" assignment')
  // Slice a 1500-char window from that marker so the assertion
  // covers the entire success NextResponse.json(...) block.
  const successWindow = ROUTE_SRC.slice(successBlockIdx, successBlockIdx + 2500)
  // The window must include a closing paren with whitespace
  // tolerance. Looking for the LAST occurrence of '})' so we
  // capture the entire block including any trailing braces.
  assert.ok(
    /\}\s*\)/.test(successWindow),
    'success-path window must include the closing `})` of NextResponse.json()'
  )
  // Accept both `key: value` AND shorthand `key, / key,` (object
  // shorthand: `remaining,` followed by another key). The route
  // uses shorthand for `remaining,` + `monthKey:` so the test
  // accommodates both shapes.
  for (const key of ['body', 'source', 'cvShortWarning', 'remaining', 'monthKey']) {
    assert.ok(
      successWindow.includes(`${key}:`) ||
        successWindow.includes(`${key},`) ||
        successWindow.includes(`${key} =`),
      `response must include "${key}:" or "${key}," (object shorthand) — locked by Round-46 / Bug 1 contract`,
    )
  }
})
