// tests/e2e/round94-polish.spec.js
//
// E2E locks for the Round-94 professional-polish surface:
//
//   1. SINGLE avatar menu — the old navbar rendered TWO avatar
//      elements (the app's ProfileAvatar initials circle AND Clerk's
//      <UserButton />). The shared <UserMenu /> (components/UserMenu.jsx)
//      replaced both with ONE 36px avatar + dropdown. These tests
//      assert exactly one avatar element on the dashboard, that its
//      trigger opens a dropdown with Profil / Inställningar / Logga ut,
//      and that navigation targets behave.
//
//   2. Star-pop save animation — clicking the row star optimistically
//      flips `data-saved` and, once the server confirms, the star
//      remounts inside a span carrying `animate-star-pop` (360° spin +
//      scale bounce). We assert the state flip AND the animation class.
//
//   3. Stat-card hover tooltips — each hero stat card has a ⓘ button
//      (data-testid `stat-hint-<key>`) whose Radix tooltip explains the
//      number. Hovering must surface the hint text.
//
//   4. Onboarding complete confetti — clicking "Slutför" fires the
//      dependency-free Confetti burst (data-testid `confetti-burst`)
//      while the redirect to /dashboard is in flight.
//
//   5. Skeleton loading states — the dashboard and settings pages swap
//      generic spinners for layout-mirroring skeletons
//      (dashboard-loading-skeleton / settings-loading-skeleton). We
//      delay the /api/profile response so the skeleton is observable,
//      then confirm real content replaces it.
//
// Testid contract (components): dashboard-header-greeting (UserMenu
// trigger), profile-avatar-nav (single avatar), toggle-saved
// (row star, data-saved attr), hero-stats + stat-hint-<key> +
// stat-hint-content-<key> (hero stat cards), confetti-burst (Confetti),
// dashboard-loading-skeleton / settings-loading-skeleton (skeletons).

import { test, expect } from './_fixtures/auth'

test.describe('Round-94: single profile avatar + dropdown menu', () => {
  test('dashboard header shows ONE avatar whose trigger opens the user menu', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('[data-testid="dashboard-header-greeting"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // Exactly one avatar element — the old two-avatar bug (ProfileAvatar
    // + Clerk UserButton) would render TWO `profile-avatar-nav` nodes.
    await expect(page.locator('[data-testid="profile-avatar-nav"]')).toHaveCount(1)

    // The trigger is the greeting button itself (avatar + "Hej X!" in
    // one element), not a separate avatar + separate button.
    const trigger = page.getByTestId('dashboard-header-greeting')
    await trigger.click()

    // Dropdown surfaces the three menu items.
    await expect(page.getByRole('menuitem', { name: /Min profil/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Inställningar/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Logga ut/i })).toBeVisible()
  })

  test('user menu "Inställningar" navigates to /settings', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('[data-testid="dashboard-header-greeting"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.getByTestId('dashboard-header-greeting').click()
    await page.getByRole('menuitem', { name: /Inställningar/i }).click()
    // Generous timeout: the menu Link performs a soft navigation whose
    // RSC fetch waits on Next dev's ON-DEMAND compile of the huge
    // /settings route (cold-compile measured at ~20s+, see the skeleton
    // test below). 15s flakes on a freshly booted dev server; 60s still
    // fails fast on a genuinely dead Link (the RSC request resolves or
    // errors quickly once the route is warm).
    await page.waitForURL('**/settings', { timeout: 60_000 })
    expect(page.url()).toMatch(/\/settings$/)
  })
})

