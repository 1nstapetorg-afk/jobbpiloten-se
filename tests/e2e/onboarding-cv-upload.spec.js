import { test, expect } from './_fixtures/auth'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * E2E spec for the CV upload flow inside the onboarding Granska step.
 *
 * The onboarding wizard renders the SAME `<CVFileUpload>` component as
 * the /settings page — but it lives in the wizard body, not in a
 * dedicated /settings route, so we have a separate spec that
 * navigates the stepper before asserting the upload contract.
 *
 * Onboarding step indexing:
 *   step 0 → Karriärinfo  → "Nästa" → step 1
 *   step 1 → Personuppgifter → "Nästa" → step 2
 *   step 2 → Preferenser   → "Nästa" → step 3
 *   step 3 → Granska       → "Slutför"  (this is where the dropzone lives)
 */

async function makeTextPdf(label) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(label, { x: 30, y: 130, size: 16, font })
  page.drawText('Stockholm, Sverige', { x: 30, y: 95, size: 12, font })
  return await doc.save()
}

async function clearCv(page) {
  const res = await page.request.post('/api/profile-update', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      cvText: '',
      cvFileName: '',
      cvFileSize: 0,
      cvUploadedAt: null,
    },
  })
  expect([200, 404]).toContain(res.status())
}

test.describe.serial('Onboarding: CV upload', () => {
  test.beforeEach(async ({ page }) => {
    await clearCv(page)
  })

  test('dragging a PDF on the Granska step uploads via /api/upload-cv', async ({ page }) => {
    await page.goto('/onboarding')

    // Wait until the wizard's forward button is rendered.
    await page.waitForSelector('button:has-text("Nästa")', {
      state: 'visible',
      timeout: 20_000,
    })

    // Click through to step 3 (Granska). The wizard advances on click;
    // we don't fill any of the early-step fields — `Nästa` is just a
    // stepper advance in this implementation, not a submit.
    for (let i = 0; i < 3; i++) {
      await page.locator('button:has-text("Nästa")').click()
      // Brief settle so DOM reconciliation finishes before the next click.
      await page.waitForTimeout(150)
    }

    // On the Granska step, the shared CVFileUpload dropzone renders.
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', {
      state: 'visible',
      timeout: 20_000,
    })

    const pdfBytes = await makeTextPdf('CV fixture onboarding Volvobilar')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-onboarding.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdfBytes),
    })

    // File card replaces the dropzone after a successful round-trip.
    // This confirms: (a) the dropzone accepts the input event,
    // (b) the upload endpoint writes cvText back, (c) the file card
    // component reacts to the new profile state once it refetches.
    // We deliberately DON'T click "Slutför" — that would trigger a
    // dashboard redirect chain that belongs in a separate spec.
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', {
      state: 'visible',
      timeout: 20_000,
    })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-onboarding.pdf')
  })
})
