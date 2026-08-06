/**
 * GET /api/extension/version
 *
 * Round-93 — returns the CURRENT extension build version so the
 * popup can detect a stale install. The extension popup fetches
 * `${DASHBOARD_URL}/api/extension/version` on open and compares the
 * server's `version` against its own running build tag; a mismatch
 * means the user has an old unpacked build loaded and the popup
 * shows the yellow "Uppdatering tillgänglig" banner instead of the
 * user (or support) guessing forever.
 *
 * Round-93-fix — the build tag's source of truth moved from
 * extension/manifest.json's `x_jp_version` field to
 * extension/version.json. Chrome warns about unrecognized top-level
 * manifest keys (and Chrome Web Store review can reject a listing
 * over them), so the extension no longer declares the custom key —
 * the version.json file is read at request time (mirroring the
 * /api/extension/download route's runtime-fs posture) so the API can
 * never drift from the artifact it describes. If the file can't be
 * read (deployment without the tracing include) we fall back to the
 * hard-coded constant below — locked to version.json by
 * tests/unit/round93-handshake-bulletproof.test.mjs.
 *
 * Public, no auth: same posture as /api/extension/download (any
 * installed extension must be able to reach it without a session).
 */
import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Round-93-fix — hard-coded fallback (see header comment). MUST match
// extension/version.json `version` — locked by
// tests/unit/round93-handshake-bulletproof.test.mjs.
const FALLBACK_VERSION = '1.0.0-93'

export async function GET() {
  let version = FALLBACK_VERSION
  try {
    // The Next.js bundler can rewrite process.cwd() in some
    // environments, so we anchor on the project root the same way
    // the download route does. outputFileTracingIncludes in
    // next.config.js forces extension/version.json into the trace.
    const versionFile = JSON.parse(
      readFileSync(join(process.cwd(), 'extension/version.json'), 'utf-8'),
    )
    if (versionFile && typeof versionFile.version === 'string' && versionFile.version) {
      version = versionFile.version
    }
  } catch (_) { /* fall back to the constant */ }
  return NextResponse.json({ version }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
