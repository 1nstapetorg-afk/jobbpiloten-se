import { test, expect } from './_fixtures/auth'

/**
 * E2E spec — onboarding Step 4 (Granska) end-to-end: the two buttons
 * the Round-86 bug pair broke.
 *
 *   • "Generera förhandsvisning" (Förhandsvisa AI-mejl) — POST
 *     /api/email-preview must return HTTP 200 with a usable body
 *     (AI-generated OR rule-based fallback — both are valid; the
 *     pre-fix code surfaced "Servern returnerade 502" when the Groq
 *     quota was exhausted + trackEvent() threw).
 *   • "Slutför" — POST /api/profile must save and redirect to
 *     /dashboard. Pre-fix the client called bare res.json(), so an
 *     empty body leaked the raw "Unexpected end of JSON input" toast.
 *
 * Onboarding step indexing (matches onboarding-cv-upload.spec.js):
 *   step 0 → Karriärinfo      → "Nästa"
 *   step 1 → Personuppgifter  → "Nästa"
 *   step 2 → Preferenser      → "Nästa"
 *   step 3 → Granska          → "Generera förhandsvisning" + "Slutför"
 *
 * The demo user seeds fullName + email (tests/e2e/_fixtures/auth.js),
 * so step-1's name validation passes without typing and the preview's
 * requireCompleteProfile() profile lookup succeeds.
 *
 * Testid contract (app/onboarding/page.js):
 *   • preview button:   onboarding-email-preview-btn
 *   • preview body:     onboarding-email-preview-body
 *   • preview error:    onboarding-email-preview-error
 *   • cv-short warning: onboarding-email-preview-cv-warning
 */

test.describe.serial('Onboarding: Step 4 email preview + Slutför', () => {
  test('generates an email preview, saves the profile, and redirects to /dashboard', async ({ page }) => {
    await page.goto('/onboarding')

    await page.waitForSelector('button:has-text("Nästa")', {
      state: 'visible',
      timeout: 20_000,
    })

    // Click through to Step 1 (Personuppgifter). Nästa is a stepper
    // advance (not a submit) except on the last step.
    await page.locator('button:has-text("Nästa")').click()
    await page.waitForTimeout(250)

    // Step 1 validates that a full name exists before advancing. In
    // Clerk-configured mode useUser() returns the Clerk session (null
    // for a fixture without a real Clerk account) so the demo-user
    // fullName fallback is NOT available client-side — type it to pass
    // validation deterministically in BOTH auth modes.
    const nameInput = page.locator('input:below(:text("Fullständigt namn"))').first()
    await nameInput.fill('Anna Test')

    // Advance to Step 2 (Preferenser), then Step 3 (Granska).
    for (let i = 0; i < 2; i++) {
      await page.locator('button:has-text("Nästa")').click()
      await page.waitForTimeout(250)
    }

    // --- Granska step: the Förhandsvisa AI-mejl section renders ---
    await page.waitForSelector('[data-testid="onboarding-email-preview"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // --- Bug 1: "Generera förhandsvisning" must NOT 502 ---
    // The route may take a few seconds (Groq 429 → fail-fast →
    // rule-based fallback). Generous timeout.
    await page.getByTestId('onboarding-email-preview-btn').click()

    // Either outcome is acceptable on the happy path:
    //   • success  → onboarding-email-preview-body renders the email
    //   • the preview saves the profile first (the wizard POSTs
    //     /api/profile before previewing), so no error block expected.
    await expect(page.getByTestId('onboarding-email-preview-body')).toBeVisible({
      timeout: 30_000,
    })
    const bodyText = (await page.getByTestId('onboarding-email-preview-body').innerText()).trim()
    expect(bodyText.length).toBeGreaterThan(0)
    // A Swedish application email starts with a greeting.
    expect(bodyText).toMatch(/Hej|Med vänliga hälsningar|annons/i)
    // Round-86 followup (code-review): the full-suite run observed the
    // LLM ECHO the raw prompt back as the body ("1. **Analyze User
    // Input:** ...") when Groq's TPD quota is exhausted — that is NOT
    // a usable email. The greeting regex alone can't distinguish an
    // echo (the prompt is Swedish too), so pin the echo signature
    // explicitly: a body that reproduces the prompt's instruction
    // section is a provider-degradation artifact, not a preview.
    expect(bodyText).not.toMatch(/Analyze User Input/)

    // The error block must NOT be rendered (pre-fix it showed
    // "Servern returnerade 502").
    await expect(page.getByTestId('onboarding-email-preview-error')).not.toBeVisible()

    // --- Bug 2: "Slutför" saves + redirects (never empty-body toast) ---
    await page.waitForSelector('button:has-text("Slutför")', { state: 'visible', timeout: 20_000 })
    await page.locator('button:has-text("Slutför")').click()

    // On success the wizard redirects to /dashboard.
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 })

    // --- Verify the API round-trip: profile persisted with the
    //     onboarding payload (name + email at minimum) ---
    const res = await page.request.get('/api/profile')
    expect(res.status()).toBe(200)
    const body = await res.json()
    const profile = body.profile || body
    expect(typeof profile.fullName).toBe('string')
    expect(profile.fullName.length).toBeGreaterThan(0)
    expect(typeof profile.email).toBe('string')
  })
})
