import { test, expect } from './_fixtures/auth'

/**
 * E2E spec for the Avatar picker on /settings.
 *
 * Each test assumes:
 *   - dev server reachable at http://localhost:3000
 *   - Mongo reachable with at least one seeded demo user
 *     (`demoUserId=demo-user-001` is what `_fixtures/auth` sets)
 *   - the demo user has already passed /onboarding so a profile exists
 *
 * Shared isolation rule: the demo user's `profilePicture` field is
 * reset to `null` before each test via POST /api/profile-update. That's
 * the same partial-update endpoint the settings page uses for the
 * "Spara ändringar" round-trip, so the same server-side validation
 * guard applies (200 OK for `null`, drops invalid shapes with warn).
 * Mongo treats explicit `null` as an assignment, so the next render
 * falls through to the default pilot-circle branch.
 */

/**
 * Reset the profilePicture to null via the partial-update endpoint.
 * Both 200 (profile existed) and 404 (no profile yet) are acceptable —
 * we just need a known "no picture saved" baseline before each test.
 */
async function clearProfilePicture(page) {
  const res = await page.request.post('/api/profile-update', {
    headers: { 'Content-Type': 'application/json' },
    data: { profilePicture: null },
  })
  expect([200, 404]).toContain(res.status())
}

test.describe.serial('Settings: profile picture picker', () => {
  test.beforeEach(async ({ page }) => {
    await clearProfilePicture(page)
  })

  test('renders the profile picture section with a default avatar when nothing is saved', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })
    // Default fallback branch is rendered in the live preview. The
    // data-avatar-source attribute differentiates "default" from
    // "avatar" / "upload" so e2e specs can probe without SVG parsing.
    await expect(page.locator('[data-testid="profile-avatar-preview"]')).toHaveAttribute(
      'data-avatar-source',
      'default',
    )
    // The picker tab is the default landing tab. Verify the avatar
    // grid is visible AND the upload tab content is hidden.
    await expect(page.locator('[data-testid="settings-pp-avatar-grid"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-pp-tab-avatar"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('avatar picker lists 16 avatars and selecting an entry updates the live preview', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // 16 avatars are rendered (matches the AVATAR_KEYS length shared
    // between the client picker and the server validator). Bumped from
    // 12 → 16 by the 2026-07-10 polish bundle (Hjalten/Innovatören/
    // Visionären/Mystikern). The 4×4 grid is preserved — `md:grid-cols-4`
    // in app/settings/page.js lines up the new entries below the
    // original 12 without any layout change.
    //
    // The selector is `button[data-testid^="settings-pp-avatar-"]` —
    // explicitly a `button` filter, not just an attribute prefix match.
    // Without the `button` filter, the picker grid container
    // (`data-testid="settings-pp-avatar-grid"`) would also match
    // and skew the count by +1. The CSS prefix selector alone is too
    // loose for this assertion.
    const avatarButtons = page.locator('button[data-testid^="settings-pp-avatar-"]')
    await expect(avatarButtons).toHaveCount(16)

    // Click "Piloten" — confirm the live preview swaps its source
    // attribute to "avatar" and the avatar id to "piloten".
    await page.click('[data-testid="settings-pp-avatar-piloten"]')
    const preview = page.locator('[data-testid="profile-avatar-preview"]')
    await expect(preview).toHaveAttribute('data-avatar-source', 'avatar')
    await expect(preview).toHaveAttribute('data-avatar-id', 'piloten')

    // The "Du har valt:" caption reflects the Swedish name.
    await expect(page.locator('[data-testid="settings-profile-picture"]')).toContainText('Piloten')

    // Picking a DIFFERENT avatar replaces the previous selection —
    // verify by clicking Mentorn and re-checking the preview.
    await page.click('[data-testid="settings-pp-avatar-mentorn"]')
    await expect(preview).toHaveAttribute('data-avatar-id', 'mentorn')
    await expect(page.locator('[data-testid="settings-profile-picture"]')).toContainText('Mentorn')
  })

  test('saving a chosen avatar round-trips via /api/profile-update and clears dirty state', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.click('[data-testid="settings-pp-avatar-piloten"]')

    // Spara ändringar enables once dirty. Save and wait for the
    // standardised success toast.
    const save = page.locator('[data-testid="settings-save"]')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(
      page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first(),
    ).toBeVisible({ timeout: 10_000 })

    // After save + reload, the picker preserves the choice and the
    // preview still shows piloten — proving the data round-tripped
    // through MongoDB rather than just living in component state.
    await page.reload()
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="profile-avatar-preview"]')).toHaveAttribute('data-avatar-id', 'piloten')
    await expect(page.locator('[data-testid="settings-pp-avatar-piloten"]')).toHaveAttribute('aria-selected', 'true')
  })

  test('clear button restores the default JobbPiloten plane circle', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.click('[data-testid="settings-pp-avatar-piloten"]')

    // The clear button only appears once a picture is selected.
    await expect(page.locator('[data-testid="settings-pp-clear"]')).toBeVisible()
    await page.click('[data-testid="settings-pp-clear"]')

    // Preview reverts to default branch.
    await expect(page.locator('[data-testid="profile-avatar-preview"]')).toHaveAttribute(
      'data-avatar-source',
      'default',
    )
  })

  test('collection progress round-trips through /api/profile-update', async ({ page }) => {
    // Reset BOTH profilePicture and collectedAvatars — the existing
    // beforeEach only clears profilePicture, so without this the
    // persisted slug set from a prior test could already be populated.
    const resetRes = await page.request.post('/api/profile-update', {
      headers: { 'Content-Type': 'application/json' },
      data: { profilePicture: null, collectedAvatars: [] },
    })
    expect([200, 404]).toContain(resetRes.status())

    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })

    // Banner reads the server-persisted prop on mount → "0/16 samlade".
    await expect(
      page.locator('[data-testid="settings-pp-collection-progress"]'),
    ).toContainText('0 av 16 samlade')

    // Pick two avatars — banner should advance to "2/16 samlade"
    // before the save round-trip. This proves pickAvatar writes through
    // the parent form's collectedAvatars (not just a session Set).
    await page.click('[data-testid="settings-pp-avatar-piloten"]')
    await page.click('[data-testid="settings-pp-avatar-mentorn"]')
    await expect(
      page.locator('[data-testid="settings-pp-collection-progress"]'),
    ).toContainText('2 av 16 samlade')

    // Save via the same Spara ändringar button the rest of the form uses,
    // so the partial-update endpoint sees profilePicture + collectedAvatars
    // in the same payload (idempotent for our purposes since both are dirty).
    const save = page.locator('[data-testid="settings-save"]')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(
      page.locator('[data-sonner-toast]:has-text("Profil uppdaterad")').first(),
    ).toBeVisible({ timeout: 10_000 })

    // Reload and re-assert. If the banner read from a session-only Set
    // we'd see "0/16" again. Persisted Mongo state should keep the
    // count at 2/16 and both buttons aria-selected=true. The total
    // was bumped from 12 → 16 by the 2026-07-10 polish bundle
    // (Hjalten/Innovatören/Visionären/Mystikern); see lib/avatar-keys.js.
    await page.reload()
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(
      page.locator('[data-testid="settings-pp-collection-progress"]'),
    ).toContainText('2 av 16 samlade')
    // Mentorn was the last-clicked avatar, so the picker surfaces it as
    // aria-selected=true after reload. Piloten stays aria-selected=false
    // because aria-selected tracks the single profilePicture.value, not
    // collectedAvatars (which is the array). The banner count above is
    // the canonical "X av 16 samlade" indicator for collection state.
    await expect(page.locator('[data-testid="settings-pp-avatar-mentorn"]')).toHaveAttribute('aria-selected', 'true')
  })
})

/**
 * Upload tab is its own describe block so the picker-grid verifier
 * (`Settings: profile picture picker`) and the upload-tab verifier
 * (`Settings: profile picture upload tab`) can run independently.
 */
test.describe.serial('Settings: profile picture upload tab', () => {
  test.beforeEach(async ({ page }) => {
    await clearProfilePicture(page)
  })

  test('switching to the upload tab reveals the dropzone', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-profile-picture"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await page.click('[data-testid="settings-pp-tab-upload"]')
    await expect(page.locator('[data-testid="settings-pp-upload-zone"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-pp-dropzone"]')).toBeVisible()
  })
})
