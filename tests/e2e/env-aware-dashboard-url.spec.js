// tests/e2e/env-aware-dashboard-url.spec.js
//
// E2E spec for the dashboard connect's env-aware URL persistence
// (v0.2.1). Asserts the contract between the dashboard and the
// extension's content script:
//
//   dashboard.connectExtension()
//     → POST /api/extension/token
//     → window.postMessage({ type: 'JOBBPILOTEN_AUTH_SYNC', payload: { token, profile, baseUrl, allowedOrigins } }, origin)
//     → window.postMessage({ type: 'JOBBPILOTEN_SET_DASHBOARD_URL', payload: { url } }, origin)
//
// The SET_DASHBOARD_URL message is the env-aware handshake —
// payload.url = window.location.origin is what the content script
// persists to chrome.storage.sync.jobbpiloten_dashboardUrl,
// which the popup's Tier-1 resolver reads first (see
// tests/unit/popup-resolver.test.mjs for the popup side).
//
// What this catches:
//   - Missed `JOBBPILOTEN_SET_DASHBOARD_URL` postMessage.
//   - Wrong payload URL (wrong origin, trailing slash, full URL
//     with pathname or query string).
//   - Wrong targetOrigin arg (postMessage's second arg MUST equal
//     the same window.location.origin so the content-script
//     listener accepts the message).
//   - Dropped companion `JOBBPILOTEN_AUTH_SYNC` — the two are
//     separate messages so a regression that drops one would
//     half-break the connect.
//
// What this does NOT cover:
//   - The actual chrome.storage.sync.set (extension side — requires
//     a real Chrome install). Covered manually in TESTING.md.
//   - The popup's Tier-1 reading/storage of dashboardUrl. Covered
//     by tests/unit/popup-resolver.test.mjs.

import { test, expect } from './_fixtures/auth'

test.describe('Dashboard: env-aware URL persistence on connect', () => {
  test('connect posts JOBBPILOTEN_SET_DASHBOARD_URL with window.location.origin + companion AUTH_SYNC', async ({ page }) => {
    // 1. Capture EVERY postMessage the page fires. addInitScript runs
    //    BEFORE any page script (extending past the first navigation),
    //    so the wrapper is in place by the time React's onClick handler
    //    is mounted and ready to fire.
    //
    //    We use addInitScript (not page.evaluate) so the wrapper also
    //    works across Next.js client-side transitions inside the test.
    await page.addInitScript(() => {
      /** @type {Array<{type: string|null, payload: any, targetOrigin: string}>} */
      window.__capturedPostMessages = []
      const original = window.postMessage.bind(window)
      // Marker so we can introspect that the wrapper actually installed.
      window.__postMessageWrapperInstalled = true
      window.postMessage = function patchedPostMessage(...args) {
        try {
          const message = args[0]
          window.__capturedPostMessages.push({
            type: (message && typeof message === 'object') ? message.type : null,
            payload: (message && typeof message === 'object') ? message.payload : null,
            targetOrigin: args[1],
          })
        } catch (_) {
          // Capture is best-effort; a false capture must NOT crash
          // the page. Fall-through happens below.
        }
        return original(...args)
      }
    })

    // 2. Navigate + simulate the extension being installed. The
    //    dashboard polls documentElement every 1s; dispatching a
    //    `focus` event short-circuits the wait, so we don't have
    //    to sleep blindly.
    await page.goto('/dashboard')
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-jobbpiloten-ext', '1')
      window.dispatchEvent(new Event('focus'))
    })

    // 3. Wait for the connect button to appear once the
    //    "installed" state settles.
    const connectButton = page.locator('[data-testid="extension-connect-button"]')
    await expect(connectButton).toBeVisible({ timeout: 15_000 })

    // 4. Click connect. The handler awaits POST /api/extension/token
    //    (the demo-cookie Mongo lookup is the bottleneck in dev — the
    //    Next.js first compile of the route adds ~1-2s on top).
    await connectButton.click()

    // 5. Poll the captured list until BOTH JobbPiloten messages
    //    have landed. We poll rather than waitForTimeout because
    //    the postMessage calls happen inside the fetch's then-chain
    //    — sleeping a constant 5s would either be flaky (too short)
    //    or slow (too long). expect.poll was added in
    //    @playwright/test 1.30, which our ^1.61.1 dep satisfies.
    const expectedOrigin = new URL(page.url()).origin
    await expect
      .poll(
        async () => {
          const msgs = await page.evaluate(() => window.__capturedPostMessages || [])
          return {
            total: msgs.length,
            url: msgs.filter((m) => m.type === 'JOBBPILOTEN_SET_DASHBOARD_URL').length,
            auth: msgs.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC').length,
          }
        },
        {
          timeout: 15_000,
          intervals: [100, 250, 500],
          message: 'dashboard.connectExtension should fire BOTH JOBBPILOTEN_SET_DASHBOARD_URL AND JOBBPILOTEN_AUTH_SYNC',
        },
      )
      .toEqual({ total: expect.any(Number), url: 1, auth: 1 })

    // 6. Snapshot the captured messages now that both have fired.
    const messages = await page.evaluate(() => window.__capturedPostMessages || [])
    const urlMessages  = messages.filter((m) => m.type === 'JOBBPILOTEN_SET_DASHBOARD_URL')
    const authMessages = messages.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC')

    // 7. SET_DASHBOARD_URL asserts:
    //   • exactly one fire (idempotent — no double-click here)
    //   • payload.url is a non-empty string equal to window.location.origin
    //   • targetOrigin (postMessage's 2nd arg) is the same origin
    //     — the content-script listener accepts only same-origin posts,
    //     so passing anything else would silently swallow the message.
    expect(urlMessages).toHaveLength(1)
    const setUrlMsg = urlMessages[0]
    expect(setUrlMsg.payload).toBeTruthy()
    expect(typeof setUrlMsg.payload.url).toBe('string')
    expect(setUrlMsg.payload.url.length).toBeGreaterThan(0)
    expect(setUrlMsg.payload.url).toBe(expectedOrigin)
    expect(setUrlMsg.targetOrigin).toBe(expectedOrigin)

    // 8. AUTH_SYNC asserts (companion contract):
    //   • exactly one fire
    //   • payload carries token + profile
    //   • payload.baseUrl + payload.allowedOrigins are populated so
    //     the popup's fetch() can resolve without Tier-3 build-config.
    expect(authMessages).toHaveLength(1)
    const authMsg = authMessages[0]
    expect(authMsg.payload).toBeTruthy()
    expect(typeof authMsg.payload.token).toBe('string')
    expect(authMsg.payload.token.length).toBeGreaterThan(0)
    expect(authMsg.payload.profile).toBeTruthy()
    expect(typeof authMsg.payload.baseUrl).toBe('string')
    expect(authMsg.payload.baseUrl).toBe(expectedOrigin)
    expect(Array.isArray(authMsg.payload.allowedOrigins)).toBe(true)
    expect(authMsg.payload.allowedOrigins).toContain(expectedOrigin)
  })
})
