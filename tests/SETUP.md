# Sandbox E2E Setup

What this project needs before `yarn test:e2e` will actually exercise
anything, plus a record of what the local-sandbox blocker looked like
during Round-26/27 when we tried to validate live.

## Prerequisites

A full local Web E2E run needs:

| Requirement           | Why                                                     | Where to set                       |
| --------------------- | ------------------------------------------------------- | ---------------------------------- |
| **MongoDB**           | `/api/profile`, `/api/applications`, `/api/upload-cv` all read + write the `jobbpiloten` DB. Without it the first POST returns 500 and every spec that depends on the demo user 404s in `loadProfile`. | `MONGO_URL` env var (default `mongodb://localhost:27017` from `.env.example`); local install: `brew services start mongodb-community` or Docker `mongo:7`. |
| **DB_NAME**           | Lets you point the dev server at a sandbox-only DB so CI + local don't collide. | `.env.local` or shell env.                                |
| **Demo-cookie auth**  | Tests rely on the Clerk-less demo-cookie path so no real Clerk account is needed. The `tests/e2e/_fixtures/auth.js` fixture seeds the cookie + `localStorage.demoUser` + the demo profile automatically per context. | Implicit — tests set their own context.                    |
| **Open port**         | `next dev` binds the port from `$PORT` (default `3000`). Pick something else if `3000` is held by another process you can't kill. | `PORT=3001 yarn dev` (or pass through `yarn test:e2e`).     |

Mongo's local-server health is the actual blocker in many sandboxes —
the dev server boots fine, the tests start, but `seedDemoUser()` POSTs
profiled data and the read-back fails silently (logged as a warning
in non-CI runs, failed loudly in CI).

## Validating the prerequisites from a fresh shell

```bash
# 1. Mongo up?
pgrep -a mongod || echo "mongod NOT running"
ss -tln | grep -q 27017 && echo "port 27017 BOUND" || echo "port 27017 NOT bound"

# 2. Dev server up?
PORT=3001 nohup yarn dev > /tmp/dev.log 2>&1 &
disown
# Pre-stage the bind-detection message so we can distinguish "server
# up, route 200" from "server up, route 404" — important because a
# 404 means dev bound but wrong path, NOT cold-start failure. The
# Round-28.1c break-line rewording surfaces this directly.
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    if [ "$code" = "200" ]; then
      echo "dev BOUND on :3001 after ${i}s (code=${code})"
    else
      echo "dev BOUND on :3001 after ${i}s (code=${code} — server up but path NOT 200, investigate next dev compile / route)"
    fi
    break
  fi
  sleep 1
done
# Explicit silent-fail guard: if the loop walked all 90s without
# breaking, the dev server never came up — surface the log + exit
# non-zero so the recipe doesn't lie. Curl exit code 000 (connection
# refused) or empty code (DNS or pre-listener stage) means fail.
if [ -z "$code" ] || [ "$code" = "000" ]; then
  echo "FAIL: dev server did not bind :3001 within 90s"
  echo "== last 40 lines of /tmp/dev.log =="
  tail -40 /tmp/dev.log
  exit 1
fi

# 3. Run a quick smoke spec (single, narrow grep).
PORT=3001 CI=true yarn test:e2e \
  --grep "Settings: CV preview immediately" \
  --reporter=list --max-failures=1 \
  --workers=1 --timeout=60000
```

## First-time setup on a fresh sandbox

If the prerequisites above are NOT pre-installed (fresh container,
rebuilt CI runner, or any environment where `yarn test:e2e` fails
with `Executable doesn't exist at .../headless_shell`), run these
BEFORE the "Validating the prerequisites" recipe below:

1. **Install Playwright chromium binary** (the most common first-time
   blocker):

   ```bash
   yarn playwright install chromium
   # or equivalently:
   npx playwright install chromium
   ```

   Default install path:
   `/root/.cache/ms-playwright/chromium_headless_shell-<rev>/`.
   `yarn test:e2e` surfaces a clear "Executable doesn't exist at
   /root/.cache/ms-playwright/chromium_headless_shell-..." error if
   this step is skipped. Round-33 verified the install completes in
   ~6 s.

