/**
 * GET /api/extension/version
 *
 * Round-93 — returns the CURRENT extension build version so the
 * popup can detect a stale install. The extension popup fetches
 * `${DASHBOARD_URL}/api/extension/version` on open and compares the
 * server's `version` against its own running version (manifest
 * `x_jp_version`); a mismatch means the user has an old unpacked
 * build loaded and the popup shows the yellow "Uppdatering tillgänglig"
 * banner instead of the user (or support) guessing forever.
 *
 * The source of truth is extension/manifest.json's `x_jp_version`
 * field — read at request time (mirroring the /api/extension/download
 * route's runtime-fs posture) so the API can never drift from the
 * artifact it describes. If the file can't be read (deployment
 * without the tracing include) we fall back to the hard-coded
 * constant below — locked to the manifest by
 * tests/unit/round93-version-endpoint.test.mjs.
 *
 * Public, no auth: same posture as /api/extension/download (any
 * installed extension must be able to reach it without a session).
 */
import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Round-93 — hard-coded fallback (see header comment). MUST match
// extension/manifest.json `x_jp_version` — locked by
// tests/unit/round93-version-endpoint.test.mjs.
const FALLBACK_VERSION = '1.0.0-93'

export async function GET() {
  let version = FALLBACK_VERSION
  try {
    // The Next.js bundler can rewrite process.cwd() in some
    // environments, so we anchor on the project root the same way
    // the download route does. outputFileTracingIncludes in
    // next.config.js forces extension/manifest.json into the trace.
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'extension/manifest.json'), 'utf-8'),
    )
    if (manifest && typeof manifest.x_jp_version === 'string' && manifest.x_jp_version) {
      version = manifest.x_jp_version
    }
  } catch (_) { /* fall back to the constant */ }
  return NextResponse.json({ version }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
