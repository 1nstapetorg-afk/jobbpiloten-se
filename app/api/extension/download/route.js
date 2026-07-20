/**
 * GET /api/extension/download
 *
 * One-click install flow for the JobbPiloten Auto-Fill extension.
 * Streams a FLAT zip of the contents of /extension/ (manifest.json at
 * the zip root, no nested `extension/` subfolder) so the user can:
 *
 *   1. Click the green "Ladda ner & Installera" button on
 *      /extension-install.
 *   2. Unzip the downloaded file anywhere on disk.
 *   3. Point chrome://extensions → "Load unpacked" at the unzipped
 *      folder directly (manifest.json sits at the folder root, no
 *      drill-down required).
 *
 * Why an inline ZIP builder rather than shelling out to
 * scripts/package-extension.py:
 *   • Vercel's Node.js serverless runtime doesn't ship Python as a
 *     default binary — child_process.spawn('python3', ...) would
 *     fail at runtime.
 *   • Adding a npm zip lib (archiver, jszip, yauzl…) would pull in
 *     transitive deps and grow the install footprint.
 *   • ZIP file format for ~10 small files is ~100 lines of clean
 *     code; the only fiddly bit is the CRC-32 lookup table, which
 *     is well-documented and self-contained.
 *
 * Vercel bundler caveat: this route reads files at runtime via
 * node:fs, which the bundler can't statically trace. The matching
 * `outputFileTracingIncludes` block in next.config.js forces the
 * extension/ folder into the trace so the deployed function actually
 * has the files to ship.
 *
 * Public, no auth: same posture as the /extension-install page
 * (anonymous friends-&-family testers must be able to reach the
 * download). Rate limiting is intentionally not added for soft
 * launch — the artifact is < 50 KB, and a tight limit would just
 * create support tickets.
 */

import { NextResponse } from 'next/server'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep, posix } from 'node:path'
import { deflateRawSync } from 'node:zlib'

export const runtime = 'nodejs'
// `force-dynamic` opts out of Next's static prerender pass — the
// route reads from the filesystem at request time, so it has to
// run per request. Edge caching is controlled by the
// `Cache-Control` header on the response (below), not by this
// directive (which only governs the build-time prerender step).
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// The Next.js bundler can rewrite process.cwd() in some environments,
// so we resolve relative to the project root via the conventional
// "where the repo was at build time" anchor. process.cwd() inside a
// Next.js Serverless Function is the project root, so this is correct
// for both Vercel + local dev. The outputFileTracingIncludes hint in
// next.config.js is what guarantees the files are actually present.
const EXTENSION_DIR = join(process.cwd(), 'extension')

// Files to exclude from the zip. Mirrors scripts/package-extension.py
// so the yarn build and the API endpoint produce identical artefacts.
const EXCLUDE_SUFFIXES = ['.md', '.map', '.log', '.pyc', '.swp', '.swo']
const EXCLUDE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'node_modules',
  '__pycache__',
  '.git',
  '.next',
  'package-lock.json',
  'yarn.lock',
])

// Static MS-DOS date/time (2024-01-01 00:00:00) so identical input
// produces byte-identical output, and we don't have to handle
// pre-1980 wrap-around in the date encoder. Chrome's unzip code
// doesn't care about the timestamp, so a constant is fine.
const DOS_TIME = 0
const DOS_DATE = (2024 - 1980) << 9 | (1 << 5) | 1

// ---------------------------------------------------------------------------
// CRC-32 (PKZIP polynomial 0xEDB88320) — table-driven, ~256-byte
// constant memory cost. Avoids depending on a polyfill or a Node
// flag-gated zlib.crc32.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// Minimal ZIP encoder
// ---------------------------------------------------------------------------
//
// Format reference: APPNOTE.TXT 6.3.10. We emit:
//   • Local file header (signature 0x04034b50) per file
//   • Compressed (or stored) file data
//   • Central directory file header (signature 0x02014b50) per file
//   • End of central directory record (signature 0x06054b50)
//
// We use deflate (method 8) when it actually shrinks the file;
// otherwise we fall back to store (method 0) so tiny files like
// manifest.json don't grow by a few bytes from the deflate header.

/**
 * @param {{name: string, data: Buffer}[]} files
 * @returns {Buffer} zip archive
 */
