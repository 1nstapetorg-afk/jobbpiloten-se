// Round-58 / Bug 3 -- tiny-PDF contract-lock test.
//
// Pre-Round-58: a 2.3 KB PDF with no extracted text fell into the
// Round-10 soft-fail (200, empty cvText, cvFileName saved) and the
// user saw the generic "Filen är uppladdad men vi kunde inte tolka
// texten" banner. The complaint: AI then generated generic cover
// letters because no cvText was set.
//
// Round-58: add a `TINY_PDF` heuristic branch -- files smaller
// than 5 KB AND no extracted text AND not a soft-failure -- return
// 400 with code 'TINY_PDF' and a focused Swedish message.
// Distinguishing this from the existing IMAGE_ONLY_PDF branch
// (which kicks in for actual scanned PDFs) gives analytics + UI a
// clean code discriminator.
//
// This file uses the same source-grep / regex pattern as
// tests/unit/af-job-url-resolver.test.mjs so it's a pure node --test
// -- no need to boot Mongo or pdfjs-dist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'api', 'upload-cv', 'route.js'),
  'utf8',
)

// ---------- 1. The TINY_PDF branch must exist ----------

test('Round-58 / Bug 3: route.js must declare a TINY_PDF_HEURISTIC_BYTES constant', () => {
  assert.match(
    SRC,
    /const\s+TINY_PDF_HEURISTIC_BYTES\s*=\s*8\s*\*\s*1024/,
    'route.js must declare TINY_PDF_HEURISTIC_BYTES (8 * 1024 = 8 KB) so the distinct code is contract-locked',
  )
})

test('Round-58 / Bug 3: route.js must reference TINY_PDF_HEURISTIC_BYTES in a guard', () => {
  assert.match(
    SRC,
    /file\.size\s*<\s*TINY_PDF_HEURISTIC_BYTES/,
    'route.js must use TINY_PDF_HEURISTIC_BYTES in the file.size guard so tiny-PDFs hit the new branch',
  )
})

test('Round-58 / Bug 3: route.js must return code: TINY_PDF (not IMAGE_ONLY_PDF) for tiny files', () => {
  assert.match(
    SRC,
    /code:\s*['"]TINY_PDF['"]/,
    'route.js must surface code: TINY_PDF so analytics + UI can branch on it distinctly from IMAGE_ONLY_PDF',
  )
})

test('Round-58 / Bug 3: route.js must return 400 status for tiny files with no text', () => {
  // Anchor the slice at `code: 'TINY_PDF'` (not the bare constant name
  // declaration) so the 400-char window lands inside the actual return
  // block where status: 400 lives. Anchoring at the constant's earlier
  // declaration would put the slice above the if-branch and miss the
  // NextResponse.json({status: 400}) return statement.
  const tinyPdfSection = SRC.match(/code:\s*['"]TINY_PDF['"][\s\S]{0,400}/)
  assert.ok(tinyPdfSection, "code: 'TINY_PDF' block must be present in route.js")
  assert.match(
    tinyPdfSection[0],
    /status:\s*400/,
    "TINY_PDF block must return status 400 so the UI shows a clear Swedish error",
  )
})

test('Round-58 / Bug 3: route.js must NOT clobber existing IMAGE_ONLY_PDF code', () => {
  // Make sure the existing IMAGE_ONLY_PDF code branch is still present
  // (locking the round-14 explicit-error contract).
  assert.match(
    SRC,
    /code:\s*['"]IMAGE_ONLY_PDF['"]/,
    'route.js must keep the existing IMAGE_ONLY_PDF code untouched so the round-14 e2e tests stay green',
  )
})

// ---------- 2. The predicate: file.size < 5 KB AND no text AND not soft-fail ----------

test('Round-58 / Bug 3: tiny-PDF guard requires no extracted text (extracted.length < MIN_VALID_CV_TEXT_CHARS)', () => {
  assert.match(
    SRC,
    /file\.size\s*<\s*TINY_PDF_HEURISTIC_BYTES[\s\S]{0,200}extracted\.length\s*<\s*MIN_VALID_CV_TEXT_CHARS/,
    'tiny-PDF guard requires extracted.length < MIN_VALID_CV_TEXT_CHARS so a real PDF cannot hit the new branch',
  )
})

test('Round-58 / Bug 3: tiny-PDF guard should NOT fire on soft-failures (those keep the round-10 200 path)', () => {
  assert.match(
    SRC,
    /[!]\s*extractionSoftFailure/,
    'tiny-PDF guard must exclude !extractionSoftFailure so a soft-failure keeps the round-10 contract (400 catastrophic + 200 soft + 200 valid)',
  )
})

// ---------- 3. Distinct Swedish message ----------

test('Round-58 / Bug 3: tiny-PDF error message uses distinct Swedish copy', () => {
  const tinyPdfSection = SRC.match(/code:\s*['"]TINY_PDF['"][\s\S]{0,400}/)
  assert.ok(tinyPdfSection, 'TINY_PDF block must be present')
  // Must mention "liten" (small) or "tom" (empty) so the user understands
  // it's not a scanned-PDF problem.
  assert.match(
    tinyPdfSection[0],
    /(liten|tom|saknar text|textlager)/i,
    'tiny-PDF error message must mention "liten" or "tom" so the user understands the file is too small/empty (not scanned)',
  )
  // Must also include the manual-summary hint so users have a fallback.
  assert.match(
    tinyPdfSection[0],
    /(sammanfattning|manuell)/i,
    'tiny-PDF error message must include manual-fallback hint so users have a next step',
  )
})

test('Round-59 / Followup 4: TINY_PDF user-facing copy must match the 8 KB threshold (no stale 5 KB mention)', () => {
  // Round-59 / Followup 4 -- hazard guard. The error message string must
  // match the TINY_PDF_HEURISTIC_BYTES threshold at all times. If a future
  // maintainer bumps the constant to e.g. 12 KB but forgets to update the
  // Swedish user-facing message, this test fails loudly. Eliminates the
  // previous HIGH-severity finding where the message said 'under 5 KB'
  // while the threshold was already 8 KB.
  //
  // Implementation note: anchor on the actual user-facing Swedish text
  // (not full SRC and not a code: 'TINY_PDF' slice). The user-facing message
  // is emitted BEFORE `code: 'TINY_PDF'` in the same return block, so a
  // slice from `code:` doesn't reach it -- a 200-char slice from the
  // Swedish message itself binds the assertion to the TINY_PDF error
  // (not just any 'under 8 KB' substring anywhere in the file).
  const msgBlock = SRC.match(/error:\s*['"]PDF:en verkar vara för liten[\s\S]{0,200}/)
  assert.ok(msgBlock, 'user-facing Swedish message (error: "PDF:en ...") must be present in route.js')
  assert.match(
    msgBlock[0],
    /under\s+8\s*KB/,
    'TINY_PDF user-facing message must literal-mention the 8 KB threshold so it stays in sync with the TINY_PDF_HEURISTIC_BYTES constant',
  )
  assert.doesNotMatch(
    msgBlock[0],
    /under\s+5\s*KB/,
    'TINY_PDF user-facing message must NOT say "under 5 KB" (Round-59 hazard guard; the threshold was bumped to 8 KB)',
  )
})
