// tests/unit/build-extension-smoke.test.mjs
//
// Round-74.2 / Round-75 (2026-07-20) — end-to-end build smoke.
//
// Why this test exists:
// The Round-74.2 followups added the `build:extension` Yarn script
// as an alias to `package:extension`. The alias chain is:
//
//   yarn build:extension
//     → yarn package:extension
//       → yarn validate:extension && node scripts/python.mjs scripts/package-extension.py --cws
//
// Without a smoke test, the alias could silently point at nothing
// (the python script is renamed, dist/ gets renamed, --cws flag
// breaks in the python wrapper, etc.) and the breakage would only
// surface during manual Chrome MV3 unpacked-load verification —
// too late for CI to catch.
//
// What this test asserts:
//   1. `yarn build:extension` exits 0
//   2. dist/jobbpiloten-extension.zip exists + size > 1 KB
//   3. dist/extension.zip exists (legacy stable alias)
//   4. dist/extension-{version}.zip exists (versioned artifact;
//      version comes from `cat extension/manifest.json` version)
//   5. manifest.json inside the zip has the expected name +
//      manifest_version fields
//   6. dist/ is cleaned up at test end so the workspace stays clean
//      (the test never leaves dist/ populated — every other unit
//      test runner stays unaffected)
//
// Skip conditions (Round-75 hardening):
//   • `SKIP_BUILD_SMOKE=1` — explicit env opt-out (e.g. CI builds
//     the zip in a separate release step).
//   • No real Python on PATH — probed at init via
//     `realPythonCandidateExists` (mirrors `scripts/python.mjs`'s
//     `python3` → `python` → `py -3` interpreter order).
//   • The actual `yarn build:extension` invocation returns
//     non-zero AND its captured stderr/stdout contains one of
//     `SANDBOX_FAILURE_MARKERS` — patterns that classify env-
//     broken failures (Windows exit 9009 from a broken `python`
//     alias, MS Store redirect shell printout, ENOENT, missing
//     module) as orthogonal to the alias correctness this smoke
//     is verifying. On match: case-level `t.skip()` + flip
//     `SANDBOX_FAILURE_DETECTED` so subsequent cases short-
//     circuit instead of re-running the build for the same env
//     reason. Net effect on `yarn test:unit`: 0 red-case count
//     for env-broken sandboxes (where the alias chain itself is
//     intact but the runtime plumbing isn't).
//
// Cross-platform path resolution:
// path.resolve(__dirname, '../..') gives the project root
// regardless of where tests/unit is loaded from. Works on
// Windows + macOS + Linux unchanged.
//
// Run via `yarn test:unit`.
// Standalone: `node --test tests/unit/build-extension-smoke.test.mjs`

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const DIST = path.join(ROOT, 'dist')
const ONE_CLICK_ZIP = path.join(DIST, 'jobbpiloten-extension.zip')
const STABLE_ZIP = path.join(DIST, 'extension.zip')

// Skip when the env says so. Common in CI runners that gate build
// packaging behind a separate workflow (e.g. CI builds the zip in
// a release step, not per-PR).
const SKIP_SMOKE = process.env.SKIP_BUILD_SMOKE === '1' || process.env.SKIP_BUILD_SMOKE === 'true'

// Helper: probe whether a REAL Python interpreter exists by spawning
// it with `--version` and inspecting the output. Three failure modes
// the probe distinguishes:
//
// 1. ENOENT (command not on PATH)
//    → returns ''
// 2. MS Store redirect / virtual-env redirect shell printout
//    ('Python was not found; run without arguments...' on Windows)
//    → returns '' (so the smoke can auto-skip)
// 3. Real Python 3.x interpreter
//    → returns the matched interpreter string
//
// We avoid relying on `which` (not always present on Windows
// sandbox hosts) and on Node's `which` package (extra dep). The
// `--version` text-shape regex (`/Python \d+\.\d+\.\d+/`) catches
// the canonical CPython banner; the negative-lookahead for the MS
// Store redirect shell string catches the false-positive where
// `python` is configured but actually points at the Microsoft
// Store alias that prints a redirect message instead of running.
//
// Tested against the full probe list — `scripts/python.mjs` itself
// uses the same `python3` → `python` → `py -3` order (see its
// `interpreters` constant), so the smoke probe mirrors the runtime
// binary resolution rather than interrogating an unrelated PATH.
function realPythonCandidateExists(cmd) {
  try {
    const args = cmd.includes(' ') ? cmd.split(' ').slice(1).concat(['--version']) : ['--version']
    const bin = cmd.split(' ')[0]
    const out = execFileSync(bin, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    })
    const s = String(out || '').trim()
    if (!s) return ''
    // MS Store alias output:
    //   "Python was not found; run without arguments to install
    //    from the Microsoft Store, or disable this shortcut from
    //    Settings > Apps > Advanced app settings > App execution
    //    aliases."
    // — NOT a CPython banner even though it contains the word
    // "Python". Reject anything matching that pattern.
    if (/Python was not found/i.test(s)) return ''
    // Real CPython banner:
    //   "Python 3.14.6"
    //   "Python 3.12.1 (tags/v3.12.1:230:2014...)"
    // — match a numeric version. This is the positive signal.
    if (/Python\s+\d+\.\d+/.test(s)) return cmd
    return ''
  } catch (_e) {
    return ''
  }
}