function buildZip(files) {
  const chunks = []
  const central = []
  let offset = 0

  for (const file of files) {
    // ZIP entries use forward-slash separators regardless of host OS.
    // path.posix.normalize + a leading-slash strip keeps the layout
    // flat: "icons/icon16.png" rather than "icons\\icon16.png" on
    // Windows dev machines, which Chrome would silently reject.
    const posixName = posix.join(...file.name.split(sep))
    const nameBuf = Buffer.from(posixName, 'utf-8')

    // Deflate; fall back to store for files where deflate adds overhead.
    const deflated = deflateRawSync(file.data)
    const useDeflate = deflated.length < file.data.length
    const payload = useDeflate ? deflated : file.data
    const method = useDeflate ? 8 : 0
    const crc = crc32(file.data)

    // Local file header (30 bytes + filename + extra)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0) // signature
    lh.writeUInt16LE(20, 4) // version needed
    lh.writeUInt16LE(0, 6) // gp flags
    lh.writeUInt16LE(method, 8) // compression method
    lh.writeUInt16LE(DOS_TIME, 10)
    lh.writeUInt16LE(DOS_DATE, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(payload.length, 18) // compressed size
    lh.writeUInt32LE(file.data.length, 22) // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26) // filename length
    lh.writeUInt16LE(0, 28) // extra field length

    chunks.push(lh, nameBuf, payload)

    // Central directory entry (46 bytes + filename + extra + comment)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0) // signature
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0, 8) // gp flags
    cd.writeUInt16LE(method, 10) // compression method
    cd.writeUInt16LE(DOS_TIME, 12)
    cd.writeUInt16LE(DOS_DATE, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(payload.length, 20)
    cd.writeUInt32LE(file.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30) // extra field length
    cd.writeUInt16LE(0, 32) // comment length
    cd.writeUInt16LE(0, 34) // disk number start
    cd.writeUInt16LE(0, 36) // internal file attributes
    cd.writeUInt32LE(0, 38) // external file attributes
    cd.writeUInt32LE(offset, 42) // relative offset of local header

    central.push(cd, nameBuf)
    offset += lh.length + nameBuf.length + payload.length
  }

  const centralSize = central.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // signature
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk where central dir starts
  eocd.writeUInt16LE(files.length, 8) // entries on this disk
  eocd.writeUInt16LE(files.length, 10) // total entries
  eocd.writeUInt32LE(centralSize, 12) // size of central dir
  eocd.writeUInt32LE(offset, 16) // offset of central dir
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...chunks, ...central, eocd])
}

// ---------------------------------------------------------------------------
// Filesystem walker
// ---------------------------------------------------------------------------

function shouldSkip(name) {
  if (EXCLUDE_NAMES.has(name)) return true
  for (const suffix of EXCLUDE_SUFFIXES) {
    if (name.endsWith(suffix)) return true
  }
  return false
}

function collectFiles(dir) {
  /** @type {{name: string, data: Buffer}[]} */
  const out = []
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (shouldSkip(entry.name)) continue
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const rel = relative(dir, full)
        out.push({ name: rel, data: readFileSync(full) })
      }
    }
  }
  walk(dir)
  // Stable order so the produced zip is byte-identical across requests
  // (helps with debugging + ETag-style client caches).
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  // Stat the dir first so we surface a 500 (not a 200 with empty zip)
  // when the extension/ folder is missing — that would otherwise be
  // a silent footgun: the user downloads "jobbpiloten-extension.zip"
  // and Chrome says "could not load manifest".
  let stat
  try {
    stat = statSync(EXTENSION_DIR)
  } catch (e) {
    console.error('[extension/download] cannot stat extension dir:', e?.message)
    return new NextResponse(
      JSON.stringify({ error: 'Extension artifacts saknas på servern.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (!stat.isDirectory()) {
    console.error(
      '[extension/download] extension path exists but is not a directory:',
      EXTENSION_DIR,
    )
    return new NextResponse(
      JSON.stringify({ error: 'Extension-sökvägen är inte en katalog.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let files
  try {
    files = collectFiles(EXTENSION_DIR)
  } catch (e) {
    console.error('[extension/download] failed to read extension dir:', e?.message)
    return new NextResponse(
      JSON.stringify({ error: 'Kunde inte läsa extension-filer.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (files.length === 0) {
    return new NextResponse(
      JSON.stringify({ error: 'Extension-mappen är tom.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Sanity check: manifest.json must be present at the zip root AND
  // must parse as valid JSON. Without the parse check, a corrupted
  // manifest would slip through into the zip and the user would get
  // Chrome's "Manifest is not valid JSON" error AFTER the download —
  // a strictly worse UX than a 500 with a clear message.
  const manifestEntry = files.find((f) => f.name === 'manifest.json')
  if (!manifestEntry) {
    return new NextResponse(
      JSON.stringify({
        error: 'manifest.json saknas i extension/ — installera inte denna zip.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
  let version = '0.0.0'
  try {
    const parsed = JSON.parse(manifestEntry.data.toString('utf-8'))
    if (typeof parsed.version === 'string' && parsed.version) {
      version = parsed.version
    }
  } catch (e) {
    console.error('[extension/download] manifest.json is not valid JSON:', e?.message)
    return new NextResponse(
      JSON.stringify({
        error: 'manifest.json är inte giltig JSON — installera inte denna zip.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const zipBuffer = buildZip(files)
  const filename = `jobbpiloten-extension-v${version}.zip`

  // Return the zip as a binary response. Next.js will set the
  // Content-Length from the Buffer, so we don't have to.
  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Soft-launch posture: no edge caching (the file may be
      // re-shipped during friends-&-family iteration), but allow
      // the browser to keep a copy so repeat clicks are instant.
      'Cache-Control': 'no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
