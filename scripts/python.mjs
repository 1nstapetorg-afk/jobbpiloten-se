#!/usr/bin/env node
/**
 * scripts/python.mjs — cross-platform Python 3 interpreter launcher.
 *
 * Replaces the previous POSIX-only `python3 scripts/...` literal in
 * `package:extension` and `package:extension:cws`, so the extension
 * packager can run on Windows boxes where `python3` is typically
 * absent but `py` (Microsoft launcher) or `python` (PY-laid PATH)
 * resolves Python 3.
 *
 * Probes `python3` → `python` → `py -3` in order; the first exec
 * that ENOENT-skips onward; the first one that spawns wins. Forwards
 * its exit code. Exits 127 if no interpreter resolves.
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
const scriptPath = isAbsolute(scriptArg) ? scriptArg : resolve(here, scriptArg)
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
  const result = spawnSync(bin, [...prefixArgs, scriptPath, ...forwardArgs], {
    stdio: 'inherit',
  })
  if (result.error) {
    lastError = result.error
    if (result.error.code === 'ENOENT') continue // not installed, try next
    // Non-ENOENT spawn errors are unrecoverable; surface verbatim.
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
  `No Python 3 interpreter found. Tried: ${interpreters
    .map(i => i.bin)
    .join(', ')}. Install Python 3.x and ensure it is on PATH ` +
    `(on Windows, the Microsoft Store or https://python.org installers will register \`py\`).`,
)
if (lastError) console.error(`Last spawn error: ${lastError.message}`)
process.exit(127)