2. **Verify MongoDB is running on port 27017**:

   ```bash
   pgrep -a mongod || echo "mongod NOT running"
   ```

   If absent, start MongoDB locally:

   - Docker: `docker run -d --name mongo -p 27017:27017 mongo:7`
   - Homebrew: `brew services start mongodb-community`

3. **Pick a non-conflicting PORT** (only if `3000` is held by a
   root-owned process the unprivileged shell can't `kill`):

   ```bash
   PORT=3001 yarn dev
   PORT=3001 yarn test:e2e ...
   ```

   The Round-27.1a + Round-27.1b package/playwright port-aware defaults
   pick up `PORT` automatically, so the only change required is the
   shell-level `PORT=3001` prefix. Round-33 verified this end-to-end
   (Playwright install + mongod pgrep + `PORT=3001` overhead = ~10 s).

## Blocked state observed during Round-26 (2026-07-11 → 2026-07-12)

Two live-attempt runs were attempted on this sandbox during Round-26
followup closure. Both failed for the **same** env-level reason, not
a code defect:

- **Sandbox**: `mongod v7.0.37` running as PID 46, port 27017 bound —
  *Mongo is genuinely available*. The dev-server bind is the actual
  holdup.
- **Problem**: Port 3000 was held by a root-owned process (likely a
  prior `next dev` from a parent sandbox session) that the non-root
  shell used by `yarn test:e2e` cannot free. `lsof -ti:3000 | xargs
  kill -9` returned 0 kills, `fuser -k 3000/tcp` was denied, and
  `pkill -9 -f 'next dev'` matched nothing. `ss -tln` continued to
  show `:3000` bound through both attempts. `yarn dev` then collided
  with `EADDRINUSE` before reaching the listener stage, so no
  webServer boot ever completed.
- **Workaround**: Round-27.1a + Round-27.1b land PORT-aware defaults
  in `package.json` + `playwright.config.js`. `PORT=3001 yarn dev`
  binds cleanly even when `:3000` is held. Verified in Round-27.1c by
  running `ss -tlnp 'sport = :3001'` after a fresh start — `:3001`
  became the `next dev` PID's bound listener immediately.

If you hit the same EADDRINUSE in a new sandbox, run the recipe under
"Validating the prerequisites" above — substituting any free port
(`3001`, `3002`, etc.) for the literal value.

## Reference

- `tests/e2e/_fixtures/auth.js` — demo-cookie + localStorage seed per
  context.
- `tests/e2e/_helpers/seedDemoUser.js` — POST `/api/profile` + `GET
  /api/applications` verify, with CV preview-seed fields added in
  Round-26.2.
- `tests/unit/seedDemoUser-fixture.test.mjs` — source-grep lock on the
  seed shape so a future drop of `cvText` / `cvFileName` / `cvFileSize`
  breaks the build before a real E2E run wastes 20 s timing out.
- `last_response.txt` → Round-26 **Live e2e validation** section —
  the original two-attempt log and the carryover cookie for `:3001`.

## Round-35 verified env-setup timings (baseline, captured 2026-07-13)

Real-time measurements from a fresh-sandbox-equivalent run on this
sandbox's existing state (no cold-start; mongod + chromium shell
pre-installed). The numbers serve as a regression baseline — if a
Round-N+1 setup takes noticeably longer, surface the diff here.

| Step                                                           | Time     | Notes                                                            |
| -------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `pgrep -a mongod`                                              | ~0.006 s | Instant (PID found in kernel proc table).                        |
| Playwright binary present at `/root/.cache/.../headless_shell` | 285 MB   | First-time install (6.4 s per Round-33); subsequent runs instant. |
| `PORT=3001 yarn test:e2e <spec>` (cold dev compile + spec run)  | 20.8 s   | Includes dev-server-bind + spec execution; tested: CV-preview.   |

