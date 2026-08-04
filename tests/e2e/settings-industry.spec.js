import { test, expect } from './_fixtures/auth'

/**
 * Round-84 — E2E spec for the /settings structured industry form.
 *
 * Round-84 wired the complete structured industry taxonomy (shadcn
 * Selects / multiselect chips / inputs — same shared component as
 * onboarding) into /settings, replacing the legacy boolean toggles:
 *   • industry selector      settings-industry / settings-industry-<id>
 *   • structured field block settings-industry-fields
 *   • select field           settings-industry-field-<fieldId>-trigger
 *   • select option          settings-industry-field-<fieldId>-opt-<slug>
 *   • multiselect chip       settings-industry-field-<fieldId>-opt-<slug>
 *   • text/url input         settings-industry-field-<fieldId>
 *   • universal status       settings-universal-block / settings-universal-<id>
 *   • save                   settings-save
 *
 * Switching industry must WIPE the structured answers (handleIndustryChange)
 * and the "Spara ändringar" POST must round-trip industryFields + the
 * dual-write booleans through /api/profile-update.
 */

test('settings: picking lager + answering structured questions persists industryFields', async ({ page }) => {
  await page.goto('/settings')

  await page.waitForSelector('[data-testid="settings-fullName"]', { state: 'visible', timeout: 20_000 })

  // --- Pick the industry in the shadcn Select ---
  await page.getByTestId('settings-industry').click()
  await page.getByTestId('settings-industry-lager').click()

  // The complete structured question block for lager appears.
  await expect(page.getByTestId('settings-industry-fields')).toBeVisible()

  // Answer the required lager questions with "Ja" + one multiselect.
  for (const fieldId of ['forklift_license', 'physical_capacity', 'shift_work']) {
    await page.getByTestId(`settings-industry-field-${fieldId}-trigger`).click()
    await page.getByTestId(`settings-industry-field-${fieldId}-opt-ja`).click()
  }
  // testidSlug() strips non-ASCII: 'A1 - låglyftande' →
  // 'a1-l-glyftande' (see components/IndustryFieldsForm.jsx).
  await page.getByTestId('settings-industry-field-forklift_types-opt-a1-l-glyftande').click()

  // --- Save ---
  await page.getByTestId('settings-save').click()

  // Wait for the success toast, then verify the API round-trip.
  await expect(page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first()).toBeVisible({ timeout: 15_000 })

  const res = await page.request.get('/api/profile')
  expect(res.status()).toBe(200)
  const body = await res.json()
  const profile = body.profile || body

  expect(profile.industry).toBe('lager')
  expect(profile.industryFields).toBeDefined()
  expect(profile.industryFields.lager.forklift_license).toBe('Ja')
  expect(profile.industryFields.lager.physical_capacity).toBe('Ja')
  expect(profile.industryFields.lager.shift_work).toBe('Ja')
  expect(profile.industryFields.lager.forklift_types).toEqual(['A1 - låglyftande'])
  // Dual-write booleans (Round-81 extension fill path).
  expect(profile.hasForkliftLicense).toBe(true)
  expect(profile.canLiftHeavy).toBe(true)
  expect(profile.canShiftWork).toBe(true)
})

test('settings: switching industry wipes stale structured answers before save', async ({ page }) => {
  await page.goto('/settings')

  await page.waitForSelector('[data-testid="settings-fullName"]', { state: 'visible', timeout: 20_000 })

  // Seed lager answers first.
  await page.getByTestId('settings-industry').click()
  await page.getByTestId('settings-industry-lager').click()
  await page.getByTestId('settings-industry-field-forklift_license-trigger').click()
  await page.getByTestId('settings-industry-field-forklift_license-opt-ja').click()
  await page.getByTestId('settings-save').click()
  await expect(page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first()).toBeVisible({ timeout: 15_000 })

  // Switch to vård — the lager answers must NOT carry over (the form
  // wipes industryFields on change; the server also wipes stored
  // industryFields when the industry changes without a new answer set).
  await page.getByTestId('settings-industry').click()
  await page.getByTestId('settings-industry-vård').click()
  await page.getByTestId('settings-save').click()
  await expect(page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first()).toBeVisible({ timeout: 15_000 })

  const res = await page.request.get('/api/profile')
  expect(res.status()).toBe(200)
  const body = await res.json()
  const profile = body.profile || body

  expect(profile.industry).toBe('vård')
  // Old lager answers wiped (nested object no longer holds lager).
  expect(profile.industryFields).toBeDefined()
  expect(profile.industryFields.lager).toBeUndefined()
})
