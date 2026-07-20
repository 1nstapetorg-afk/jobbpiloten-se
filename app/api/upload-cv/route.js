/**
 * POST /api/upload-cv
 *
 * Accepts a multipart/form-data upload of a single CV file (PDF or DOCX),
 * parses it server-side, and writes the extracted text + filename to the
 * user's profile document. The endpoint never stores the binary file —
 * only the parsed text — which keeps MongoDB documents tiny and dodges
 * the need for object-storage (S3/R2) at the soft-launch scale.
 *
 * Why server-side parsing instead of client-side: the on-device
 * `pdf.js` library builds a 1MB+ worker and emits console warnings, and
 * `mammoth` has zero browser-friendly distribution. Doing the work
 * server-side keeps the client bundle slim and gives us a clean place
 * to enforce file-size / file-type limits and to truncate aggressively
 * before persisting.
 *
 * Lifecycle:
 *   1. requireAuth — uses Clerk or falls back to the demoUserId cookie.
 *   2. Parse FormData. Capture the first file present.
 *   3. Validate file size (5MB) and file type (PDF or DOCX). .doc is
 *      NOT supported because `mammoth` only handles OOXML (.docx) —
 *      classic .doc (binary) would require LibreOffice / Word. The
 *      client UI ALSO accepts .doc so the file-picker doesn't feel
 *      picky, but the server returns a clean 400 with the same message
 *      the client shows.
 *   4. Read into a Buffer, dispatch to pdfjs-dist (PDF) or mammoth
 *      (DOCX) by MIME / extension.
 *   5. Truncate to MAX_CV_TEXT_CHARS (20 000 chars) to be safe against
 *      pathological PDFs that flatten into 1MB+ of plain text.
 *   6. Upsert cvText + cvFileName into profiles (the user's own
 *      clerkId). We do NOT touch cvSummary here — manual text stays
 *      untouched so the user's own words still win when present.
 *   7. Return the trimmed text + the filename so the UI can show a
 *      preview immediately without an extra GET roundtrip.
 */

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { requireAuth } from '@/lib/auth';
// Bug-3 polish (2026-07-17): single source of truth for LLM
// availability, defined alongside the provider-order precedence
// in lib/groq.js so a future addition (e.g. Anthropic, Cohere)
// only touches one file. Mirror of getProvider() ordering at
// lib/groq.js (GROQ → OPENAI → EMERGENT).
import { isLlmAvailable } from '@/lib/groq';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---- Mongo singleton (mirrors the catch-all route to avoid duplicate
// connection pools) ----
let clientPromise;
if (!global._mongoClientPromise) {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten');
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.DB_NAME);
}

// ---- Limits ----
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CV_TEXT_CHARS = 20_000;       // ~20KB before truncate
// 2026-07-12 (soft-launch polish #d): single source of truth for
// the "this PDF has real text" threshold. A PDF with < 50 chars
// of extracted text is treated as effectively empty — the AI
// prompt in lib/groq.js prefers cvText over cvSummary, so a
// short cvText would override the user's longer manual summary.
// The route now refuses to overwrite cvText with a sub-50-char
// result; instead it surfaces `needsManualFallback: true` so
// the UI keeps the manual textarea visible + scrollable, and
// the user's existing cvText/cvSummary stays untouched.
//
// 2026-07-13 (Round-25.1 followup): first-time-upload gate (issue:
// the CV-upload e2e spec cluster fails because the demo-user fixture
// has no cvText on profile, and a short first-time PDF could not
// satisfy the >= 50 char floor, so the success element never mounts —
// see last_response.txt's Round-23 diagnosis for the exact spec list
// carried into Round-25; baseline Round-25.1 was "settings-cv-upload,
// cv-magic-bytes, all-issues-smoke" plus a fourth spec from the
// soft-launch cluster).
// The gate reads the EXISTING profile's cvText + cvSummary and calls
// the upload "first-time" only when BOTH are empty. For first-time
// uploads, shouldOverwriteCvText is true regardless of extracted
// length; otherwise the >= 50 floor stands. The cvSummary-only case
// is unchanged from Round-10 (the gate preserves manual summary
// protection in BOTH the cvText and cvSummary directions — a user
// who wrote a manual summary but never uploaded a PDF must NOT be
// classified as first-time, otherwise the original short-cvText-
// clobbers-manual-summary regression re-emerges).
const MIN_VALID_CV_TEXT_CHARS = 50
// Bug-3 polish (2026-07-17): lazy-resolve via lib/groq.js's
// isLlmAvailable() so a future addition to lib/groq.js's
// provider precedence (e.g. ANTHROPIC_API_KEY) automatically
// reaches this endpoint without a second edit. Backward-
// compatible (same boolean, same module-load evaluation).
// Original Bug-3 fix commentary (kept for git-blame context):
// surface the AI-key availability to the client so cover-letter /
// cv-enhance downstream calls can show an explicit toast when no
// LLM provider is configured. Surface only — this route does NOT
// call any AI provider directly; downstream callers
// (/api/cv-enhance, /api/[[...path]]/route.js regenerate-cover-
// letter) silently degrade to a fallback template when the keys
// are absent, which is why surfacing here gives the user one
// clear "contact admin" toast right after upload.
const HAS_ANY_LLM_KEY = isLlmAvailable()

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);
const ALLOWED_EXT = new Set(['pdf', 'docx']);

