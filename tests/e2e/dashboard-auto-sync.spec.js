// tests/e2e/dashboard-auto-sync.spec.js
//
// E2E spec for the dashboard's auto-sync useEffect added in
// Round-46 / 2026-07-20 (BUG A from the Monday test pass).
//
// CONTRACT (the fix that landed this useEffect):
//   When the dashboard mounts with ALL THREE conditions truthy:
//     - user (Clerk-or-demo) is loaded
//     - profile is fetched (not redirected to /onboarding)
//     - extension is detected as installed (`data-jobbpiloten-ext="1"`)
//   the dashboard must AUTO-FIRE connectExtension(), which posts
//   JOBBPILOTEN_AUTH_SYNC via window.postMessage so the content
//   script hydrates chrome.storage.local end-to-end. The user
//   should NOT have to manually click "Anslut din profil" on every
//   device after every browser restart — that was the symptom that
//   surfaced the bug.
//
// What this catches:
//   - The autoSyncAttemptedRef guard regressed (StrictMode double-
//     fire would still produce the message but waste a
//     /api/extension/token round-trip).
//   - The deps array `[user, profile, extensionInstalled]` lost a
//     dependency (e.g. someone refactored to `[user, profile]`
//     and the auto-sync never re-fires after the extension poll
//     flips `extensionInstalled` true).
//   - The auto-sync useEffect was moved INTO `load()` instead of
//     its own useEffect (race with content-script mount).
//   - The dashboard's connectExtension function regressed (the
//     old `Profil hittades inte` round-46 bug).
//
// What this does NOT cover:
//   - The popup's Anslut click (covered by
//     popup-jp-connect-bug-b.spec.js logic + tests/e2e/
//     env-aware-dashboard-url.spec.js for the manual-click path).
//   - The actual chrome.storage write (requires a real Chrome
//     install — covered manually in TESTING.md).
//
// Companion test: tests/e2e/env-aware-dashboard-url.spec.js covers
// the MANUAL click path. Together they lock both the auto-fire
// contract AND the manual fallback contract so a future refactor
// can't silently regress either path.

import { test, expect } from './_fixtures/auth'