Round-33 also measured 23.85 s for the same CV-preview spec; the
~3 s delta in Round-35 is likely Next.js dev-server cache warmth
(parcel-cache was primed from Round-33's e2e run earlier in the
same shell session).

### Round-40 additions (captured 2026-07-13)

| Step                                           | Time     | Notes                                                                                              |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `yarn dev` cold-compile-to-bind (Ready in ...) | 1.21 s   | Next.js 15.5.16 `Ready in 1206ms` on PORT=3000 after `setsid` detach. Fast vs Round-33 because the parcel-cache was already warm. |
| `node scripts/smoke-saved-answers.mjs` (full flow) | 2.5 s  | mint-token + seed + memory-match + groq-fallthrough + cleanup. End-to-end.                        |
| `yarn test:e2e tests/e2e/dashboard-email-source.spec.js` (2 tests) | 17.6 s | 2/2 passed; auth fixture + context.request + filter chip + Mail tag + empty state.            |

Future maintainers hitting a >30 s gap should suspect:
1. Port collision on 3000 (use `PORT=3001 ...`).
2. Cold Next.js compile (cold first-navigation can add 1-2 s).
3. MongoDB latency (mongod slow start or first-write fsync).
4. **Round-40 NEW**: stale `next-server` from a previous shell session holding the port — `ss -tlnp | grep :3000` will show the offender; `pkill -9 -f 'next dev'` + `pkill -9 -f 'next-server'` clears it, but a root-owned PID may require direct `kill -9 <pid>`. The Round-40 smoke + e2e setup recipe uses `setsid` to fully detach the dev process so the basher shell can exit without taking it down.

If a future Round-N has a noteworthy timing change (positive OR
negative), update this table + cite the change in the
last_response.txt entry for that Round.

### Round-47 additions (2026-07-13)

Two followups from the Round-47 followups list landed this round,
captured here as regression-investigation baselines + future-test
guardrails.

#### Cloud-port tip: port 3000 was busy on this sandbox

The Round-46 recipe assumes port 3000 (which the Round-35 timing
table used). At the start of Round-47 the immediate yarn dev command
on port 3000 FAILED with:

  Error: listen EADDRINUSE: address already in use 0.0.0.0:3000

Investigation: a previous-shell next-server process was still bound.
The kill target was `pkill -f 'next-server\|next dev'`. The clean
fallback is PORT=3001 + the same setsid-bash dance.

Future maintainer debugging a similar "yarn dev won't bind" symptom:
check `pgrep -a 'next-server\|next dev'` first, kill any leftover
PID, and verify with `ss -ltnp 2>/dev/null | grep ':3000'` (port
should be empty).

#### Round-47 yarn dev timing baseline (port 3001)

| Step                                          | Time      |
| `yarn dev` cold-compile-to-bind (Ready in 1341ms) | ~1.34 s |
| Full e2e smoke (Round-40 baseline, port 3000) | 17.6 s    |
| Storage.onChanged vm-test extraction          | <1 ms     |

Delta from Round-35:

| Round | Time   | Notes                                        |
| Round-35 | 1.21 s | First captured baseline (port 3000)           |
| Round-40 | (unchanged) | Implicit baseline; not re-captured         |
| Round-47 | 1.341 s | Cold + port-conflict-resolved (port 3001)    |

The Round-47 increase (+130ms over Round-35) is within the natural
variance of cold-compile timing — Next.js's incremental cache and
Turbopack warm-up differ across shells. Future maintainer hitting
>2 s should suspect:
  1. cold Next.js dev cache (clean .next/ and re-run);
  2. port collision (check `pgrep` per the tip above);
  3. a stuck next-server from a previous shell.

#### Round-47 test inventory snapshot (587 unit tests baseline)