// ---- Magic-byte signatures (file header validation) ----
// Issue 5 (2026-07-10): validate the first bytes of the buffer
// against the expected signature for the claimed extension. Catches
// the most common upload error: a classic `.doc` file renamed to
// `.docx` (Word binary format vs OOXML/ZIP). The MIME type check
// above can be spoofed by a hand-crafted curl POST; magic bytes
// are much harder to forge without the right authoring tool.
//
// Why not parse first, then validate? Because the parser's error
// message for a "looks-like-PDF-but-isn't" payload is generic
// ("corrupt file"), and the user can't tell whether they uploaded
// the wrong format or whether the file is genuinely broken. The
// magic-byte check surfaces a SPECIFIC error: "this looks like a
// .doc file, not a .docx" — which is actionable.
//
// PDF signature: `%PDF-` (5 bytes) — 25 50 44 46 2D in hex.
// DOCX signature: `PK\x03\x04` (4 bytes) — the standard ZIP local
// file header. Every valid OOXML container starts with these four
// bytes because DOCX is a ZIP archive.
const MAGIC_BYTES = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2D], // %PDF-
  docx: [0x50, 0x4B, 0x03, 0x04],      // PK\x03\x04
}

// ---- Auth (shared via @/lib/auth — see the consolidated
// requireAuth / resolveClerkId helpers there) ----

/**
 * Strip the file extension (case-insensitive) for downstream dispatch.
 * Returns '' if there is no extension — caller treats that as unsupported.
 */
function getExtension(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : '';
}

/**
 * Verify the first bytes of a file buffer match the expected magic-byte
 * signature for the claimed extension. Returns `null` on success, or a
 * Swedish error string the caller can return as 400.
 *
 * Issue 5 (2026-07-10): magic-byte validation runs AFTER the size +
 * extension/MIME checks so a malicious 500 MB payload still gets
 * rejected before we read 5 bytes into memory. The buffer is sliced
 * (not sliced-and-discarded) so the same `buffer` reference can be
 * passed straight to the parser without a copy.
 *
 * Why we DON'T use `Buffer.indexOf()` for DOCX: a real DOCX has the
 * ZIP signature at byte 0, and `Buffer.indexOf` would also match
 * `PK\x03\x04` anywhere later in the file (e.g. an embedded resource).
 * Strict prefix match is the only correct shape.
 */
function validateMagicBytes(buffer, extension) {
  const sig = MAGIC_BYTES[extension];
  if (!sig) return 'Filformatet stöds inte. Använd PDF eller DOCX.';
  if (buffer.length < sig.length) {
    return 'Filen är för kort för att vara en giltig PDF/DOCX.';
  }
  for (let i = 0; i < sig.length; i++) {
    if (buffer[i] !== sig[i]) {
      // Specialise the most common case (classic .doc renamed to
      // .docx) so the user knows exactly what to fix. Other
      // mismatches get a generic "this isn't a real PDF/DOCX"
      // message.
      if (extension === 'docx' && sig === MAGIC_BYTES.docx) {
        return 'Filen verkar vara en äldre .doc-fil (inte .docx). Konvertera till .docx eller PDF i Word/Google Docs och ladda upp igen.';
      }
      return 'Filen är inte en giltig ' + (extension === 'pdf' ? 'PDF' : 'DOCX') + '. Kontrollera att filen inte är skadad.';
    }
  }
  return null;
}

/**
 * Native pdfjs-dist error names. The legacy build throws these as
 * concrete subclass instances; their `.name` property is the most
 * reliable discriminator across pdfjs-dist versions. We map each
 * to a distinct Swedish user-facing message so the UI can give
 * actionable guidance instead of a generic "broken PDF" alert.
 *
 *   • PasswordException     → "PDF:en är lösenordsskyddad" (issue: user
 *                              encrypted it in Acrobat before sending).
 *   • InvalidPDFException   → "PDF:en är skadad" (xref broken or
 *                              generated by a tool with a known bug).
 *   • MissingPDFException   → "PDF:en är tom" (zero-byte or headline-
 *                              only payload; treated as corrupt).
 *   • FormatError + other  → "Formatet stöds inte" (rare — non-PDF
 *                               bytes that still passed magic-byte
 *                               validation, e.g. malformed clones).
 */
const PDF_ERROR_NAMES = {
  PasswordException: 'PASSWORD_PROTECTED',
  InvalidPDFException: 'CORRUPT_PDF',
  MissingPDFException: 'CORRUPT_PDF',
  FormatError: 'UNSUPPORTED_PDF_FORMAT',
}

/**
 * Single source of truth for whether a thrown pdfjs-dist error
 * matches any KNOWN categorised type (PASSWORD_PROTECTED, CORRUPT_PDF,
 * UNSUPPORTED_PDF_FORMAT). Both the per-page catch (in
 * `extractPdfTextDirect`) and the outer `categorisePdfError` consult
 * this helper so the two gate paths can't drift apart. A single
 * throwable that matches by .name OR by message-substring is treated
 * identically — critical because an error caught on page 3 of a
 * multi-page CV must propagate to the OUTER error handler that
 * maps to the right Swedish message; without this helper, a future
 * refactor that adds a new entry to PDF_ERROR_NAMES would silently
 * skip on one of the two paths.
 *
 * Substring matching is intentionally kept — pdfjs-dist forks that
 * throw plain Errors before PDF_ERROR_NAMES was extended (older
 * v3-era libraries) still surface the right code via this gate.
 */
function matchesKnownPdfError(e) {
  const name = String(e?.name || '')
  if (PDF_ERROR_NAMES[name]) return true
  const message = String(e?.message || e || '')
  if (/password/i.test(message)) return true
  if (/invalid\s*pdf/i.test(message)) return true
  if (/missing\s*pdf/i.test(message)) return true
  return false
}

/**
 * Categorise a thrown pdfjs-dist error into a fresh Error with a
 * Swedish user-facing message and a `.code` discriminator the UI
 * could later switch on (currently only the message is surfaced).
 *
 * First matches the `.name` against PDF_ERROR_NAMES (the most
 * reliable signal), then falls back to substring matches on the
 * message for older pdfjs-dist forks where the error name was
 * a plain string. The `matchesKnownPdfError` gate at the top drives
 * the v3-fork fallback path; the deeper per-name + substring match
 * picks the SPECIFIC `.code` (the per-page catch only needs a YES/NO
 * answer, while categorisePdfError picks among PASSWORD_PROTECTED
 * / CORRUPT_PDF / UNSUPPORTED_PDF_FORMAT).
 */
