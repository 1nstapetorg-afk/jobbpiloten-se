// tests/unit/round74-await-scan.test.mjs
//
// Round-74 (2026-07-20) PERMANENT SAFEGUARD.
//
// The popup.js:390 (Round-74 setStatus) + popup.js:2205
// (Round-74 wire) user-reported "Uncaught SyntaxError:
// Unexpected reserved word" crashes were caused by `await`
// calls inside non-async function bodies. Chrome MV3's
// module parser refuses to execute the whole script at
// parse time, so the popup HTML default "Kontrollerar…"
// text stays visible and every listener stays dead.
//
// This test is the project's standing regression gate for
// that bug class. It runs as part of `yarn test:unit` and
// will fail CI if ANY `await` expression appears outside an
// async function (declaration OR arrow OR class method) in
// any extension/*.js file. The companion fixture
// `tests/fixtures/round74-await-scan.js` does the brace-
// counting + async-scope-tracking actually executed by
// this test.
//
// The previous shape of this scanner lived only at
// tests/fixtures/ — that directory is excluded from the
// unit runner per the project's test-layout conventions,
// so the scan never ran as part of CI. The Round-74.1
// followup promotes it to a proper test under tests/unit/
// so a future await-in-non-async-function regression is
// caught on the build, not on the user's Monday test
// session.
//
// Run via `yarn test:unit`. To run JUST this test:
//   yarn test:unit tests/unit/round74-await-scan.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Round-77.2 (2026-07-20) — shared cross-test-file exclusive
// scan lock so tests/unit/lint-await-async.test.mjs Test 2's
// write-scan is serialised against this test's read-scan.
// Without this, the Round-77.1 per-file lock only protected
// against a hypothetical second writer; the actual Round-74
// reader race persisted (5 sequential `yarn test:unit` runs all
// failed 1/1034 cases).
import { acquireScanLock, releaseScanLock } from './lib/scan-lock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scannerPath = path.resolve(__dirname, '../fixtures/round74-await-scan.js')

// Execute the scanner and parse its JSON output. The scanner
// prints any REAL offending sites to stdout (one per line) and
// ends with a literal `TOTAL REAL OFFENDING SITES: <n>` summary
// line.
function runScanner() {
  const cwd = path.resolve(__dirname, '../..')
  try {
    const stdout = execFileSync(process.execPath, [scannerPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout, stderr: '' }
  } catch (e) {
    // execFileSync throws on non-zero exit; if the scanner
    // exits non-zero unexpectedly, surface its stdout + stderr
    // so the test failure includes the scanner's output verbatim.
    return { ok: false, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

test('every extension/*.js file: NO `await` outside an `async function` / async arrow / async class method', () => {
  // Round-77.8 — sync acquire, no async retry-with-backoff
  // (concurrent acquirers cannot exist under concurrency=1).
  // If openSync('wx') throws EEXIST, that means a future
  // maintainer bumped concurrency back up — loud surface
  // surfaces the regression rather than masking it with a
  // silent skip or 10 s retry exhaustion.
  const lockFd = acquireScanLock()
  try {
    const { ok, stdout, stderr } = runScanner()
    assert.ok(ok, `scanner exited non-zero\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    // The scanner's contract is: print offending sites to stdout,
    // then `TOTAL REAL OFFENDING SITES: <n>`. Match the summary line.
    const match = stdout.match(/TOTAL REAL OFFENDING SITES:\s*(\d+)/)
    assert.ok(match, `scanner must print a TOTAL summary line; got: ${stdout}`)
    const total = Number(match[1])
    if (total !== 0) {
      // Surface the offending sites (printed before the TOTAL line).
      const offending = stdout
        .split(/\r?\n/)
        .filter((l) => /\.(?:js|mjs):\d+/.test(l) && !/^TOTAL/.test(l))
        .join('\n')
      assert.fail(
        `extension JS has ${total} real await-in-non-async-function site(s):\n${offending}\n` +
          'Fix: prefix the containing function with `async`.\n' +
          'Background: Chrome MV3 module-script parser refuses to execute\n' +
          'the whole file if any await appears outside an async scope —\n' +
          'the popup HTML default "Kontrollerar…" stays visible and every\n' +
          'button is dead (Round-74 setStatus + wire regression fixed 2026-07-20).',
      )
    }
    assert.equal(total, 0, 'scanner reports 0 offending sites — popup.js parses cleanly under Chrome MV3')
  } finally {
    // Release unconditionally — the lock fd was acquired, so we
    // MUST release it even on assertion failure. acquireScanLockOrSkip
    // early-returned before this finally block runs only when
    // contention was contended (lockFd === null), in which case
    // releaseScanLock is a no-op.
    releaseScanLock(lockFd)
  }
})

// Belt-and-braces: the user-reported real crash site at
// popup.js:390 (Round-74 setStatus) must be fixed by now.
// Setstatus should be declared `async`. This is the explicit
// regression lock on the user's reported bug.
test('Round-74 / 2026-07-20 user-reported site: popup.js setStatus is declared `async function setStatus(...)`', async () => { // kept async: fs/promises
  const fs = await import('node:fs/promises')
  const popup = await fs.readFile(path.resolve(__dirname, '../../extension/popup.js'), 'utf8')
  // is also caught.
  assert.ok(
    /async\s+function\s+setStatus\s*\(/.test(popup),
    'popup.js must declare `async function setStatus(...)` so the await-loadStorage at line 390 is in an async scope',
  )
})

// Belt-and-braces: the second user-reported crash site at
// popup.js:2205 (Round-74 wire) must be fixed by now.
// wire() must be declared `async`.
test('Round-74 / 2026-07-20 second instance: popup.js wire() is declared `async function wire()`', async () => { // kept async: fs/promises
  const fs = await import('node:fs/promises')
  const popup = await fs.readFile(path.resolve(__dirname, '../../extension/popup.js'), 'utf8')
  assert.ok(
    /async\s+function\s+wire\s*\(/.test(popup),
    'popup.js must declare `async function wire()` so the await-loadStorage at line 2298 (inside `if (styleSelect) { ... }`) is in an async scope',
  )
})

// Belt-and-braces: the malformed-line derp at popup.js:~1053
// was fixed in Round-74.1. The line under the fetchWithRetry
// call must end with `)` on its own line, then `if (!res.ok) {`
// on the next — never `})              if (...)` glued.
//
// The check walks per-line and skips any line that starts with
// `//` so the Round-74.1 explanatory comment in popup.js (which
// describes the bad pattern inside backticks) doesn't
// self-trigger the assertion. A bad line is `})` followed by 8+
// whitespace chars followed by `if (` — the structural derp
// Chrome's parser called out at popup.js:1053.
test('Round-74.1: popup.js no longer has `})              if (!res.ok) {` glued to fetchWithRetry close', async () => { // kept async: fs/promises
  const fs = await import('node:fs/promises')
  const popup = await fs.readFile(path.resolve(__dirname, '../../extension/popup.js'), 'utf8')
  const lines = popup.split(/\r?\n/)
  const glued = lines.find((l) => !/^\s*\/\//.test(l) && /\}\)\s{8,}if\s*\(/.test(l))
  assert.equal(
    glued,
    undefined,
    `popup.js must not contain a non-comment line where \`})\` is followed by 8+ whitespace chars and then \`if (\` — Chrome parser reported \`Uncaught SyntaxError: Unexpected token 'if'\` at popup.js:1053 for that pattern. Offending line: ${JSON.stringify(glued)}`,
  )
})
