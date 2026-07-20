/**
 * lib/avatars-svg.js
 *
 * Single source of truth for the 5 avatar silhouettes that are ported
 * between the React SVG component layer (`components/avatars.jsx`)
 * and the Aktivitetsrapport PDF layer (`lib/pdf-report.js`).
 *
 * DRIFT GUARD — IMPORTANT FOR SOFT-LAUNCH:
 *   The 5 PDF-supported silhouettes declared below REPLICATE the
 *   paths/circles/ellipses in `components/avatars.jsx` (the React
 *   `<Piloten>`, `<Navigatorn>`, `<Strategen>`, `<Upptackaren>`,
 *   `<Kaptenen>` components). The two renderers are NOT yet
 *   consolidated into one source — the React components stay
 *   inline-JSX so they don't lose `'use client'` boundary clarity.
 *
 *   When editing a silhouette BELOW you MUST also edit the matching
 *   React component in `components/avatars.jsx`. The drift here is
 *   intentional post-launch work; until then, a `bg`/`fill`/`stroke`
 *   change should land in BOTH files in the same commit.
 *
 *   For non-PDF-supported avatars (the other 11 of the 16 React
 *   components), there's nothing to sync here — they don't appear
 *   in the Aktivitetsrapport PDF, so their data only lives in the
 *   React component.
 *
 * Both renderers read the same shape list, so a tweak to Piloten's hat
 * shows up in BOTH the picker grid AND the user's monthly report PDF
 * the moment the data file is updated. The other 11 avatar slugs
 * (ingenjören, kreatören, utforskaren, byggaren, forskaren, konstnären,
 * mentorn, hjalten, innovatören, visionären, mystikern) are not
 * included here because the soft-launch spec only requires PDF
 * rendering for the 5 most-popular characters — the rest fall back
 * to the JobbPiloten pilot ✈ symbol in both the picker-cropped image
 * and the PDF.
 *
 * Render-neutral data shape. Each avatar:
 *   - `bg`:    background-circle fill (hex string)
 *   - `shapes`: ordered list of shape primitives, with optional
 *              `transform` / `opacity` props for React-only effects
 *              (the PDF renderer silently drops unsupported keys so
 *              the shape stays visible without rotating).
 *
 * Shape types referenced by both renderers:
 *   - circle   ({ cx, cy, r, fill?, stroke?, strokeWidth?, opacity? })
 *   - ellipse  ({ cx, cy, rx, ry, fill?, stroke?, strokeWidth?, opacity? })
 *   - rect     ({ x, y, width, height, fill?, stroke?, strokeWidth?, opacity? })
 *   - line     ({ x1, y1, x2, y2, stroke?, strokeWidth?, opacity? })
 *   - path     ({ d, fill?, stroke?, strokeWidth?, strokeLinecap?, strokeLinejoin?, opacity? })
 *   - watermark (sentinel for the small JobbPiloten plane — both renderers substitute it)
 *
 * Render-neutral color contract: every `fill` / `stroke` / `background`
 * field is a hex string ("#rrggbb"). Both renderers parse hex → their
 * runtime representation; the data layer doesn't care which.
 *
 * Render-neutral coord contract: every x / y / r / etc. value lives in
 * the SVG's `viewBox 0 0 144 144` coordinate space. The React renderer
 * passes through unchanged (its SVG element already declares that viewBox);
 * the PDF renderer scales by `size / 144` and flips the y-axis so pdf-lib
 * (which is y-up) renders at the same visual position.
 *
 * The set is locked by `tests/unit/avatars-svg.test.mjs`. Adding a
 * 6th avatar = adding the entry here + refactoring `components/avatars.jsx`
 * + adding a PDF renderer call in `AVATAR_PDF_RENDERERS`.
 */

export const SKIN_TONE = '#fde7c8'
export const OUTLINE_DARK = '#0f172a'