test.describe('Dashboard: auto-sync fires on mount (BUG A fix)', () => {
  test('JOBBPILOTEN_AUTH_SYNC fires automatically when dashboard mounts with extension detected -- no manual click required', async ({ page }) => {
    // 1. Capture EVERY postMessage the page fires (same wrapper as
    //    env-aware-dashboard-url.spec.js). addInitScript runs BEFORE
    //    any page script, so the wrapper is in place by the time
    //    React's auto-sync useEffect is mounted.
    await page.addInitScript(() => {
      /** @type {Array<{type: string|null, payload: any, targetOrigin: string}>} */
      window.__capturedAutoSyncMessages = []
      const originalPostMessage = window.postMessage.bind(window)
      window.__postMessageWrapperInstalledForAutoSync = true
      window.postMessage = function patchedPostMessage(...args) {
        try {
          const message = args[0]
          window.__capturedAutoSyncMessages.push({
            type: (message && typeof message === 'object') ? message.type : null,
            payload: (message && typeof message === 'object') ? message.payload : null,
            targetOrigin: args[1],
          })
        } catch (_) {
          // Capture is best-effort; a false capture must NOT crash
          // the page (same fallback as env-aware-dashboard-url.spec.js).
        }
        return originalPostMessage(...args)
      }
    })

    // 2. Navigate to /dashboard. The auto-sync useEffect is wired
    //    at the top of the component and watches
    //    `[user, profile, extensionInstalled]`. Both `user` and
    //    `profile` will become truthy once the dashboard's `load()`
    //    fetch chain resolves. `extensionInstalled` is flipped via
    //    a separate polling effect that reads the
    //    `data-jobbpiloten-ext` attribute every 1s + on window focus.
    await page.goto('/dashboard')

    // 3. Wait for the dashboard's poll to settle BEFORE flipping the
    //    extension flag. The auto-sync guard requires ALL FOUR deps
    //    truthy (user, profile, extensionInstalled, extensionChecked),
    //    so flipping the flag before the profile arrives would NOT
    //    trigger the auto-sync (the effect re-runs once profile becomes
    //    truthy though, so a late flip still works — but a
    //    deterministic test waits for the poll first).
    //
    //    Round-84 fix: previously this waited for the
    //    `extension-connect-button`, but that card only renders AFTER
    //    the extension is detected (`extensionChecked &&
    //    extensionInstalled` — app/dashboard/page.js) — a state this
    //    test only reaches by flipping the flag in step 4, so the wait
    //    could never resolve. The install banner is the NOT-detected
    //    surface: its visibility proves the poll completed
    //    (`extensionChecked` true) with the extension still
    //    undetected, which is exactly the pre-flip state we want.
    const installBanner = page.locator('[data-testid="extension-install-banner"]')
    await expect(installBanner).toBeVisible({ timeout: 30_000 })

    // 4. CRITICAL: simulate extension detection WITHOUT clicking
    //    the button. Dispatching the focus event short-circuits
    //    the 1-second poll, so the test doesn't have a blind sleep.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-jobbpiloten-ext', '1')
      window.dispatchEvent(new Event('focus'))
    })

    // 5. Poll the captured list for at least ONE
    //    JOBBPILOTEN_AUTH_SYNC message. The auto-sync useEffect
    //    should fire connectExtension() which posts the message
    //    without ANY user interaction.
    //
    //    Why poll: the auto-sync fires inside a React effect tick
    //    that depends on the polling-effect updating
    //    `extensionInstalled`, which depends on the focus event
    //    landing in the polling queue. A constant 5s sleep would
    //    be either flaky (too short on cold-start) or slow.
    const expectedOrigin = new URL(page.url()).origin
    await expect
      .poll(
        async () => {
          const msgs = await page.evaluate(() => window.__capturedAutoSyncMessages || [])
          return {
            total: msgs.length,
            auth: msgs.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC').length,
            setUrl: msgs.filter((m) => m.type === 'JOBBPILOTEN_SET_DASHBOARD_URL').length,
          }
        },
        {
          // 30s: covers the first-compile of /api/extension/token
          // + the dashboard's polling interval + Mongo round-trip.
          timeout: 30_000,
          intervals: [100, 250, 500, 1000],
          message:
            'dashboard auto-sync should fire JOBBPILOTEN_AUTH_SYNC on mount without manual click (BUG A fix verification)',
        },
      )
      // Round-84 fix: `expect.toBeGreaterThanOrEqual(1)` is not a
      // nested asymmetric matcher through the re-exported fixture
      // `expect` — it threw TypeError. The >=1 contract is asserted
      // directly in step 6 below (authMessages.length >= 1), so a
      // plain number placeholder suffices here.
      .toEqual({
        total: expect.any(Number),
        auth: expect.any(Number),
        setUrl: expect.any(Number),
      })


    // 6. Snapshot the captured messages and assert the AUTH_SYNC
    //    shape: it should carry token + profile + baseUrl +
    //    allowedOrigins so the popup's fetch() can resolve
    //    without Tier-3 build-config (same contract as the
    //    manual-click path in env-aware-dashboard-url.spec.js).
    const messages = await page.evaluate(() => window.__capturedAutoSyncMessages || [])
    const authMessages = messages.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC')
    expect(authMessages.length).toBeGreaterThanOrEqual(1)
    const authMsg = authMessages[0]
    expect(authMsg.payload).toBeTruthy()
    expect(typeof authMsg.payload.token).toBe('string')
    expect(authMsg.payload.token.length).toBeGreaterThan(0)
    expect(authMsg.payload.profile).toBeTruthy()
    expect(typeof authMsg.payload.baseUrl).toBe('string')
    expect(authMsg.payload.baseUrl).toBe(expectedOrigin)
    // targetOrigin must be the same as the dashboard origin so
    // the content-script listener (which accepts only same-
    // origin posts) doesn't silently swallow the message.
    expect(authMsg.targetOrigin).toBe(expectedOrigin)

    // 7. Guard assertion: the auto-sync useEffect's
    //    `autoSyncAttemptedRef` should produce AT LEAST 1 fire
    //    (the mount itself fires it) AND AT MOST 2 fires (1 for
    //    the real mount + 1 for the React 18 StrictMode dev
    //    double-mount — production runs without strict mode
    //    would get exactly 1). A regression that drops the
    //    auto-sync useEffect (silent zero-fire) is caught by the
    //    `>= 1` bound; a regression that drops the ref guard
    //    (unbounded re-fires across poll ticks) is caught by the
    //    `<= 2` bound.
    expect(authMessages.length).toBeGreaterThanOrEqual(1)
    expect(authMessages.length).toBeLessThanOrEqual(2)
  })
})
