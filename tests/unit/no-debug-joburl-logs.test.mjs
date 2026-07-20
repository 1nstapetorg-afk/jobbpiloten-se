// tests/unit/no-debug-joburl-logs.test.mjs
//
// Static-source lock. The round-15 work shipped
// resolveAFJobUrl() + openJobOrSearch() and stripped four
// temporary DEBUG-jobUrl log statements scattered across
// lib/jobScraper.js, app/api/[[...path]]/route.js, and
// app/dashboard/page.js. This test prevents accidental reintroduction
// through copy-paste or future "let me just dump this for a second"
// debugging sessions.
//
// Policy: any debug instrumentation that DOES need to ship goes
// through lib/debug.js#isJobUrlDebug() so a single env-flag gates
// it without polluting every site with literal DEBUG-tagged strings.
//
// What this test catches vs what it ignores:
//   • MATCHES: an actual console call site (one of log/warn/error/
//     debug/info) whose first string-literal argument contains the
//     DEBUG-jobUrl tag — a real shipped debug-instrumentation line
//     that would litter Vercel logs in production.
//   • IGNORES: prose that names the literal in a JSDoc comment or
//     markdown (this very file's docstring is the canonical example,
//     and lib/debug.js's policy header references the tag in prose).
//     Without this carve-out the test would self-flag the very
//     helper that points future devs at the canonical replacement.
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

// Top-level directories that contain shipped source. We deliberately
// exclude tests/ (because tests are allowed to assert on what they
// see), node_modules/, .next/ (build cache), and .git/.
const SOURCE_DIRS = ['app', 'lib', 'components']
// Covers the project's current .js files plus a future ESM migration
// (.mjs/.cjs) so a packaged lib helper dropped as `lib/foo.mjs`
// doesn't bypass the guard silently.
const SOURCE_EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']
const SKIP_DIR_NAMES = new Set(['node_modules', '.next', '.git'])

// Match only ACTUAL console.* call sites that pass a string literal
// containing the DEBUG-jobUrl tag. We deliberately do NOT match the
// bare bracketed literal because that would self-flag documentation
// and policy prose (see header).
const RE = /console\.(log|warn|error|debug|info)\s*\(\s*['"`][^'"`\n]*\[DEBUG-jobUrl\b[^'"`\n]*['"`]/m

function listSourceFiles() {
  const out = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (SOURCE_EXTS.some((ext) => entry.name.endsWith(ext))) {
        out.push(full)
      }
    }
  }
  for (const top of SOURCE_DIRS) walk(path.join(ROOT, top))
  return out
}

test('no DEBUG-jobUrl log statements survive in shipped source', () => {
  // If a future dev copy-pastes a console-call with the DEBUG-jobUrl
  // tag back into any shipped source, this test fails fast so the
  // regression is caught before any deploy.
  const offenders = []
  for (const f of listSourceFiles()) {
    const src = fs.readFileSync(f, 'utf-8')
    if (RE.test(src)) {
      offenders.push(path.relative(ROOT, f))
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `DEBUG-jobUrl console.* log statements must not ship. Found in: ${offenders.join(', ') || '(none)'}\n` +
      'Use lib/debug.js#isJobUrlDebug() + a guarded console call instead so a\n' +
      'single env flag (DEBUG_JOBURL=1) gates future debug instrumentation.',
  )
})
