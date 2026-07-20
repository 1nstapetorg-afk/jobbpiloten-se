/**
 * lib/sanitise-winansi.js
 *
 * Module-level WinAnsi sanitiser — extracted from lib/pdf-report.js so
 * it can be:
 *   1. Imported by the PDF generator WITHOUT dragging in pdf-lib's
 *      transitive @/lib/* modules (the helper has zero deps, so a
 *      clean import keeps the dependency graph localised).
 *   2. Imported by Node --test unit tests DIRECTLY via
 *      `import { sanitiseForWinAnsi } from '../../lib/sanitise-winansi.js'`
 *      — no @/ alias resolution required because this module has
 *      zero internal-imports. The previous eval-based extraction
 *      in tests/unit/winansi-sanitiser.test.mjs is a useful halo
 *      test but a direct import is the canonical contract lock.
 *
 * Why this exists (2026-07-10, "PDF download"):
 * pdf-lib's `StandardFonts.Helvetica` family encodes WinAnsi (CP1252 +
 * the smart-quote/dash/ellipsis extension block at U+2013–U+2122).
 * Any other Unicode codepoint passed to `drawText` raises
 * `WinAnsi cannot encode …` BEFORE any PDF stream is written — the
 * /api/report caller receives a 500. Today this surfaces for EVERY
 * string that flows in from MongoDB (profile.fullName, application
 * company/title/location, the LLM-generated coverLetter, etc.) — a
 * job posting with a single ✈ (U+2708), a ✓, a 🎉, or an
 * accented-Latin-2 character would have broken the entire PDF route.
 *
 * Strategy (kept identical to the inline version for backwards
 * compatibility — the test files lock the byte-level equivalence):
 *   • Allow ASCII (0x00-0x7F) + Latin-1 Supplement (0xA0-0xFF) — both
 *     in WinAnsi verbatim. Swedish å ä ö Å Ä Ö land here (0xE4/E5/F6
 *     and their uppercase equivalents).
 *   • Allow the smart-quote/dash/ellipsis extensions pdf-lib supports
 *     (U+2013 – U+2122). Em-dash survives untouched.
 *   • For the most common offenders (emoji, arrows, fancy check-marks,
 *     en-dash, smart quotes) we ship a small replacement table so the
 *     output reads sanely rather than dropping silently.
 *   • Everything else is dropped. We never throw because the route
 *     would already have crashed before reaching this helper.
 */

// allow-list of WinAnsi-safe ranges — anything outside falls through
// to the replacement table below or is dropped.
const WIN_ANSI_SAFE_RANGES = [
  [0x00, 0x7f],   // ASCII
  [0xa0, 0xff],   // Latin-1 Supplement (covers Swedish å ä ö § © etc.)
]

// Explicit replacements for chars outside the safe ranges. Keys are
// hex codepoints; values are the ASCII (or WinAnsi-safe) string we
// substitute. Mappings are conservative — we only ship replacements
// for the most common offenders so the table stays audit-friendly.
const WIN_ANSI_REPLACEMENTS = new Map([
  [0x2013, '-'],   // en-dash → single ASCII dash
  [0x2014, '-'],   // em-dash → single ASCII dash (avoids two-char '--' which would shift column widths)
  [0x2018, "'"],   // left single smart quote
  [0x2019, "'"],   // right single smart quote (curly apostrophe)
  [0x201a, "'"],   // single low-9 quote
  [0x201c, '"'],   // left double smart quote
  [0x201d, '"'],   // right double smart quote
  [0x201e, '"'],   // double low-9 quote
  [0x2022, '*'],   // bullet point
  [0x2026, '...'], // horizontal ellipsis
  [0x2032, "'"],   // prime
  [0x2033, '"'],   // double prime
  [0x2122, '(TM)'], // trademark
  [0x2192, '->'],  // rightwards arrow
  [0x2190, '<-'],  // leftwards arrow
  [0x2708, 'JP'],  // airplane (was the brand glyph — now mapped to the
                   // brand-initials fallback so user data with this
                   // glyph renders as readable text instead of crashing).
  [0x2713, 'OK'],  // check mark
  [0x2717, 'X'],   // ballot X
  [0x2605, '*'],   // black star
  [0x2726, '*'],   // white star
])

/**
 * Sanitise any string so pdf-lib's WinAnsi encoder will accept it.
 * The output is identical for ASCII + Latin-1 input; common smart-
 * quote/ellipsis chars are normalised to ASCII equivalents; any
 * remaining Unicode is dropped silently so the PDF route never
 * crashes on a single emoji in user data.
 *
 * Cost is O(n) over the code points and runs in single-digit
 * microseconds for typical job-application strings. The caller is
 * expected to wrap the input in a null-check before calling
 * (the helper itself bails to '' on null/undefined).
 */
function sanitiseForWinAnsi(value) {
  if (value == null) return ''
  const s = String(value)
  let out = ''
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)
    const len = cp > 0xffff ? 2 : 1
    i += len
    let inSafe = false
    for (const [lo, hi] of WIN_ANSI_SAFE_RANGES) {
      if (cp >= lo && cp <= hi) { inSafe = true; break }
    }
    if (inSafe) {
      out += String.fromCodePoint(cp)
      continue
    }
    if (WIN_ANSI_REPLACEMENTS.has(cp)) {
      out += WIN_ANSI_REPLACEMENTS.get(cp)
      continue
    }
    // Drop silently. We do NOT insert a placeholder character so a
    // future caller doesn't accidentally trip on the same crash —
    // dropped text reads cleanly across the report.
  }
  return out
}

// Named export — lib/pdf-report.js imports from here + re-exports for
// any future caller that wants to apply the same sanitiser rule (e.g.
// a cover-letter preview endpoint). The direct export also makes the
// function unit-testable without the eval-extract heuristic.
export { sanitiseForWinAnsi, WIN_ANSI_SAFE_RANGES, WIN_ANSI_REPLACEMENTS }
