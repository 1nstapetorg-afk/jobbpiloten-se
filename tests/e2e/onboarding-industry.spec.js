import { test, expect } from './_fixtures/auth'

/**
 * E2E spec — onboarding flow with industry selection (Round-82/83).
 *
 * Covers the tiered-taxonomy wiring end to end:
 *   • Step 0 (Karriärinfo) shows the industry dropdown; selecting an
 *     industry reveals its COMPLETE structured field form (Round-83:
 *     selects with the schema's option list, multiselect chips,
 *     text/url inputs).
 *   • All REQUIRED industry fields must be answered before "Nästa"
 *     advances (per-step validation, Round-81/83).
 *   • "Slutför" persists `industry` + the nested `industryFields`
 *     object (e.g. { lager: { forklift_license: 'Ja', … } }) via
 *     POST /api/profile, PLUS the legacy flat booleans (dual-write,
 *     e.g. hasForkliftLicense = true).
 *   • GET /api/profile returns the industry-specific fields.
 *
 * Onboarding step indexing (matches onboarding-cv-upload.spec.js):
 *   step 0 → Karriärinfo    (industry dropdown + structured questions)
 *   step 1 → Personuppgifter
 *   step 2 → Preferenser
 *   step 3 → Granska         → "Slutför"
 *
 * The demo user seeds `fullName: 'Demo Användare'` (see
 * tests/e2e/_fixtures/auth.js), so step-1's name validation passes
 * without typing.
 *
 * Testid contract (app/onboarding/page.js):
 *   • industry dropdown:      onboarding-industry / onboarding-industry-<id>
 *   • select field:           onboarding-industry-field-<fieldId>-trigger
 *   • select option:          onboarding-industry-field-<fieldId>-opt-<slug>
 *   • multiselect chip:       onboarding-industry-field-<fieldId>-opt-<slug>
 *   • text/url input:         onboarding-industry-field-<fieldId>
 */

test.describe.serial('Onboarding: industry selection', () => {
  test('selecting lager + answering the required structured questions persists industry + industryFields', async ({ page }) => {
    await page.goto('/onboarding')

    await page.waitForSelector('button:has-text("Nästa")', {
      state: 'visible',
      timeout: 20_000,
    })

    // --- Step 0: pick the industry in the shadcn Select ---
    await page.getByTestId('onboarding-industry').click()
    await page.getByTestId('onboarding-industry-lager').click()

    // The complete structured question block for lager appears.
    await expect(page.getByTestId('onboarding-industry-fields')).toBeVisible()

    // Answer every REQUIRED lager question (Round-83: forklift_license,
    // physical_capacity, shift_work) with "Ja". Also answer one
    // optional multiselect (forklift_types) to lock the nested-array
    // storage shape.
    for (const fieldId of ['forklift_license', 'physical_capacity', 'shift_work']) {
      await page.getByTestId(`onboarding-industry-field-${fieldId}-trigger`).click()
      await page.getByTestId(`onboarding-industry-field-${fieldId}-opt-ja`).click()
    }
        // testidSlug() strips non-ASCII: 'A1 - låglyftande' →
    // 'a1-l-glyftande' (see components/IndustryFieldsForm.jsx).
    await page.getByTestId('onboarding-industry-field-forklift_types-opt-a1-l-glyftande').click()

    // --- Step 1 → 3: click through the remaining steps ---
    // Step 1 (Personuppgifter): the demo user's fullName pre-fills the
    // field in pure demo mode, but in a Clerk-keyed dev env useUser()
    // returns the Clerk session (null for a fixture without a real
    // Clerk account) so the client-side fallback is unavailable — type
    // it to pass step-1 validation deterministically in BOTH auth modes
    // (same pattern as onboarding-email-preview.spec.js). Step 2
    // (Preferenser): no validation. Step 3 (Granska): "Slutför"
    // submits.
    await page.locator('button:has-text("Nästa")').click()
    await page.waitForTimeout(150)
    const nameInput = page.locator('input:below(:text("Fullständigt namn"))').first()
    await nameInput.fill('Anna Test')
    for (let i = 0; i < 2; i++) {
      await page.locator('button:has-text("Nästa")').click()
      await page.waitForTimeout(150)
    }

    await page.waitForSelector('button:has-text("Slutför")', { state: 'visible', timeout: 20_000 })
    await page.locator('button:has-text("Slutför")').click()

    // On success the wizard redirects to /dashboard.
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 })

    // --- Verify the API round-trip: industry + nested industryFields
    //     + legacy boolean dual-write persisted ---
    const res = await page.request.get('/api/profile')
    expect(res.status()).toBe(200)
    const body = await res.json()
    const profile = body.profile || body

    expect(profile.industry).toBe('lager')
    // Nested per-industry shape (Round-83 Mongo contract).
    expect(profile.industryFields).toBeDefined()
    expect(profile.industryFields.lager.forklift_license).toBe('Ja')
    expect(profile.industryFields.lager.physical_capacity).toBe('Ja')
    expect(profile.industryFields.lager.shift_work).toBe('Ja')
    expect(profile.industryFields.lager.forklift_types).toEqual(['A1 - låglyftande'])
    // Legacy dual-write booleans (the extension's Round-81 fill path).
    expect(profile.hasForkliftLicense).toBe(true)
    expect(profile.canLiftHeavy).toBe(true)
    expect(profile.canShiftWork).toBe(true)
  })
})
