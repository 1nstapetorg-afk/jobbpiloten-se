#!/usr/bin/env node
/**
 * scripts/python.mjs — cross-platform Python 3 interpreter launcher
 * with per-candidate pre-flight `--version` probe.
 *
 * Replaces the previous POSIX-only `python3 scripts/...` literal in
 * `package:extension` and `package:extension:cws`, so the extension
 * packager can run on Windows boxes where `python3` is typically
 * absent but `py` (Microsoft launcher) or `python` (PY-laid PATH)
 * resolves Python 3.
 *
 * Probes `python3` → `python` → `py -3` in order. For each candidate,
 * runs `<bin> --version` with a 5-second timeout; only treats the
 * candidate as "usable" if (a) it spawns without ENOENT, (b) it exits
 * with status 0, and (c) its stdout or stderr mentions "Python 3.x".
 * This rules out:
 *   - Microsoft Store `python3` stub (Windows): EXISTS in PATH and
 *     EXECUTES without ENOENT, but exits non-zero — would otherwise
 *     abort the chain mid-fallback and never try `python` or `py`.
 *   - Pre-3.0 installs (POSIX): exits successfully but reports
 *     "Python 2.x" (we want 3.x for scripts/package-extension.py's
 *     f-strings + pathlib modern syntax).
 *   - PATH-laid wrappers that redirect to non-Python tools.
 *
 * Once a usable interpreter is found, invokes the requested script
 * with stdio: 'inherit' so the chosen interpreter's stdout/stderr
 * propagates verbatim (a real failure in scripts/package-extension.py
 * still surfaces). Forwards exit status. Exits 127 if no candidate
 * resolves.
 *
 * Usage:
 *   node scripts/python.mjs scripts/package-extension.py --cws
 */

import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const scriptArg = process.argv[2]
if (!scriptArg) {
  console.error('Usage: node scripts/python.mjs <python-script> [args...]')
  process.exit(2)
}
// Resolve the script path. Script path is interpreted relative to
// the INVOKER's cwd (NOT relative to the launcher's own location)
// — this matches how every Node CLI tool resolves its first arg and
// lets a single launcher binary be called from the project root
// without producing a doubled path. Two forms both work:
//
//   node scripts/python.mjs scripts/package-extension.py --cws
//     (cwd=<repo root>, scriptArg resolves to scripts/package-extension.py)
//   cd scripts && node python.mjs package-extension.py --cws
//     (cwd=<repo>/scripts, scriptArg resolves to package-extension.py)
//
// Round-79.5 finding: the prior `resolve(here, scriptArg)` form
// produced `scripts/scripts/...` when invoked from the repo root,
// which surfaced as `python: can't open file .../[Errno 2]` after
// the per-candidate probe let us get past the previously-broken
// python3 → python → py fallback chain. Always-cwd matches Node's
// built-in `require()` and `child_process.spawn()` semantics.
const scriptPath = isAbsolute(scriptArg) ? scriptArg : resolve(process.cwd(), scriptArg)
const forwardArgs = process.argv.slice(3)

/** Preference order for the Python 3 interpreter. Add higher here to
 *  try a new candidate before falling through to `py -3`. */
const interpreters = [
  { bin: 'python3', prefixArgs: [] }, // POSIX default
  { bin: 'python', prefixArgs: [] }, // PATH-laid symlink or Windows install
  { bin: 'py', prefixArgs: ['-3'] }, // Microsoft launcher
]

let lastError = null
for (const { bin, prefixArgs } of interpreters) {
  // Per-candidate `--version` probe. Runs under stdio: 'pipe' (NOT
  // 'inherit') so the user's terminal does NOT see the
  // "Python 3.x.y" banner from every candidate we try — only from
  // the one we ultimately pick. 5-second timeout caps the worst-case
  // hang if e.g. a PATH-laid wrapper prompts interactively.
  const probe = spawnSync(bin, [...prefixArgs, '--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  })
  if (probe.error) {
    lastError = probe.error
    if (probe.error.code === 'ENOENT') continue // not installed, try next
    // Non-ENOENT spawn errors are unrecoverable; surface verbatim.
    console.error(`${bin}: ${probe.error.message}`)
    process.exit(probe.status ?? 1)
  }
  // Probe exited non-zero — most commonly the Microsoft-Store
  // python3 stub on Windows (exists, runs, but immediately fails).
  // We CONTINUE rather than exit, because the next candidate may
  // resolve.
  if (probe.status !== 0) continue
  // Probe ran but its output doesn't claim to be Python 3.x. This
  // catches pre-3.0 installs as well as PATH-laid wrappers that
  // redirect to non-Python tools. stdout may be empty on Windows
  // (Python prints version to stderr there); check both streams.
  const probeOut = (probe.stdout?.toString?.() || '') + (probe.stderr?.toString?.() || '')
  if (!/Python 3\./.test(probeOut)) continue

  // Candidate is verified Python 3.x — invoke the actual script with
  // stdio: 'inherit' so the chosen interpreter's stdout/stderr
  // propagates verbatim. A REAL failure in scripts/package-extension.py
  // (e.g. a syntax error) still surfaces to the user's terminal.
  const result = spawnSync(bin, [...prefixArgs, scriptPath, ...forwardArgs], {
    stdio: 'inherit',
  })
  if (result.error) {
    lastError = result.error
    if (result.error.code === 'ENOENT') continue // extreme edge: invoked bin vanished mid-run
    console.error(`${bin}: ${result.error.message}`)
    process.exit(result.status ?? 1)
  }
  // Spawn succeeded; exit with the interpreter's status.
  // `?? 1` (not `?? 0`) so a signal-killed child (status: null on
  // POSIX SIGINT/SIGTERM) surfaces as a non-zero exit rather than
  // masquerading as success.
  process.exit(result.status ?? 1)
}

console.error(
  `No usable Python 3 interpreter found. Tried: ${interpreters
    .map(i => i.bin)
    .join(', ')}. Install Python 3.x and ensure it is on PATH ` +
    `(on Windows, the Microsoft Store or https://python.org installers will register \`py\`).`,
)
if (lastError) console.error(`Last spawn error: ${lastError.message}`)
process.exit(127)
