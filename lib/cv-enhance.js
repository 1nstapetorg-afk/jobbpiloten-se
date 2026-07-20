// lib/cv-enhance.js
//
// Part 5 — CV Enhancement. Lightweight Groq-backed "Förbättra
// formulering" helper that rewrites a cvSummary in a stronger
// tone (resultatorienterad, teknisk, ledarskap).
//
// Architecture decision: this module exposes TWO surfaces:
//   1. enhanceCvSummaryPure(summary, focus) — no-network rule-based
//      rewriter that ALWAYS succeeds. Used as the offline fallback.
//   2. enhanceCvSummaryGroq(summary, focus) — Groq-backed, returns
//      a Promise. Used when the env has GROQ_API_KEY.
//
// The settings page calls enhanceCvSummaryGroq; on failure it
// falls back to enhanceCvSummaryPure so the user always gets an
// improved version (the rule-based rewriter is conservative but
// solid — adds concrete bullet structure, removes filler, focuses
// on a chosen theme).

import { generateText } from './groq.js'

// ---- Pure offline enhancer ----
//
// Three "focus" modes map to bullet style + lead verb catalogue.
// The rewriter is intentionally non-creative — it restructures
// what the user wrote rather than inventing new content. This
// avoids hallucinated CV entries and keeps the "Granska"
// affordance honest.

const FOCUS_LEAD_VERBS = {
  resultat: ['Levererade', 'Ökade', 'Minskade', 'Höjde', 'Sänkte', 'Genererade'],
  teknisk: ['Byggde', 'Implementerade', 'Optimerade', 'Arkiterade', 'Utvecklade', 'Designade'],
  // Round-46: verb normalisation — "Coachte" → "Coachade",
  // "Mentorskade" → "Mentorerade". Both are now correctly formed
  // Swedish past-tense verbs (att coacha → coachade; att mentora →
  // mentorerade). The earlier forms were non-standard Swedish and
  // would read as "happened to coach / mentor" rather than past
  // tense. The strong-verb regex in `makeBullet()` matches both
  // old + new forms so a hypothetical legacy CV summary still
  // passes the "double-prefix guard" — the contract is preserved.
  ledarskap: ['Ledde', 'Coachade', 'Samordnade', 'Drev', 'Mentorerade', 'Faciliterade'],
}

const FILLER_WORDS = [
  'egentligen',
  'faktiskt',
  'typ',
  'liksom',
  'alltså',
  'ju',
  'nog',
  'väl',
  'väldigt',
  'ganska',
]

function cleanFillers(text) {
  let out = String(text || '')
  for (const w of FILLER_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, 'gi')
    out = out.replace(re, '')
  }
  // Collapse double-spaces created by filler removal.
  return out.replace(/\s+/g, ' ').trim()
}

function splitBullets(text) {
  return String(text || '')
    .split(/[.\n!?]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function makeBullet(text, leadVerbs) {
  const cleaned = cleanFillers(text)
  if (!cleaned) return ''
  // Capitalize first letter; trim trailing period (the bullet
  // style uses no terminal period for visual consistency).
  const first = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/\.$/, '')
  // If the line already starts with a strong verb (Levererade,
  // Byggde, etc.), keep it. Otherwise prepend a random lead verb.
  // Round-46: include BOTH legacy ("Coachte" / "Mentorskade") +
  // normalised forms ("Coachade" / "Mentorerade") so a CV summary
  // containing the old non-standard verbs still passes the
  // double-prefix check, while we phase them out from the
  // generator. Remove the legacy forms after 6 months of
  // telemetry data shows 0% of users maintain them in their
  // summaries (track via `enhanceCvSummaryGroq` source='groq'
  // paths in the stats dashboard).
  const alreadyStrong = /^(levererade|ökade|minskade|h[öo]jde|s[äa]nkte|genererade|byggde|implementerade|optimerade|arkiterade|utvecklade|designade|ledde|coachade|coachte|samordnade|drev|mentorerade|mentorskade|faciliterade)\b/i.test(first)
  if (alreadyStrong) return first
  const verb = leadVerbs[Math.floor(Math.random() * leadVerbs.length)]
  return `${verb} ${first.charAt(0).toLowerCase() + first.slice(1)}`
}

/**
 * Pure-JS enhancer — no network. Returns { enhanced, bullets, focus }.
 * Used as the offline fallback when Groq is unavailable.
 */
export function enhanceCvSummaryPure(summary, focus = 'resultat') {
  const leadVerbs = FOCUS_LEAD_VERBS[focus] || FOCUS_LEAD_VERBS.resultat
  const bullets = splitBullets(cleanFillers(summary))
    .map((b) => makeBullet(b, leadVerbs))
    .filter((b) => b.length > 0)
  // Reassemble as a bullet list. If the input was a single
  // sentence (no bullet), the first bullet is the original
  // sentence, so the result is always a meaningful improvement.
  const enhanced = bullets.map((b) => `• ${b}`).join('\n')
  // 2026-07-17 (Round-59 polish): always include `source: 'pure'`
  // so the assertion in tests/unit/cv-enhance.test.mjs#90
  // ("returns valid bullets regardless of provider" expects
  // `source` to be defined regardless of which path returned)
  // passes cleanly. Mirrors the `source: 'groq'` field set on
  // the AI-success path in enhanceCvSummaryGroq below so a
  // downstream consumer can always discriminate "AI generated"
  // from "rule-based fallback" without a null check.
  return { enhanced, bullets, focus, source: 'pure' }
}

/**
 * Groq-backed enhancer. Falls back to the pure enhancer on any
 * failure (network, 429, missing key) so the user never sees a
 * hard error.
 */
export async function enhanceCvSummaryGroq(summary, focus = 'resultat') {
  const fallback = enhanceCvSummaryPure(summary, focus)
  if (!summary || !String(summary).trim()) return { ...fallback, source: 'pure' }
  // Build a small Swedish prompt.
  const themeHint = {
    resultat: 'resultatorienterad — kvantifiera effekter (%, kr, antal, tid) och undvik vaga ord',
    teknisk: 'teknisk — lista konkreta teknologier, ramverk, metoder och undvik affisch-språk',
    ledarskap: 'ledarskap — framhäv samarbete, coachning, mentorskap och beslut',
  }[focus] || 'resultatorienterad'
  const prompt = `Skriv om följande CV-sammanfattning i ${FOCUS_LEAD_VERBS[focus]?.length || 4} korta bullet points. Ton: ${themeHint}. Håll dig till fakta från originalet — hitta inte på. Inga påhittade siffror. Returnera ENDAST bullet points, en per rad, varje rad börjar med "• ".

ORIGINAL:
${String(summary).trim()}

BULLETS:`
  try {
    const text = await generateText(prompt, { maxTokens: 400, temperature: 0.4 })
    const cleaned = String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('•') || l.startsWith('-') || /^[A-ZÅÄÖ]/.test(l))
      .map((l) => (l.startsWith('-') ? `• ${l.slice(1).trim()}` : l.startsWith('•') ? l : `• ${l}`))
      .slice(0, 6)
      .join('\n')
    if (cleaned) {
      return { enhanced: cleaned, bullets: cleaned.split('\n'), focus, source: 'groq' }
    }
    return { ...fallback, source: 'pure' }
  } catch (err) {
    // Non-fatal: fall back to the pure enhancer. Spread
    // `fallback` explicitly + force `source: 'pure'` so a future
    // refactor of `enhanceCvSummaryPure`'s return shape cannot
    // silently drop the discriminator (defense-in-depth).
    return { ...fallback, source: 'pure' }
  }
}
