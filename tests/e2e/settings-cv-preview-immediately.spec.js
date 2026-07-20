import { test, expect } from './_fixtures/auth'

/**
 * Round-27.3a — the "preview immediately" companion to the CV upload
 * spec. Where `settings-cv-upload.spec.js` clears the demo user's cv
 * fields in `test.beforeEach` so every test starts from a known
 * "no CV on file" baseline, THIS spec starts from the seeded
 * "CV already on file" baseline and asserts the file card + success
 * line mount immediately on first paint, with NO upload step.
 *
 * The seed is established by `tests/e2e/_helpers/seedDemoUser.js`
 * (Round-26.2 extension of `DEMO_PROFILE_PAYLOAD` with cvText +
 * cvFileName + cvFileSize; cvUploadedAt is set to NOW at the call
 * site so relative-time renderers don't surface a stale "6 months
 * ago" timestamp against a mid-2026 demo). The seed runs
 * automatically via the `_fixtures/auth.js` fixture — no manual
 * setup is needed beyond pulling in that fixture.
 *
 * CRITICAL: this spec file MUST NOT call `clearCv` in `beforeEach`
 * or anywhere else. The whole point is to exercise the option (b)
 * seeded-pre-cvText path; if a future maintainer adds a wipe the
 * spec silently regresses to the upload-spec baseline. The
 * companion structural lock test in
 * `tests/unit/settings-cv-preview-immediate-spec.test.mjs` asserts
 * the absence of `clearCv` in this file so the two cannot drift.
 *
 * One test, intentionally — adding a second test that depends on
 * upload behaviour would force the file to import the upload
 * fixture set and re-introduce the option (a)/(b) coupling this
 * spec exists to break.
 */

test.describe('Settings: CV preview immediately (option b seed path)', () => {
  test('seeded cvText renders the file card and the success line on first paint', async ({ page }) => {
    await page.goto('/settings')

    // The file card must mount immediately on first paint — no upload
    // step, no clearCv wipe. This is the option (b) contract: the
    // seeded cvText renders BEFORE the user does anything.
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText(
      'cv-demo-frontend.pdf',
    )

    // Success line must be visible — the seed cvText is ~270 chars so
    // the route's MIN_VALID_CV_TEXT_CHARS = 50 floor cleared with
    // headroom. The substring "tecken hittades" is the stable copy
    // anchor even if the char count's locale-formatted shape drifts.
    await expect(page.locator('[data-testid="settings-cv-success"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText(
      'tecken hittades',
    )

    // The dropzone must NOT be visible — once a CV is on file the
    // file card replaces the dropzone. This catches a regression
    // that renders both UIs side-by-side (which would block clicks
    // on the file card via overflow:hidden).
    await expect(page.locator('[data-testid="settings-cv-dropzone"]')).toHaveCount(0)

    // The replace / remove actions must be present on the file card —
    // confirms the post-upload branch (NOT the empty-state branch) is
    // the one that's actually mounting.
    await expect(page.locator('[data-testid="settings-cv-replace"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-cv-remove"]')).toBeVisible()
  })
})
