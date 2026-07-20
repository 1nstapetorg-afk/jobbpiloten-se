import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the "AI-hjälp i ansökningsformulär" toggle on
 * /settings.
 *
 * The toggle controls `profile.aiFallbackEnabled` (default true).
 * The extension's /api/extension/ai-answers route honours this
 * setting server-side — flipping it off returns
 * `{ disabled: true, answers: {} }` so the content script never
 * paints the blue AI-generated outline on host-page fields.
 *
 * The /settings page owns the toggle UI (AIUsageCard) and posts
 * the patch via /api/profile-update with `{ aiFallbackEnabled: bool }`.
 * The server's guard coerces non-boolean payloads to a console
 * warning and drops the key, so a bad client can't break the
 * round-trip.
 *
 * We assert three things:
 *   1. The toggle is rendered in its current state on first visit.
 *   2. Clicking the toggle + saving persists the new state across
 *      a page reload.
 *   3. The server-side guard rejects a non-boolean payload.
 */
test.describe('Settings: AI-hjälp toggle', () => {
  test('renders in its current state on /settings', async ({ page }) => {
    await page.goto('/settings')
    // The AI card hydrates AFTER /api/ai-usage returns — wait for
    // either the toggle or its loading skeleton.
    await page.waitForSelector('[data-testid="settings-ai-toggle"], [data-testid="settings-ai-usage-loading"]', {
      state: 'visible',
      timeout: 20_000,
    })
    // Wait for the loading skeleton to swap to the real card.
    await page.waitForSelector('[data-testid="settings-ai-toggle"]', {
      state: 'visible',
      timeout: 20_000,
    })
    // Sanity: the toggle has the expected aria-label.
    await expect(page.locator('[data-testid="settings-ai-toggle"]')).toHaveAttribute(
      'aria-label',
      /Aktivera AI-svar/,
    )
  })

  test('toggling off + reload preserves the off state', async ({ page }) => {
    // Reset to a known ON state via the API.
    const onRes = await page.request.post('/api/profile-update', {
      headers: { 'Content-Type': 'application/json' },
      data: { aiFallbackEnabled: true },
    })
    expect(onRes.status()).toBe(200)

    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-ai-toggle"]', { state: 'visible', timeout: 20_000 })
    await expect(page.locator('[data-testid="settings-ai-toggle"]')).toBeChecked()

    // Flip the toggle. Radix Switch uses the same click-to-toggle
    // interaction as a checkbox.
    await page.locator('[data-testid="settings-ai-toggle"]').click()
    // The toast confirms the server round-trip.
    await expect(
      page.locator('[data-sonner-toast]:has-text("AI-svar avaktiverat")').first(),
    ).toBeVisible({ timeout: 10_000 })

    // Reload — the toggle should be in the OFF state.
    await page.reload()
    await page.waitForSelector('[data-testid="settings-ai-toggle"]', { state: 'visible', timeout: 20_000 })
    await expect(page.locator('[data-testid="settings-ai-toggle"]')).not.toBeChecked()
  })

  test('server-side guard drops non-boolean payloads', async ({ page }) => {
    // First turn the toggle back ON so we have a clean state.
    await page.request.post('/api/profile-update', {
      headers: { 'Content-Type': 'application/json' },
      data: { aiFallbackEnabled: true },
    })
    // Now send a string instead of a boolean. The server should
    // log a warning AND drop the key (so the existing
    // aiFallbackEnabled=true stays untouched).
    const badRes = await page.request.post('/api/profile-update', {
      headers: { 'Content-Type': 'application/json' },
      data: { aiFallbackEnabled: 'not-a-boolean' },
    })
    expect(badRes.status()).toBe(200)
    // Re-read and confirm the value is still true.
    const profile = (await (await page.request.get('/api/profile')).json()).profile
    expect(profile.aiFallbackEnabled).toBe(true)
  })
})
