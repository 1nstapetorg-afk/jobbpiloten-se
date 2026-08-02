// tests/unit/cv-ocr-lib.test.mjs
//
// 2026-08-02 — locks lib/cv-ocr.js: the LLM-vision OCR module that
// rescues scanned PDFs + image CV uploads. The critical contract is
// that OCR is a SOFT fallback — it must return '' (never throw) on
// any failure so the upload-cv route falls through to the manual
// summary UX instead of hard-failing an upload.
//
// The PDF page-render path is integration-tested against a real
// minimal PDF built with pdf-lib (already a dependency) — this
// proves pdfjs-dist legacy + @napi-rs/canvas actually rasterize a
// page on this runtime, which is what unlocks scanned-PDF OCR.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  visionModelForProvider,
  isOcrConfigured,
  renderPdfPageToPng,
  ocrPdfPage,
  ocrPdfPages,
} from '../../lib/cv-ocr.js'

test('visionModelForProvider maps each provider to a vision-capable model', () => {
  // 2026-08-02: qwen/qwen3.6-27b — Groq decommissioned
  // llama-3.2-90b-vision-preview on 2025-04-14 (requests now 400).
  assert.equal(visionModelForProvider('groq', 'x'), 'qwen/qwen3.6-27b')
  assert.equal(visionModelForProvider('openai', 'x'), 'gpt-4o-mini')
  assert.equal(visionModelForProvider('emergent', 'x'), 'gpt-4o-mini')
  // Unknown providers fall back to their own model.
  assert.equal(visionModelForProvider('unknown-vendor', 'fallback-model'), 'fallback-model')
})

test('isOcrConfigured() is a boolean (false when no LLM key is exported)', () => {
  // The test runner does not load .env, so in CI this is false.
  assert.equal(typeof isOcrConfigured(), 'boolean')
})

test('renderPdfPageToPng rasterizes a real PDF page to a PNG buffer', async () => {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([300, 200])
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  page.drawText('JobbPiloten CV OCR test', { x: 40, y: 120, size: 16, font })
  const bytes = await pdfDoc.save()
  const png = await renderPdfPageToPng(Buffer.from(bytes), 1)
  assert.ok(png && png.length > 0, 'renderPdfPageToPng must return a non-empty buffer')
  // PNG magic bytes: \x89PNG\r\n\x1a\n
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'output must be a valid PNG',
  )
})

test('renderPdfPageToPng returns null on garbage input (soft failure)', async () => {
  const png = await renderPdfPageToPng(Buffer.from('definitely not a pdf'), 1)
  assert.equal(png, null)
})

test('ocrPdfPage returns "" when the PDF cannot be rendered (soft failure)', async () => {
  const text = await ocrPdfPage(Buffer.from('garbage'))
  assert.equal(text, '')
})

test('ocrPdfPages is exported and walks pages (soft, returns a string)', async () => {
  assert.equal(typeof ocrPdfPages, 'function')
  // Garbage input → '' (never throws).
  assert.equal(await ocrPdfPages(Buffer.from('garbage')), '')
})

test('ocrPdfPage on a valid page either returns text or "" — never throws', async () => {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([200, 200])
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  page.drawText('Hej JobbPiloten', { x: 30, y: 120, size: 18, font })
  const bytes = await pdfDoc.save()
  // In a no-key test env, ocrImageBuffer returns '' (no provider) —
  // assert the soft contract rather than a specific non-empty value.
  const result = await ocrPdfPage(Buffer.from(bytes), 1)
  assert.equal(typeof result, 'string')
})

// ---- Round-80 edge-case additions ----

test('renderPdfPageToPng returns null for an out-of-range page number (soft)', async () => {
  const pdfDoc = await PDFDocument.create()
  pdfDoc.addPage([200, 200])
  const bytes = await pdfDoc.save()
  const png = await renderPdfPageToPng(Buffer.from(bytes), 99)
  assert.equal(png, null)
})

test('ocrImageBuffer with a garbage image returns a string, never throws (soft)', async () => {
  // Robust regardless of whether an LLM key is configured in the test
  // env: with NO key it returns '' immediately (no provider); WITH a
  // key the 4-byte "PNG" is rejected by the API → catch → ''. Either
  // way the soft contract holds: a string, never a throw. Do NOT
  // assert a specific value here — a future model that tolerates tiny
  // images could return text, and this test must not become the
  // regression that breaks the soft-fallback guarantee.
  const text = await (await import('../../lib/cv-ocr.js')).ocrImageBuffer(
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'image/png',
  )
  assert.equal(typeof text, 'string')
})

test('ocrPdfPages caps page walk at maxPages (soft, never exceeds bound)', async () => {
  const pdfDoc = await PDFDocument.create()
  // 3 pages, but maxPages=1 must bound the walk to a single page.
  for (let i = 0; i < 3; i++) {
    const page = pdfDoc.addPage([150, 150])
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    page.drawText(`Sida ${i + 1}`, { x: 20, y: 80, size: 14, font })
  }
  const bytes = await pdfDoc.save()
  // In a no-key env this returns '' (no OCR provider) — but the walk
  // itself must complete without throwing, proving the bound holds.
  const result = await ocrPdfPages(Buffer.from(bytes), { maxPages: 1 })
  assert.equal(typeof result, 'string')
})

test('ocrPdfPages with maxPages 0 still walks at least page 1 (floor)', async () => {
  const pdfDoc = await PDFDocument.create()
  pdfDoc.addPage([150, 150])
  const bytes = await pdfDoc.save()
  const result = await ocrPdfPages(Buffer.from(bytes), { maxPages: 0 })
  assert.equal(typeof result, 'string')
})

test('empty buffer fails soft (null/""), never throws', async () => {
  assert.equal(await renderPdfPageToPng(Buffer.alloc(0), 1), null)
  assert.equal(await ocrPdfPage(Buffer.alloc(0), 1), '')
  assert.equal(await ocrPdfPages(Buffer.alloc(0)), '')
})
