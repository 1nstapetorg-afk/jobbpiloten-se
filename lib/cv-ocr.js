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

// Vision-capable models per provider name (see getProviderInfo in
// lib/groq.js). Each entry is an ordered FALLBACK CHAIN: the first
// model is the primary, later entries are retried when the primary
// 400s with a model-level error (decommissioned / deprecated /
// unknown). Unknown providers fall back to the provider's own text
// model, which usually supports vision anyway (gpt-4o-mini, claude-3.5).
//
// 2026-08-02: primary swapped from llama-3.2-90b-vision-preview (Groq
// decommissioned it 2025-04-14; requests 400). qwen/qwen3.6-27b is
// Groq's current featured multimodal model. The chain keeps a second
// Groq vision option so a future deprecation degrades to a WORKING
// model instead of breaking OCR until a manual code edit lands.
const VISION_MODELS = {
  groq: ['qwen/qwen3.6-27b', 'meta-llama/llama-4-maverick-17b-128e-instruct'],
  openai: ['gpt-4o-mini'],
  emergent: ['gpt-4o-mini'],
  openrouter: [process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'],
}

/**
 * Primary vision model for a provider. Kept for the public contract
 * (tests + callers that want the single best model): returns the FIRST
 * entry of the fallback chain, or `fallbackModel` for unknown providers.
 */
export function visionModelForProvider(name, fallbackModel) {
  const chain = VISION_MODELS[name]
  return Array.isArray(chain) && chain.length > 0 ? chain[0] : fallbackModel
}

/**
 * Full ordered vision-model chain for a provider (primary first).
 * Unknown providers yield a single-entry chain of the fallback model.
 * Used by ocrImageBuffer to retry a secondary model when the primary
 * is rejected at the model level.
 */
export function visionModelChainForProvider(name, fallbackModel) {
  const chain = VISION_MODELS[name]
  if (Array.isArray(chain) && chain.length > 0) return chain.slice()
  return [fallbackModel]
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
  const client = new OpenAI({ apiKey: info.apiKey, baseURL: info.baseURL })
  const models = visionModelChainForProvider(info.name, info.model)
  const systemPrompt =
    'Du är ett OCR-verktyg för CV-dokument. Extrahera ALL text ur bilden exakt som den står — namn, kontaktuppgifter, rubriker, arbetslivserfarenhet, utbildning, språk, certifieringar. Behåll radbrytningar och punktlistor. Hitta INTE på text som inte finns i bilden. Svara ENBART med den extraherade texten — ingen inledning, ingen kommentar, inga markdown-formateringar.'
  let lastErr = null
  for (const model of models) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: systemPrompt }, { type: 'image_url', image_url: { url: dataUrl } }],
          },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      })
      const text = response?.choices?.[0]?.message?.content
      // 2026-08-02 live-smoke fix: reasoning models (qwen3.6, others)
      // prefix the real transcription with a <think>…</think> trace.
      // Saving that trace into the user's cvText would pollute every
      // downstream prompt. Strip it, then the fence cleanup.
      const cleaned = String(text || '')
        // Strip CLOSED <think>…</think> traces (the live qwen3.6
        // behavior), then any LEFTOVER leading unterminated trace that
        // survived a max_tokens truncation (a truncated <think> has no
        // closing tag, so the first replace can't remove it). The
        // fallback strips from a leading <think> up to the first
        // double-newline boundary so genuine transcription after the
        // trace survives.
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^\s*<think>[\s\S]*?\n\n/i, '')
        .replace(/^```[a-z]*\n/i, '')
        .replace(/\n```\s*$/i, '')
        .trim()
      // Empty content after stripping is NOT a model-level failure — a
      // secondary model would likely also return nothing useful for an
      // unreadable image, so we return as-is ('' → caller falls back
      // to the manual-summary UX) instead of burning the fallback
      // chain. Deliberate asymmetry with the model-ERROR path below,
      // which DOES retry.
      return cleaned
    } catch (err) {
      lastErr = err
      const msg = String(err?.message || err || '')
      // Only retry the NEXT model on MODEL-LEVEL rejections (the
      // primary is decommissioned/deprecated/unknown). Transient
      // network/rate-limit errors should NOT burn the whole chain —
      // fail soft so the upload falls through to the manual UX.
      const isModelError =
        /decommissioned|deprecated|does not exist|not supported|model not found/i.test(msg)
      if (isModelError && models.length > 1) {
        console.warn(`[cv-ocr] vision model ${model} rejected (${msg}) — trying next in chain`)
        continue
      }
      console.warn('[cv-ocr] vision OCR failed:', msg || err)
      return ''
    }
  }
  // All models in the chain rejected at the model level — fail soft.
  if (lastErr) console.warn('[cv-ocr] all vision models rejected:', String(lastErr?.message || lastErr))
  return ''
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
