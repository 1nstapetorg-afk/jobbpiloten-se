// tests/e2e/dashboard-af-compliance.spec.js
//
// Round-41 / Part 7 (Sub-feature 3 — AF compliance check) —
// Live e2e smoke for the AF compliance card on the dashboard.
//
// What we lock
// ------------
//   1. The Aktivitetsrapport card wrapper renders
//      (data-testid="aktivitetsrapport-card")
//   2. The AF compliance sub-card renders
//      (data-testid="af-compliance")
//   3. The status chip renders with one of the 3 status labels
//      (data-testid="af-compliance-chip")
//   4. The progress bar renders
//      (data-testid="af-compliance-bar")
//   5. The regulatory disclaimer renders
//      (data-testid="af-compliance-disclaimer")
//   6. The "Ladda ner PDF" download button renders
//      (data-testid="af-compliance-download")
//
// What we don't lock
// ------------------
//   - The pace-marker overlay (data-testid="af-compliance-pace-marker")
//     is conditionally rendered (guarded by `paceRequired > 0 &&
//     paceRequired < pace.target`). On day 1 of the month, the
//     marker is hidden — a non-failure. The structural-lock test
//     in tests/unit/af-compliance-jsx.test.mjs pins the guard
//     pattern, so the e2e doesn't need to re-assert it.
//   - The exact chip text. The status branch depends on the seed
//     data (status='prepared' apps from the onboarding auto-seed
//     do NOT count toward the pace, so a fresh demo user with
//     0 'applied' apps will see "Du ligger efter takten"). We
//     assert the chip is one of the 3 valid status labels via a
//     regex match, not a literal.
//   - The progress bar fill width. The % depends on the
//     applied/target ratio which is fixture-driven.
//
// Fixtures
// --------
// The auth fixture (tests/e2e/_fixtures/auth.js) provides a
// per-TEST demoUserId cookie so a parallel e2e run never
// collides on a shared row. The onboarding flow
// (POST /api/profile) auto-seeds 12 applications with random
// statuses, so a fresh fixture user already has data for the
// dashboard to render the AF compliance card against.

import { test, expect } from './_fixtures/auth'

test.describe('Round-41 / Part 7 — AF compliance card render', () => {
  test('Aktivitetsrapport card + AF compliance sub-card render with all surfaces', async ({ page }) => {
    // Mount the dashboard. The auth fixture auto-seeds the demo
    // user + 12 applications on first request to /api/profile
    // (Round-30 onboarding flow). The /api/applications fetch
    // returns the seed, the dashboard renders, and the AF
    // compliance card computes the pace from the seed.
    await page.goto('/dashboard')
    // Round-41.3 e2e-smoke fix: wait for the dashboard's 5 API
    // calls (stats / applications / profile / subscription /
    // push-status) to settle before asserting on the card. The
    // dashboard shows a spinner while `loading` is true and the
    // card only renders after `setLoading(false)` fires in the
    // Promise.all().all() branch. Without this wait, the first
    // `toBeVisible()` assertion can race the load and fail with
    // "Element not found" (the card is not in the DOM while
    // the spinner is showing). `networkidle` is the right
    // signal — it's emitted when no network requests have been
    // in flight for 500ms, which matches "the dashboard has
    // finished its initial load and is idle".
    await page.waitForLoadState('networkidle')

    // 1. The Aktivitetsrapport card wrapper is visible.
    const card = page.getByTestId('aktivitetsrapport-card')
    await expect(card, 'Aktivitetsrapport card wrapper is rendered').toBeVisible()

    // 2. The AF compliance sub-card is visible.
    const afCard = page.getByTestId('af-compliance')
    await expect(afCard, 'AF compliance sub-card is rendered inside the Aktivitetsrapport card').toBeVisible()

    // 3. The status chip is visible with one of the 3 valid status labels.
    const chip = page.getByTestId('af-compliance-chip')
    await expect(chip, 'AF compliance status chip is rendered').toBeVisible()
    // The 3 status labels are exclusive — exactly one of them renders
    // for any given (applied, paceRequired) pair. Asserting via a
    // pipe-OR regex keeps the test robust to fixture data variation
    // (a fresh user with 0 'applied' apps sees "Du ligger efter
    // takten", while a 14-app user sees "Standardmål uppnått").
    const chipText = await chip.textContent()
    expect(
      /Standardmål uppnått|I linje med takten|Du ligger efter takten/.test(chipText),
      `AF compliance chip text "${chipText}" must be one of the 3 valid status labels`,
    ).toBe(true)

    // 4. The progress bar is visible.
    const bar = page.getByTestId('af-compliance-bar')
    await expect(bar, 'AF compliance progress bar is rendered').toBeVisible()
    // role="progressbar" + aria-valuemin/max are the a11y contract.
    await expect(bar, 'AF compliance bar exposes role=progressbar').toHaveRole('progressbar')
    await expect(bar, 'AF compliance bar aria-valuemax=14 (AF standardmål)').toHaveAttribute('aria-valuemax', '14')
    await expect(bar, 'AF compliance bar aria-valuemin=0').toHaveAttribute('aria-valuemin', '0')

    // 5. The regulatory disclaimer is visible with the standardmål
    //    copy. Asserting the "standardmål" keyword is the minimal
    //    contract: a future copy edit that drops the regulatory
    //    hedge would fail the assertion without locking the
    //    exact wording (which is Swedish and could be copy-edited
    //    by future maintainers).
    const disclaimer = page.getByTestId('af-compliance-disclaimer')
    await expect(disclaimer, 'AF compliance regulatory disclaimer is rendered').toBeVisible()
    await expect(disclaimer, 'Disclaimer mentions the 14/month standardmål').toContainText('standardmål på 14 ansökningar/månad')
    await expect(disclaimer, 'Disclaimer defers to the user\'s handlingsplan').toContainText('handlingsplan')

    // 6. The download button is visible.
    const download = page.getByTestId('af-compliance-download')
    await expect(download, 'Ladda ner PDF button is rendered').toBeVisible()
    await expect(download, 'Download button has the Swedish label').toContainText('Ladda ner PDF')

    // 7. The summary line renders the "{N} ansökningar denna period"
    //    copy. The exact N depends on fixture data, so we assert
    //    the Swedish suffix only.
    const summary = page.getByTestId('af-compliance-summary')
    await expect(summary, 'AF compliance summary line is rendered').toBeVisible()
    await expect(summary, 'Summary shows the "denna period" suffix').toContainText('ansökningar denna period')
  })
})
