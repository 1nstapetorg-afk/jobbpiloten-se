// tests/unit/round88-dashboard-split.test.mjs
//
// Round-88 — dashboard monolith split regression net. The stateful
// DashboardContent container stays in app/dashboard/page.js (heavy
// source-lock coverage: testids, composite keys, resolveApplicationUrl,
// SOURCE_FALLBACKS, Tag signature, slice(3), ...), but the pure helpers
// moved to lib/dashboard-helpers.js and the leaf presentational
// components moved to components/DashboardCards.jsx.
//
// These locks pin the split so a future "consolidation" refactor can't
// silently move the definitions back into the 2600-line page (or drop
// the extraction) without tripping a test. Same source-grep pattern as
// the rest of the dashboard lock suite — no runtime, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const PAGE = readFileSync(resolve(ROOT, 'app/dashboard/page.js'), 'utf8')
const HELPERS_PATH = resolve(ROOT, 'lib/dashboard-helpers.js')
const CARDS_PATH = resolve(ROOT, 'components/DashboardCards.jsx')

// The 11 pure helpers + shared STATUS_MAP expected in lib/dashboard-helpers.js.
const HELPER_EXPORTS = [
  'readJsonSafely',
  'readClerkEmail',
  'readClerkFullName',
  'readClerkPhone',
  'mergeProfileWithUser',
  'fmtDate',
  'monthNames',
  'nextCronAt',
  'fmtTimeUntil',
  'getMonthlyTrend',
  'STATUS_MAP',
]

// The 6 leaf presentational components expected in components/DashboardCards.jsx.
const CARD_EXPORTS = [
  'TrendBadge',
  'NextCronBanner',
  'AnimatedCounter',
  'CompanyLogo',
  'StatusPill',
  'BroaderSearchCard',
]

test('lib/dashboard-helpers.js exists and exports every moved helper', () => {
  assert.ok(existsSync(HELPERS_PATH), 'lib/dashboard-helpers.js must exist after the Round-88 split')
  const src = readFileSync(HELPERS_PATH, 'utf8')
  for (const name of HELPER_EXPORTS) {
    assert.match(
      src,
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}|export\\s+const\\s+${name}`),
      `lib/dashboard-helpers.js must export ${name}`,
    )
  }
  // Pure module — must NOT import React/Next so node --test can load it.
  const importsRuntime =
    src.includes("from 'react'") || src.includes('from "react"') ||
    src.includes("from 'next/") || src.includes('from "next/')
  assert.equal(importsRuntime, false, 'helpers must stay React/Next-free so node --test can load them')
})

test('components/DashboardCards.jsx exists and exports every moved component', () => {
  assert.ok(existsSync(CARDS_PATH), 'components/DashboardCards.jsx must exist after the Round-88 split')
  const src = readFileSync(CARDS_PATH, 'utf8')
  for (const name of CARD_EXPORTS) {
    assert.match(
      src,
      new RegExp(`export\\s+function\\s+${name}`),
      `components/DashboardCards.jsx must export ${name}`,
    )
  }
  assert.match(src, /^'use client'/m, 'DashboardCards.jsx must be a client component')
})

test('dashboard/page.js no longer re-declares the moved helpers/components', () => {
  // Each moved symbol must exist in the page ONLY via the import lines —
  // a merged-back definition would double-declare and break the split.
  // Plain string checks (no regex) so the lock can never silently match
  // nothing the way an over-escaped regex literal can.
  const MOVED_DEFS = [
    'function readJsonSafely(',
    'function mergeProfileWithUser(',
    'const fmtDate =',
    'const monthNames =',
    'function nextCronAt(',
    'function fmtTimeUntil(',
    'function getMonthlyTrend(',
    'const STATUS_MAP =',
    'function TrendBadge(',
    'function NextCronBanner(',
    'function AnimatedCounter(',
    'function CompanyLogo(',
    'function StatusPill(',
    'function BroaderSearchCard(',
  ]
  for (const def of MOVED_DEFS) {
    assert.equal(
      PAGE.includes(def),
      false,
      `app/dashboard/page.js must not re-declare a moved symbol (${def})`,
    )
  }
})

test('dashboard/page.js imports the helpers + cards modules', () => {
  assert.match(
    PAGE,
    /from\s+['"]@\/lib\/dashboard-helpers['"]/,
    'page must import from @/lib/dashboard-helpers',
  )
  assert.match(
    PAGE,
    /from\s+['"]@\/components\/DashboardCards['"]/,
    'page must import from @/components/DashboardCards',
  )
})

test('positive control: the page source was actually read (locks are non-vacuous)', () => {
  // Guards against a future broken readFileSync/empty-PAGE state silently
  // satisfying every doesNotMatch above. The page must still contain its
  // own (non-moved) locked symbols.
  assert.ok(PAGE.includes('function Tag('), 'page must still declare Tag')
  assert.ok(PAGE.includes('function DashboardContent('), 'page must still declare DashboardContent')
  assert.ok(PAGE.includes('const FILTERS ='), 'page must still declare FILTERS')
  assert.ok(PAGE.includes('function resolveApplicationUrl('), 'page must still declare resolveApplicationUrl')
  assert.ok(PAGE.includes('const SOURCE_FALLBACKS ='), 'page must still declare SOURCE_FALLBACKS')
})
