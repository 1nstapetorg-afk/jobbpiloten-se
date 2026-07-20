import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the dashboard's extension install banner detection.
 *
 * The dashboard reads `data-jobbpiloten-ext="1"` on
 * `document.documentElement` to decide whether to render the install
 * banner. The extension's content script sets that attribute at
 * document_start on every page. We can't actually load the MV3
 * extension into Playwright (the manifest needs a real chrome://
 * install) — so we simulate the extension by writing the attribute
 * directly via `page.evaluate` and assert the banner toggles off
 * within the dashboard's 1-second poll interval.
 *
 * What this catches:
 *   • The dashboard's useEffect that polls the attribute
 *   • The banner's `extensionChecked && !extensionInstalled` guard
 *   • The "install" / "installed" visual states don't drift
 *
 * What this does NOT cover:
 *   • The actual extension content script (covered manually in
 *     `TESTING.md` + via the /test-form manual flow).
 *   • The popup or background.js surface.
 */
test.describe('Dashboard: extension install banner', () => {
  test('banner is visible when the extension is NOT installed', async ({ page }) => {
    // Defensive: strip the attribute at the start of the test in
    // case a previous test left it set (the attribute is on
    // documentElement which is per-context, but Playwright reuses
    // contexts within a worker — better safe than sorry).
    await page.goto('/dashboard')
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-jobbpiloten-ext')
    })
    await page.reload()
    await page.waitForSelector('[data-testid="extension-install-banner"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="extension-install-banner"]')).toContainText(
      'Installera JobbPiloten Auto-Fill',
    )
  })

  test('banner hides when the extension attribute is set on documentElement', async ({ page }) => {
    await page.goto('/dashboard')
    // Set the attribute BEFORE the dashboard's poll runs, so the
    // first check in the useEffect already sees the install state.
    // The dashboard polls every 1s; give it up to 5s to react.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-jobbpiloten-ext', '1')
    })
    // Force a focus event so the dashboard re-polls immediately
    // (the useEffect listens for `focus` to short-circuit the
    // 1s interval).
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    // Wait until the banner is gone. If the polling breaks, this
    // times out at 5s and the assertion surfaces as a flake.
    await expect(page.locator('[data-testid="extension-install-banner"]')).toHaveCount(0, {
      timeout: 5_000,
    })
  })

  test('connect-button card appears when the extension is detected', async ({ page }) => {
    await page.goto('/dashboard')
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-jobbpiloten-ext', '1')
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('[data-testid="extension-connect-button"]')).toBeVisible({
      timeout: 10_000,
    })
  })
})
