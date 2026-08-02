// lib/cv-ocr.js
//
// 2026-08-02 — OCR for CV uploads. Implements the missing link in the
// CV-extraction chain: previously an image-only PDF or a direct image
// upload always landed on the manual-summary fallback ("CV uppladdad —
// men texten kunde inte tolkas"), because the route only knew pdfjs-dist
// (PDF text layers) and mammoth (DOCX). This module adds:
//
//   1. `ocrImageBuffer(buffer, mime)`   — LLM-vision OCR on an image
//      (PNG/JPG/WebP). Reuses the SAME provider priority + credentials
//      as every other LLM call via `getProviderInfo()` from lib/groq.js
//      (GROQ → OPENAI → EMERGENT → OPENROUTER), mapping the provider's
//      text model to a vision-capable model:
//        • groq       → qwen/qwen3.6-27b (2026-08-02: the old
//          llama-3.2-90b-vision-preview was DECOMMISSIONED by Groq on
//          2025-04-14 — requests to it return 400 "model has been
//          decommissioned", breaking OCR until swapped)
//        • openai     → gpt-4o-mini (vision-capable)
//        • emergent   → gpt-4o-mini (OpenAI-compatible proxy)
//        • openrouter → claude-3.5-sonnet (or OPENROUTER_MODEL)
//
//   2. `renderPdfPageToPng(pdfBuffer, pageNumber)` — rasterizes a PDF
//      page to a PNG using pdfjs-dist's legacy (Node) build + the
//      `@napi-rs/canvas` package that ships in node_modules (transitive
//      dep of pdf-lib, verified working). This is what lets us OCR
//      SCANNED PDFs: pdfjs-dist finds no text layer → we render page 1
//      → run vision OCR → the extracted text feeds the same
//      cvText pipeline as a text-based PDF.
//
//   3. `ocrPdfPage(pdfBuffer, pageNumber)` — convenience wrapper for
//      the upload-cv route's image-only branch.
//
// Design decisions:
//   • tesseract.js was explicitly rejected (see app/api/cv-ocr/route.js
//     stub): ~15-25 MB bundle + >5 s cold start + poor Swedish accuracy.
//     Vision-LLM OCR uses the key the app ALREADY has, reads Swedish
//     well, and costs the same per-call tier as cover-letter generation.
//   • OCR is a "soft" extraction — if it fails (no key, network, model
//     reject), the caller falls through to the existing manual-summary
//     UX. It NEVER hard-fails an upload.
//   • This module is pure-I/O (no Mongo, no Next.js) so it's unit-testable
//     with node --test.

import { OpenAI } from 'openai'
import { getProviderInfo } from './groq.js'

// Vision-capable model per provider name (see getProviderInfo in
// lib/groq.js). Unknown providers fall back to the provider's own text
// model, which usually supports vision anyway (gpt-4o-mini, claude-3.5).
const VISION_MODELS = {
  // 2026-08-02: swapped from llama-3.2-90b-vision-preview (Groq
  // decommissioned it 2025-04-14; requests 400). qwen/qwen3.6-27b is
  // Groq's current featured multimodal model (vision + JSON + OCR).
  groq: 'qwen/qwen3.6-27b',
  openai: 'gpt-4o-mini',
  emergent: 'gpt-4o-mini',
  openrouter: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
}

export function visionModelForProvider(name, fallbackModel) {
  return VISION_MODELS[name] || fallbackModel
}

/**
 * Is OCR available? True iff any LLM provider key is configured
 * (the same key set that powers cover-letter generation).
 */
export function isOcrConfigured() {
  return !!getProviderInfo()
}

/**
 * OCR an image buffer (PNG/JPG/WebP) via the configured LLM provider's
 * vision model. Returns the extracted text (trimmed), or '' on any
 * failure — callers treat '' as "no text" and fall back to the manual
 * summary UX. Never throws.
 *
 * The image is sent as a base64 data URL in an OpenAI-compatible
 * chat.completions call (works across Groq / OpenAI / Emergent /
 * OpenRouter since they all speak the OpenAI wire format).
 */
