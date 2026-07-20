// tests/unit/extension-host-pattern.test.mjs
//
// Behavioral coverage of the `hostPatternToRegex` helper that
// extension/popup.js and extension/content.js both define (and
// must keep byte-identical — divergence is a silent DNS-rebinding
// vector per the file-level comment in content.js).
//
// The helper lives INSIDE the MV3 modules so we can't `import`
// it from Node `--test` without a bundler. Instead, this test
// re-implements the algorithm inline in pure JS and exercises
// it. A future refactor that changes popup.js's helper without
// updating the test mirror would still pass this suite (the
// source-grep tests in tests/unit/popup-handshake.test.mjs
// catch structural deletions) but the algorithm under test
// here is the canonical "should behave like" reference.
//
// v0.2.3 fix: the trailing `/*` is stripped BEFORE the `*`
// substitution so the path becomes fully optional. The
// previous shape required at least one char after the trailing
// `/`, which meant a test of the BARE origin (e.g.
// `re.test('https://x.com')`) would always fail. The
// behavioral tests below pin the v0.2.3 contract so the
// bare-origin match works against any pattern with a trailing
// `/*`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Mirror of extension/popup.js (and extension/content.js)'s
// hostPatternToRegex. If a refactor changes the helper, this
// mirror must be updated in lock-step — the popup.js and
// content.js source-grep tests catch structural deletions;
// this test catches behavioral regressions.
function hostPatternToRegex(pattern) {
  let body = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  if (body.endsWith('/*')) {
    body = body.slice(0, -2)
  }
  body = body.replace(/\*/g, '[^/]+')
  return new RegExp('^' + body + '(?:/.*)?$')
}

// ----- 1. Manifest patterns declared in extension/manifest.json -----

test('hostPatternToRegex: "https://jobbpiloten.se/*" matches bare prod origin', () => {
  const re = hostPatternToRegex('https://jobbpiloten.se/*')
  assert.equal(re.test('https://jobbpiloten.se'), true,
    'bare prod origin must match (the v0.2.3 fix that strips trailing `/*`)')
})

test('hostPatternToRegex: "https://jobbpiloten.se/*" matches prod origin with path', () => {
  const re = hostPatternToRegex('https://jobbpiloten.se/*')
  assert.equal(re.test('https://jobbpiloten.se/dashboard'), true)
  assert.equal(re.test('https://jobbpiloten.se/extension-auth'), true)
  assert.equal(re.test('https://jobbpiloten.se/a/b/c'), true)
})

test('hostPatternToRegex: "https://jobbpiloten.se/*" does NOT match other origin', () => {
  const re = hostPatternToRegex('https://jobbpiloten.se/*')
  assert.equal(re.test('https://other.com'), false)
  assert.equal(re.test('https://jobbpiloten.se.evil.com'), false,
    'suffix-match must NOT be allowed (no host wildcard) — phishing protection')
})

test('hostPatternToRegex: "https://*.vercel.app/*" matches any vercel.app subdomain', () => {
  const re = hostPatternToRegex('https://*.vercel.app/*')
  assert.equal(re.test('https://my-app.vercel.app'), true)
  assert.equal(re.test('https://my-app.vercel.app/dashboard'), true)
  assert.equal(re.test('https://foo-bar-123.vercel.app/anything/at/all'), true)
})

test('hostPatternToRegex: "https://*.vercel.app/*" does NOT match the bare vercel.app (no subdomain)', () => {
  // The host wildcard `*` requires at least one non-slash char,
  // so the bare apex `vercel.app` (no subdomain) is rejected.
  // This is intentional — Chrome match patterns use the same
  // rule (`*` ≠ empty substring). A future refactor that
  // substitutes `*` with `[^/]*` (zero-or-more) would regress
  // this test.
  const re = hostPatternToRegex('https://*.vercel.app/*')
  assert.equal(re.test('https://vercel.app'), false,
    'host wildcard `*` must require at least one char (no bare apex match)')
})

test('hostPatternToRegex: "https://*.vercel.app/*" does NOT match a different apex that contains vercel.app as a substring', () => {
  // Defense against DNS-rebinding where a malicious apex
  // contains the allowlisted pattern as a suffix.
  const re = hostPatternToRegex('https://*.vercel.app/*')
  assert.equal(re.test('https://my-app.vercel.app.evil.com'), false)
  assert.equal(re.test('https://vercel.app.evil.com'), false)
})