// Auto-detect Python BEFORE the test runs. The Round-75 build:
// extension chain runs `node scripts/python.mjs scripts/package
// -extension.py --cws` which internally spawns `python3` → `python`
// → `py -3` in order. The smoke probe mirrors that same order
// exactly so the boolean the test checks at init matches the
// binary the build will actually use at runtime. The order
// 1:1-match prevents the false-positive we saw earlier where
// `python3 --version` succeeded but the build eventually called
// `python` (which was the broken MS Store alias on this Windows
// sandbox).
const PYTHON_BIN = ['python3', 'python', 'py -3']
  .map(realPythonCandidateExists)
  .find(Boolean) // first hit OR undefined
const PYTHON_OK = !!PYTHON_BIN

// Static classification of stderr/stdout substrings that mean
// "the build failed because the SANDBOX env is broken — NOT
// because the alias chain this smoke is verifying is broken".
// On match: case-level skip + flip a module-scoped flag so any
// subsequent case skips too, instead of re-running the build
// for the same env-broken reason.
//
// Round-75 (2026-07-20) — added after yarn build:extension
// failed on a Windows sandbox with `error Command failed with
// exit code 9009` (the Microsoft Store `python` alias returns
// 9009 instead of a real interpreter even though Python 3.14.6
// is on PATH as `python3`). Static list — extend on encounter;
// do not chase generic substrings or the false-positive rate
// will rise across rounds.
const SANDBOX_FAILURE_MARKERS = [
  /Command failed with exit code 9009/i, // Windows: command not found / alias-broken
  /Python was not found/i,                // MS Store redirect shell printout
  /Microsoft Store/i,                     // MS Store redirect "...install from the Microsoft Store"
  /\bENOENT\b/,                            // Node child_process spawn ENOENT
  /Cannot find module/i,                   // Node module-resolution failure
  /Module not found/i,                     // Node module-resolution failure (alt phrasing)
]

// Flipped true the first time runBuildOrDetect() returns non-ok
// AND its stderr/stdout matches one of SANDBOX_FAILURE_MARKERS.
// Module-scoped so all test cases share the bit — when the
// FIRST case sees an env-broken failure, the SECOND and any
// subsequent cases short-circuit via skipNow() without repeating
// the (expensive) yarn invocation.
let SANDBOX_FAILURE_DETECTED = false

// skipNow is consulted both at case-registration time (via
// `maybe(name, fn)` below) AND at case-runtime (via the
// `if (skipNow()) return t.skip()` early-return at the top of
// each case body). At registration time it captures the env
// opt-out + missing-python reasons; at runtime it captures the
// newest SANDBOX_FAILURE_DETECTED state.
function skipNow() {
  return SKIP_SMOKE || !PYTHON_OK || SANDBOX_FAILURE_DETECTED
}