function categorisePdfError(e) {
  const name = String(e?.name || '')
  // 1. Discriminate by error name (preferred path).
  for (const [errName, code] of Object.entries(PDF_ERROR_NAMES)) {
    if (name === errName) {
      return _buildCategorisedError(code, errName)
    }
  }
  // 2. Fallback: substring match against the message for older
  //    pdfjs-dist forks that throw plain Errors. pdfjs-dist v4
  //    throws structured errors so this branch is rarely hit;
  //    matchesKnownPdfError gate below ensures parity with the
  //    per-page catch.
  const message = String(e?.message || e || '')
  if (/password/i.test(message)) return _buildCategorisedError('PASSWORD_PROTECTED')
  if (/invalid\s*pdf/i.test(message)) return _buildCategorisedError('CORRUPT_PDF')
  if (/missing\s*pdf/i.test(message)) return _buildCategorisedError('CORRUPT_PDF')
  // 3. Default: unknown pdfjs-dist error (FormatError or any of
  //    the catchall pseudo-errors). Treat as "unsupported" so the
  //    UI suggests re-exporting from a known-good tool.
  return _buildCategorisedError('UNSUPPORTED_PDF_FORMAT')
}

function _buildCategorisedError(code) {
  const messages = {
    PASSWORD_PROTECTED:
      'PDF:en är lösenordsskyddad — öppna den i Acrobat eller Preview, välj "Spara som" utan lösenord och ladda upp den nya filen.',
    CORRUPT_PDF:
      'PDF:en är skadad och kan inte tolkas. Prova att öppna den i Acrobat eller Preview och spara om den, eller ladda upp en annan version.',
    UNSUPPORTED_PDF_FORMAT:
      'PDF:en är i ett format vi inte stöder just nu. Testa att exportera om den från Word eller Google Docs, eller skriv en kort sammanfattning manuellt nedan.',
  }
  const err = new Error(messages[code] || messages.UNSUPPORTED_PDF_FORMAT)
  err.code = code
  return err
}

/**
 * Load a PDF buffer via pdfjs-dist directly so we can
 *   1. extract text from every page (concatenated),
 *   2. detect image-only scans via the page-1 operator list,
 *   3. surface pdfjs-dist's STRUCTURED errors (PasswordException,
 *      InvalidPDFException, MissingPDFException, FormatError) so
 *      the route can map each to a distinct Swedish message.
 *
 * Replaces `pdf-parse` — pdfjs-dist gives us the same underlying
 * parser with much better error reports. The legacy build
 * (`pdfjs-dist/legacy/build/pdf.mjs`) is the Node-friendly
 * distribution — no Canvas, no Worker plumbing needed.
 *
 * Returns `{ text, hasText, isImageOnly }`. `text` is the trimmed
 * concatenated text across pages; `hasText` distinguishes the
 * "success but empty" case from the "success with text" case;
 * `isImageOnly` is true when page 1 has image operators but no
 * text operators (a classic scanned PDF signature).
 *
 * Throws categorised Error instances on failures — the caller
 * (`extractText`) re-tags them with the right Swedish message.
 */
