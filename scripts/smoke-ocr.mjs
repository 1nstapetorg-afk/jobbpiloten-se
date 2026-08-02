// scripts/smoke-ocr.mjs
//
// Round-80 followup — LIVE smoke test for LLM-vision CV OCR.
//
// Renders a PNG with realistic Swedish CV text via @napi-rs/canvas
// (already a dependency — same lib lib/cv-ocr.js uses to rasterize
// PDF pages), then pushes it through ocrImageBuffer() with the REAL
// configured LLM provider (GROQ → OPENAI → EMERGENT → OPENROUTER).
//
// Why this exists: the unit tests only prove the SOFT contract (never
// throws, returns a string). They cannot prove the configured vision
// model actually READS text — that requires a live key. This script is
// the operator-facing check, and it's how we caught the 2026-08-02
// Groq model decommission (llama-3.2-90b-vision-preview 400'd) the
// unit tests were blind to. Run it after any VISION_MODELS change in
// lib/cv-ocr.js:
//
//   node scripts/smoke-ocr.mjs            # requires a real LLM key in env
//
// Exit codes:
//   0 — OCR extracted text (prints it + length)
//   1 — no LLM key configured
//   2 — OCR returned empty / failed (model not vision-capable etc.)
//
// Not part of `yarn test:unit` (network + cost). CI-gated smoke only.

import { createCanvas } from '@napi-rs/canvas'
import { ocrImageBuffer, isOcrConfigured } from '../lib/cv-ocr.js'

const EXPECTED_MARKERS = ['React', 'Frontendutvecklare', 'Stockholm']

function makeCvPng() {
  const canvas = createCanvas(900, 520)
  const ctx = canvas.getContext('2d')
  // White background + simple dark text (high contrast = reliable OCR).
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 900, 520)
  ctx.fillStyle = '#111827'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('Anna Andersson', 40, 60)
  ctx.font = '20px sans-serif'
  ctx.fillText('Frontendutvecklare', 40, 110)
  ctx.fillText('Stockholm, Sverige', 40, 145)
  ctx.fillText('Erfarenhet: React, TypeScript och Next.js', 40, 200)
  ctx.fillText('Tidigare roller: Klarna (senior frontend), Spotify', 40, 240)
  ctx.fillText('Utbildning: Civilingenjör Datateknik, KTH', 40, 295)
  ctx.fillText('Språk: Svenska (modersmål), Engelska (flytande)', 40, 335)
  return canvas.toBuffer('image/png')
}

async function main() {
  if (!isOcrConfigured()) {
    console.error('SMOKE-OCR: no LLM provider key configured — cannot run live OCR check.')
    process.exit(1)
  }
  const png = makeCvPng()
  const text = await ocrImageBuffer(png, 'image/png')
  const trimmed = String(text || '').trim()
  console.log(`SMOKE-OCR: extracted ${trimmed.length} chars`)
  if (trimmed) console.log('---- extracted text ----\n' + trimmed + '\n------------------------')
  if (trimmed.length < 20) {
    console.error('SMOKE-OCR: FAIL — OCR returned too little text. The configured vision model may not read images.')
    process.exit(2)
  }
  const missing = EXPECTED_MARKERS.filter((m) => !trimmed.includes(m))
  if (missing.length > 0) {
    console.error(`SMOKE-OCR: WARN — expected markers missing from OCR output: ${missing.join(', ')}`)
    console.error('  (not fatal; the model may paraphrase — inspect the output above)')
  } else {
    console.log(`SMOKE-OCR: PASS — all expected markers found (${EXPECTED_MARKERS.join(', ')})`)
  }
}

main().catch((err) => {
  console.error('SMOKE-OCR: unexpected failure:', err?.message || err)
  process.exit(2)
})