Wave-1 inventory via ripgrep on `^test\\(` declarations (column-0
`test(...)` lines):

  - tests/unit/  : 587 tests across 52 files
  - tests/e2e/   : see note below
  - Combined    : 587 tests across 72 files (52 unit + 20 e2e specs)

Important caveat: the inventory's `^test\\(` regex doesn't match
indented `test(...)` declarations inside `describe(...)` blocks.
The yarn test:unit command reports the higher count (623 at end
of Round-46) because it walks the node:test tree post-indent. The
587 figure is a LOWER BOUND — actual test count is `587 + N`
where N is the indent-wrapped `test(...)` count.

For a unit regression check, the 587 lower-bound is sufficient
(N is stable across rounds). For an exact count, run:

  yarn test:unit 2>&1 | grep '^# tests' 

…not part of the SETUP.md automation because the count appears in
Round-N narratives, not in cold-boot diagnostics.

Distribution highlights (Top-10 unit test files by count):

  | File                                                  | Tests  |
  | popup-handshake.test.mjs                              | 34     |
  | winansi-sanitiser.test.mjs                            | 28     |
  | saved-answers.test.mjs                                | 25     |
  | pdf-second-pass.test.mjs                              | 21     |
  | match-score.test.mjs                                  | 19     |
  | blocket-scraper.test.mjs                              | 19     |
  | extension-content.test.mjs                            | 17     |
  | pdf-report.test.mjs                                   | 17     |
  | interactive-demo.test.mjs                             | 17     |
  | auth-cookie.test.mjs                                  | 16     |

Largest single test file (popup-handshake.test.mjs at 34 tests)
contains every contract lock for the v0.2.2 auth handshake + the
Round-10 content-script-bridge + the v0.2.3 preview-branch
gate changes. The 17 baseline popup-handshake tests were topped up
with 17 more across rounds 7-37 (Round-10 added storage.onChanged
locks; Round-36 added the brace-counting body extractor; Round-37
added the mirror-path contract).

## Round-77.5–77.7 (2026-07-20) — unit-test runner serial-mode env var

The unit-test runner (`scripts/run-unit-tests.mjs`) defaults to
**serial execution** (`--test-concurrency=1`) because
`tests/unit/lint-await-async.test.mjs` (writer) and
`tests/unit/round74-await-scan.test.mjs` (reader) both spawn
subprocesses that scan `extension/*.js` for `await`-outside-
`async` violations. When run in parallel (the node:test default),
they race for an exclusive `openSync('wx')` on
`tests/fixtures/.round77-scan.lock` — only one wins; the other
exhausts its 10 s retry budget waiting for the winner. Serial
execution eliminates the race entirely.

### Override for dev-loop speed

If you need faster feedback on a quiet box and accept the race
risk (the warning below tells you exactly when), override:

```bash
JOBBPILOTEN_TEST_CONCURRENCY=2 yarn test:unit
```

The runner parses the env var as an integer and falls back to 1
on missing / non-numeric / <1 values. **Any value >= 2 emits a
WARNING to stderr** explaining the race boundary (the lock-
contending tests are EXACTLY two files, so concurrency=2 puts
them in parallel — race returns).

### Wall-clock cost

| Concurrency | Approx. wall-clock for `yarn test:unit` |
| ----------- | -------------------------------------- |
| 1 (default) | ~20 s                                   |
| 2           | ~14 s (race-warning emitted)           |
| no flag / unset | ~14 s but with intermittent 2-FAIL lock exhaustion |

The default is intentional: stable > fast for CI correctness.
Tune `JOBBPILOTEN_TEST_CONCURRENCY=2` only for local dev loops
where you can re-run if the race surfaces.

### Lock file lifecycle

The lock file at `tests/fixtures/.round77-scan.lock`:

- **Created** by `acquireScanLock()` (`openSync('wx')`)
- **Released** by `releaseScanLock()` (`closeSync` +
  `unlinkSync`)
