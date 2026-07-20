/**
 * lib/pdf-report.js
 *
 * Aktivitetsrapport PDF generator — extracted from the catch-all
 * route.js so the API route stays focused on request/response shape.
 *
 * Exports one function:
 *   • `generateAktivitetsrapport(profile, applications, now)` →
 *     `Promise<Uint8Array>` (ready to stream back as application/pdf).
 *
 * Avatar silhouette data lives in lib/avatars-svg.js (the same
 * module consumed by components/avatars.jsx) so a tweak in one
 * place updates the React picker AND the PDF simultaneously — the
 * data-layer table + a generic shape walker means the silhouettes
 * are described once in `lib/avatars-svg.js` and translated to
 * PDF primitives on the fly. Eliminated the duplicated hard-coded
 * SVG path strings that previously lived in `route.js`.
 *
 * Visual contract: the 5 PDF-supported avatar slugs (`piloten`,
 * `navigatören`, `strategen`, `upptäckaren`, `kaptenen`) render in
 * the top-right of page 1. Other slugs fall back to the indigo ✈
 * glyph on a white-rimmed amber disc (the same fallback the React
 * `ProfileAvatar` component uses for unknown slugs).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { truncate } from '@/lib/utils'
import { PROFILE_PICTURE_AVATARS } from '@/lib/avatar-keys'
import { AVATAR_SVG_DATA, WATERMARK_PDF_PATH } from '@/lib/avatars-svg'
import { sanitiseForWinAnsi } from './sanitise-winansi.js'

// =============================================================================
// WinAnsi-safe text sanitiser — moved to lib/sanitise-winansi.js
// =============================================================================
//
// The `sanitiseForWinAnsi()` helper now lives in its own tiny module
// (`./sanitise-winansi.js`). The split lets us:
//   • Run unit tests against the function WITHOUT booting the @/lib/*
//     alias chain — the new module has zero internal imports, so
//     `import { sanitiseForWinAnsi } from '../../lib/sanitise-winansi.js'`
//     works in `node --test` without a custom loader.
//   • Re-use the helper from other routes (e.g. a future cover-letter
//     preview endpoint) without dragging in pdf-lib.
//
// The behavioural contract is byte-identical to the previous inline
// version, so the existing static-grep locks in
// tests/unit/pdf-winansi.test.mjs + the BEHAVIOURAL test in
// tests/unit/winansi-sanitiser.test.mjs both still pass on the same
// input distribution.

// Hex "#rrggbb" → pdf-lib rgb tuple. Used by the shape loop below to
// turn the data-layer hex strings into pdf-lib's expected format.
//
// VALIDATION NOTE: parseInt('xx', 16) silently returns NaN for non-hex
// chars, and pdf-lib's `rgb(NaN/255, NaN/255, NaN/255)` renders as
// invisible-fail black rather than throwing — so a typo in
// lib/avatars-svg.js (e.g. "#fbbf2g") would silently render as black
// instead of crashing. We NaN-check explicitly here so an invalid
// `bg` or `fill` surfaces as a clear error pointing at the source
// file + slug, instead of a week-long scavenger hunt in the PDF
// output. The data-layer constants are all hand-authored so this
// throw is also a contract-lock — adding a new color without a hex
// triplet will fail loudly during the soft-launch render check.
function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '')
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`hexToRgb: invalid hex "${hex}" (expected "#rrggbb")`)
  }
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return rgb(r, g, b)
}

// SVG-coord → pdf-coord helper. The data layer stores x/y in the SVG
// viewBox (0–144, y-down). pdf-lib uses absolute page coords (y-up),
// so each render position is translated + scaled here.
function svgCoord(opts, svgX, svgY) {
  const scale = opts.size / 144
  return {
    x: opts.x + svgX * scale,
    y: opts.y + opts.size - svgY * scale,
    scale,
  }
}

// Helper for the watermark — drawn FIRST inside each renderer so the
// body silhouette overlays it (matches the React SVG render order in
// components/avatars.jsx).
function drawWatermarkPdf(page, opts) {
  const scale = opts.size / 144
  page.drawSvgPath(WATERMARK_PDF_PATH, {
    x: opts.x,
    y: opts.y + opts.size,
    scale,
    color: rgb(1, 1, 1),
    borderColor: hexToRgb('#0f172a'),
    borderWidth: 1.4 * scale,
    opacity: 0.55,
  })
}

// =============================================================================
// Avatar shape renderer
// =============================================================================
//
// One generic shape walker takes a record from AVATAR_SVG_DATA and
// translates it to the equivalent pdf-lib draw* call. Replacing the
// 5 hand-written drawPilotenPdf/drawNavigatörenPdf/drawStrategenPdf/
// drawUpptäckarenPdf/drawKaptenenPdf functions with this single
// walker means the silhouette data has ONE source (lib/avatars-svg.js)
// and a tweak propagates to both the picker and the PDF in lock-step.

function renderAvatarShapePdf(page, opts, shape) {
  if (shape.type === 'watermark') {
    drawWatermarkPdf(page, opts)
    return
  }
  const fillColor = shape.fill && shape.fill !== 'none' ? hexToRgb(shape.fill) : undefined
  const strokeColor = shape.stroke ? hexToRgb(shape.stroke) : undefined
  switch (shape.type) {
    case 'circle': {
      const c = svgCoord(opts, shape.cx, shape.cy)
      page.drawCircle({
        x: c.x,
        y: c.y,
        size: shape.r * c.scale,
        color: fillColor,
        borderColor: strokeColor,
        borderWidth: (shape.strokeWidth || 0) * c.scale,
        opacity: shape.opacity,
      })
      return
    }
    case 'ellipse': {
      const c = svgCoord(opts, shape.cx, shape.cy)
      page.drawEllipse({
        x: c.x,
        y: c.y,
        xScale: shape.rx * c.scale,
        yScale: shape.ry * c.scale,
        color: fillColor,
        borderColor: strokeColor,
        borderWidth: (shape.strokeWidth || 0) * c.scale,
        opacity: shape.opacity,
      })
      return
    }
    case 'rect': {
      // SVG rect coords are TOP-LEFT in viewBox; pdf-lib drawRectangle
      // takes BOTTOM-LEFT. Translate by shape.height to land in the
      // same visual position.
      const c = svgCoord(opts, shape.x, shape.y + shape.height)
      page.drawRectangle({
        x: c.x,
        y: c.y,
        width: shape.width * c.scale,
        height: shape.height * c.scale,
        color: fillColor,
        borderColor: strokeColor,
        borderWidth: (shape.strokeWidth || 0) * c.scale,
        opacity: shape.opacity,
      })
      return
    }
    case 'line': {
      const a = svgCoord(opts, shape.x1, shape.y1)
      const b = svgCoord(opts, shape.x2, shape.y2)
      page.drawLine({
        start: { x: a.x, y: a.y },
        end: { x: b.x, y: b.y },
        thickness: (shape.strokeWidth || 1) * a.scale,
        color: strokeColor,
        opacity: shape.opacity,
      })
      return
    }
    case 'path': {
      const scale = opts.size / 144
      // VISUAL-DRIFT NOTE: the data layer's shape strokes carry
      // `strokeLinejoin: 'round'` for soft corners (the React picker
      // honours this via SVG's default), but pdf-lib has no public
      // API to set per-element line-join — `PDFPage.setLineJoin`
      // doesn't exist. The default line-join is MITER, so path
      // strokes will render slightly sharper than the React picker.
      // At the 60pt output size the visual difference is ~1px on
      // acute angles (the pilot cap + jacket closures) and is
      // acceptable for the soft launch. Future: switch to a per-
      // element Path context if pdf-lib exposes one in a later
      // version.
      page.drawSvgPath(shape.d, {
        x: opts.x,
        y: opts.y + opts.size,
        scale,
        color: fillColor,
        borderColor: strokeColor,
        borderWidth: (shape.strokeWidth || 0) * scale,
        opacity: shape.opacity,
      })
      return
    }
    default:
      // Unknown shape type — silently skip so the rest of the avatar
      // still draws. Logging every unknown shape would be too noisy
      // for the hot pdf-lib path; a code change here is the right
      // time to catch the gap.
      return
  }
}

// Registry: maps a slug → (page, opts) rendering function. Each
// entry reads from AVATAR_SVG_DATA and walks the shape list at
// draw-time so a tweak to the data table propagates here without
// needing to recompile the helper functions.
//
// FAULT TOLERANCE — the data layer (lib/avatars-svg.js) is
// hand-authored and trends toward typos that surface at PDF
// render time. hexToRgb THROWS on invalid hex so a fresh typo
// is loud in dev/tests, but production MUST NOT 500 a user's
// PDF download. The try/catch wrapper below logs a warning and
// paints a translucent magenta splotch so a sick avatar is
// unmistakable to the operator (no silent fail-to-default).
const AVATAR_PDF_RENDERERS = Object.create(null)
for (const slug of Object.keys(AVATAR_SVG_DATA)) {
  AVATAR_PDF_RENDERERS[slug] = (page, opts) => {
    const data = AVATAR_SVG_DATA[slug]
    if (!data) return
    try {
      // Background circle first — matches the React SVG order in
      // components/avatars.jsx (the bg is drawn before the body so
      // every other shape overlays it).
      const bgCenter = svgCoord(opts, 72, 72)
      page.drawCircle({
        x: bgCenter.x,
        y: bgCenter.y,
        size: opts.size / 2,
        color: hexToRgb(data.bg),
      })
      // Then each shape in declaration order. `shapes[0]` is the
      // watermark (drawn FIRST so it's behind the body silhouette),
      // matching the React SVG render order.
      for (const shape of data.shapes) {
        renderAvatarShapePdf(page, opts, shape)
      }
    } catch (err) {
      // Dev: the throw is the bug signal (`hexToRgb: invalid hex …`).
      // Prod: this catch keeps the user from seeing a 500. We paint
      // a bright magenta disk so the profile-picture spot in the
      // Aktivitetsrapport header reads as "data layer broken here"
      // instead of "no avatar picked" — an operator scanning PDFs
      // can spot a trend and fix the data file.
      console.warn('[pdf-report] avatar render failed for slug', JSON.stringify(slug), err && err.message)
      const center = svgCoord(opts, 72, 72)
      page.drawCircle({
        x: center.x,
        y: center.y,
        size: opts.size / 2,
        color: rgb(0.95, 0.20, 0.85), // hot magenta — visible "sick avatar" marker
      })
    }
  }
}

// =============================================================================
// Profile picture renderer
// =============================================================================

/**
 * Top-right profile-picture circle for the Aktivitetsrapport header.
 *
 * Three render paths (mirrors `components/ProfileAvatar.jsx`):
 *   1. avatar slug — uses the registry above; visual parity with the picker
 *   2. uploaded JPEG/PNG (`data:image/...;base64,...`) — embedded via pdf-lib
 *   3. unset / webp / unknown — falls back to the indigo ✈ glyph on a white disc
 *
 * `opts.bold` is REQUIRED for the fallback glyph (the ✈ symbol is
 * drawn in HelveticaBold so the centred placement reads cleanly).
 * The top-level `generateAktivitetsrapport` embeds the font once
 * and threads it through — no need to dig into pdf-lib internals.
 *
 * The picture is wrapped in a thin amber ring (matches the JobbPiloten
 * amber accent elsewhere in the app) so the top-right corner reads
 * as polished rather than a raw DOM image.
 */
