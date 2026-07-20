# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-hjalp-toggle.spec.js >> Settings: AI-hjälp toggle >> server-side guard drops non-boolean payloads
- Location: tests\e2e\ai-hjalp-toggle.spec.js:72:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: undefined
```

# Test source

```ts
  1  | import { test, expect } from './_fixtures/auth'
  2  | 
  3  | /**
  4  |  * E2E spec for the "AI-hjälp i ansökningsformulär" toggle on
  5  |  * /settings.
  6  |  *
  7  |  * The toggle controls `profile.aiFallbackEnabled` (default true).
  8  |  * The extension's /api/extension/ai-answers route honours this
  9  |  * setting server-side — flipping it off returns
  10 |  * `{ disabled: true, answers: {} }` so the content script never
  11 |  * paints the blue AI-generated outline on host-page fields.
  12 |  *
  13 |  * The /settings page owns the toggle UI (AIUsageCard) and posts
  14 |  * the patch via /api/profile-update with `{ aiFallbackEnabled: bool }`.
  15 |  * The server's guard coerces non-boolean payloads to a console
  16 |  * warning and drops the key, so a bad client can't break the
  17 |  * round-trip.
  18 |  *
  19 |  * We assert three things:
  20 |  *   1. The toggle is rendered in its current state on first visit.
  21 |  *   2. Clicking the toggle + saving persists the new state across
  22 |  *      a page reload.
  23 |  *   3. The server-side guard rejects a non-boolean payload.
  24 |  */
  25 | test.describe('Settings: AI-hjälp toggle', () => {
  26 |   test('renders in its current state on /settings', async ({ page }) => {
  27 |     await page.goto('/settings')
  28 |     // The AI card hydrates AFTER /api/ai-usage returns — wait for
  29 |     // either the toggle or its loading skeleton.
  30 |     await page.waitForSelector('[data-testid="settings-ai-toggle"], [data-testid="settings-ai-usage-loading"]', {
  31 |       state: 'visible',
  32 |       timeout: 20_000,
  33 |     })
  34 |     // Wait for the loading skeleton to swap to the real card.
  35 |     await page.waitForSelector('[data-testid="settings-ai-toggle"]', {
  36 |       state: 'visible',
  37 |       timeout: 20_000,
  38 |     })
  39 |     // Sanity: the toggle has the expected aria-label.
  40 |     await expect(page.locator('[data-testid="settings-ai-toggle"]')).toHaveAttribute(
  41 |       'aria-label',
  42 |       /Aktivera AI-svar/,
  43 |     )
  44 |   })
  45 | 
  46 |   test('toggling off + reload preserves the off state', async ({ page }) => {
  47 |     // Reset to a known ON state via the API.
  48 |     const onRes = await page.request.post('/api/profile-update', {
  49 |       headers: { 'Content-Type': 'application/json' },
  50 |       data: { aiFallbackEnabled: true },
  51 |     })
  52 |     expect(onRes.status()).toBe(200)
  53 | 
  54 |     await page.goto('/settings')
  55 |     await page.waitForSelector('[data-testid="settings-ai-toggle"]', { state: 'visible', timeout: 20_000 })
  56 |     await expect(page.locator('[data-testid="settings-ai-toggle"]')).toBeChecked()
  57 | 
  58 |     // Flip the toggle. Radix Switch uses the same click-to-toggle
  59 |     // interaction as a checkbox.
  60 |     await page.locator('[data-testid="settings-ai-toggle"]').click()
  61 |     // The toast confirms the server round-trip.
  62 |     await expect(
  63 |       page.locator('[data-sonner-toast]:has-text("AI-svar avaktiverat")').first(),
  64 |     ).toBeVisible({ timeout: 10_000 })
  65 | 
  66 |     // Reload — the toggle should be in the OFF state.
  67 |     await page.reload()
  68 |     await page.waitForSelector('[data-testid="settings-ai-toggle"]', { state: 'visible', timeout: 20_000 })
  69 |     await expect(page.locator('[data-testid="settings-ai-toggle"]')).not.toBeChecked()
  70 |   })
  71 | 
  72 |   test('server-side guard drops non-boolean payloads', async ({ page }) => {
  73 |     // First turn the toggle back ON so we have a clean state.
  74 |     await page.request.post('/api/profile-update', {
  75 |       headers: { 'Content-Type': 'application/json' },
  76 |       data: { aiFallbackEnabled: true },
  77 |     })
  78 |     // Now send a string instead of a boolean. The server should
  79 |     // log a warning AND drop the key (so the existing
  80 |     // aiFallbackEnabled=true stays untouched).
  81 |     const badRes = await page.request.post('/api/profile-update', {
  82 |       headers: { 'Content-Type': 'application/json' },
  83 |       data: { aiFallbackEnabled: 'not-a-boolean' },
  84 |     })
  85 |     expect(badRes.status()).toBe(200)
  86 |     // Re-read and confirm the value is still true.
  87 |     const profile = (await (await page.request.get('/api/profile')).json()).profile
> 88 |     expect(profile.aiFallbackEnabled).toBe(true)
     |                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  89 |   })
  90 | })
  91 | 
```