export async function ocrImageBuffer(buffer, mime = 'image/png') {
  const info = getProviderInfo()
  if (!info) return ''
  const dataUrl = `data:${mime || 'image/png'};base64,${Buffer.from(buffer).toString('base64')}`
  const model = visionModelForProvider(info.name, info.model)
  const client = new OpenAI({ apiKey: info.apiKey, baseURL: info.baseURL })
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Du är ett OCR-verktyg för CV-dokument. Extrahera ALL text ur bilden exakt som den står — namn, kontaktuppgifter, rubriker, arbetslivserfarenhet, utbildning, språk, certifieringar. Behåll radbrytningar och punktlistor. Hitta INTE på text som inte finns i bilden. Svara ENBART med den extraherade texten — ingen inledning, ingen kommentar, inga markdown-formateringar.',
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    })
    const text = response?.choices?.[0]?.message?.content
    return String(text || '')
      .replace(/^```[a-z]*\n/i, '')
      .replace(/\n```\s*$/i, '')
      .trim()
  } catch (err) {
    console.warn('[cv-ocr] vision OCR failed:', err?.message || err)
    return ''
  }
}

/**
 * Rasterize a PDF page to a PNG buffer using pdfjs-dist's legacy
 * (Node) build + @napi-rs/canvas. Needed to OCR scanned PDFs that
 * have no embedded text layer.
 *
 * pdfjs-dist v4 render API: `page.render({ canvas, viewport })` accepts
 * a Canvas-like object directly; older v3 used `canvasContext`. We try
 * the v4 `canvas` form first and fall back to `canvasContext` for
 * robustness across versions.
 *
 * Returns a PNG Buffer, or null on any failure (caller falls back to
 * the manual summary UX).
 */
export async function renderPdfPageToPng(pdfBuffer, pageNumber = 1) {
  let pdfjs
  let canvasMod
  try {
    ;[pdfjs, canvasMod] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
    ])
  } catch (err) {
    console.warn('[cv-ocr] pdfjs/@napi-rs/canvas import failed:', err?.message || err)
    return null
  }
  const { createCanvas } = canvasMod
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useSystemFonts: false,
  })
  let pdfDoc = null
  try {
    pdfDoc = await loadingTask.promise
    const page = await pdfDoc.getPage(pageNumber)
    // 2x scale: doubles OCR accuracy on typical 150 dpi scans while
    // keeping the payload well under the vision model's size limits.
    const viewport = page.getViewport({ scale: 2 })
    const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
    const ctx = canvas.getContext('2d')
    try {
      // v4-style render (canvas object directly).
      await page.render({ canvas, viewport }).promise
    } catch (renderErr) {
      // v3-style render (canvas 2d context).
      await page.render({ canvasContext: ctx, viewport }).promise
    }
    return canvas.toBuffer('image/png')
  } catch (err) {
    console.warn('[cv-ocr] PDF page render failed:', err?.message || err)
    return null
  } finally {
    if (pdfDoc && typeof pdfDoc.destroy === 'function') {
      try { await pdfDoc.destroy() } catch (_) { /* best-effort */ }
    }
  }
}

/**
 * OCR a single page of a scanned PDF: rasterize → vision OCR.
 * Returns '' when the PDF can't be rendered or the model yields nothing.
 */
export async function ocrPdfPage(pdfBuffer, pageNumber = 1) {
  const png = await renderPdfPageToPng(pdfBuffer, pageNumber)
  if (!png) return ''
  return ocrImageBuffer(png, 'image/png')
}

/**
 * OCR a scanned PDF across ALL pages (capped at `maxPages` to bound
 * cost — a pathological 40-page scan must not burn the LLM budget).
 * Concatenates the per-page text with blank lines. Returns '' when
 * nothing can be read on any page. This is the route-level entry
 * point: a multi-page scanned CV previously lost pages 2+ because
 * the image-only branch only OCR'd page 1.
 */
export async function ocrPdfPages(pdfBuffer, { maxPages = 5 } = {}) {
  let numPages = 1
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      isEvalSupported: false,
      useSystemFonts: false,
    })
    let pdfDoc = null
    try {
      pdfDoc = await task.promise
      numPages = pdfDoc.numPages || 1
    } finally {
      if (pdfDoc && typeof pdfDoc.destroy === 'function') {
        try { await pdfDoc.destroy() } catch (_) { /* best-effort */ }
      }
    }
  } catch (err) {
    console.warn('[cv-ocr] could not read page count for OCR:', err?.message || err)
  }
  const pages = Math.max(1, Math.min(maxPages, numPages))
  const parts = []
  for (let i = 1; i <= pages; i++) {
    const png = await renderPdfPageToPng(pdfBuffer, i)
    if (!png) continue
    const text = await ocrImageBuffer(png, 'image/png')
    const trimmed = String(text || '').trim()
    if (trimmed) parts.push(trimmed)
  }
  return parts.join('\n\n')
}