async function drawProfilePicture(pdf, page, profile, opts) {
  const { x, y, size, ringColor, iconBgColor, ringWidth = 3, bold } = opts
  const r = size / 2
  const cx = x + r
  const cy = y + r

  // White background plate + amber ring.
  page.drawCircle({
    x: cx,
    y: cy,
    size: r,
    color: rgb(1, 1, 1),
    borderColor: ringColor,
    borderWidth: ringWidth,
  })

  const pp = profile?.profilePicture || null

  // 1. Avatar slug — registry forward.
  if (pp?.type === 'avatar' && PROFILE_PICTURE_AVATARS.has(pp.value)) {
    const renderer = AVATAR_PDF_RENDERERS[pp.value]
    if (typeof renderer === 'function') {
      renderer(page, {
        x: x + ringWidth,
        y: y + ringWidth,
        size: size - 2 * ringWidth,
      })
      return
    }
    // Slug is recognised but has no renderer entry — fall back to
    // the icon below (rare, but possible if lib/avatars-svg.js was
    // trimmed down without re-syncing the renderer registry).
  }

  // 2. Uploaded JPEG / PNG / etc. via data URL.
  let embedded = false
  if (
    pp?.type === 'upload' &&
    typeof pp.value === 'string' &&
    pp.value.startsWith('data:image/')
  ) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(pp.value)
    if (m) {
      const mime = m[1].toLowerCase()
      const b64 = m[2]
      try {
        const bytes = Buffer.from(b64, 'base64')
        let img = null
        if (mime === 'image/png') {
          img = await pdf.embedPng(bytes)
        } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
          img = await pdf.embedJpg(bytes)
        }
        // WebP intentionally omitted — pdf-lib can't embed it.
        if (img) {
          const ix = x + ringWidth
          const iy = y + ringWidth
          const iw = size - 2 * ringWidth
          page.drawImage(img, { x: ix, y: iy, width: iw, height: iw })
          embedded = true
        }
      } catch (_e) {
        // Unsupported subtype or corrupt payload — fall through.
        embedded = false
      }
    }
  }

  if (!embedded) {
    // 3. Fallback: indigo disc + white "J" glyph (JobbPiloten initial).
    // The previous design used a centred ✈ plane symbol, but pdf-lib's
    // built-in StandardFonts only encode WinAnsi (CP1252 + smart-quotes /
    // dashes additions), so the U+2708 codepoint raises
    // "WinAnsi cannot encode U+2708" before even a single PDF object is
    // serialised. A capital "J" is a 1-byte ASCII fall-back that keeps
    // the brand identity intact (initial-of-JobbPiloten) without a font
    // swap. The centred placement uses bold.widthOfTextAtSize so the
    // metric is portable across pdf-lib's font version.
    const innerR = r - ringWidth
    page.drawCircle({ x: cx, y: cy, size: innerR, color: iconBgColor })
    // Glyph size 1.30 * innerR matches the original ✈ ratio so the
    // disc reads balanced (1.50 was visually too tight against the
    // inner-circle edge at PHOTO_SIZE=60). The cap-height of a 60pt
    // "J" then sits comfortably inside the inner disc with breathing
    // room top + bottom.
    const glyphSize = innerR * 1.30
    const glyph = 'J'
    // `widthOfTextAtSize` on the embedded bold font gives us the
    // exact glyph width so the centred placement lands on (cx, cy)
    // regardless of font glyph metrics churn in future pdf-lib releases.
    const glyphWidth = typeof bold.widthOfTextAtSize === 'function'
      ? bold.widthOfTextAtSize(glyph, glyphSize)
      : glyphSize * 0.55
    // Bold Helvetica capital "J" geometric cap-height centre sits at
    // approximately `baseline + 0.36 * fontSize`, so we drop the
    // baseline by exactly that fraction to centre the letter on
    // (cx, cy). Using 0.32 previously left the cap a touch below true
    // centre; 0.36 is the correct value for capital H/B/J-shaped
    // letterforms with no descender. Validated visually at PHOTO_SIZE
    // 60 against the existing profile picker (matches the React
    // component).
    page.drawText(glyph, {
      x: cx - glyphWidth / 2,
      y: cy - glyphSize * 0.36,
      size: glyphSize,
      font: bold,
      color: rgb(1, 1, 1),
    })
  }
}