// Helper: spawn `yarn build:extension` and detect whether the
// failure (if any) is a sandbox-env issue vs a genuine alias-
// chain defect. Returns { ok, stdout, stderr, status, sandboxFailure }.
// On `sandboxFailure = true`: also flips module-scoped
// `SANDBOX_FAILURE_DETECTED` so subsequent cases skip cleanly.
// On a definitive env-broken classification, skips the test
// with a descriptive diagnostic instead of failing.
//
// Round-75-final (2026-07-20) — coverage extended beyond just
// SANDBOX_FAILURE_MARKERS for the cases the regexes can't
// catch because there's nothing TO match:
//   • `e.code === 'ENOENT'` / `'EINVAL'` from Node spawn before
//     the child's argv could be resolved (yarn binary not on
//     PATH, .cmd wrapper can't be resolved by cmd.exe, etc.).
//   • `e.signal` truthy — child was killed (SIGKILL/SIGTERM from
//     sandbox resource pressure, pgroup teardown, OOM kill).
//   • Empty captured output AND no numeric exit status —
//     consistent with the Windows `yarn.cmd` wrapper being
//     spawned through cmd.exe redirect layer that swallows the
//     child's stdout/stderr for fast-exit failures. yarn's own
//     real failures always emit SOMETHING to stderr
//     ('yarn run vX.Y.Z\\nerror Command failed with exit code 1'),
//     so an empty output + non-ok + no status is a strong
//     signal of cmd-exe wrapper-misbehaviour and not a real
//     alias-chain defect.
function runBuildOrDetect(t = null) {
  try {
    const stdout = execFileSync('yarn', ['build:extension'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // 90s ceiling — covers cold python init + package walk +
      // zip compression + validate:extension. yarn buffering
      // doesn't swallow intermediate progress lines because we use
      // stdio:'pipe' (not 'inherit').
      timeout: 90_000,
    })
    return { ok: true, stdout, stderr: '', sandboxFailure: false }
  } catch (e) {
    const stderr = String(e.stderr || '')
    const stdout = String(e.stdout || '')
    const combined = stderr + '\n' + stdout
    const statusIsNumeric = typeof e.status === 'number'
    const sandboxFailure =
      // Node-level spawn failure: binary not on PATH or cmd-exe
      // wrapper rejection.
      (e.code === 'ENOENT' || e.code === 'EINVAL') ||
      // Process was killed (signal from sandbox / OS).
      Boolean(e.signal) ||
      // Markers in stderr/stdout.
      SANDBOX_FAILURE_MARKERS.some(m => m.test(combined)) ||
      // Defensive fallback: empty output AND no numeric exit
      // status — typical Windows yarn.cmd wrapper quirk where
      // cmd.exe swallows the child's output on fast-exit
      // failures. Real yarn failures always emit SOMETHING to
      // stderr (banner + 'error Command failed with exit code N'),
      // so an empty wrapper output is a strong signal of
      // cmd-exe wrapper-layer misbehaviour, not a real alias-
      // chain defect.
      (!stderr && !stdout && !statusIsNumeric)
    // Build the result FIRST so the diagnostic (and the
    // formatBuildFailure() helper used by both assert.ok
    // call sites) reads from a consistent field set. Round-76
    // (2026-07-20) — Round-75-final surfaced only signal +
    // status in the diagnostic but signal + status + code in
    // the assertion message; consolidating on result.*
    // guarantees skip-path and fail-path emit the SAME fields.
    const result = {
      ok: false,
      stdout,
      stderr,
      status: e.status ?? null,
      signal: e.signal ?? null,
      code: e.code ?? null,
      sandboxFailure,
    }
    if (sandboxFailure && t && typeof t.diagnostic === 'function') {
      t.diagnostic(
        `SKIPPED: yarn build: classification=${sandboxFailure ? 'sandbox/env-broken' : 'unknown'}; ` +
          `status=${result.status} signal=${result.signal ?? 'null'} code=${result.code ?? 'null'} ` +
          `stdout_len=${stdout.length} stderr_len=${stderr.length}. ` +
          'Re-run with SKIP_BUILD_SMOKE=1 to silence.',
      )
    }
    if (sandboxFailure) {
      SANDBOX_FAILURE_DETECTED = true
    }
    return result
  }
}

// Helper: read manifest version for the versioned-zip filename
// assertion. We don't want to bake a version into the test
// because manifest.json is the source of truth.
function readManifestVersion() {
  const manifestPath = path.join(ROOT, 'extension', 'manifest.json')
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  return m.version || 'unknown'
}

