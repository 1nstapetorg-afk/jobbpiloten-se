import { test, expect } from './_fixtures/auth'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { Document, Packer, Paragraph } from 'docx'

/**
 * E2E spec for the CV upload magic-bytes validation
 * (Issue 5, 2026-07-10).
 *
 * The route enforces the file's actual byte signature, not just
 * its MIME type or extension, so a hand-crafted .doc renamed to
 * .docx is rejected with a SPECIFIC Swedish error message instead
 * of surfacing as a generic "corrupt file" parser exception.
 *
 * Coverage matrix:
 *   • Valid text PDF — happy path, 200 OK + cvText populated
 *   • Valid DOCX — happy path via mammoth, 200 OK + cvText populated
 *   • Wrong magic bytes (.doc-style file with .pdf extension) —
 *     400 with the "är inte en giltig PDF" message
 *   • Image-only PDF (empty page) — 200 OK with empty cvText +
 *     `needsManualFallback: true` so the UI can show the empty-hint
 *
 * The existing settings-cv-upload.spec.js covers most of these;
 * this spec focuses on the DOCX path and the SPECIFIC magic-byte
 * rejection message to lock the contract introduced on 2026-07-10.
 */

async function makeTextPdf(label) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(label, { x: 30, y: 130, size: 16, font })
  return await doc.save()
}

async function makeDocx() {
  // Minimal valid DOCX: one paragraph with "Hej från DOCX".
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Hej från DOCX — test-CV skapad av cv-magic-bytes.spec.js' }),
          new Paragraph({ text: 'Anna Andersson, Stockholm' }),
        ],
      },
    ],
  })
  return await Packer.toBuffer(doc)
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

test.describe.serial('Settings: CV magic-bytes validation', () => {
  test.beforeEach(async ({ page }) => {
    await clearCv(page)
  })

  test('valid PDF: 200 OK, file card renders, success line shows tecken hittades', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    const bytes = await makeTextPdf('CV magic-bytes PDF test')
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-magic.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    })
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-magic.pdf')
    await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')
  })

  test('valid DOCX: 200 OK, file card renders, success line shows tecken hittades', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    const bytes = await makeDocx()
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'cv-magic.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(bytes),
    })
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toContainText('cv-magic.docx')
    // DOCX is parsed via mammoth, so the success line should still
    // appear with the extracted-text character count.
    await expect(page.locator('[data-testid="settings-cv-success"]')).toContainText('tecken hittades')
  })

  test('invalid magic bytes (text file with .pdf extension): 400 with SPECIFIC Swedish error', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    // The first 5 bytes are "Hello" (0x48 0x65 0x6C 0x6C 0x6F) — NOT
    // the PDF signature (0x25 0x50 0x44 0x46 0x2D = "%PDF-"). The
    // server's magic-byte guard rejects this with a SPECIFIC message
    // instead of letting the parser throw a generic "corrupt file".
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'inte-en-pdf.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('Hello, this is not a PDF — the magic bytes are wrong on purpose.'),
    })
    // The error alert renders inline (not as a Sonner toast) so
    // the user sees WHY the file was rejected. The exact wording
    // is part of the contract; we match on the stable phrase
    // "inte en giltig PDF".
    await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('inte en giltig PDF')
    // The dropzone is still visible — no file card should have
    // appeared.
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  })

  test('.doc file renamed to .docx: 400 with the SPECIFIC 2026-07-10 Swedish message', async ({ page }) => {
    // Issue 5 (2026-07-10) added a SPECIALISED error message for
    // the most common upload pitfall: a classic .doc (OLE2
    // compound document) renamed to .docx by the user. The
    // server's validateMagicBytes() detects this case and
    // returns a Swedish sentence naming the exact fix
    // ("Konvertera till .docx eller PDF i Word/Google Docs").
    //
    // The OLE2 compound document signature is
    //   0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1
    // — emitted by every Word 97-2003 .doc file. We prepend
    // this to a benign payload so the server's check sees the
    // real-world byte pattern instead of "Hello" (which would
    // also fail, but with the GENERIC "inte en giltig DOCX"
    // message — the wrong contract).
    const ole2Signature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    const body = Buffer.from('This is a classic Word .doc saved as .docx by mistake.')
    const fakeDocx = Buffer.concat([ole2Signature, body])
    // NOTE: the MIME is intentionally the OOXML type because
    // the route's MIME check (`ALLOWED_MIME.has(mime)`) is
    // INDEPENDENT of the magic-bytes check. The bug we're
    // testing lives in the file's CONTENT, not its declared
    // type — a hand-crafted curl POST can lie about either,
    // and the route defends against both attacks separately.
    // A real-world user uploads with a matching MIME; the
    // attack surface is the file's first bytes, which the
    // OLE2 signature simulates.

    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'gamal-doc.docx', // lying extension to trigger the specific branch
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: fakeDocx,
    })

    // The 2026-07-10 specialised error message must be visible.
    // Match on the stable phrase "äldre .doc-fil" (the .doc
    // mention) and "Konvertera till .docx eller PDF" (the fix
    // instructions). Both are part of the locked contract;
    // changing either requires updating the route AND this test.
    await expect(page.locator('[data-testid="settings-cv-error"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('äldre .doc-fil')
    await expect(page.locator('[data-testid="settings-cv-error"]')).toContainText('Konvertera till .docx eller PDF')
    // The dropzone is still visible — no file card should have
    // appeared.
    await expect(page.locator('[data-testid="settings-cv-filecard"]')).toHaveCount(0)
  })

  test('image-only PDF: 200 OK with empty cvText + needsManualFallback, empty-hint banner renders', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-cv-dropzone"]', { timeout: 20_000 })
    // Empty page PDF — no drawText call means pdf-parse returns
    // an empty string, and the image-only detector (added 2026-07-10)
    // sees no text operators but no image operators either, so it
    // falls through to the "empty text" success path.
    const bytes = await (async () => {
      const d = await PDFDocument.create()
      d.addPage([300, 200])
      return await d.save()
    })()
    await page.setInputFiles('[data-testid="settings-cv-fileinput"]', {
      name: 'scanned-empty.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    })
    await page.waitForSelector('[data-testid="settings-cv-filecard"]', { timeout: 20_000 })
    // The empty-hint banner renders; no success line; no error alert.
    await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-cv-empty-hint"]')).toContainText('kunde inte tolka texten')
    await expect(page.locator('[data-testid="settings-cv-error"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="settings-cv-success"]')).toHaveCount(0)
  })
})
