// tests/unit/onboarding-preview-save-first.test.mjs
//
// 2026-08-02 — locks the "Profil hittades inte — slutför /onboarding
// först." fix on the onboarding "Förhandsvisa AI-mejl" panel, plus
// the two CV-persistence fixes that shipped in the same batch:
//   • /api/upload-cv now upserts (an onboarding user who uploads a
//     CV on the Granska step before the profile doc exists no longer
//     loses the extracted text)
//   • POST /api/profile no longer clobbers an existing cvSummary
//     with '' on an onboarding re-submit
//
// Structural-lock style (source-grep), matching the repo's test
// culture.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ONBOARDING = readFileSync('app/onboarding/page.js', 'utf8')
const API_ROUTE = readFileSync('app/api/[[...path]]/route.js', 'utf8')
const UPLOAD_CV = readFileSync('app/api/upload-cv/route.js', 'utf8')

// ---- handlePreviewEmail saves the profile BEFORE previewing ----

test('handlePreviewEmail POSTs /api/profile before /api/email-preview', () => {
  // The preview endpoint looks the user's profile up by clerkId and
  // 404s ("Profil hittades inte") when it can't find a profile with
  // a name + email. On the Granska step the profile is only
  // persisted by "Slutför", so a preview before saving always hit
  // the 404. Fix: persist the form first, then preview. Lock the
  // ORDER (profile fetch must appear before the email-preview fetch
  // inside the preview handler).
  const previewStart = ONBOARDING.indexOf('handlePreviewEmail')
  const profileFetch = ONBOARDING.indexOf("fetch('/api/profile'", previewStart)
  const previewFetch = ONBOARDING.indexOf("fetch('/api/email-preview'", previewStart)
  assert.ok(profileFetch !== -1, 'preview handler must fetch /api/profile first')
  assert.ok(previewFetch !== -1, 'preview handler must fetch /api/email-preview')
  assert.ok(
    profileFetch < previewFetch,
    '/api/profile save must happen BEFORE /api/email-preview',
  )
})

test('the preview handler explains the save-first rationale in a comment', () => {
  // Guards against a future "simplification" that deletes the save
  // step because it looks redundant.
  assert.match(
    ONBOARDING,
    /persist the current form first|profiler\s+finns\s+bara|slutför\s+\/onboarding/i,
    'save-first rationale comment must survive',
  )
})

test('preview handler re-submits the same profile payload as handleSubmit (idempotent)', () => {
  // Both the preview and the final submit must build the body via
  // buildApiBody so the doc is consistent whichever button is hit.
  const previewBlock = ONBOARDING.slice(ONBOARDING.indexOf('handlePreviewEmail'), ONBOARDING.indexOf('renderStep'))
  assert.match(previewBlock, /buildApiBody\(formData,\s*user\)/, 'preview must reuse buildApiBody')
})

// ---- /api/upload-cv upserts (onboarding CV before profile exists) ----

test('upload-cv updateOne passes upsert: true', () => {
  // Without upsert, an onboarding user who uploads a CV on the
  // Granska step (before the profile doc exists) matched ZERO rows
  // and the extracted text silently vanished.
  // The $set body + the rationale comment sit between the filter and
  // the options object, so the window is generous (comments must not
  // be treated as code).
  assert.match(
    UPLOAD_CV,
    /db\.collection\('profiles'\)\.updateOne\(\s*\{\s*clerkId\s*\}[\s\S]{0,3000}?\{\s*upsert:\s*true\s*\}/,
    'upload-cv profile updateOne must upsert',
  )
})

// ---- POST /api/profile no longer clobbers cvSummary ----

test('profile POST writes cvSummary conditionally (never force-clobbers with "")', () => {
  // Previously `cvSummary: source.cvSummary || ''` was written
  // unconditionally, so an onboarding re-submit that omits the field
  // wiped a summary saved via /settings or the CV review panel.
  assert.doesNotMatch(
    API_ROUTE,
    /cvSummary:\s*source\.cvSummary\s*\|\|\s*''/,
    'profile POST must not unconditionally write cvSummary',
  )
  // (The conditional merge below is the positive lock.)
  assert.match(
    API_ROUTE,
    /if\s*\(Object\.prototype\.hasOwnProperty\.call\(source,\s*'cvSummary'\)\)\s*\{\s*doc\.cvSummary\s*=\s*source\.cvSummary;\s*\}/,
    'cvSummary must be merged conditionally from source',
  )
})

// ---- upload-cv accepts images + OCR wiring ----

test('upload-cv accepts image uploads (png/jpg/webp)', () => {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    assert.ok(
      UPLOAD_CV.includes(`'${ext}'`),
      `ALLOWED_EXT must include ${ext}`,
    )
  }
  assert.match(UPLOAD_CV, /ocrImageBuffer\(buffer, mime/, 'image branch must route through ocrImageBuffer')
  assert.match(UPLOAD_CV, /ocrPdfPages\(buffer\)/, 'scanned-PDF branch must route through ocrPdfPages (multi-page OCR)')
  assert.match(UPLOAD_CV, /Endast PDF-, DOCX- och bildfiler \(PNG\/JPG\/WebP\) accepteras/, '400 copy must mention images (aligned with the client copy)')
})
