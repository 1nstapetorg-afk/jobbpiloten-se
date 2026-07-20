// tests/unit/next-config-no-standalone.test.mjs
//
// Bug lock (2026-07-12, "soft-launch polish #d — preview deploy CSS"):
// next.config.js was setting `output: 'standalone'`. That mode is
// intended for self-hosted Docker / containerized deployments and
// produces a build output under `.next/standalone/` with a
// different static-asset path layout than a regular Vercel
// serverless build. On Vercel-managed preview deploys the CSS
// bundle path then drifts from what the served HTML expects, and
// the user sees unstyled HTML (raw text, no Tailwind, broken
// layout).
//
// Fix: do NOT set `output: 'standalone'`. Vercel handles its own
// per-route serverless packaging without an explicit `output`,
// so leaving it unset produces a build that Vercel's CDN serves
// correctly. The fix keeps `outputFileTracingIncludes` (the trace
// hint that ensures ./extension/**/* stays alongside the
// /api/extension/download function bundle — a different concern
// from the static-asset path).
//
// This test pins the regression so a future refactor can't
// silently re-introduce `output: 'standalone'` (e.g. via a yarn
// upgrade or a `next build` doc copy-paste) and re-break the
// preview CSS.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const NEXT_CONFIG = readFileSync('next.config.js', 'utf-8')

test('next.config.js must NOT set output: "standalone" (Vercel-incompatible — breaks preview CSS)', () => {
  // We assert the substring is absent. We don't try to parse
  // next.config.js (it's a CommonJS module that requires Node
  // bootstrap). A naive string match is sufficient because the
  // regression mode is "someone copy-pasted output: 'standalone'
  // from Next.js docs" — a string match catches that exactly.
  //
  // Whitelist of acceptable substitutes (none currently): a
  // future migration to a self-hosted Docker deploy would need
  // a separate config file. If a future refactor needs to add
  // `output: 'standalone'` back (e.g. for a sibling project),
  // update this test to lock the change against the new context.
  assert.ok(
    !/output\s*:\s*['"]standalone['"]/.test(NEXT_CONFIG),
    'next.config.js must NOT include `output: "standalone"` — the mode is intended for self-hosted Docker, not Vercel serverless. Setting it on a Vercel project causes the preview deploy to render unstyled HTML (CSS bundle path drift).',
  )
})

test('next.config.js must still set outputFileTracingIncludes (separate concern — keeps extension files alongside /api/extension/download)', () => {
  // This is the OTHER output-related config and it MUST stay.
  // It ensures Vercel's bundler keeps the entire extension/
  // folder alongside the /api/extension/download serverless
  // function so the zip endpoint can read the files at
  // runtime via fs. Without it the function crashes with
  // ENOENT the first time someone hits the endpoint.
  assert.match(
    NEXT_CONFIG,
    /outputFileTracingIncludes\s*:\s*\{/,
    'next.config.js must still declare outputFileTracingIncludes — Vercel tree-shakes serverless functions aggressively and /api/extension/download reads ./extension/ at runtime via fs (not static import)',
  )
  assert.match(
    NEXT_CONFIG,
    /['"]\/api\/extension\/download['"]\s*:\s*\[\s*['"]\.\/extension\/\*\*\/\*['"]/,
    'outputFileTracingIncludes must trace ./extension/**/* alongside /api/extension/download so the zip endpoint can find the files',
  )
})