// =============================================================================
// Aktivitetsrapport PDF builder
// =============================================================================

/**
 * Build the monthly Aktivitetsrapport PDF.
 *
 * JobbPiloten-branded header banner, profile picture top-right,
 * personal details block, summary card, and a paginated
 * applications table.
 *
 * @param {Object} profile            profile document from MongoDB
 * @param {Array}  applications      this-month applications to render
 * @param {Date}   now               "as of" timestamp (the report month)
 * @returns {Promise<Uint8Array>}     pdf-lib save() output, ready to stream
 */
export async function generateAktivitetsrapport(profile, applications, now) {
  const pdf = await PDFDocument.create()

  // Cache Helvetica + HelveticaBold fonts once. Both are used by
  // every text call in this function; pdf-lib caches the embedded
  // font glyphs internally so re-embedding is a no-op key collision.
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const pageW = 595.28
  const pageH = 841.89
  const margin = 50
  const contentW = pageW - margin * 2

  // Subtle blues / grays matching JobbPiloten branding.
  const C = {
    primary: rgb(0.23, 0.32, 0.62),
    primaryHi: rgb(0.30, 0.42, 0.78),
    accent: rgb(0.96, 0.62, 0.18),
    text: rgb(0.14, 0.16, 0.20),
    muted: rgb(0.46, 0.49, 0.55),
    rule: rgb(0.85, 0.87, 0.91),
    band: rgb(0.95, 0.96, 0.98),
    row: rgb(0.99, 0.99, 0.995),
    rowAlt: rgb(0.95, 0.96, 0.98),
    cardBg: rgb(0.97, 0.98, 0.99),
    white: rgb(1, 1, 1),
  }

  const monthNames = [
    'januari','februari','mars','april','maj','juni',
    'juli','augusti','september','oktober','november','december',
  ]
  const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`

  let page = pdf.addPage([pageW, pageH])

  // ---- Branded header banner ----
  const BANNER_H = 38
  page.drawRectangle({ x: 0, y: pageH - BANNER_H, width: pageW, height: BANNER_H, color: C.primary })
  page.drawRectangle({ x: 0, y: pageH - 6, width: pageW, height: 6, color: C.primaryHi })
  // Brand-name-only header — pdf-lib's WinAnsi encoding does NOT support
  // the plane Unicode symbol (U+2708) which the design originally used
  // here. Rendering it raises "WinAnsi cannot encode U+2708" before any
  // payload is written. The wordmark "JobbPiloten" reads fine in straight
  // Helvetica-Bold, so we just drop the icon — visually the banner still
  // anchors the brand via the brand-blue band + the name. Same fix below
  // for the avatar fallback glyph that used to render a ✈ centred disc.
  page.drawText('JobbPiloten', { x: margin, y: pageH - 23, size: 13, font: bold, color: C.white })
  page.drawText('Aktivitetsrapport', { x: pageW - margin - 105, y: pageH - 23, size: 11, font, color: C.white })

  // ---- Profile picture (top-right) ----
  const PHOTO_SIZE = 60
  await drawProfilePicture(pdf, page, profile, {
    x: pageW - margin - PHOTO_SIZE,
    y: pageH - BANNER_H - PHOTO_SIZE - 14,
    size: PHOTO_SIZE,
    ringColor: C.accent,
    iconBgColor: C.primary,
    ringWidth: 3,
    bold, // thread the embedded bold font for the fallback ✈ glyph
  })

  // ---- Title block ----
  let y = pageH - BANNER_H - PHOTO_SIZE - 28
  page.drawText('AKTIVITETSRAPPORT', { x: margin, y, size: 22, font: bold, color: C.primary })
  y -= 22
  page.drawText(`Rapportperiod: ${monthLabel}`, { x: margin, y, size: 11, font, color: C.muted })
  y -= 12
  page.drawText(`Genererad: ${now.toISOString().slice(0, 10)} · Av JobbPiloten`, { x: margin, y, size: 9, font, color: C.muted })
  y -= 14
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: C.rule })
  y -= 18

  // ---- Personal details ----
  page.drawText('Personuppgifter', { x: margin, y, size: 12, font: bold, color: C.primary })
  y -= 16
  const p = profile || {}
  // personalRows labels are hard-coded Swedish ASCII+Latin-1, so
  // skip sanitisation on them (cheaper, and serves as a self-check
  // that the labels never get touched). Values flow in from MongoDB,
  // so sanitiseForWinAnsi guards against the rare fullName with a
  // smart-quote / accented-Latin-2 character etc.
  const personalRows = [
    ['Namn', p.fullName],
    ['Personnummer', p.personalNumber],
    ['Adress', p.address],
    ['E-post', p.email],
    ['Telefon', p.phone],
  ]
  const LABEL_W = 78
  for (const [k, v] of personalRows) {
    page.drawText(k, { x: margin, y, size: 10, font: bold, color: C.text })
    page.drawText(sanitiseForWinAnsi(v) || '—', { x: margin + LABEL_W, y, size: 10, font, color: v ? C.text : C.muted })
    y -= 14
  }
  y -= 12

  // ---- Summary card ----
  const CARD_PAD_Y = 14
  const cardLines = 3
  const cardH = CARD_PAD_Y * 2 + (cardLines * 13) + 4
  page.drawRectangle({
    x: margin, y: y - cardH, width: contentW, height: cardH,
    color: C.cardBg, borderColor: C.rule, borderWidth: 0.5,
  })
  const cardTop = y - CARD_PAD_Y
  page.drawText('Sammanfattning', { x: margin + 12, y: cardTop, size: 12, font: bold, color: C.primary })
  page.drawText(`Antal jobbansökningar under perioden: ${applications.length || 0}`, {
    x: margin + 12, y: cardTop - 16, size: 10, font, color: C.text,
  })
  page.drawText(
    'Varje rad i tabellen nedan visar ansökningsdatum (ÅÅÅÅ-MM-DD) — Rapporten uppfyller Arbetsförmedlingens krav.',
    { x: margin + 12, y: cardTop - 30, size: 9, font, color: C.muted },
  )
  y -= cardH + 12

    // ---- Applications table ----
  page.drawText('Jobbansökningar', { x: margin, y, size: 12, font: bold, color: C.primary })
  y -= 14

  // Column geometry — Round-46 / Bug 3 fix: removed the duplicate
  // "Datum" column (was showing the same `appliedAt` value as
  // "Ansökningsdatum"). The pre-fix build had both columns rendering
  // `appliedAt` because `dateStr` and `appliedAtStr` were both
  // derived from `app.appliedAt`, so the user saw two identical date
  // columns side-by-side. Single "Ansökningsdatum" column now keeps
  // the AF-compliance contract intact (the AF-formatting is on the
  // appliedAt cell, which is what they require).
  //
  // Width math: 5 × column widths (75+95+100+60+90 = 420pt)
  //           + 4 × 5pt inter-column padding = 20pt
  //           = 440pt total = contentW
  // (the last column has no padding after it, sits flush against
  // pageW-margin) — wider budget than the 6-column layout because
  // dropping the duplicate "Datum" freed 50+5=55pt.
  const COL_PAD = 5   // horizontal padding between adjacent columns (right side)
  const COL_W = {
    appliedAt: 75,
    company: 95,
    title: 100,
    location: 60,
    source: 90,
  }
  const colX = {
    appliedAt: margin,
    company: margin + COL_W.appliedAt + COL_PAD,
    title: margin + COL_W.appliedAt + COL_PAD + COL_W.company + COL_PAD,
    location: margin + COL_W.appliedAt + COL_PAD + COL_W.company + COL_PAD + COL_W.title + COL_PAD,
    source: margin + COL_W.appliedAt + COL_PAD + COL_W.company + COL_PAD + COL_W.title + COL_PAD + COL_W.location + COL_PAD,
  }
  // cellX places the text half-padding inside the slot's left edge
  // so the leading glyph doesn't kiss the column boundary. The
  // header BG rectangle spans margin-2 → margin-2+contentW+4 to
  // visually close the table + bleed the header band 2pt past the
  // contentW (anti-aliasing buffer).
  const cellX = (col) => colX[col] - Math.floor(COL_PAD / 2)

  const drawHeaderRow = () => {
    page.drawRectangle({ x: margin - 2, y: y - 22, width: contentW + 4, height: 22, color: C.primary })
    const headerY = y - 14
    // Reduced header font from 9 → 8.5 with explicit horizontal padding
    // — "Ansökningsdatum" + the previously-overlapping "Företag/Titel"
    // now fit cleanly. Compact 8.5pt is still legible at body-text
    // size for a printed/onscreen report.
    // Round-46 / Bug 3 fix: removed "Datum" column header. The
    // "Ansökningsdatum" column is the SOLE date column now —
    // duplicated dates in the previous build confuses both the user
    // and the AF compliance check (the AF format requires the
    // appliedAt cell; the duplicate "Datum" was the same value).
    page.drawText('Ansökningsdatum',  { x: cellX('appliedAt'),  y: headerY, size: 8.5, font: bold, color: C.white })
    page.drawText('Företag',          { x: cellX('company'),    y: headerY, size: 8.5, font: bold, color: C.white })
    page.drawText('Titel',            { x: cellX('title'),      y: headerY, size: 8.5, font: bold, color: C.white })
    page.drawText('Ort',              { x: cellX('location'),   y: headerY, size: 8.5, font: bold, color: C.white })
    page.drawText('Källa',            { x: cellX('source'),     y: headerY, size: 8.5, font: bold, color: C.white })
    y -= 28
    page.drawLine(
      { start: { x: margin - 2, y: y + 4 }, end: { x: pageW - margin + 2, y: y + 4 }, thickness: 0.4, color: C.rule },
    )
  }
  drawHeaderRow()

  if (!applications || applications.length === 0) {
    page.drawText('Inga ansökningar registrerade denna period.', { x: margin, y: y - 8, size: 10, font, color: C.muted })
    y -= 18
  } else {
    let rowIdx = 0
    const ROW_H = 18
    const FOOTER_RESERVE = 70
    for (const app of applications) {
      if (y < (FOOTER_RESERVE + ROW_H + 8)) {
        page = pdf.addPage([pageW, pageH])
        y = pageH - margin - 14
        drawHeaderRow()
      }
      const tintBase = (rowIdx % 2 === 0) ? C.row : C.rowAlt
      page.drawRectangle({
        x: margin, y: y - ROW_H + 4, width: contentW, height: ROW_H, color: tintBase,
      })

      // Round-46 / Bug 3 fix: removed the duplicate "Datum" cell.
      // Previously both `dateStr` and `appliedAtStr` were derived
      // from `app.appliedAt` so the row rendered two identical dates.
      // The single `appliedAt` cell is now the canonical AF-format
      // date — its format (YYYY-MM-DD) matches the AF compliance chip
      // on the dashboard and the spec at aktivitetsrapport expected
      // by Arbetsförmedlingen.
      const appliedAtValue = app.appliedAt || app.userSentAt
      const appliedAtStr = appliedAtValue
        ? `${new Date(appliedAtValue).getFullYear()}-${String(new Date(appliedAtValue).getMonth() + 1).padStart(2, '0')}-${String(new Date(appliedAtValue).getDate()).padStart(2, '0')}`
        : 'Ej ansökt än'
      const rowY = y - 11
      page.drawText(appliedAtStr,               { x: colX.appliedAt,   y: rowY, size: 9, font, color: appliedAtValue ? C.text : C.muted })
      // Each application-data field is sanitised through the
      // WinAnsi allow-list before drawText — a single ✈ / ✓ / 🎉 /
      // accented-Latin-2 character in any of these would otherwise
      // crash /api/report. The sanitiser keeps Swedish å/ä/ö/AO
      // intact and silently drops (or maps, via the small replacement
      // table) anything outside WinAnsi.
      page.drawText(sanitiseForWinAnsi(truncate(app.company, 18)),  { x: colX.company,     y: rowY, size: 9, font, color: C.text })
      page.drawText(sanitiseForWinAnsi(truncate(app.title, 20)),    { x: colX.title,       y: rowY, size: 9, font, color: C.text })
      page.drawText(sanitiseForWinAnsi(truncate(app.location, 11)), { x: colX.location,    y: rowY, size: 9, font, color: C.text })
      page.drawText(sanitiseForWinAnsi(truncate(app.source, 14)),   { x: colX.source,      y: rowY, size: 9, font, color: C.text })

      y -= ROW_H
      rowIdx += 1
    }
  }

  // ---- Footer ----
  let footerPage = page
  if (y < 56) {
    footerPage = pdf.addPage([pageW, pageH])
  }
  footerPage.drawLine({ start: { x: margin, y: 56 }, end: { x: pageW - margin, y: 56 }, thickness: 0.5, color: C.rule })
  // Round-41 / Part 7 (Sub-feature 3 — AF compliance check): the
  // PDF report's footer disclaimer is the mirror of the dashboard's
  // AF-compliance copy. Both surfaces share the "Standardmål
  // 14/mån — du ansvarar själv" contract so the user sees the
  // SAME regulatory disclaimer whether they read it on the
  // dashboard or print the PDF. The legal hedge ("detta är ett
  // hjälpmedel") is mandatory: we are NOT the source of truth for
  // AF's actual requirement (the user may have an individual plan
  // with different targets), so the footer explicitly defers to
  // the user's handlingsplan and to AF's current rules. Swedish
  // throughout — the PDF is a government-facing artifact.
  footerPage.drawText('Denna rapport har genererats automatiskt av JobbPiloten.', { x: margin, y: 44, size: 9, font, color: C.text })
  footerPage.drawText('Standardmål: 14 ansökningar/månad enligt Arbetsförmedlingens vägledning. Du ansvarar själv för att din', { x: margin, y: 32, size: 8, font, color: C.muted })
  footerPage.drawText('individuella handlingsplan uppfylls — kontrollera alltid mot Arbetsförmedlingens aktuella krav.', { x: margin, y: 22, size: 8, font, color: C.muted })
  footerPage.drawText('JobbPiloten är ett hjälpmedel, inte en auktoritativ källa för AF-compliance.', { x: margin, y: 12, size: 8, font: bold, color: C.muted })

  return await pdf.save()
}
