#!/usr/bin/env node
/**
 * scripts/run-dev.mjs — cross-platform launcher for `next dev` with the
 * project's NODE_OPTIONS heap flag.
 *
 * Replaces the previous
 *   `cross-env NODE_OPTIONS=--max-old-space-size=2048 next dev …`
 * chain in package.json. The whole job is "set one env var, spawn
 * next", and `cross-env` + `cross-env-shell` + `@epic-web/invariant`
 * add ~10 kB of transitive deps for that one task; doing it in pure
 * Node keeps `yarn install` lean and removes a Windows-vs-POSIX
 * shell-escape footgun.
 *
 * Honours an existing `NODE_OPTIONS` from the caller's env (so a
 * user can run `NODE_OPTIONS=--max-old-space-size=4096 yarn dev`
 * to bump the heap). Defaults to 2048 MB otherwise.
 *
 * Spawns `node <next-entrypoint>` rather than `next` so we don't
 * trip the Windows `.cmd` / `.bat` spawn gotcha — Node can't exec
 * those shims directly without `shell: true`, and adding shell:true
 * reintroduces the cross-platform quoting headaches we're trying to
 * avoid. The `next` package exposes its CLI as a regular JS file at
 * `next/dist/bin/next`, which Node can run on every platform.
 *
 * Forwards any extra CLI args (after `--`) to `next dev`.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

// Resolve the actual JS entrypoint of the next CLI. Uses the project's
// package.json as the resolution root so we hit the version the user
// installed via `yarn`, not whatever happens to be on ambient node_modules.
const requireFromRoot = createRequire(join(ROOT, 'package.json'))
let nextEntry
try {
  nextEntry = requireFromRoot.resolve('next/dist/bin/next')
} catch (e) {
  console.error(
    `Cannot resolve next/dist/bin/next from ${join(ROOT, 'package.json')}: ${e.message}\n` +
      `Did you run \`yarn install\`?`,
  )
  process.exit(127)
}

// Set NODE_OPTIONS only if the user didn't already override it. This
// is a deliberate inversion of the previous `cross-env NODE_OPTIONS=…`
// behaviour (which always overrode): letting the caller win means
// `NODE_OPTIONS=--max-old-space-size=4096 yarn dev` works for
// diagnosing OOM without editing source.
// Next.js reads NODE_OPTIONS from process.env on startup, so a 2 GB
// default heap is restored without forcing the user to set it on
// every `yarn dev`.
const env = { ...process.env }
if (!env.NODE_OPTIONS) env.NODE_OPTIONS = '--max-old-space-size=2048'

const args = ['dev', '--hostname', '0.0.0.0', ...process.argv.slice(2)]
const child = spawn(process.execPath, [nextEntry, ...args], {
  env,
  stdio: 'inherit',
})

child.on('exit', code => {
  // `?? 1` (not `?? 0`) so a signal-killed next (code: null on
  // POSIX SIGINT/SIGTERM) surfaces as a non-zero exit rather than
  // masquerading as success.
  process.exit(code ?? 1)
})
child.on('error', err => {
  console.error(`Failed to spawn next: ${err.message}`)
  process.exit(1)
})
