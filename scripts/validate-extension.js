#!/usr/bin/env node
/**
 * validate-extension.js
 *
 * Pre-packaging sanity check for the JobbPiloten Auto-Fill extension.
 * Runs in <100 ms with zero npm dependencies so it can be a hard
 * gate inside `yarn package:extension` and `yarn validate:extension`
 * without adding to the install footprint.
 *
 * Checks performed (in order, fail-fast):
 *   1. extension/manifest.json parses as JSON.
 *   2. manifest_version === 3 (we only ship MV3).
 *   3. Required top-level fields are present: name, version,
 *      action.default_popup, background.service_worker, content_scripts,
 *      icons.
 *   4. Every file referenced from the manifest exists on disk:
 *        - icons (top-level + action.default_icon)
 *        - action.default_popup (popup.html)
 *        - background.service_worker (background.js)
 *        - content_scripts[].js
 *        - any web_accessible_resources
 *   5. Icon PNGs are exactly the sizes Chrome expects (16/48/128).
 *      Reads the IHDR chunk directly (bytes 16-23) — no sharp/PIL dep.
 *   6. Optional: warns on `*.md` files inside the extension folder
 *      since the packaging script excludes them and the user may have
 *      forgotten to scrub.
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (errors printed to stderr)
 *   2 — fatal: extension/ folder missing entirely
 *
 * USAGE
 *   node scripts/validate-extension.js
 *   yarn validate:extension
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { openSync, readSync, closeSync } = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const EXT = path.join(ROOT, 'extension')

// Subset of Chrome MV3's public permissions list — just the names
// a third-party extension is likely to declare. Chrome silently
// rejects installs that name an unknown permission, so catching
// typos here is high-value. The list isn't exhaustive (new
// permissions ship in every Chrome release) but covers everything
// the JobbPiloten extension uses today plus the common neighbours.
const KNOWN_PERMISSIONS = new Set([
  'activeTab',
  'alarms',
  'background',
  'bookmarks',
  'clipboardRead',
  'clipboardWrite',
  'contentSettings',
  'contextMenus',
  'cookies',
  'debugger',
  'declarativeNetRequest',
  'desktopCapture',
  'downloads',
  'favicon',
  'geolocation',
  'history',
  'identity',
  'idle',
  'management',
  'nativeMessaging',
  'notifications',
  'pageCapture',
  'power',
  'privacy',
  'proxy',
  'readingList',
  'scripting',
  'search',
  'sidePanel',
  'storage',
  'tabGroups',
  'tabs',
  'topSites',
  'tts',
  'ttsEngine',
  'unlimitedStorage',
  'webNavigation',
  'webRequest',
  'webRequestBlocking',
  'windows',
])

// ---- Output helpers (use ANSI colors only if stderr is a TTY) ----
const isTTY = process.stderr.isTTY
const RED = isTTY ? '\x1b[31m' : ''
const YELLOW = isTTY ? '\x1b[33m' : ''
const GREEN = isTTY ? '\x1b[32m' : ''
const DIM = isTTY ? '\x1b[2m' : ''
const RESET = isTTY ? '\x1b[0m' : ''

let errorCount = 0
let warningCount = 0

function err(msg) {
  errorCount++
  console.error(`${RED}✗${RESET} ${msg}`)
}
function warn(msg) {
  warningCount++
  console.error(`${YELLOW}!${RESET} ${msg}`)
}
function ok(msg) {
  console.error(`${GREEN}✓${RESET} ${msg}`)
}
function info(msg) {
  console.error(`${DIM}  ${msg}${RESET}`)
}

// ---- PNG dimension probe (no external deps) ----
// Layout: 8-byte signature + 4-byte IHDR length + "IHDR" (4 ASCII)
// + width (4 BE) + height (4 BE). The IHDR chunk is mandatory as
// the FIRST chunk of any valid PNG (per the W3C PNG spec §3.2), so
// the bytes 12-15 are guaranteed to read "IHDR" for every conformant
// file. We verify the marker so a non-PNG file renamed to .png
// (or a corrupted PNG with a swapped chunk order) returns null
// instead of misreading whatever bytes happen to live at 16-23.
function getPngSize(filePath) {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(24)
    const bytesRead = readSync(fd, buf, 0, 24, 0)
    if (bytesRead < 24) return null
    // 8-byte PNG signature
    if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return null
    // 4-byte ASCII "IHDR" chunk type marker
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    }
  } finally {
    closeSync(fd)
  }
}

// ---- Manifest cross-reference checks ----
function collectReferencedFiles(manifest) {
  const refs = new Set()
  // Top-level icons (used by Chrome Web Store + toolbar)
  if (manifest.icons && typeof manifest.icons === 'object') {
    for (const v of Object.values(manifest.icons)) {
      if (typeof v === 'string') refs.add(v)
    }
  }
  // action.default_popup + action.default_icon
  if (manifest.action && typeof manifest.action === 'object') {
    const a = manifest.action
    if (typeof a.default_popup === 'string') refs.add(a.default_popup)
    if (a.default_icon && typeof a.default_icon === 'object') {
      for (const v of Object.values(a.default_icon)) {
        if (typeof v === 'string') refs.add(v)
      }
    }
  }
  // background.service_worker
  if (manifest.background && typeof manifest.background.service_worker === 'string') {
    refs.add(manifest.background.service_worker)
  }
  // content_scripts[].js + content_scripts[].css
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs.js)) cs.js.forEach((f) => refs.add(f))
      if (Array.isArray(cs.css)) cs.css.forEach((f) => refs.add(f))
    }
  }
  // web_accessible_resources — strings OR { resources: [...] } shapes
  if (Array.isArray(manifest.web_accessible_resources)) {
    for (const r of manifest.web_accessible_resources) {
      if (typeof r === 'string') refs.add(r)
      else if (r && Array.isArray(r.resources)) r.resources.forEach((f) => refs.add(f))
    }
  }
  return refs
}

// ---- Main ----
function main() {
  console.error(`Validating ${path.relative(ROOT, EXT)}/ ...`)

  if (!fs.existsSync(EXT)) {
    err(`extension folder missing: ${EXT}`)
    console.error('\nFATAL: cannot continue without extension/.')
    process.exit(2)
  }

  const manifestPath = path.join(EXT, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    err(`manifest.json missing at ${manifestPath}`)
    process.exit(1)
  }

  // --- 1. JSON parse ---
  let manifest
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    manifest = JSON.parse(raw)
    ok('manifest.json parses as valid JSON')
  } catch (e) {
    err(`manifest.json is not valid JSON: ${e.message}`)
    process.exit(1)
  }

  // --- 2. manifest_version ---
  if (manifest.manifest_version !== 3) {
    err(`manifest_version must be 3, got ${JSON.stringify(manifest.manifest_version)}`)
  } else {
    ok('manifest_version === 3')
  }

  // --- 3. Required top-level fields ---
  const required = [
    ['name', 'string'],
    ['version', 'string'],
  ]
  for (const [key, kind] of required) {
    if (typeof manifest[key] !== kind) {
      err(`manifest.${key} missing or not a ${kind}`)
    }
  }
  if (typeof manifest.name === 'string') ok(`name: ${manifest.name}`)
  if (typeof manifest.version === 'string') ok(`version: ${manifest.version}`)

  if (!manifest.action || typeof manifest.action.default_popup !== 'string') {
    err('manifest.action.default_popup missing (popup won\'t open)')
  } else {
    ok(`action.default_popup: ${manifest.action.default_popup}`)
  }
  if (!manifest.background || typeof manifest.background.service_worker !== 'string') {
    err('manifest.background.service_worker missing (no service worker)')
  } else {
    ok(`background.service_worker: ${manifest.background.service_worker}`)
  }
  if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
    err('manifest.content_scripts missing or empty (content script won\'t inject)')
  } else {
    ok(`content_scripts: ${manifest.content_scripts.length} entry(ies)`)
  }
  if (!manifest.icons || typeof manifest.icons !== 'object') {
    err('manifest.icons missing (Chrome Web Store rejects without icons)')
  } else {
    ok(`icons: ${Object.keys(manifest.icons).join(', ')}`)
  }

  // --- 4. All referenced files exist ---
  const refs = collectReferencedFiles(manifest)
  if (refs.size === 0) {
    warn('no files referenced from manifest (this is unusual)')
  } else {
    info(`checking ${refs.size} referenced file(s) exist on disk ...`)
  }
  for (const ref of refs) {
    const full = path.join(EXT, ref)
    if (!fs.existsSync(full)) {
      err(`manifest references ${ref} but ${path.relative(ROOT, full)} does not exist`)
    } else {
      const stat = fs.statSync(full)
      if (stat.size === 0) {
        err(`manifest references ${ref} but the file is empty (0 bytes)`)
      } else {
        info(`  ${ref}  ${(stat.size / 1024).toFixed(1)} KB`)
      }
    }
  }

  // --- 5. Icon sizes ---
  if (manifest.icons && typeof manifest.icons === 'object') {
    for (const [size, ref] of Object.entries(manifest.icons)) {
      const expected = parseInt(size, 10)
      if (Number.isNaN(expected)) {
        warn(`icon key "${size}" is not a numeric size — skipping dimension check`)
        continue
      }
      const full = path.join(EXT, ref)
      if (!fs.existsSync(full)) continue // already reported above
      const dims = getPngSize(full)
      if (!dims) {
        err(`icons.${size} (${ref}) is not a valid PNG (signature/IHDR missing or file too small)`)
        continue
      }
      if (dims.width !== expected || dims.height !== expected) {
        err(`icons.${size} (${ref}) is ${dims.width}x${dims.height}, expected ${expected}x${expected}`)
      } else {
        ok(`icons.${size} (${ref}) is ${dims.width}x${dims.height}`)
      }
    }
  }

  // --- 5b. Permissions sanity check ---
  // Chrome rejects installs with unknown permission names at LOAD
  // time, not at zip-build time — exactly the silent-failure class
  // this validator exists to prevent. We warn (not error) on
  // unknowns so the validator stays useful for private/internal
  // permission names that aren't in the public docs.
  if (Array.isArray(manifest.permissions)) {
    const unknown = manifest.permissions.filter((p) => !KNOWN_PERMISSIONS.has(p))
    if (unknown.length > 0) {
      warn(
        `manifest.permissions contains ${unknown.length} name(s) not in Chrome's public list — ` +
        `double-check spelling, or Chrome will reject the install:`,
      )
      unknown.forEach((p) => info(`  ${p}`))
    } else {
      ok(`permissions: all ${manifest.permissions.length} entries are recognised`)
    }
  }
  if (Array.isArray(manifest.host_permissions)) {
    const unknown = manifest.host_permissions.filter(
      (p) => typeof p !== 'string' || !/^(<all_urls>|\*|https?:\/\/|\*:\/\/)/.test(p),
    )
    if (unknown.length > 0) {
      warn(`host_permissions contains ${unknown.length} suspicious entry(ies) (should be "<all_urls>" or an origin pattern):`)
      unknown.forEach((p) => info(`  ${p}`))
    }
  }

  // --- 6. md file scrub (warning only) ---
  const mdFiles = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) mdFiles.push(full)
    }
  }
  walk(EXT)
  if (mdFiles.length > 0) {
    warn(`${mdFiles.length} .md file(s) found in extension/ — the packaging script excludes them, but make sure they don't ship to the Chrome Web Store:`)
    mdFiles.forEach((f) => info(`  ${path.relative(EXT, f)}`))
  }

  // --- Summary ---
  console.error('')
  if (errorCount > 0) {
    console.error(`${RED}${errorCount} error(s)${RESET}, ${warningCount} warning(s)`)
    process.exit(1)
  }
  if (warningCount > 0) {
    console.error(`${GREEN}OK${RESET} with ${warningCount} warning(s)`)
    process.exit(0)
  }
  console.error(`${GREEN}OK${RESET} — all checks passed`)
  process.exit(0)
}

main()
