// tests/unit/cv-ocr-stub.test.mjs
//
// Static-contract guards for /api/cv-ocr (the OCR stub endpoint).
// The implementation is deferred to v0.4.0 (tesseract.js + swe/eng
// traineddata would balloon the serverless bundle by ~15-25 MB),
// but the route MUST exist + auth-gate + return a structured 501
// so the settings UI can detect the deferred state via
// `code === 'OCR_NOT_CONFIGURED'` and surface a clean amber alert.
//
// Run via `yarn test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = path.resolve(__dirname, '../../app/api/cv-ocr/route.js')
const SOURCE = fs.readFileSync(ROUTE_PATH, 'utf-8')

// ---------- 1. Route file exists and exports POST + GET ----------

test('cv-ocr route file exists at the canonical Next.js App Router path', () => {
  // If a future refactor moves this to lib/ or app/(group)/api/, this
  // test catches it before the UI starts hard-fetching a missing endpoint.
  assert.ok(
    fs.existsSync(ROUTE_PATH),
    'expected app/api/cv-ocr/route.js to exist for the OCR stub',
  )
})

test('cv-ocr route exports the canonical handlers (POST + GET)', () => {
  // Next.js App Router requires named `POST` / `GET` exports. A
  // casualty of a copy-paste from another file would be a missing
  // export → silent 405 on every UI click.
  assert.ok(/export async function POST/.test(SOURCE),
    'cv-ocr/route.js must export `async function POST`')
  assert.ok(/export async function GET/.test(SOURCE),
    'cv-ocr/route.js must export `async function GET` (so a browser refresh shows the 501 contract instead of 405)')
})

test('cv-ocr route runtime is nodejs + dynamic', () => {
  // Future Edge runtime switch would break the PDF/OCR imports; lock
  // the runtime contract here so a refactor surfaces synchronously.
  assert.ok(/export const runtime = 'nodejs'/.test(SOURCE),
    'cv-ocr/route.js must run in nodejs runtime (not Edge)')
  assert.ok(/export const dynamic = 'force-dynamic'/.test(SOURCE),
    'cv-ocr/route.js must be force-dynamic (OCR + auth cookies are non-cacheable)')
})

// ---------- 2. Stub returns OCR_NOT_CONFIGURED 501 --------------------

test('cv-ocr handler returns 501 with code=OCR_NOT_CONFIGURED', () => {
  // The handleNotConfigured() helper is the canonical stub. Any future
  // refactor that drops the structured body breaks the UI's `code`
  // discriminator — lock the literal here.
  assert.ok(/status:\s*501/.test(SOURCE),
    'cv-ocr handler must return NextResponse.json with `status: 501`')
  assert.ok(/OCR_NOT_CONFIGURED/.test(SOURCE),
    'cv-ocr handler must return `{ code: "OCR_NOT_CONFIGURED" }`')
})

test('cv-ocr stub mirrors the IMAGE_ONLY_PDF Swedish UX message', () => {
  // The settings page's empty-hint banner shows the same fallback
  // copy when OCR is stubbed. The literal substring is the contract
  // — without it, the user sees an empty state instead of guidance.
  assert.ok(/Skriv en kort sammanfattning manuellt/.test(SOURCE),
    'cv-ocr stub must teach the user the manual-summary fallback UX')
})

test('cv-ocr stub exposes retryWithOcr: false so the UI knows not to auto-retry', () => {
  // The UI checks this flag to decide whether to render a "retry"
  // button or amber alert. Without the explicit false, the UI
  // defaults to truthy and would loop forever.
  assert.ok(/retryWithOcr:\s*false/.test(SOURCE),
    'cv-ocr stub must set `{ retryWithOcr: false }` so the UI disables auto-retry')
})

// ---------- 3. Auth gate is enforced BEFORE the 501 ---------------------

test('cv-ocr auth gate runs before the OCR_NOT_CONFIGURED response', () => {
  // A request without auth must 401, not 501. Order matters: a
  // casual POST without cookie should not leak the "we know
  // about this route" signal.
  const authPos = SOURCE.indexOf('requireAuth')
  const stubPos = SOURCE.search(/status:\s*501|status: 501/)
  assert.ok(authPos >= 0, 'cv-ocr handler must call requireAuth')
  assert.ok(stubPos >= 0, 'cv-ocr handler must have a stub return path')
  assert.ok(authPos < stubPos,
    'requireAuth must run before the 501 stub response so unauthenticated callers get 401, not 501')
})

// ---------- 4. Documentation references tesseract.js --------------------

test('cv-ocr handler comments reference tesseract.js as the future implementation', () => {
  // Operator note: when wiring OCR in v0.4.0, this is the file to
  // touch. Renaming/moving the deferred-impl note strips the
  // breadcrumbs for future maintainers.
  assert.ok(/tesseract\.js/.test(SOURCE),
    'cv-ocr/route.js documentation must mention tesseract.js as the planned implementation')
  assert.ok(/v0\.4\.0|swe.*traineddata|eng.*traineddata/.test(SOURCE),
    'cv-ocr/route.js must mention a target version (v0.4.0) or the traineddata bundles')
})
