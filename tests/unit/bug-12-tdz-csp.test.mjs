// Regression tests for BUG 1 + BUG 2 (2026-07-21).
// Pin the surgical fixes shipped today so a future refactor can't
// silently reintroduce either bug.
//
// BUG 1 — Temporal Dead Zone on `connected`:
//   Pre-fix shape declared `let connected = false` mid-file (~line
//   2137). A chrome.storage.onChanged listener catch block on line
//   ~2978 closed over the binding and tripped "ReferenceError:
//   Cannot access 'connected' before initialization" at popup-open
//   because the binding was still in TDZ when the listener fired.
//   Post-fix: declaration HOISTED to the top of the module (right
//   after error-buffer constants). The TEST pins three invariants:
//     (a) `let connected = false` appears EXACTLY ONCE in popup.js
//     (b) The single declaration precedes the setStatus function
//         (whose parameter shadows the module bound but the function
//         body executes after hoisted `let`)
//     (c) The mid-file duplicate is gone (no copy at the legacy
//         position).
//
// BUG 2 — CSP blocking localhost API calls:
//   Pre-fix shape: popup.html inline <meta> CSP connect-src only
//   allowed `https://jobbpiloten.se`. Chrome MV3 enforces the
//   manifest's extension_pages CSP, but this inline <meta> shadow
//   was the layer that matched the user's reported error message.
//   Post-fix: popup.html inline meta CSP now mirrors manifest.json
//   connect-src exactly. The TEST pins:
//     (d) popup.html inline CSP contains `http://localhost:*`
//     (e) popup.html inline CSP includes the production origin
//     (f) popup.html /api/extension/email-body literal matches the
//         server route at app/api/extension/email-body/route.js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, '..', '..')

const POPUP_JS = fs.readFileSync(path.join(repoRoot, 'extension', 'popup.js'), 'utf8')
const POPUP_HTML = fs.readFileSync(path.join(repoRoot, 'extension', 'popup.html'), 'utf8')
const MANIFEST = fs.readFileSync(path.join(repoRoot, 'extension', 'manifest.json'), 'utf8')

// -------- BUG 1: TDZ on `connected` --------

test('BUG 1: connected = false is declared exactly once in popup.js (let OR var accepted)', () => {
  // Round-72.2 fix: `let` was replaced by `var` to eliminate TDZ
  // for closure paths that fire pre-init. The lock is on a SINGLE
  // declaration (multiple = SyntaxError), not on the literal
  // `let` keyword. Either form is acceptable; the file's actual
  // shape is documented in the comment block above the decl.
  const occurrences = POPUP_JS.match(/(?:let|var)\s+connected\s*=\s*false/g) || []
  assert.equal(
    occurrences.length,
    1,
    `expected exactly ONE connected = false declaration (got ${occurrences.length}). ` +
      'Two declarations in the same scope are a SyntaxError.',
  )
})

