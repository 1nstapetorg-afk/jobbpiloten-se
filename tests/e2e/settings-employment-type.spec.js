import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the multi-select Anställningstyp picker on /settings.
 *
 * Issue 2 (2026-07-10) changed the field from a single string
 * (`'heltid'`) to an array of canonical Swedish slugs
 * (`['heltid', 'deltid', 'konsult']`). The settings form reflects
 * this with a checkbox grid; the route's `employmentType` branch on
 * `POST /api/profile-update` normalises legacy English keys + dedupes
 * before persisting.
 *
 * We don't reset the field in `beforeEach` because the suite already
 * shares a single `demo-user-001` profile across tests (see
 * playwright.config.js `workers: 1`). The test below uses
 * `buildPatch`'s sorted-comparison to detect a no-op save and avoid
 * a flake when the same multi-select is toggled between runs.
 */
test.describe('Settings: multi-select Anställningstyp', () => {
  test('checkboxes round-trip through the patch + persist across reload', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-employmentType"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // Clear any prior selection first so the dirty-state path is
    // deterministic across runs. We click each currently-checked
    // checkbox to flip it off.
    const checkboxes = page.locator(
      '[data-testid="settings-employmentType"] [data-testid^="settings-employmentType-"]',
    )
    const count = await checkboxes.count()
    for (let i = 0; i < count; i++) {
      const cb = checkboxes.nth(i)
      if (await cb.isChecked()) {
        await cb.click()
      }
    }
    // After clearing, click heltid + deltid + konsult. These are
    // the three most common values a real user would pick.
    await page.locator('[data-testid="settings-employmentType-heltid"]').click()
    await page.locator('[data-testid="settings-employmentType-deltid"]').click()
    await page.locator('[data-testid="settings-employmentType-konsult"]').click()

    // Save the patch.
    await page.locator('[data-testid="settings-save"]').click()
    await expect(
      page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first(),
    ).toBeVisible({ timeout: 10_000 })

    // Reload and verify the three checkboxes are still ticked.
    // The other three (praktik, tillsvidare, visstid) stay
    // unchecked.
    await page.reload()
    await page.waitForSelector('[data-testid="settings-employmentType-heltid"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="settings-employmentType-heltid"]')).toBeChecked()
    await expect(page.locator('[data-testid="settings-employmentType-deltid"]')).toBeChecked()
    await expect(page.locator('[data-testid="settings-employmentType-konsult"]')).toBeChecked()
    await expect(page.locator('[data-testid="settings-employmentType-praktik"]')).not.toBeChecked()
    await expect(page.locator('[data-testid="settings-employmentType-tillsvidare"]')).not.toBeChecked()
    await expect(page.locator('[data-testid="settings-employmentType-visstid"]')).not.toBeChecked()
  })

  test('legacy English slugs (full-time / part-time) are normalised to Swedish', async ({ page }) => {
    // Reset to a known state via the API, then PATCH with the
    // legacy key to verify the server-side enum map. Issue 2 fix
    // (2026-07-10) added the same map to /api/profile-update.
    await page.request.post('/api/profile-update', {
      headers: { 'Content-Type': 'application/json' },
      data: { employmentType: [] },
    })
    const res = await page.request.post('/api/profile-update', {
      headers: { 'Content-Type': 'application/json' },
      data: { employmentType: ['full-time', 'part-time', 'contract'] },
    })
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    // Re-read the profile and verify the array was translated.
    const profileRes = await page.request.get('/api/profile')
    const profile = (await profileRes.json()).profile
    expect(profile.employmentType).toEqual(
      expect.arrayContaining(['heltid', 'deltid', 'konsult']),
    )
    expect(profile.employmentType).not.toEqual(
      expect.arrayContaining(['full-time', 'part-time', 'contract']),
    )
  })
})
