import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the dashboard \u2192 settings navigation.
 *
 * Covers the small but important UI affordance introduced alongside
 * /settings: the gear icon in the dashboard nav. Without this test the
 * icon could silently disappear on a redesign without anyone noticing.
 */

test.describe('Dashboard nav: gear icon', () => {
  test('gear icon is visible on /dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('[data-testid="dashboard-open-settings"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="dashboard-open-settings"]')).toHaveAttribute(
      'aria-label',
      /(?:Ö|ö|O|o)ppna inst.llningar/,
    )
  })

  test('clicking gear icon navigates to /settings', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('[data-testid="dashboard-open-settings"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.locator('[data-testid="dashboard-open-settings"]').click()
    await page.waitForURL('**/settings', { timeout: 15_000 })
    expect(page.url()).toMatch(/\/settings$/)
  })

  test('settings page has a back-to-dashboard link', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-back-to-dashboard"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.locator('[data-testid="settings-back-to-dashboard"]').click()
    await page.waitForURL('**/dashboard', { timeout: 15_000 })
    expect(page.url()).toMatch(/\/dashboard$/)
  })
})
