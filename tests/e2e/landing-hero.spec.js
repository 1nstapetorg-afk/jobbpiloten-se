import { test, expect } from './_fixtures/auth'

/**
 * Hero narrative assertions for the landing page.
 *
 * The hero is now a CSS-built laptop mockup (replacing the previous
 * Shopify-looking Unsplash photo). The visual tells the same story as
 * the dashboard the user will see after sign-up:
 *   • "Lediga jobb för dig"      — page heading
 *   • "Volvo Cars / Frontend-utvecklare" — sample job card
 *   • "AI har skrivit ditt personliga brev" — AI status pill
 *   • "Klar att söka" (with green checkmark) — readiness indicator
 *
 * We assert the structural markers first (`hero-laptop` and
 * `hero-laptop-screen` data-testids) so failures point at the right
 * branch — a missing laptop container vs a missing text fragment.
 *
 * No authentication is needed because the landing page is public;
 * we still use the auth fixture so the demo-cookie context matches
 * the rest of the suite, and so future specs can co-locate
 * `landing + dashboard + settings` in one worker.
 */

test.describe('Landing: hero narrative', () => {
  test('renders the JobbPiloten narrative inside the laptop mockup', async ({ page }) => {
    await page.goto('/')

    // Wait for hydration — the page is statically pre-rendered so the
    // laptop container should appear quickly, but give it a generous
    // budget so we don't flake on slow CI.
    await page.waitForSelector('[data-testid="hero-laptop"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.waitForSelector('[data-testid="hero-laptop-screen"]', {
      state: 'visible',
      timeout: 5_000,
    })

    // Each narrative fragment the spec mandates. We use
    // getByText({ exact: true }) so common substrings ("Volvo Cars"
    // matches both the job card and the floating badge) don't
    // shorten the assertion to a single match.
    await expect(page.getByText('Lediga jobb för dig', { exact: true })).toBeVisible()
    await expect(page.getByText('Volvo Cars', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Frontend-utvecklare', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByText('AI har skrivit ditt personliga brev', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Klar att söka', { exact: true })).toBeVisible()
  })
})
