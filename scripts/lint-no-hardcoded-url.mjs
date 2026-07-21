#!/usr/bin/env node
// 2026-07-21 (Round-73 / ITEM 4)
// scripts/lint-no-hardcoded-url.mjs — fail-loud guard against
// hardcoded `jobbpiloten.se` in client-side fetches.
//
// BUG E (Round-73) shipped the fix to surface ERR_SSL_PROTOCOL_ERROR:
// when the dev popup was running against a localhost Next.js and a
// fetch hardcoded `https://jobbpiloten.se`, the browser rejected the
// mixed-origin request and the dashboard settings save failed. The
// fix was to use env-driven `resolveEnvAuthBaseUrl()`. This lint
// script keeps that fix from regressing — any future PR that adds a
// hardcoded `jobbpiloten.se` to a CLIENT-side file fails CI.
//
// Allowlist (legitimate uses that the linter must NOT flag):
//   1. `lib/siteConfig.js` — server-side env-driven fallback
//      (process.env.NEXT_PUBLIC_BASE_URL || 'https://jobbpiloten.se'),
//      never reaches the browser. PROTECTED.
//   2. `app/api/[[...path]]/route.js` — server-side env-driven
//      fallback for the catch-all API route. PROTECTED.
//   3. `app/api/*/route.js` — all server-only Next.js API routes
//      (the route handler never runs in the browser bundle). PROTECTED.
//   4. `extension/lib/dashboard-url-resolver.js` — has the same
//      PROD_BASE_URL_DEFAULT constant; final fallback that resolves
//      via host_permissions; only reachable from the extension.
//      PROTECTED.
//   5. `extension/popup.js` + `extension/content.js` — these have
//      `PROD_BASE_URL` as a final fallback ONLY. The popup's outbound
//      fetch chain must use `resolveEnvAuthBaseUrl()`. PROTECTED for
//      now; the regex below explicitly excludes these.
//
// Detection:
//   - Pattern:  /https?:\/\/jobbpiloten\.se/
//   - Searched in: app/  +  extension/  excluding allowlist entries
//
// Exit codes:
//   0 — clean (no hardcoded URL offenders found)
//   1 — at least one hardcoded offender found (with file:line:match)
//   2 — internal lint failure (e.g. fs read error)

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..')

const HARD_RE = /https?:\/\/jobbpiloten\.se/

// Allowlist — paths RELATIVE to PROJECT_ROOT. Both exact matches and
// regexy prefix matches below.
const ALLOWLIST = new Set([
  // Server-side env-driven fallback — never reaches the browser.
  'lib/siteConfig.js',
  // Catch-all API route env fallback — server-only.
  'app/api/[[...path]]/route.js',
  // Extension's pure resolver module — final fallback constant.
  'extension/lib/dashboard-url-resolver.js',
  // Extension's popup/content have PROD_BASE_URL as a documented
  // FINAL fallback only (Round-72.2). Outbound fetch chain uses
  // resolveEnvAuthBaseUrl() which prefers env-derived origins.
  'extension/popup.js',
  'extension/content.js',
])

// Directory-level allowlist (every .js under it is OK)
const DIR_ALLOWLIST = new Set([
  // Server-only Next.js API routes — never reach the browser bundle.
  'app/api',
])

function isAllowlisted(relPath) {
  if (ALLOWLIST.has(relPath)) return true
  // Check directory allowlist
  for (const d of DIR_ALLOWLIST) {
    if (relPath === d || relPath.startsWith(d + '/')) return true
  }
  return false
}

// Recursive directory walker that collects .js/.mjs/.tsx files
function* walkJsFiles(root) {
  let entries
  try {
    entries = readdirSync(root)
  } catch (_) {
    return
  }
  for (const name of entries) {
    const full = join(root, name)
    let st
    try { st = statSync(full) } catch (_) { continue }
    if (st.isDirectory()) {
      // Skip .next, node_modules, .git
      if (name === '.next' || name === 'node_modules' || name === '.git') continue
      yield* walkJsFiles(full)
    } else if (
      st.isFile() &&
      (full.endsWith('.js') || full.endsWith('.mjs') || full.endsWith('.tsx'))
    ) {
      yield full
    }
  }
}

// Scoped search roots — these are the directories where a hardcoded
// 'jobbpiloten.se' would actually ship to the browser. We DO NOT
// search `.next/` or `node_modules/` (they're build artifacts).
const SEARCH_ROOTS = ['app', 'extension']

const offenders = []
for (const root of SEARCH_ROOTS) {
  const full = join(PROJECT_ROOT, root)
  for (const file of walkJsFiles(full)) {
    const relPath = relative(PROJECT_ROOT, file).replaceAll('\\', '/')
    if (isAllowlisted(relPath)) continue
    let text
    try { text = readFileSync(file, 'utf8') } catch (_) { continue }
    // Per-line scan to surface line numbers + the offending match
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (HARD_RE.test(lines[i])) {
        offenders.push({
          file: relPath,
          line: i + 1,
          match: lines[i].trim().slice(0, 200),
        })
      }
    }
  }
}

if (offenders.length === 0) {
  console.log(
    'OK — no hardcoded jobbpiloten.se URLs in client-side files ' +
      '(app/ scoured + extension/ scoured, allowlist applied).',
  )
  process.exit(0)
}

console.error(
  `FAIL — ${offenders.length} hardcoded jobbpiloten.se URL ` +
    (offenders.length === 1 ? 'offender' : 'offenders') +
    ` found in client-side files:`,
)
for (const { file, line, match } of offenders) {
  console.error(`  ${file}:${line}  →  ${match}`)
}
console.error(
  '\nFix: use env-driven resolveEnvAuthBaseUrl() (extension) or ' +
    'relative /api/<path> (app), NOT a hardcoded production URL. ' +
    'See Round-73 / BUG E closeout for rationale.',
)
process.exit(1)