- **Self-flushed** at module-import time if a leftover file is
  detected (cross-process crash recovery)
- **Never** user-visible in a successful run — the file is
  created then deleted within milliseconds per test

If you see the file still present after `yarn test:unit`, a test
crashed without releasing its `finally{}`. Manual cleanup:

```bash
rm -f tests/fixtures/.round77-scan.lock
rm -f extension/__lint_await_async_negative_test__.js
```

## Round-73 (2026-07-20) — extension re-test commands

After the Monday-tester report (4 critical extension bugs + 3
followups), the recommended manual re-test path on the original 3
Swedish job forms:

### Pre-flight

```bash
# 1. Build the fresh extension bundle.
yarn build:extension && ls -la extension/build/extension-user.zip

# 2. Load it into Chrome (chrome://extensions → Developer mode →
#    "Load unpacked" → point at extension/build/ OR drag the zip
#    into "Pack extension" output dir).
```

### Re-test 1 — Panel-freeze regression check (Bug 1)

Open any page where the dashboard is NOT loaded (e.g. about:blank
or a tab the user hasn't visited). Click the JobbPiloten extension
icon. Within ~3 s the popup should transition from the default
"Kontrollerar…" text to either "Inte ansluten" or "Ansluten".
The frozen-forever symptom should NOT reproduce.

If the popup still freezes, the chrome.storage.local.get is hanging
in your environment — paste the popup-console error (right-click →
Inspect popup) into the bug report.

### Re-test 2 — Boolean-radio regression check (Bug 3)

Open one of the original 3 form types (Manpower/Extrajobb, the
long warehouse multi-step, or any Swedish ATS with Ja/Nej
radios). Append `?jobbpiloten_debug=1` (or `?jp_dev=1`) to the
page URL — this enables the `[jobbpiloten boolean] clickBooleanOption`
console.debug entries. Click "Fyll i nu" and confirm ONE log line
per boolean field (was TWO before the gate) with:

  - `desiredValue: true|false`
  - `wanted: "ja"|"nej"`
  - `hostTag: 'INPUT'|'BUTTON'|...`
  - `hostId: <input id>`
  - `hostName: <input name>`
  - `labelText: <first 80 chars of <label>>`

If a host page is still routing to `reason: 'no-target-found'`
or `reason: 'exception'`, paste the log line + the
`chrome://extensions → service worker → Inspect` console output —
the heuristic path tells us which DOM traversal needs hardening.

### Re-test 3 — Address regex regression check (Bug 2)

Open Platsbanken (or any form with a "Beskriv" preamble to an
address field). Expected:
  - "Beskriv din adress" → `address` filled, NOT the comment
    field.
  - "Kommentar" → NOT touched by the address regex.
  - "Stad/Ort/Kommun" → `city` filled.

If Beskriv-routed fields still leak to the comment textarea,
paste the host-page label text + `document.querySelectorAll('input,
textarea')` HTML snapshot into the bug report.

### Re-test 4 — Email-draft blank-body regression check (Bug 4)

Open the Gmail compose-via-mailto path on any job-application
confirmation page. Expected:
  - "Mejlutkast" panel populates with subject + body (NOT blank).
  - "Genererar AI-utkast…" visible for ~1-4 s while the
    /api/extension/email-body fetch resolves.
  - "Kopiera", "Öppna mailto:", "Spara utkast", "Öppna i Gmail",
    "Öppna i Outlook" buttons stay ENABLED after the body lands
    or after the static-fallback path (was stuck disabled before
    Round-73).

If the body is still blank after 5 s, paste the popup-console
network log + the /api/extension/email-body response JSON.

### Post-re-test cleanup

```bash
# Tear down the dev session + free :3000 (or :3001).
pkill -f 'next dev' || true
pgrep -a mongod  # leave running for the next session
```

These commands are copy-pasteable from this section — the Quick
Capture sheet doesn't require a fresh clone.


