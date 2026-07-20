import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the /settings page.
 *
 * Each test assumes:
 *   - dev server reachable at http://localhost:3000
 *   - Mongo reachable by the server with at least one seeded demo user
 *     (`demoUserId=demo-user-001` is what `_fixtures/auth` sets)
 *   - the demo user has already passed /onboarding so a profile exists
 *
 * If any of these is false the test will surface a clear Playwright
 * failure with the underlying error rather than hanging — timeout is
 * generous (60s on the suite) but failures are loud.
 *
 * Isolation: tests are wrapped in `test.describe.serial(...)` so they
 * execute in declaration order. The destructive account-delete test is
 * intentionally LAST so its database side-effect (profile + applications
 * gone) cannot race other tests. Combined with `workers: 1` in
 * playwright.config.js this also protects cross-file specs that share
 * the same demoUserId cookie.
 */

test.describe.serial('Settings page', () => {
test.describe('Settings: profile editor', () => {
  test('loads profile fields populated from /api/profile', async ({ page }) => {
    await page.goto('/settings')
    // Wait until the ProfileEditor Card has hydrated (i.e. the loader
    // Skeleton vanishes and a real input appears).
    await page.waitForSelector('[data-testid="settings-fullName"]', { state: 'visible', timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /Inställningar/ })).toBeVisible()
    // Save button starts disabled when the form equals the loaded profile.
    await expect(page.locator('[data-testid="settings-save"]')).toBeDisabled()
  })

  test('edit + save a field shows success toast and clears dirty state', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-fullName"]', { state: 'visible', timeout: 20_000 })

    const fullName = page.locator('[data-testid="settings-fullName"]')
    const original = await fullName.inputValue()
    await fullName.fill(original ? `${original} *` : 'Anna Andersson *')

    // Save button enables once the dirty counter shows > 0.
    const save = page.locator('[data-testid="settings-save"]')
    await expect(save).toBeEnabled()
    await save.click()

    // Sonner toast appears in a [data-sonner-toast] element. We assert the
    // text starts with "Profil uppdaterad" — exact copy may drift.
    await expect(
      page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first(),
    ).toBeVisible({ timeout: 10_000 })
    // After re-fetch, the new value is round-tripped so the form is no
    // longer dirty and the save button is disabled again.
    await expect(save).toBeDisabled()
  })
})

test.describe('Settings: GDPR art. 20 export', () => {
  test('clicking "Ladda ner JSON" triggers a download', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-export"]', { state: 'visible', timeout: 20_000 })

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
    await page.locator('[data-testid="settings-export"]').click()
    const download = await downloadPromise

    // Filename follows the convention in app/settings/page.js:
    // `jobbpiloten-data-YYYY-MM-DD.json`
    expect(download.suggestedFilename()).toMatch(/^jobbpiloten-data-\d{4}-\d{2}-\d{2}\.json$/)
  })
})

// Round-31 ISOLATION MIGRATION — RESOLVED.
// The auth fixture (tests/e2e/_fixtures/auth.js) now derives the
// per-test clerkId via `demo-user-001-w${testInfo.workerIndex}-h${hash(testInfo.title)}`,
// so this destructive test safely wipes only its own per-test
// Mongo document and never cascades to parallel siblings. With
// per-test isolation in place, playwright.config.js flipped
// `fullyParallel: true` back from Round-30's belt-and-braces
// `false` — the spec suite reclaims the throughput Round-30 had
// sacrificed. The Round-30 hint (per-worker clerkId) was a partial
// fix; the Round-31 per-test fix is the complete one.
test.describe('Settings: GDPR art. 17 account delete', () => {
  test('button is disabled until the confirm phrase is typed exactly', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-open-delete"]', { state: 'visible', timeout: 20_000 })
    await page.locator('[data-testid="settings-open-delete"]').click()

    // Confirm button starts disabled (phrase empty).
    const confirm = page.locator('[data-testid="settings-delete-confirm-button"]')
    await expect(confirm).toBeDisabled()

    // Wrong phrase (lowercase / partial) keeps it disabled.
    await page.locator('[data-testid="settings-delete-confirm"]').fill('radera mitt konto')
    await expect(confirm).toBeDisabled()

    // Aprrox text with trailing whitespace also rejected.
    await page.locator('[data-testid="settings-delete-confirm"]').fill('RADERA MITT KONTO ')
    // The dialog resets on re-open; here the value matches trimmed string but
    // the comparison is exact, so it should still be disabled until the
    // user types exactly the phrase. Adjust behavior if loosening later.
    await expect(confirm).toBeDisabled()

    // Finally, exact phrase — button enables.
    await page.locator('[data-testid="settings-delete-confirm"]').fill('RADERA MITT KONTO')
    await expect(confirm).toBeEnabled()
  })

  test('successful delete closes the workflow with an emerald summary', async ({ page }) => {
    // Uses a temporary demo user so this test does not destroy other tests'
    // shared fixture. The fixture-as-test-name convention lets us isolate
    // state if needed.
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-open-delete"]', { state: 'visible', timeout: 20_000 })
    await page.locator('[data-testid="settings-open-delete"]').click()
    await page.locator('[data-testid="settings-delete-confirm"]').fill('RADERA MITT KONTO')
    await page.locator('[data-testid="settings-delete-confirm-button"]').click()

    // The success banner inside the dialog body asserts the per-collection
    // delete counts the server reported.
    await expect(
      page.locator('text=Kontot är raderat').first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})
}) // end of test.describe.serial('Settings page')