test.describe('Round-94: star-pop save animation', () => {
  test('clicking the row star flips data-saved and mounts the animate-star-pop span', async ({ page }) => {
    await page.goto('/dashboard')
    // The dashboard auto-defaults to the "Sparade" filter when the demo
    // seed contains a saved app (Round-33.3 behaviour). Un-saving that
    // row would empty the filtered grid and unmount its star — so pin
    // the "Alla" tab first to keep every row in view for the toggle.
    await page.waitForSelector('[data-testid="filter-all"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.getByTestId('filter-all').click()

    // Wait for an application row (the toggle-saved button only exists
    // once /api/applications has resolved).
    await page.waitForSelector('[data-testid="toggle-saved"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const star = page.getByTestId('toggle-saved').first()
    const before = await star.getAttribute('data-saved')
    await star.click()

    // Optimistic flip: data-saved toggles immediately.
    await expect(star).toHaveAttribute('data-saved', before === 'true' ? 'false' : 'true', {
      timeout: 5_000,
    })

    // Server-confirmed state: the saved star remounts inside the
    // Round-94 animation span. When saved=true the span carries the
    // `animate-star-pop` class (the 360° spin + scale bounce).
    if ((await star.getAttribute('data-saved')) === 'true') {
      await expect(star.locator('span.animate-star-pop')).toBeVisible({ timeout: 10_000 })
    } else {
      // Un-save path: the outline star returns and the animation span
      // is gone.
      await expect(star.locator('span.animate-star-pop')).toHaveCount(0)
    }
  })
})

test.describe('Round-94: stat-card hover tooltips', () => {
  test('hovering the ⓘ on each hero stat card reveals its explanation', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('[data-testid="hero-stats"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // All four cards render (saved / this-month / total / confirmed).
    await expect(page.locator('[data-testid="hero-stats"] [data-testid^="stat-hint-"]')).toHaveCount(4)

    for (const key of ['saved', 'this-month', 'total', 'confirmed']) {
      const hintBtn = page.getByTestId(`stat-hint-${key}`)
      await hintBtn.hover()
      // Radix portals the tooltip content to <body> — visible anywhere.
      await expect(page.getByTestId(`stat-hint-content-${key}`)).toBeVisible({ timeout: 5_000 })
      // The hint text is non-empty Swedish copy.
      const text = (await page.getByTestId(`stat-hint-content-${key}`).innerText()).trim()
      expect(text.length).toBeGreaterThan(10)
      // Radix keeps tooltip content hoverable while the pointer stays
      // near it, so a rapid next-hover can be intercepted by the still-
      // open content and the next tooltip never mounts. Escape forces a
      // deterministic close before the next trigger hover.
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
    }
  })
})

test.describe('Round-94: onboarding completion confetti', () => {
  test('clicking Slutför fires the confetti burst before the dashboard redirect', async ({ page }) => {
    // Pin reducedMotion to no-preference so this test is deterministic on
    // ANY machine. Confetti (components/Confetti.jsx) renders NULL when
    // prefers-reduced-motion: reduce — the honest outcome for those
    // users — so asserting the burst requires a no-preference context
    // (headless CI defaults to this, but a developer machine with OS
    // reduce-motion enabled would otherwise fail here).
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/onboarding')

    await page.waitForSelector('button:has-text("Nästa")', {
      state: 'visible',
      timeout: 20_000,
    })
    // Step 0 (Karriärinfo) → Step 1 (Personuppgifter).
    await page.locator('button:has-text("Nästa")').click()
    await page.waitForTimeout(250)

    // Step 1 requires a full name in both Clerk and demo modes.
    const nameInput = page.locator('input:below(:text("Fullständigt namn"))').first()
    await nameInput.fill('Anna Test')

    // Step 1 → Step 2 (Preferenser) → Step 3 (Granska).
    for (let i = 0; i < 2; i++) {
      await page.locator('button:has-text("Nästa")').click()
      await page.waitForTimeout(250)
    }

    await page.waitForSelector('button:has-text("Slutför")', { state: 'visible', timeout: 20_000 })
    await page.locator('button:has-text("Slutför")').click()

    // Confetti is self-cleaning after ~1.8s; the redirect to /dashboard
    // runs in the same tick, so assert attachment quickly.
    await expect(page.getByTestId('confetti-burst')).toBeAttached({ timeout: 5_000 })
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 })
  })
})

test.describe('Round-94: prefers-reduced-motion audit', () => {
  test('reduced-motion users get NO confetti burst on onboarding completion', async ({ page }) => {
    // Emulate OS-level reduce-motion BEFORE any navigation so
    // window.matchMedia in components/Confetti.jsx reads it on mount.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/onboarding')

    await page.waitForSelector('button:has-text("Nästa")', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.locator('button:has-text("Nästa")').click()
    await page.waitForTimeout(250)

    // Step 1 requires a full name in both Clerk and demo modes.
    const nameInput = page.locator('input:below(:text("Fullständigt namn"))').first()
    await nameInput.fill('Anna Test')

    for (let i = 0; i < 2; i++) {
      await page.locator('button:has-text("Nästa")').click()
      await page.waitForTimeout(250)
    }

    await page.waitForSelector('button:has-text("Slutför")', { state: 'visible', timeout: 20_000 })
    await page.locator('button:has-text("Slutför")').click()

    // Confetti returns null under reduce — the burst testid must never
    // enter the DOM (the honest outcome, not a collapsed animation).
    await expect(page.getByTestId('confetti-burst')).toHaveCount(0)
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 })
  })

  test('reduced-motion users get a static star-pop span (no animation duration)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/dashboard')

    await page.waitForSelector('[data-testid="filter-all"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.getByTestId('filter-all').click()
    await page.waitForSelector('[data-testid="toggle-saved"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // Pin the row to the SAVED state so the animation span mounts.
    const star = page.getByTestId('toggle-saved').first()
    if ((await star.getAttribute('data-saved')) !== 'true') {
      await star.click()
      await expect(star).toHaveAttribute('data-saved', 'true', { timeout: 5_000 })
    }

    // The span STILL mounts (element-type remount drives the visual
    // state) but carries motion-reduce:animate-none, and the global
    // CSS guard (globals.css) collapses its animation duration to
    // 0.01ms — assert both so a future refactor that re-enables the
    // motion for reduced-motion users is caught.
    const span = star.locator('span.animate-star-pop')
    await expect(span).toBeVisible({ timeout: 10_000 })
    await expect(span).toHaveClass(/motion-reduce:animate-none/)
    const duration = await span.evaluate(
      (el) => getComputedStyle(el).animationDuration,
    )
    // 0.01ms (global guard) or 0s (animate-none) — anything >= 1ms
    // means the 360° spin would actually play for a reduced-motion
    // user.
    expect(parseFloat(duration)).toBeLessThan(1)
  })
})

test.describe('Round-94: skeleton loading states', () => {
  test('dashboard shows the layout skeleton while /api/profile is in flight', async ({ page }) => {
    // Delay the profile fetch so the skeleton is deterministically
    // observable (the dashboard renders it while `loading` is true).
    await page.route('**/api/profile', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })

    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-loading-skeleton')).toBeVisible({ timeout: 10_000 })

    // Once the delayed profile resolves, real content replaces it.
    await expect(page.getByTestId('hero-stats')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('dashboard-loading-skeleton')).toHaveCount(0)
  })

  test('settings shows the layout skeleton while /api/profile is in flight', async ({ page }) => {
    await page.route('**/api/profile', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })

    await page.goto('/settings')
    await expect(page.getByTestId('settings-loading-skeleton')).toBeVisible({ timeout: 10_000 })

    // Real settings content lands after the delay.
    await expect(page.getByTestId('settings-root')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('settings-loading-skeleton')).toHaveCount(0)
  })
})