// -------- 1. Piloten (amber bg) ----
// Pilot cap + sunglasses + flight jacket. The original JobbPiloten look.
export const PILOTEN_SVG = {
  bg: '#fbbf24',
  shapes: [
    { type: 'watermark' },
    // pilot cap
    { type: 'path', d: 'M48 56 Q48 30 72 30 Q96 30 96 56 L98 60 L46 60 Z',
      fill: OUTLINE_DARK, stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // visor band
    { type: 'rect', x: 46, y: 58, width: 52, height: 5,
      fill: '#1e293b', stroke: OUTLINE_DARK, strokeWidth: 2 },
    // head
    { type: 'circle', cx: 72, cy: 62, r: 22,
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2 },
    // aviator sunglasses
    { type: 'ellipse', cx: 63, cy: 62, rx: 7, ry: 5, fill: OUTLINE_DARK },
    { type: 'ellipse', cx: 81, cy: 62, rx: 7, ry: 5, fill: OUTLINE_DARK },
    { type: 'line', x1: 69, y1: 62, x2: 75, y2: 62,
      stroke: OUTLINE_DARK, strokeWidth: 2 },
    // glints
    { type: 'circle', cx: 61, cy: 60, r: 1.4, fill: '#fef9c3' },
    { type: 'circle', cx: 79, cy: 60, r: 1.4, fill: '#fef9c3' },
    // smile
    { type: 'path', d: 'M66 74 Q72 78 78 74',
      fill: 'none', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinecap: 'round' },
    // body flight jacket
    { type: 'path', d: 'M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z',
      fill: '#1e293b', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // shirt collar
    { type: 'path', d: 'M58 84 L72 100 L86 84 Z',
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // stripe accent
    { type: 'rect', x: 36, y: 106, width: 22, height: 3, fill: '#fef9c3' },
  ],
}

// -------- 2. Navigatören (cyan bg) ----
// Explorer hat + compass.
export const NAVIGATORN_SVG = {
  bg: '#22d3ee',
  shapes: [
    { type: 'watermark' },
    // hat brim
    { type: 'ellipse', cx: 72, cy: 48, rx: 34, ry: 7,
      fill: '#7c2d12', stroke: OUTLINE_DARK, strokeWidth: 2 },
    // hat top
    { type: 'path', d: 'M52 48 Q72 28 92 48 Z',
      fill: '#92400e', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // hat band
    { type: 'rect', x: 46, y: 46, width: 52, height: 4,
      fill: '#451a03', stroke: OUTLINE_DARK, strokeWidth: 1.5 },
    // head
    { type: 'circle', cx: 72, cy: 64, r: 20,
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2 },
    // eyes
    { type: 'circle', cx: 65, cy: 64, r: 2, fill: OUTLINE_DARK },
    { type: 'circle', cx: 79, cy: 64, r: 2, fill: OUTLINE_DARK },
    // smile
    { type: 'path', d: 'M67 73 Q72 76 77 73',
      fill: 'none', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinecap: 'round' },
    // explorer jacket
    { type: 'path', d: 'M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z',
      fill: '#134e4a', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // shirt collar
    { type: 'path', d: 'M58 84 L72 100 L86 84 Z',
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // compass body
    { type: 'circle', cx: 72, cy: 110, r: 13,
      fill: '#fef3c7', stroke: OUTLINE_DARK, strokeWidth: 2 },
    // compass centre dot
    { type: 'circle', cx: 72, cy: 110, r: 3, fill: OUTLINE_DARK },
    // compass needle
    { type: 'path', d: 'M72 100 L75 110 L72 120 L69 110 Z',
      fill: '#dc2626', stroke: OUTLINE_DARK, strokeWidth: 1 },
  ],
}

// -------- 3. Strategen (royal-blue bg) ----
// Slicked hair + tie + chess-queen silhouette.
export const STRATEGEN_SVG = {
  bg: '#2563eb',
  shapes: [
    { type: 'watermark' },
    // slicked hair
    { type: 'path', d: 'M54 56 Q56 32 72 32 Q88 32 90 56 Q88 50 82 50 L62 50 Q56 50 54 56 Z',
      fill: OUTLINE_DARK, stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // head
    { type: 'circle', cx: 72, cy: 64, r: 20,
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2 },
    // eyes — focused
    { type: 'line', x1: 62, y1: 64, x2: 69, y2: 64,
      stroke: OUTLINE_DARK, strokeWidth: 3, strokeLinecap: 'round' },
    { type: 'line', x1: 75, y1: 64, x2: 82, y2: 64,
      stroke: OUTLINE_DARK, strokeWidth: 3, strokeLinecap: 'round' },
    // determined mouth
    { type: 'line', x1: 68, y1: 74, x2: 76, y2: 74,
      stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinecap: 'round' },
    // suit body
    { type: 'path', d: 'M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z',
      fill: '#1e3a8a', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // shirt
    { type: 'path', d: 'M58 84 L72 110 L86 84 Z',
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // tie
    { type: 'path', d: 'M68 96 L72 100 L76 96 L78 116 L72 122 L66 116 Z',
      fill: '#fef3c7', stroke: OUTLINE_DARK, strokeWidth: 1.5, strokeLinejoin: 'round' },
  ],
}

// -------- 4. Upptäckaren (violet bg) ----
// Bowler hat + magnifier.
export const UPPTACKAREN_SVG = {
  bg: '#a855f7',
  shapes: [
    { type: 'watermark' },
    // bowler brim
    { type: 'ellipse', cx: 72, cy: 42, rx: 28, ry: 6,
      fill: '#1e293b', stroke: OUTLINE_DARK, strokeWidth: 2 },
    // bowler top
    { type: 'path', d: 'M52 42 Q52 28 72 28 Q92 28 92 42 Z',
      fill: '#1e293b', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // head
    { type: 'circle', cx: 72, cy: 64, r: 20,
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2 },
    // squinting eyes
    { type: 'ellipse', cx: 65, cy: 64, rx: 2.5, ry: 3, fill: OUTLINE_DARK },
    { type: 'ellipse', cx: 79, cy: 64, rx: 2.5, ry: 3, fill: OUTLINE_DARK },
    // smile
    { type: 'path', d: 'M67 73 Q72 75 77 73',
      fill: 'none', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinecap: 'round' },
    // vest body
    { type: 'path', d: 'M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z',
      fill: '#312e81', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // shirt collar
    { type: 'path', d: 'M58 84 L72 100 L86 84 Z',
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // bow tie
    { type: 'path', d: 'M66 100 L72 96 L78 100 L72 104 Z',
      fill: '#fef3c7', stroke: OUTLINE_DARK, strokeWidth: 1.5 },
    // magnifier outer ring (no fill)
    { type: 'circle', cx: 50, cy: 110, r: 11,
      fill: 'none', stroke: OUTLINE_DARK, strokeWidth: 3 },
    // magnifier lens
    { type: 'circle', cx: 50, cy: 110, r: 6, fill: '#bae6fd', opacity: 0.7 },
    // magnifier handle
    { type: 'line', x1: 58, y1: 118, x2: 68, y2: 128,
      stroke: OUTLINE_DARK, strokeWidth: 4, strokeLinecap: 'round' },
  ],
}

// -------- 5. Kaptenen (indigo bg) ----
// Captain hat + star badge + naval uniform.
export const KAPTENEN_SVG = {
  bg: '#4f46e5',
  shapes: [
    { type: 'watermark' },
    // captain hat brim
    { type: 'path', d: 'M50 50 Q50 30 72 30 Q94 30 94 50 L98 56 L46 56 Z',
      fill: '#1e1b4b', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // gold band
    { type: 'rect', x: 46, y: 54, width: 52, height: 5,
      fill: '#fbbf24', stroke: OUTLINE_DARK, strokeWidth: 1.5 },
    // star badge (filled gold)
    { type: 'circle', cx: 72, cy: 42, r: 4.5,
      fill: '#fbbf24', stroke: OUTLINE_DARK, strokeWidth: 1.5 },
    // star centre dot
    { type: 'circle', cx: 72, cy: 42, r: 1.5, fill: '#1e1b4b' },
    // head
    { type: 'circle', cx: 72, cy: 64, r: 20,
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2 },
    // focused eyes
    { type: 'line', x1: 62, y1: 64, x2: 69, y2: 64,
      stroke: OUTLINE_DARK, strokeWidth: 3, strokeLinecap: 'round' },
    { type: 'line', x1: 75, y1: 64, x2: 82, y2: 64,
      stroke: OUTLINE_DARK, strokeWidth: 3, strokeLinecap: 'round' },
    // beard stubble
    { type: 'path', d: 'M58 72 Q72 86 86 72 Q72 78 58 72 Z',
      fill: '#1e293b', opacity: 0.7 },
    // smile
    { type: 'path', d: 'M67 74 Q72 77 77 74',
      fill: 'none', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinecap: 'round' },
    // naval uniform body
    { type: 'path', d: 'M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z',
      fill: '#1e1b4b', stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // shirt collar
    { type: 'path', d: 'M58 84 L72 100 L86 84 Z',
      fill: SKIN_TONE, stroke: OUTLINE_DARK, strokeWidth: 2, strokeLinejoin: 'round' },
    // gold stripes
    { type: 'rect', x: 36, y: 100, width: 20, height: 3,
      fill: '#fbbf24', stroke: OUTLINE_DARK, strokeWidth: 1 },
    { type: 'rect', x: 36, y: 106, width: 20, height: 3,
      fill: '#fbbf24', stroke: OUTLINE_DARK, strokeWidth: 1 },
  ],
}

/**
 * Public registry of the 5 PDF-supported avatar slugs. Keys here MUST
 * match the corresponding key in `lib/avatar-keys.js`'s AVATAR_KEYS
 * array — the profile-picture validator rejects unknown slugs, so
 * adding a 6th entry here must be paired with adding the slug to
 * AVATAR_KEYS before the soft launch.
 *
 * Cross-checked by `tests/unit/avatars-svg.test.mjs`:
 *   1. Every key here is in AVATAR_KEYS.
 *   2. Every entry exposes a `bg` hex string and a non-empty `shapes` array.
 *   3. Every shape primitive has the required keys per its `type`.
 */
export const AVATAR_SVG_DATA = {
  piloten:     PILOTEN_SVG,
  navigatören: NAVIGATORN_SVG,
  strategen:   STRATEGEN_SVG,
  upptäckaren: UPPTACKAREN_SVG,
  kaptenen:    KAPTENEN_SVG,
}

/**
 * The watermark SVG-path (the tiny JobbPiloten plane drawn at the
 * bottom-right of every figure). Exported as a constant so React and
 * PDF both render the same shape.
 *
 * React renders with `transform="translate(112 116) rotate(-30)"`
 * for the -30° tilt. PDF can't rotate per-glyph cheaply, so PDF
 * renders without the tilt (the missing -30° is visually negligible
 * at the 60pt output size — ~1.5pt of glyph height out of place).
 */
export const WATERMARK_REACT_PATH = 'M0 0 L20 6 L4 9 L8 5 Z'
export const WATERMARK_REACT_TAIL = 'M8 5 L 20 6'
export const WATERMARK_PDF_PATH = 'M112 116 L132 122 L116 125 L120 121 Z'