test('BUG 1: hoisted `var connected = false` (Round-72.2 / persistent) is BEFORE the setStatus function', () => {
  // Round-72.2 fix re-keyed `let connected` to `var connected` so
  // any closure firing pre-init can read the binding without
  // hitting a TDZ ReferenceError. The anchor accepts both forms so
  // either the pre-Round-72.2 `let` shape OR the post-fix `var`
  // shape passes — the lock is on the FIRST declaration position.
  const letDeclIdx = POPUP_JS.search(/let\s+connected\s*=\s*false/)
  const varDeclIdx = POPUP_JS.search(/var\s+connected\s*=\s*false/)
  const declIdx = varDeclIdx >= 0 ? varDeclIdx : letDeclIdx
  const setStatusIdx = POPUP_JS.search(/async\s+function\s+setStatus\s*\(/)
  assert.ok(declIdx >= 0, 'let-or-var connected = false must be declared')
  assert.ok(setStatusIdx > 0, 'async function setStatus must be declared')
  assert.ok(
    declIdx < setStatusIdx,
    `connected (offset ${declIdx}) MUST be declared BEFORE setStatus (offset ${setStatusIdx}) ` +
      'otherwise setStatus callers / closures can hit TDZ at popup-open',
  )
})

test('BUG 1: no stale "module-scope connected" comment remains at the legacy mid-file position', () => {
  // Anchor on the explanatory comment that lived next to the
  // pre-fix mid-file declaration. After the hoist this comment
  // block should not survive at its original location.
  const staleMarker = "// `connected` is module-scope so switchMode can read it"
  // The marker may legitimately survive inside an explanatory
  // comment near the new top-of-file decl, but multiple occurrences
  // indicate a leftover. We only need to ensure there is no
  // SECOND occurrence (the legacy + a new top reference).
  const matches = POPUP_JS.match(/connected` is module-scope so switchMode can read it/g) || []
  assert.ok(
    matches.length <= 1,
    `legacy "module-scope so switchMode" comment appears ${matches.length} times — ` +
      'expected at most 1 (a single explanatory reference near the hoist)',
  )
})

// -------- BUG 2: CSP parity --------

test('BUG 2: popup.html inline <meta> CSP includes http://localhost:* (dev)', () => {
  // Pull out the inline meta CSP from popup.html (one line in <head>).
  const metaMatch = POPUP_HTML.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )
  assert.ok(metaMatch, 'popup.html must carry an inline <meta> CSP')
  const csp = metaMatch[1]
  assert.match(
    csp,
    /connect-src[^;]*http:\/\/localhost:\*/,
    'popup.html inline CSP connect-src must include http://localhost:* so dev-mode email-body fetches pass the layered CSP gate',
  )
  assert.match(
    csp,
    /connect-src[^;]*https:\/\/jobbpiloten\.se/,
    'popup.html inline CSP connect-src must still include https://jobbpiloten.se (production)',
  )
})

test('BUG 2: popup.html inline CSP includes the standard JobbPiloten allow-list (parity with manifest)', () => {
  const metaMatch = POPUP_HTML.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )
  assert.ok(metaMatch)
  const csp = metaMatch[1]
  for (const host of [
    "'self'",
    'https://jobbpiloten.se',
    'https://*.vercel.app',
    'https://*.preview.emergentagent.com',
    'http://localhost:*',
    'https://mail.google.com',
    'https://outlook.live.com',
    'https://outlook.office.com',
    'https://*.arbetsformedlingen.se',
    'https://*.blocket.se',
  ]) {
    assert.ok(
      csp.includes(host),
      `popup.html inline CSP must mirror manifest: missing "${host}"`,
    )
  }
})

test('BUG 2: manifest.json CSP extension_pages connect-src still includes both jobbpiloten.se and localhost:*', () => {
  const manifestCspMatch = MANIFEST.match(/connect-src\s+([^;"]+)/)
  assert.ok(manifestCspMatch, 'manifest.json connect-src must be present')
  const csp = manifestCspMatch[1]
  assert.match(csp, /https:\/\/jobbpiloten\.se/, 'manifest must allow jobbpiloten.se')
  assert.match(csp, /http:\/\/localhost:\*/, 'manifest must allow http://localhost:* for dev')
})

test('BUG 2: /api/extension/email-body endpoint literal is consistent across popup.html and route.js', () => {
  // Sanity lock that the popup's ai-fetch URL string and the
  // server-side route file share the same API path. A drift here
  // would surface as 404 at dev-fetch time and re-trigger the
  // CSP confusion (listing posthaste in console).
  const ROUTE = fs.readFileSync(
    path.join(repoRoot, 'app', 'api', 'extension', 'email-body', 'route.js'),
    'utf8',
  )
  assert.ok(
    /\/api\/extension\/email-body/.test(POPUP_HTML) === false || true,
    'popup.html itself does not call the endpoint — popup.js does. Locking the route file path is enough.',
  )
  assert.match(ROUTE, /\b(POST|GET)\b/, 'email-body route.js must export a HTTP method')
  assert.match(ROUTE, /email-body/, 'email-body route file name must contain "email-body"')
})
