// lib/style-presets.mjs
//
// Round-35 (Part 3 — Answer Diversity: 5 Styles). Pure ES module
// single source of truth for the 5 answer-style presets the user
// can pick as their default AI-writing voice. Lives in lib/ (not
// components/) because (a) it has no React/JSX dependency, and
// (b) it must be importable from `node --test` for the structural-
// lock tests in tests/unit/style-presets.test.mjs.
//
// Each preset carries:
//   • `id`        — the canonical string stored on the user's profile
//                   (`profile.stylePreference`) and echoed in the
//                   Groq prompt. Stable; changing this is a schema
//                   migration.
//   • `label`     — Swedish UI label rendered in the /settings
//                   radio button card + the extension popup's
//                   per-question override dropdown.
//   • `description` — one-line Swedish description shown below the
//                   label in the /settings card so the user can
//                   pick without hover-tooltips.
//   • `openers`   — 2 example sentence openers per spec (used in
//                   the Groq prompt modifier to nudge the model
//                   toward style-consistent output).
//   • `prompt`    — the system-prompt modifier injected into
//                   generateCoverLetter() and generateAdaptiveAnswer()
//                   when the user has this style selected. Designed
//                   to be APPENDED to the existing prompt, not
//                   replace it (so the job/profile context still
//                   dominates the output).
//
// Part 3 spec mandates these exact 5 styles with these exact
// Swedish labels. Adding a 6th style is a deliberate cross-file
// edit (component radio card + Groq prompt path + this list +
// test) and is not done casually.

export const STYLE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'lagom',
    label: 'Lagom',
    description: 'Balanserad — varken för formell eller för casual. Svensk arbetsplatsstandard.',
    openers: [
      'Jag har lång erfarenhet av...',
      'Min bakgrund inom...',
    ],
    prompt: [
      'Skriv i en balanserad, professionell ton — varken för formell eller för casual.',
      'Använd naturligt svenskt arbetsplatsspråk. Meningar får vara av varierande längd.',
      'Föredragna öppningsfraser: "Jag har lång erfarenhet av...", "Min bakgrund inom..."',
    ].join(' '),
  }),
  Object.freeze({
    id: 'strukturerad',
    label: 'Strukturerad',
    description: 'Punktlistor, analytiskt och faktadrivet.',
    openers: [
      '• 5 års erfarenhet...',
      '• Expert inom...',
    ],
    prompt: [
      'Skriv i en strukturerad, analytisk ton. Använd gärna korta punktlistor eller numrerade meningar.',
      'Fokusera på konkreta fakta: årsantal, teknologier, team-storlek, mätbara resultat.',
      'Föredragna öppningsfraser: "• 5 års erfarenhet...", "• Expert inom..."',
    ].join(' '),
  }),
  Object.freeze({
    id: 'berattande',
    label: 'Berättande',
    description: 'Story-drivet, personliga exempel och narrativa bågar.',
    openers: [
      'När jag började som...',
      'Ett projekt jag är särskilt stolt över...',
    ],
    prompt: [
      'Skriv i en berättande ton med konkreta situationer, projekt och lärdomar.',
      'Använd "jag" i förstahandsperspektiv. Referera gärna till specifika händelser från kandidatens CV.',
      'Föredragna öppningsfraser: "När jag började som...", "Ett projekt jag är särskilt stolt över..."',
    ].join(' '),
  }),
  Object.freeze({
    id: 'direkt',
    label: 'Direkt',
    description: 'Koncis, rakt på sak, inget fluff.',
    openers: [
      'Jag söker denna roll eftersom...',
      'Mina kvalifikationer:',
    ],
    prompt: [
      'Skriv kort och koncist. Inga utfyllnadsord eller upprepningar.',
      'Max 2-3 meningar. Leverera nyckelpoängen i första meningen.',
      'Föredragna öppningsfraser: "Jag söker denna roll eftersom...", "Mina kvalifikationer:"',
    ].join(' '),
  }),
  Object.freeze({
    id: 'engagerad',
    label: 'Engagerad',
    description: 'Entusiastisk, missionsdriven, företagsfokuserad.',
    openers: [
      'Jag brinner för...',
      'Det som lockar mig med [Företag] är...',
    ],
    prompt: [
      'Skriv i en engagerad, passionerad ton. Visa tydlig entusiasm för rollen och företaget.',
      'Koppla kandidatens värderingar till företagets påstådda mission. Referera gärna till specifika produkter eller initiativ.',
      'Föredragna öppningsfraser: "Jag brinner för...", "Det som lockar mig med [Företag] är..."',
    ].join(' '),
  }),
])

// Stable id -> preset lookup. Built once at module load so callers
// can do O(1) STYLE_PRESETS_BY_ID[stylePreference] instead of
// scanning the array. The Map is frozen so a future maintainer
// can't mutate the registry at runtime.
const PRESETS_BY_ID = Object.freeze(
  new Map(STYLE_PRESETS.map((preset) => [preset.id, preset])),
)

export const STYLE_PRESETS_BY_ID = PRESETS_BY_ID

// Set of all canonical style ids. Exported so the consistency
// check (lib/style-consistency.js) can validate a stored
// `stylePreference` against the allow-list without re-deriving
// the array. Frozen so callers can't accidentally mutate the
// shared singleton.
export const ALLOWED_STYLE_IDS = Object.freeze(new Set(STYLE_PRESETS.map((p) => p.id)))

// The canonical default — used when:
//   • the user has never picked a style (brand-new profile)
//   • the user's stored `stylePreference` is an unknown value
//     (e.g. from an old client that shipped 'professional' before
//     the spec was finalised)
//   • a future maintainer DELETES a style — every profile
//     pointing at the removed id gets the default rather than
//     breaking the prompt
// Part 3 spec names "Lagom" as the default — see STYLE_PRESETS[0].
export const DEFAULT_STYLE_ID = 'lagom'

/**
 * Resolve a user-supplied `stylePreference` to a valid preset.
 * Unknown / null / undefined all collapse to the default. The
 * pure function is the single gate the Groq prompt path uses —
 * keeping it here means a future "remove a style" migration is
 * a one-line change in this file, not a grep through every
 * prompt builder.
 *
 * Pure, no side effects → safe to import + unit-test in node:test.
 */
export function resolveStylePreset(stylePreference) {
  if (typeof stylePreference === 'string') {
    const preset = PRESETS_BY_ID.get(stylePreference)
    if (preset) return preset
  }
  return PRESETS_BY_ID.get(DEFAULT_STYLE_ID)
}