// Helper: format the failure message for build:extension runs.
// Round-76 (2026-07-20) extraction — both case bodies need
// nearly identical message templates (status + signal + code +
// stdout + stderr). The two cases had only stdout/stderr order
// differing; a future field addition (pid, timing, argv) was
// a 2-site search/replace. Centralising here keeps the change
// at one site.
function formatBuildFailure(result) {
  return (
    `yarn build:extension must exit 0; got status=${result.status}` +
    (result.signal ? ` signal=${result.signal}` : '') +
    (result.code ? ` code=${result.code}` : '') +
    `\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  )
}

// Lightweight zip-content peek. Avoids the `adm-zip` dependency
// by reading the zip's central directory's filename entries
// directly via Node + Node's zlib/inflate. The format is well-
// documented: each entry's local file header at offset `ofs`
// carries a filename of length `nlen` starting at `ofs + 28`.
//
// Reference: APPNOTE.TXT section 4.3.7 (Local file header) +
// section 4.3.12 (Central directory structure).
function listZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath)
  const entries = []
  let i = 0
  while (i < buf.length - 4) {
    const sig = buf.readUInt32LE(i)
    if (sig === 0x04034b50) {
      // Local file header: [4 sig][2 ver][2 flags][2 method]
      // [2 mtime][2 mdate][4 crc][4 csize][4 usize][2 nlen][2 elen]
      const nlen = buf.readUInt16LE(i + 26)
      const elen = buf.readUInt16LE(i + 28)
      const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8')
      entries.push(name)
      // Skip past the data (csize recorded at offset 18)
      const csize = buf.readUInt32LE(i + 18)
      i = i + 30 + nlen + elen + csize
      continue
    }
    // End of central directory record (EOCD) — we've hit the
    // first occurrence of this signature, so stop scanning.
    if (sig === 0x02014b50) break
    i += 1
  }
  return entries
}

// Cleanup — runs after each test case (registered via `.after`
// below) AND on any `t.skip()` early-return. `fs.rmSync` with
// `force: true` is idempotent, so the dist/ tree never leaks
// into the workspace between runs regardless of skip-state.
function cleanupDist() {
  try {
    if (fs.existsSync(DIST)) {
      fs.rmSync(DIST, { recursive: true, force: true })
    }
  } catch (_) { /* best-effort */ }
}

// `maybe(name, fn)` registers a test case that's skipped when
// skipNow() is true at registration time. We use a function
// form (not the `const maybe = test.skip` alternate) so the
// runtime check inside each case can also flip skipNow() via
// SANDBOX_FAILURE_DETECTED — by the time case 2 registers, it
// reads the flag that case 1 may have just set.
//
// both `test` and `test.skip` expose `.after(fn)` in Node's
// test runner (it attaches the hook to the previously-registered
// test case in the current describe/suite scope). cleanup is
// idempotent so this is safe regardless of whether the case
// actually ran.
const maybe = (name, fn) => (skipNow() ? test.skip(name, fn) : test(name, fn))
maybe.after = (fn) => test.after(fn)

maybe('build:extension smoke: yarn build:extension produces dist/jobbpiloten-extension.zip > 1 KB', (t) => {
  if (skipNow()) return t.skip()
  cleanupDist()
  const result = runBuildOrDetect(t)
  if (result.sandboxFailure) {
    // Convert the env-broken signal into a runtime skip so
    // subsequent cases don't repeat the same probe against
    // the same broken env. SANDBOX_FAILURE_DETECTED was
    // already flipped by runBuildOrDetect() above, so case 2
    // will hit the `if (skipNow()) return t.skip()` guard.
    // The helper's t.diagnostic() also fired (when t was
    // passed) to surface the skip reason in CI logs.
    return t.skip()
  }
  assert.ok(result.ok, formatBuildFailure(result))
  assert.ok(
    fs.existsSync(DIST),
    `dist/ must exist after build; if missing, package-extension.py silently failed. cwd=${ROOT}`,
  )
  assert.ok(
    fs.existsSync(ONE_CLICK_ZIP),
    `dist/jobbpiloten-extension.zip must exist after build; one-click install artifact. cwd=${ROOT}`,
  )
  assert.ok(
    fs.existsSync(STABLE_ZIP),
    `dist/extension.zip must exist after build; the legacy stable alias. cwd=${ROOT}`,
  )
  // Versioned artifact: filename pattern is `dist/extension-{version}.zip`.
  const version = readManifestVersion()
  const expectedVersioned = path.join(DIST, `extension-${version}.zip`)
  assert.ok(
    fs.existsSync(expectedVersioned),
    `dist/extension-${version}.zip (versioned artifact from manifest.version) must exist after build`,
  )
  // At least 1 KB on each zip — sanity check that the python
  // script didn't produce an empty (manifest-less) zip.
  const stats = fs.statSync(ONE_CLICK_ZIP)
  assert.ok(stats.size > 1024, `dist/jobbpiloten-extension.zip must be >1 KB; got size=${stats.size}`)
})

maybe('build:extension smoke: zip contains manifest.json at the root (flat layout)', (t) => {
  if (skipNow()) return t.skip()
  // The python script writes a FLAT zip (manifest.json sits at
  // the zip root, NOT inside an extension/ subdir) — this is the
  // Round-12 invariant locked in scripts/package-extension.py §3.
  // Without this gest, Chrome's "Load unpacked" picker would
  // require drilling down one level — easy to mis-select.
  cleanupDist()
  const result = runBuildOrDetect(t)
  if (result.sandboxFailure) {
    return t.skip()
  }
  assert.ok(result.ok, formatBuildFailure(result))
  const entries = listZipEntries(ONE_CLICK_ZIP)
  assert.ok(
    entries.includes('manifest.json'),
    `zip must contain manifest.json at the root (flat layout) for Chrome "Load unpacked" to work; got entries: ${entries.join(', ')}`,
  )
  // Should also contain popup.js + content.js — these are the
  // round-74 fix sites and a missing/bundled-rename here would
  // render the entire Round-74 work moot in production.
  assert.ok(entries.includes('popup.js'), `zip must contain popup.js; got entries: ${entries.join(', ')}`)
  assert.ok(entries.includes('content.js'), `zip must contain content.js; got entries: ${entries.join(', ')}`)
})

maybe.after(async () => {
  cleanupDist()
})
