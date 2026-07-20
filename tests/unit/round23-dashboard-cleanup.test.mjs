// tests/unit/round23-dashboard-cleanup.test.mjs
//
// Round-23 regression net — locks the 3 idiomatic patterns the
// cleanup committed in app/dashboard/page.js so a future regression
// that re-introduces the verbose forms fails the build:
//   1. `new URLSearchParams(Array.from(searchParams.entries()))`
//      must NOT appear in shipped source (use .toString() instead).
//   2. `searchParams?.get(...)` defensive optional chain must NOT
//      appear (useSearchParams() is guaranteed non-null in Next.js 15).
//   3. The Suspense fallback must use <Skeleton> (visually consistent
//      with the rest of the dashboard's loading state), NOT <Loader2>.

import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DASHBOARD = resolve(__dirname, '../../app/dashboard/page.js')

const src = readFileSync(DASHBOARD, 'utf8')

test('app/dashboard/page.js: no `new URLSearchParams(Array.from(searchParams.entries()))`', () => {
  const offenders = src.match(/new URLSearchParams\(Array\.from\(searchParams\.entries\(\)\)\)/g) || []
  assert.deepStrictEqual(offenders, [], 'idiomatic .toString() form is preferred')
})

test('app/dashboard/page.js: no defensive `searchParams?.get(...)`', () => {
  const offenders = src.match(/searchParams\?\.get\(/g) || []
  assert.deepStrictEqual(offenders, [], 'useSearchParams() is non-null in App Router context')
})

test('app/dashboard/page.js: Suspense fallback uses <Skeleton>, not <Loader2>', () => {
  // Slice the Suspense fallback block to avoid matching the many Loader2
  // uses elsewhere in the file (button spinners, etc.).
  const match = src.match(/<Suspense[^>]*fallback=\{[\s\S]*?\}\s*>/)
  assert.ok(match, 'Suspense fallback block not found')
  const block = match[0]
  assert.ok(/Skeleton/.test(block), 'Suspense fallback should use <Skeleton>')
  assert.ok(!/Loader2/.test(block), 'Suspense fallback should NOT use <Loader2>')
})