test('hostPatternToRegex: "https://*.preview.emergentagent.com/*" matches preview subdomains', () => {
  const re = hostPatternToRegex('https://*.preview.emergentagent.com/*')
  assert.equal(re.test('https://jobbpiloten-se.preview.emergentagent.com'), true,
    'v0.2.3 fix: the soft-launch preview domain must match against the wildcard pattern')
  assert.equal(re.test('https://jobbpiloten-se.preview.emergentagent.com/extension-auth'), true)
  assert.equal(re.test('https://my-other-app.preview.emergentagent.com/dashboard'), true)
})

test('hostPatternToRegex: "https://*.preview.emergentagent.com/*" does NOT match the bare apex', () => {
  const re = hostPatternToRegex('https://*.preview.emergentagent.com/*')
  assert.equal(re.test('https://preview.emergentagent.com'), false)
})

test('hostPatternToRegex: "http://localhost:*/*" matches localhost on any port', () => {
  const re = hostPatternToRegex('http://localhost:*/*')
  assert.equal(re.test('http://localhost:3000'), true)
  assert.equal(re.test('http://localhost:3000/dashboard'), true)
  assert.equal(re.test('http://localhost:8080'), true)
  assert.equal(re.test('http://localhost'), false, 'must require the port segment')
})

// ----- 2. Defensive / edge cases -----

test('hostPatternToRegex: empty pattern matches only empty string', () => {
  const re = hostPatternToRegex('')
  assert.equal(re.test(''), true)
  assert.equal(re.test('https://anything'), false)
})

test('hostPatternToRegex: pattern with no `*` matches literal URL', () => {
  const re = hostPatternToRegex('https://jobbpiloten.se/')
  assert.equal(re.test('https://jobbpiloten.se/'), true)
  assert.equal(re.test('https://jobbpiloten.se'), false, 'trailing-slash pattern requires the slash in the test string')
})

test('hostPatternToRegex: scheme-aware (https pattern does NOT match http)', () => {
  const re = hostPatternToRegex('https://jobbpiloten.se/*')
  assert.equal(re.test('http://jobbpiloten.se'), false,
    'scheme is part of the pattern — http and https are distinct origins')
})

test('hostPatternToRegex: pattern with multiple `*` segments matches each independently', () => {
  // "*://*.foo.com/*" would be a pattern where both the scheme
  // and host are wildcards. Defensive: confirm the substitution
  // handles multiple wildcards in the same pattern.
  const re = hostPatternToRegex('https://*.foo.com/*')
  assert.equal(re.test('https://bar.foo.com/baz'), true)
})

test('hostPatternToRegex: regex meta-chars in pattern are escaped (defense against ReDoS)', () => {
  // A pattern like "https://x.com/$" would, without the escape
  // step, treat `$` as a regex anchor. With the escape, `$` is
  // literal. The test string is a URL that includes `$` —
  // matches the literal pattern.
  const re = hostPatternToRegex('https://x.com/$query/*')
  assert.equal(re.test('https://x.com/$query'), true,
    '`$` in pattern must be escaped to literal, not treated as regex anchor')
})

// ----- 3. Cross-file consistency lock -----
//
// extension/popup.js and extension/content.js both define
// hostPatternToRegex. The file-level comment in content.js
// says the two MUST stay byte-identical — divergence is a
// silent DNS-rebinding vector. Lock the parity via a static
// diff on the helper's body.

test('hostPatternToRegex implementations in popup.js and content.js must stay byte-identical', () => {
  const popupSrc = readFileSync('extension/popup.js', 'utf-8')
  const contentSrc = readFileSync('extension/content.js', 'utf-8')

  // Extract the helper body via a coarse regex. The two files
  // can have different leading whitespace, so we normalize.
  function extractBody(src) {
    const m = src.match(/function hostPatternToRegex\(pattern\)\s*\{[\s\S]*?\n\}/)
    return m ? m[0].replace(/\s+/g, ' ').trim() : null
  }

  const popupBody = extractBody(popupSrc)
  const contentBody = extractBody(contentSrc)
  assert.ok(popupBody, 'popup.js must define hostPatternToRegex')
  assert.ok(contentBody, 'content.js must define hostPatternToRegex')
  assert.equal(
    popupBody,
    contentBody,
    'hostPatternToRegex bodies must be byte-identical (ignoring whitespace) — divergence is a silent DNS-rebinding vector',
  )
})