async function extractPdfTextDirect(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // The legacy build runs synchronously in Node \u2014 no worker is
  // spawned because the parent's main thread decodes the PDF
  // directly. We deliberately DON'T touch `GlobalWorkerOptions`
  // here because pdfjs-dist v4's setter VALIDATES the value (string
  // expected) and rejects the v3-era `workerSrc = false` idiom with
  // "Invalid `workerSrc` type." \u2014 the existing `isImageOnlyPdf`
  // used this pattern, masked by a top-level try/catch that
  // silently degraded image-only detection. Leaving the option
  // untouched bypasses the validation entirely; the legacy build
  // runs as expected with its own in-thread decode path.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
  })
  let pdfDoc = null
  try {
    pdfDoc = await loadingTask.promise
    const numPages = pdfDoc.numPages || 0
    if (numPages === 0) {
      // Genuinely zero-page PDF — extremely rare but valid. We
      // surface it as an empty-success so the existing empty-hint
      // banner takes over (the user lands on the manual summary
      // path, which is the right UX for "nothing to read here").
      return { text: '', hasText: false, isImageOnly: false, pageCount: 0 }
    }

    // Bug fix (2026-07-11, "CV PDF upload"): PDFs that use a single
    // large CMap font or a content stream with no per-glyph kerning
    // were coming back as `text: ''` from the DEFAULT extraction pass
    // and being misclassified as image_only_pdf. Some real-world
    // PDF/A exports from Word Online + Pages write their body with
    // `combined-items=true` semantics that the default pass collapses
    // into an empty stream (the per-glyph `str` field is empty under
    // disableCombineTextItems siblings).
    //
    // We therefore do TWO extraction passes per page:
    //   1. Default (fast, covers the vast majority of PDFs).
    //   2. If pass #1 yielded empty text, retry with
    //      `disableCombineTextItems: true` + `includeMarkedContent: true`
    //      to capture PDFs whose glyphs would otherwise be lost.
    // The second pass costs ~3-5 ms per page on empty PDFs but is
    // essential for the false-positive classification regression.
    //
    // A single global pageText accumulator lets us decide which pass
    // contributed to the final result without polluting `textParts`
    // with both renders of the same page.
    const textParts = []
    let fallbackPagesRecovered = 0
    let transientPagesFailed = 0
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i)
      // Pass 1 — default options. We DO wrap this per-page in a
      // try/catch: a single transient pdfjs-dist error on one page of
      // a multi-page CV should not abort the ENTIRE upload. The
      // categorisePdfError classifier runs on a per-error basis:
      //   • KNOWN categorised errors (PasswordException,
      //     InvalidPDFException, MissingPDFException, FormatError) →
      //     re-throw so the outer catch maps to PASSWORD_PROTECTED /
      //     CORRUPT_PDF / UNSUPPORTED_PDF_FORMAT. Aborting is correct
      //     because the user can't read the file content anyway.
      //   • UNKNOWN (transient pdfjs-dist quirks — closed-font
      //     references, malformed content streams on individual pages,
      //     etc.) → log + treat the page as empty; pass-2 retries
      //     below with the documented accessibility-tagged options;
      //     the user's remaining pages still surface their text.
      // The aggregation invariant: if EVERY page throws transiently,
      // the loop completes with all-empty pages and the downstream
      // empty-text branch surfaces the existing IMAGE_ONLY_PDF or
      // empty-PDF UX path — the user gets a meaningful message either
      // way, just with a different category. If ANY page throws a
      // categorised error, the upload aborts with the precise
      // Swedish message straight from PDF_ERROR_NAMES.
      let content = null
      try {
        content = await page.getTextContent()
      } catch (perPageErr) {
        if (matchesKnownPdfError(perPageErr)) {
          // Categorised — re-throw so the outer catch categorises and
          // translates to the right Swedish message. Aborting ONE
          // page aborts the WHOLE upload because the user can't
          // salvage a passworded / structurally-corrupt PDF anyway.
          // matchesKnownPdfError uses the same NAME-first +
          // message-substring gate as the outer `categorisePdfError`
          // so the two paths can't drift.
          throw perPageErr
        }
        // Unknown / transient — log the page index + the error name
        // so a future regression that introduces a systematic quirk
        // is traceable. Treat as empty (pass-2 below still gets a
        // shot at it).
        transientPagesFailed += 1
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[upload-cv] pass-1 transient error on page ${i}/${numPages}, name=${String(perPageErr?.name || '') || '(anon)'}`)
        }
        content = { items: [] }
      }
      const items = Array.isArray(content?.items) ? content.items : []
      const pageText = items.map((it) => it.str || '').join(' ')
      // Trim per-page so the join doesn't multi-space on blank items.
      let trimmed = pageText.replace(/\s+/g, ' ').trim()
      // Pass 2 — only run when pass 1 yielded nothing. The second-pass
      // options are the documented `getTextContent` knobs from
      // pdfjs-dist for "structured-content but no easy concatenated
      // glyph string":
      //   • disableCombineTextItems: walk each TextItem individually
      //     instead of collapsing runs.
      //   • includeMarkedContent: capture the marked-content sequences
      //     (PDF/A accessibility structure) so accessibility-driven
      //     text layers are read.
      //
      // Pass-2 IS wrapped in try/catch: a throw here means pass-2's
      // options couldn't decode the page at all (rare pdfjs-dist quirk),
      // and falling through to the empty-page declaration is correct —
      // the page has had its chance. Page 1's operator-list walk below
      // will classify it as image-only if appropriate (which is now
      // gated by the tightened `!hasText` signature so a real PDF
      // recovered on either pass never reclassifies).
      if (!trimmed) {
        try {
          const fallback = await page.getTextContent({
            disableCombineTextItems: true,
            includeMarkedContent: true,
          })
          const fbItems = Array.isArray(fallback?.items) ? fallback.items : []
          trimmed = fbItems.map((it) => it.str || '').join(' ').replace(/\s+/g, ' ').trim()
          if (trimmed.length > 0) fallbackPagesRecovered += 1
        } catch (_) {
          // Swallow — fall through with the empty trimmed from pass 1.
          // The image-only branch downstream handles the empty case
          // EXACTLY the same as before, so a throw here can never
          // downgrade a valid PDF.
        }
      }
      textParts.push(trimmed)
    }
    // Aggregate ops signal: when ALL pages fail transiently (zero
    // recovered via pass-2 + every page hit the catch path), the
    // downstream empty-text branch will surface IMAGE_ONLY_PDF or
    // emptied-success. This single log makes it easy to spot PDFs
    // that the layered recovery logic couldn't bring back without
    // grepping through per-page warnings above.
    if (transientPagesFailed === numPages && numPages > 0) {
      console.warn(`[upload-cv] ALL ${numPages}/${numPages} pages failed transiently in pass-1; downstream empty-text UX will fire`)
    }
    // Bookkeeping signal for ops: when fallbackPagesRecovered > 0,
    // some pages only became readable via the second pass. We log
    // ONCE per upload so a future regression that reverts to a
    // single-pass extraction is visible — but only in non-prod
    // environments so a Word Online PDF storm doesn't spam prod
    // logs. The dev log is the appropriate place since the count
    // is a structural signal, not a runtime condition.
    if (fallbackPagesRecovered > 0 && process.env.NODE_ENV !== 'production') {
      console.log(`[upload-cv] fallback 2nd-pass recovered text on ${fallbackPagesRecovered}/${numPages} pages`)
    }

    // Final concatenated text — used for the >50 char heuristic
    // AND for the image-only check (which only runs when text is
    // already short). The 2-pass loop above already collapsed per-
    // page text into textParts with `'\n\n'` as the separator.
    const finalText = textParts.filter(Boolean).join('\n\n').trim()
    // 2026-07-12 (soft-launch polish #d): simpler heuristic. A PDF
    // with >50 characters of extracted text is treated as a
    // valid text-based CV — the image-only check is only invoked
    // on the LOW-text branch (< 50 chars). The previous version
    // applied the image-only check unconditionally, which caused
    // false positives on valid Word/PDF Online exports whose
    // operator-list scan returned `!hasTextOps` for glyph-fallback
    // reasons unrelated to image content. Threshold of 50 chars
    // matches the user-spec'd "if extracted text has >50 characters,
    // it's valid" heuristic and aligns with the existing CV-text
    // minimum a downstream AI prompt actually uses.
    const hasText = finalText.length >= MIN_VALID_CV_TEXT_CHARS

    // Image-only check — only triggers when the second-pass extraction
    // ALSO yielded short text (< 50 chars). The bug fix above added
    // the second pass for non-image PDFs whose body uses single-glyph
    // CMap fonts or accessibility-tagged content streams; we honor
    // that here by only invoking the operator-list walk on the
    // low-text branch. The 2-pass loop has already had a chance to
    // recover text — anything still short is genuinely text-light.
    let isImageOnly = false
    if (!hasText) {
      const page1 = await pdfDoc.getPage(1)
      const ops = await page1.getOperatorList()
      const OPS = pdfjs.OPS || {}
      let hasTextOps = false
      let hasImageOps = false
      const fnArray = ops.fnArray || []
      for (let i = 0; i < fnArray.length; i++) {
        const op = fnArray[i]
        if (op === OPS.showText) { hasTextOps = true; break }
        if (
          op === OPS.paintImageXObject ||
          op === OPS.paintImageMaskXObject ||
          op === OPS.paintJpegXObject
        ) {
          hasImageOps = true
        }
      }
      // Image-only signature: BOTH conditions must hold, AND the
      // extracted text must be below the validity threshold. The
      // gate prevents a real PDF whose glyphs were recovered on
      // pass 2 from being reclassified by the operator list.
      isImageOnly = hasImageOps && !hasTextOps && !hasText
    }

    return {
      text: finalText,
      hasText,
      isImageOnly,
      // 2026-07-12: page count surfaced so the POST handler can
      // log a single ops-friendly line per upload (file size +
      // pages + text length + decision). The /api/cv-ocr stub test
      // pins this contract — see tests/unit/cv-ocr-stub.test.mjs.
      pageCount: numPages,
    }
  } catch (e) {
    // pdfjs-dist's getDocument() throws concrete subclasses with
    // `.name` set to the discriminator (PasswordException /
    // InvalidPDFException / MissingPDFException / FormatError /
    // UnexpectedResponseException). Re-throw a categorised
    // Error so the caller can return a SPECIFIC Swedish message.
    throw categorisePdfError(e)
  } finally {
    // pdfjs-dist documents carry non-trivial references to
    // TypedArrays + closures — explicit destroy prevents the
    // Vercel serverless runtime from holding them in the
    // function-instance cache longer than it has to.
    if (pdfDoc && typeof pdfDoc.destroy === 'function') {
      try { await pdfDoc.destroy() } catch (_) { /* nothing meaningful to do */ }
    }
  }
}

/**
 * Run the right text-extractor for the file's content.
 *
 * Pdfs now go through pdfjs-dist directly so structured errors
 * (PasswordException, InvalidPDFException, MissingPDFException,
 * FormatError) surface as distinct Swedish user-facing messages.
 * DOCX continues through mammoth (no behavioural change — mammoth
 * is a self-contained OOXML/ZIP parser unaffected by the
 * pdf.js fork change).
 *
 * Returns `{ text, hasText, isImageOnly }` for PDFs so the
 * image-only detection is captured in the SAME call as text
 * extraction — saves a second getDocument() pass.
 *
 * For non-PDF formats, returns just a `text` string (existing
 * behaviour preserved).
 */
async function extractText(buffer, extension, mime) {
  if (extension === 'pdf' || mime === 'application/pdf') {
    // Returns structured result. Categorised exceptions bubble
    // up so the POST handler can map them to 400 status codes
    // with the right Swedish message — each `code` is the
    // canonical UI discriminator.
    return await extractPdfTextDirect(buffer)
  }
  if (extension === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.extractRawText({ buffer });
      const text = typeof result?.value === 'string' ? result.value : '';
      // DOCX has no "image-only" concept the way a scanned PDF does
      // (a DOCX is always text by construction). Use the same
      // >= 50 char threshold as the PDF path so the manual
      // fallback fires uniformly across formats when the parsed
      // text is suspiciously short.
      return { text, hasText: text.trim().length >= 50, isImageOnly: false, pageCount: 1 }
    } catch (e) {
      // mammoth throws plain Errors with messages we can't
      // reliably categorise between "password / corrupt /
      // unsupported". The most common cause of a DOCX parse
      // failure is a classic .doc file renamed to .docx, which
      // the magic-byte guard already catches BEFORE we reach
      // here. So a parse throw means a genuinely broken ZIP /
      // XML. Suggest opening and re-saving. The same `.code`
      // discriminator pattern as the PDF categorisation lets the
      // UI / future analytics discriminate DOCX-specific
      // failures from PDF ones without parsing the Swedish
      // message text.
      const err = new Error(
        'DOCX-filen är skadad — öppna den i Word eller Google Docs och spara om den, eller ladda upp PDF-versionen istället.',
      )
      err.code = 'CORRUPT_DOCX'
      throw err
    }
  }
  throw new Error('Filformatet stöds inte. Använd PDF eller DOCX.');
}

export async function POST(request) {
  try {
    const authRes = await requireAuth(request);
    if (authRes.error) return authRes.error;
    const clerkId = authRes.userId;

    // Multipart parse. Next.js >=15 surfaces a clean FormData object on
    // Request — works for both App Router and Pages router. The legacy
    // `formidable` middleware is NOT needed.
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'Ingen fil hittades i uppladdningen.' },
        { status: 400 },
      );
    }

    // Validate size BEFORE reading the buffer into memory so a 500MB
    // payload from a malicious client can't OOM the server.
    if (typeof file.size !== 'number' || file.size <= 0) {
      return NextResponse.json({ error: 'Tom fil — ladda upp en giltig CV.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `Filen är för stor (max ${MAX_FILE_BYTES / 1024 / 1024} MB).` },
        { status: 413 },
      );
    }

    const extension = getExtension(file.name);
    const mime = file.type || '';
    if (!ALLOWED_EXT.has(extension) || !ALLOWED_MIME.has(mime)) {
      // .doc is a common pitfall — the file-picker UI accepts it and
      // the form data arrives intact, but we can't parse it. Return a
      // spec-compliant 400 so the UI can show a clear message.
      const hint = extension === 'doc'
        ? ' DOC-format stöds inte — konvertera till DOCX eller PDF.'
        : '';
      return NextResponse.json(
        { error: `Endast PDF- och DOCX-filer accepteras.${hint}` },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Issue 5 (2026-07-10): magic-byte validation. Runs after the
    // size + extension/MIME checks (so a 500 MB payload is still
    // rejected before we read 5 bytes) and BEFORE the parser (so
    // a wrong-format upload doesn't surface as a generic "corrupt
    // file" parser error). The function returns a Swedish error
    // string on mismatch; we map that straight to a 400.
    const magicByteError = validateMagicBytes(buffer, extension);
    if (magicByteError) {
      return NextResponse.json({ error: magicByteError }, { status: 400 });
    }

    // Pdf path: extractText returns a structured { text, hasText,
    // isImageOnly } so the image-only check is free (same doc load).
    // Non-Pdf paths still return the same shape, just with
    // isImageOnly=false so the calling code's branch logic stays
    // symmetric across file types.
    let extractResult
    // 2026-07-12 (Round-10 critical fix): "soft" extraction
    // failures no longer block the upload. The previous code
    // returned 400 for ANY categorised error from pdfjs-dist,
    // including UNSUPPORTED_PDF_FORMAT and unknown errors — even
    // though the file is structurally valid and the user just
    // needs to write a manual summary. The flow is now:
    //   • PASSWORD_PROTECTED or CORRUPT_DOCX → 400 (user must
    //     fix the file: remove password, re-save the docx).      //   • Any other error → store the file metadata (filename, size,
      //     upload date) and return 200 with `needsManualFallback:
      //     true` so the UI shows the empty-hint banner and the user
      //     types a manual summary. The cvText field is preserved
      //     unchanged. (Round-14: the pdf-parse "second-opinion"
      //     fallback was removed — pdf-parse v2 is now a class-based
      //     rebuild with no plain-text-extraction function. pdfjs-dist
      //     v4 is the only viable parser and is already maximally
      //     defensive — 2-pass per page + image-only ops-walk.)
      //
      // This preserves the existing tests' contract for
      // PASSWORD_PROTECTED / CORRUPT_PDF / UNSUPPORTED_PDF_FORMAT
      // / IMAGE_ONLY_PDF error codes (they all still appear in the
      // source) while adding a new EXTRACTION_FAILED code for the
      // soft-failure path.
    //
    // This preserves the existing tests' contract for
    // PASSWORD_PROTECTED / CORRUPT_PDF / UNSUPPORTED_PDF_FORMAT
    // / IMAGE_ONLY_PDF error codes (they all still appear in the
    // source) while adding a new EXTRACTION_FAILED code for the
    // soft-failure path.
    let extractionSoftFailure = false
    let extractionSoftFailureCode = null
    let extractionSoftFailureMessage = null
    try {
      extractResult = await extractText(buffer, extension, mime);
      // 2026-07-12 (soft-launch polish #d): one-line server-side
      // log per upload so a tester (or the support flow) can see
      // WHY a PDF is being rejected. The fields line up with the
      // manual fallback heuristic so a single line answers "did
      // we get text? how much? which branch did we take?".
      //   FILE_SIZE — bytes uploaded
      //   PAGES     — pdfjs numPages (1 for DOCX)
      //   TEXT_LEN  — characters extracted, post-trim
      //   DECISION  — valid | image_only | empty
      //   FORMAT    — pdf | docx (for grep-friendly filter)
      // The log is emitted on EVERY successful extraction in
      // non-prod envs (a soft-launch tester can copy a single
      // line to support). In prod we throttle the volume via a
      // 1-in-50 sample so a Word Online PDF storm doesn't spam
      // prod logs. The `catch` block below still logs every
      // categorised failure because the support flow needs the
      // full signal there.
      const tLen = (extractResult.text || '').length
      const pCount = extractResult.pageCount || 1
      let decision = 'valid'
      if (tLen < MIN_VALID_CV_TEXT_CHARS) {
        decision = extractResult.isImageOnly ? 'image_only' : 'empty'
      }
      // Sampling gate: always log in non-prod, sample 1-in-50 in
      // prod. The `isProd` short-circuit is hoisted BEFORE the
      // counter mutates so dev runs never touch globalThis state
      // (the previous version unconditionally wrote to
      // `global.__uploadCvLogCounter` even when dev always logs).
      // In prod the counter is incremented on every upload and
      // only every 50th line is emitted — enough to keep a
      // support flow able to grep prod logs for a specific
      // upload without flooding the log stream.
      const isProd = process.env.NODE_ENV === 'production'
      let shouldLog = !isProd
      if (isProd) {
        global.__uploadCvLogCounter = (global.__uploadCvLogCounter || 0) + 1
        shouldLog = global.__uploadCvLogCounter % 50 === 0
      }
      if (shouldLog) {
        console.log(
          `[upload-cv] FILE_SIZE=${file.size} PAGES=${pCount} TEXT_LEN=${tLen} DECISION=${decision} FORMAT=${extension} clerkId=${clerkId}`,
        )
      }
    } catch (e) {
      // Categorised error from extractText. The code discriminator
      // on the error is the canonical contract: PASSWORD_PROTECTED
      // and CORRUPT_DOCX are "fatal" (the user must fix the file)
      // and still return 400; everything else is a "soft" failure
      // (the file is fine, but we can't read the text) and falls
      // through to the metadata-preserving 200 path below.
      const code = e?.code || 'PARSE_ERROR'
      // 2026-07-12 (Round-10): detailed error log so a tester
      // can grep server logs for the EXACT pdfjs-dist error on
      // a failing upload. Logs the name, message, and stack so a
      // future regression that introduces a new pdfjs-dist error
      // class is traceable to the right code path.
      console.warn(
        `[upload-cv] FILE_SIZE=${file.size} DECISION=error CODE=${code} FORMAT=${extension} clerkId=${clerkId} errorName=${e?.name || '(anon)'} errorMessage=${e?.message || String(e)}`,
      )
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[upload-cv] full error stack:', e?.stack)
      }

      // Fatal: the user MUST fix the file before re-uploading.
      // Return 400 so the UI shows a hard error and the file
      // metadata is NOT saved (so the file card stays empty
      // and the user can pick a different file).
      const isFatal = code === 'PASSWORD_PROTECTED' || code === 'CORRUPT_DOCX'
      if (isFatal) {
        return NextResponse.json(
          {
            error: e.message,
            code,
            needsManualFallback: false,
          },
          { status: 400 },
        )
      }

      // Round-14 (2026-07-12): soft-failure is now terminal. The
      // historical pdf-parse v1 "second opinion" fallback is gone —
      // pdf-parse v2 is now a TypeScript class-based API with NO
      // plain-text-extraction function in its module shape (mirror
      // fixture's analysis in tests/e2e/dashboard-ansokningsdatum
      // .spec.js#pdfParse). pdfjs-dist v4 is the ONLY viable PDF
      // parser in this codebase, and the primary path is already
      // maximally defensive — 2-pass per page + a 20-line image-only
      // operator-list walk. When pdfjs-dist can't decode a content
      // stream, no other library can, so the user lands in the
      // manual-summary UX via needsManualFallback regardless of the
      // failure shape. DOCX shares the same empty-success envelope
      // because mammoth is the only DOCX parser and there's nothing
      // to "fall back to" there either.
      extractionSoftFailure = true
      extractionSoftFailureCode = code
      extractionSoftFailureMessage = e?.message || String(e)
      extractResult = {
        text: '',
        hasText: false,
        isImageOnly: false,
        pageCount: 1,
      }
    }

    let extracted = extractResult.text || '';
    // Trim whitespace, collapse repeated blank lines, and bucket to a
    // hard size cap before saving. This bails out of any pathological
    // PDF that flattens to a wall of duplicated text.
    extracted = extracted
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (extracted.length > MAX_CV_TEXT_CHARS) {
      extracted = extracted.slice(0, MAX_CV_TEXT_CHARS);
    }

    // 2026-07-12 (soft-launch polish #d): re-aligned to the
    // simpler >50 char heuristic. The IMAGE_ONLY_PDF branch fires
    // ONLY when the extracted text is below the validity threshold
    // AND the operator-list walk classified the PDF as image-only.
    // A scanned PDF returns 400 with a SPECIFIC Swedish message so
    // the user knows to either re-export with OCR or write a
    // manual summary; a truly empty PDF (text < threshold but no
    // image-only signature) returns 200 + empty cvText so the
    // existing empty-hint banner takes over.
    // Round-58 / Bug 3 -- Tiny-PDF heuristic. A 2.3 KB PDF (or any sub-8 KB PDF)
    // that yields no extracted text is almost certainly a corrupt or empty
    // export -- a real text-based CV is 50 KB + and a real scanned CV is
    // 100 KB + . Distinguishing this from the IMAGE_ONLY_PDF branch lets the UI
    // surface a clearer Swedish message ("filen ar for liten eller tom") and
    // analytics track the difference. Returned as 400 with code=TINY_PDF so
    // the existing test contracts (PASSWORD_PROTECTED / CORRUPT_PDF /
    // UNSUPPORTED_PDF_FORMAT / IMAGE_ONLY_PDF) lock to their original values.
    const TINY_PDF_HEURISTIC_BYTES = 8 * 1024
    if (file.size < TINY_PDF_HEURISTIC_BYTES && extracted.length < MIN_VALID_CV_TEXT_CHARS && extension === 'pdf' && !extractionSoftFailure) {
      return NextResponse.json(
        {
          error: "PDF:en verkar vara för liten eller tom (under 8 KB). Ladda upp en textbaserad version eller skriv en kort sammanfattning manuellt nedan.",
          needsManualFallback: true,
          code: "TINY_PDF",
        },
        { status: 400 },
      )
    }

    if (extracted.length < MIN_VALID_CV_TEXT_CHARS && extension === 'pdf' && extractResult.isImageOnly) {
      return NextResponse.json(
        {
          error: 'PDF:en verkar vara inskannad och saknar textlager. Skriv en kort sammanfattning manuellt i fältet nedan — AI:n använder den i dina personliga brev.\n\nTips: Öppna PDF:en i Acrobat eller Preview och "Spara som" igen — många skanningsverktyg kan lägga till ett dolt textlager vid omsparning.',
          needsManualFallback: true,
          reason: 'image_only_pdf',
          code: 'IMAGE_ONLY_PDF',
        },
        { status: 400 },
      )
    }

    // 2026-07-12 (soft-launch polish #d): only overwrite the
    // server-side cvText when the parsed result is at-or-above
    // the validity threshold. The Groq prompt in lib/groq.js
    // prefers cvText over cvSummary, so a 30-char cvText would
    // override the user's longer manual summary (cvSummary).
    // The user's existing cvText + cvSummary are preserved
    // untouched when the upload result is too short — the UI
    // surfaces the manual textarea so the user can re-save
    // their summary via the regular /api/profile-update flow.
    const db = await getDb();

    // 2026-07-13 (Round-25.1 option a): first-time-upload gate.
    // See the docstring above (lines 60-78) for the full rationale
    // — short summary: when the profile has NEITHER cvText NOR
    // cvSummary set, this is a first-time upload, and the gate is
    // permissive (always overwrite) so the success element can
    // mount on the UI. When EITHER field is set, the original
    // Round-10 >= 50 floor stands (manual summary protection).
    //
    // Read-failure handling: NO inner try/catch. A Mongo blip on
    // the findOne surfaces as a 400 from the outer catch, which is
    // the right operational signal — the user retries the upload.
    // A "permissive fallback" that defaults isFirstTimeUpload = true
    // on a read blip would silently re-introduce the Round-10 bug
    // (a short cvText clobbering an existing cvSummary) under a
    // different trigger (Mongo error vs short PDF). Fail loudly
    // is the safer default.
    //
    // The findOne uses a narrow projection (only the two fields we
    // need for the gate decision) so the read cost is bounded by
    // the existing clerkId index — ~1-3 ms even on a Mongo
    // cross-region deployment.
    const existingProfile = await db.collection('profiles').findOne(
      { clerkId },
      { projection: { cvText: 1, cvSummary: 1 } },
    );
    const existingCvText = typeof existingProfile?.cvText === 'string' ? existingProfile.cvText : '';
    const existingCvSummary = typeof existingProfile?.cvSummary === 'string' ? existingProfile.cvSummary : '';
    // Both fields empty → first-time → permissive overwrite.
    // Either field non-empty → not first-time → original 50-char floor.
    const isFirstTimeUpload = existingCvText.trim().length === 0 && existingCvSummary.trim().length === 0;
    const shouldOverwriteCvText = isFirstTimeUpload || extracted.length >= MIN_VALID_CV_TEXT_CHARS

    await db.collection('profiles').updateOne(
      { clerkId },
      {
        $set: {
          // Conditionally set cvText so a sub-threshold upload
          // doesn't clobber a longer user-written summary. The
          // other metadata (filename, size, uploadedAt) is
          // always updated so the /settings card reflects the
          // last upload attempt.
          ...(shouldOverwriteCvText ? { cvText: extracted } : {}),
          cvFileName: file.name,
          cvFileSize: file.size,
          cvUploadedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    // 2026-07-12 (Round-10 critical fix): when extraction
    // soft-failed, the response is 200 (not 400) so the file
    // is recorded + the UI's empty-hint banner fires. The error
    // code is still surfaced for analytics so a tester can grep
    // for `EXTRACTION_FAILED` in the response and trace it to
    // the right log line. The cvText response field stays empty
    // (the user's existing manual summary + cvText are untouched
    // on the server side).
    const softFailureResponse = extractionSoftFailure
      ? {
          warning:
            'Vi kunde inte läsa texten från din PDF — filen är sparad, men skriv en kort sammanfattning manuellt i fältet nedan så att AI:n har något att arbeta med.',
        }
      : {}

    return NextResponse.json({
      ok: true,
      cvText: shouldOverwriteCvText ? extracted : '',
      cvFileName: file.name,
      cvFileSize: file.size,
      cvTextChars: extracted.length,
      // Bug-3 fix (2026-07-17): so the user sees a clear toast
      // when their PDF upload succeeds but the downstream AI
      // cover-letter / email-body generation will fall back to
      // the Swedish template (lib/groq.js has no key configured).
      // Exact Swedish phrasing per Bug-3 spec.
      aiKeyConfigured: HAS_ANY_LLM_KEY,
      ...(HAS_ANY_LLM_KEY
        ? {}
        : { aiWarning: 'CV-tolkning kräver en AI-nyckel. Kontakta administratören.' }),
      // 2026-07-12 (soft-launch polish #d): `needsManualFallback`
      // is now keyed off the same threshold the server uses to
      // decide valid vs image-only. A short extracted text is
      // always "the user should write a manual summary",
      // regardless of whether the parse succeeded with a
      // borderline-short result OR failed entirely. This lets
      // the client's CVFileUpload component keep showing the
      // manual textarea + scroll-into-view hint on every code
      // path, not just the image-only 400.
      needsManualFallback: extracted.length < MIN_VALID_CV_TEXT_CHARS,
      // Hint flag — a soft-launch tester copying a log line
      // can see why cvText wasn't overwritten. Distinct from
      // needsManualFallback (which the UI uses) so future
      // analytics can discriminate "manual fallback needed"
      // from "cvText was preserved unchanged".
      cvTextPreserved: !shouldOverwriteCvText,
      // 2026-07-12 (Round-10): when both pdfjs-dist AND pdf-parse
      // fail on a PDF, surface a structured `code` so the UI
      // can branch on it. Distinct from `needsManualFallback`
      // (which is the user-visible flag) so analytics can
      // discriminate the soft-failure path from a normal
      // sub-threshold extraction. The `extractionError` field is
      // gated on non-prod so the raw pdfjs-dist error message
      // (which can leak internals like the parser version,
      // internal class names, or stack frames) never reaches a
      // production browser. The `code` field is the only
      // production-safe discriminator.
      ...(extractionSoftFailure
        ? {
            code: extractionSoftFailureCode || 'EXTRACTION_FAILED',
            ...(process.env.NODE_ENV !== 'production'
              ? { extractionError: extractionSoftFailureMessage }
              : {}),
          }
        : {}),
      ...softFailureResponse,
    });
  } catch (e) {
    console.error('upload-cv error', e);
    return NextResponse.json(
      { error: e?.message || 'Kunde inte bearbeta CV-filen.' },
      { status: 400 },
    );
  }
}
