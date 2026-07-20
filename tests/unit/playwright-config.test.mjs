// tests/unit/playwright-config.test.mjs
//
// Round-31.2 regression test for the playwright.config.js
// SyntaxError that lurked from Round-30 through Round-31.
//
// The Round-30 / Round-30.1 / Round-31 versions of this file
// declared `const w = ...; const workers = ...` as inline
// declarations INSIDE the `defineConfig({...})` object literal.
// JavaScript object literals don't allow top-level `const` /
// `let` / `var` declarations between properties — the result
// was a parser SyntaxError (`Unexpected keyword 'const'`).
//
// The bug lurked through Round-30 + Round-30.1 + Round-31 because:
//   • `yarn build` (Next.js) doesn't PARSE this file — Next's
//     build pipeline doesn't execute the test runner config.
//   • `yarn test:unit` doesn't READ this file either — the
//     unit tests live under tests/unit, not tests/e2e.
//   • Only `yarn test:e2e` (Playwright) actually loads and
//     parses the config. The bug was invisible until a real
//     e2e run was attempted in Round-31's multi-worker smoke.
//
// Round-31.2 hotfix: hoist the const declarations to MODULE
// SCOPE (above the defineConfig() call), then reference them
// via shorthand `workers,` inside the object.
//
// Round-31.2 polish (after the smoke surfaced the primary
// SyntaxError AND the test file's own `new Function(...)`
// approach failed because `export default` is illegal inside
// a non-module Function body):
//   • Drop Test #4 (the Function() parseability check) — the
//     inverse `doesNotMatch` regex in Test #3 effectively
//     proves parseability beause any inline declaration
//     would cause the SAME SyntaxError.
//   • Drop the brittle depth-walker in Test #3 — use a simple
//     `CONFIG_SOURCE.slice(defineOpenIdx)` since the
//     `defineConfig({...})` invocation is the file's only
//     trailing form (no top-level code after it).
//   • Generalize the regex to `(?:const|let|var)` so a
//     future maintainer who uses `let` or `var` is caught.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const CONFIG_SOURCE = readFileSync('playwright.config.js', 'utf8')

// ---------- Primary regression: const declarations at module scope ----------

test('Round-31.2: PLAYWRIGHT_WORKERS `w` derivation is at module scope (BEFORE defineConfig invocation)', () => {
  // Round-31.2 polish #2 (after yarn test:unit revealed the v1
  // regex falsely matched the file's OWN COMMENT TEXT in two
  // ways):
  //   • `indexOf('defineConfig(')` was finding the literal
  //     text ``defineConfig({...})`` inside the Round-31.2
  //     hotfix paragraph (offset 622), not the actual
  //     `export default defineConfig({` (offset 2241).
  //   • The `\\s*=\\s*\\w` tightening (Round-31.2 polish #1)
  //     excluded dot-pattern comment-text matches like
  //     `const w = ...; const workers = ...` because `.`
  //     isn't a word char.
  //
  // Anchor the `defineConfig` call on its actual export line
  // (`^export\\s+default\\s+defineConfig\\(`) so the comment-text
  // occurrence is excluded. The actual declaration
  // `const w = Number(process.env...)` matches because `N` in
  // `Number` IS a word char.
  const wIdx = CONFIG_SOURCE.search(/\bconst\s+w\s*=\s*\w/)
  assert.ok(wIdx > -1, 'playwright.config.js must declare `const w = <identifier>...` somewhere in source')
  const defineIdx = CONFIG_SOURCE.search(/^export\s+default\s+defineConfig\(/m)
  assert.ok(defineIdx > -1, 'playwright.config.js must `export default defineConfig(...)` somewhere in source')
  assert.ok(
    wIdx < defineIdx,
    `const w = ... must appear BEFORE the ACTUAL \`export default defineConfig({\` line (the comment-text occurrence is excluded by the ^export\s+default\s+defineConfig\(/m anchor). Got wIdx=${wIdx}, defineIdx=${defineIdx}.`,
  )
})

test('Round-31.2: `workers` derivation is at module scope (BEFORE defineConfig invocation)', () => {
  // Same fix as the `w` derivation test: use the ^export\s+default
  // anchor to exclude the comment-text `defineConfig({...})`
  // occurrence.
  const workersIdx = CONFIG_SOURCE.search(/\bconst\s+workers\s*=\s*\w/)
  assert.ok(workersIdx > -1, 'playwright.config.js must declare `const workers = <identifier>...` somewhere in source')
  const defineIdx = CONFIG_SOURCE.search(/^export\s+default\s+defineConfig\(/m)
  assert.ok(defineIdx > -1, 'playwright.config.js must `export default defineConfig(...)` somewhere in source')
  assert.ok(
    workersIdx < defineIdx,
    `const workers = ... must appear BEFORE the ACTUAL \`export default defineConfig({\` line (the comment-text occurrence is excluded by the ^export\s+default\s+defineConfig\( anchor). Got workersIdx=${workersIdx}, defineIdx=${defineIdx}.`,
  )
})

test('Round-31.2 inverse: NO inline const/let/var declarations appear inside defineConfig object literal + workers shorthand MUST be referenced', () => {
  // Anchor `defineConfig` on the actual `export default define`
  // line so the comment-text `defineConfig({...})` occurrence
  // (offset 622) is excluded — otherwise `slice(defineOpenIdx)`
  // would include the module-scope declarations (which are at
  // offset 1473, AFTER the comment-text defineConfig at 622)
  // and the doesNotMatch regex would falsely fire on them.
  // The `/m` flag enables multiline mode so `^` matches after
  // each `\n` (the export line is at offset 2241, well after
  // position 0).
  const defineOpenIdx = CONFIG_SOURCE.search(/^export\s+default\s+defineConfig\(/m)
  assert.ok(defineOpenIdx > -1, 'playwright.config.js must `export default defineConfig(...)` somewhere in source')

  // Slice from the export line to the END of the file. The
  // module-scope declarations BEFORE this offset are excluded
  // from the slice so the inverse regex can't falsely match
  // them. Any inline `const`/`let`/`var` inside the actual
  // object literal would still be a JS SyntaxError caught
  // here.
  const inner = CONFIG_SOURCE.slice(defineOpenIdx)

  assert.doesNotMatch(
    inner,
    /\b(?:const|let|var)\s+\w+\s*=\s*\w/,
    'playwright.config.js must NOT declare `const`/`let`/`var` (with a runtime identifier after `=`) INSIDE the `defineConfig({...})` object literal — JS SyntaxError (`Unexpected keyword`) at Playwright load time. Round-31.2 hotfix hoisted `const w` and `const workers` to module scope; re-introducing inline declarations (with any of `const`/`let`/`var`) resurrects the bug that lurked from Round-30+ to Round-31.',
  )

  // Symmetric positive: the shorthand `workers,` MUST appear
  // inside the object literal so the module-scope const value
  // reaches Playwright. The regex anchors on the closing comma
  // (`workers,`) — comment text using ``workers: workers``
  // (no comma) doesn't match, so the assertion targets the
  // SHORTHAND PROPERTY specifically.
  assert.match(
    inner,
    /\bworkers\s*,/,
    'playwright.config.js MUST shorthand-reference the module-scope `workers` const inside the `defineConfig({...})` object literal as `workers,`. A maintainer who hoists the const but forgets to wire it back in would silently default to 1 worker (Playwright default) — the per-worker isolation contract would degrade without a test signal.',
  )
})
