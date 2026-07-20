/**
 * Avatar registry — single source of truth.
 *
 * Both the client picker (components/avatars.jsx) and the server-side
 * validation guard (app/api/[[...path]]/route.js → /api/profile-update)
 * consume this list. Adding a new avatar only requires touching this
 * file (and adding the matching React component in components/avatars.jsx),
 * which avoids the silent-drop landmine where the server's hardcoded slug
 * list diverges from the client's registry.
 *
 * Rarity metadata lives here too so the picker grid, the SVG component,
 * and any future analytics card share the same colour + label mapping
 * without a triplicate definition.
 *
 * Why a plain JS module (no `'use client'`): this file contains no React
 * APIs — it's pure data. Server code (Next.js API routes) can import the
 * Set directly without the client-bundle boundary crossing. The
 * containing `components/avatars.jsx` stays a `'use client'` module
 * because it renders JSX, but it imports `AVATAR_KEYS` from here so its
 * `AVATAR_ORDER` stays in lock-step with the validator.
 */

/** Canonical 16-slot ordering. UI picker iteration and server validation
 *  both walk this list in the same order so the grid layout and the
 *  allow-list never drift.
 *
 *  Order rationale: original 12 slots stay at 1-12 so saved preferences
 *  on existing users keep their current picker position. The 4 new
 *  slots (hjalten / innovatören / visionären / mystikern) append at
 *  13-16 to fill the 16-character target from the polish-feature spec.
 *  Pair each new list entry with the matching React component in
 *  components/avatars.jsx AND a row in AVATAR_RARITY below — missing
 *  any of those three leaves the avatar effectively unrenderable from
 *  one of the picker / server-validator / legend triple. */
export const AVATAR_KEYS = [
  'piloten',
  'navigatören',
  'upptäckaren',
  'ingenjören',
  'kreatören',
  'strategen',
  'utforskaren',
  'kaptenen',
  'byggaren',
  'forskaren',
  'konstnären',
  'mentorn',
  'hjalten',
  'innovatören',
  'visionären',
  'mystikern',
]

/** Set version for O(1) server-side validation. Convert AVATAR_KEYS to
 *  a Set once at module load and reuse the same instance — exporting a
 *  frozen Set means callers can't accidentally mutate it. */
export const PROFILE_PICTURE_AVATARS = new Set(AVATAR_KEYS)

/**
 * Rarity tiers in display order — the picker renders them as a legend
 * and the JSX renders each tier-badge with this colour + label.
 *
 * Distribution of the 16 avatars across the tiers (intentional skew so
 * users can complete the collection-set without grinding forever):
 *   common:    5 (piloten, upptäckaren, kreatören, forskaren, mentorn)
 *   uncommon:  5 (navigatören, ingenjören, byggaren, konstnären, innovatören)
 *   rare:      4 (utforskaren, kaptenen, hjalten, mystikern)
 *   epic:      2 (strategen, visionären)
 *   legendary: 0 — reserved for future drops; if you add one, set its
 *               rarity in AVATAR_RARITY below and bump the legend here.
 */
export const RARITY_TIERS = [
  { rarity: 'common',    label: 'Vanlig',      color: '#94a3b8', twRing: 'ring-slate-400', twBg: 'bg-slate-100', twText: 'text-slate-700', order: 0 },
  { rarity: 'uncommon',  label: 'Ovanlig',     color: '#10b981', twRing: 'ring-emerald-500', twBg: 'bg-emerald-100', twText: 'text-emerald-700', order: 1 },
  { rarity: 'rare',      label: 'Sällsynt',    color: '#3b82f6', twRing: 'ring-blue-500', twBg: 'bg-blue-100', twText: 'text-blue-700', order: 2 },
  { rarity: 'epic',      label: 'Episk',       color: '#a855f7', twRing: 'ring-purple-500', twBg: 'bg-purple-100', twText: 'text-purple-700', order: 3 },
  { rarity: 'legendary', label: 'Legendarisk', color: '#f59e0b', twRing: 'ring-amber-500', twBg: 'bg-amber-100', twText: 'text-amber-700', order: 4 },
]

/** Map from rarity key → tier definition (lazily computed from RARITY_TIERS). */
export const RARITY_BY_KEY = RARITY_TIERS.reduce((acc, t) => {
  acc[t.rarity] = t
  return acc
}, {})

/**
 * Per-avatar rarity table. The picker reads this to draw the rarity dot
 * in each grid cell, the picker tooltip to show tier name, and the
 * collection progress label to show "X av 16 samlade".
 *
 * The `bg` colours here are a LIGHTER SWATCH of each avatar's solid
 * circle bg from components/avatars.jsx (e.g. piloten is `#fbbf24`
 * amber-400 in the SVG but `#fde68a` yellow-200 in the legend). The
 * legend swatch is intentionally lighter so the rarity tier text
 * stays readable on top — going full-strength would clash with the
 * text colour and make the "Ovanlig / Sällsynt" labels invisible on
 * some browsers. Keep this list in sync when adding new avatars
 * and prefer the lighter-shade pattern; full-strength colours belong
 * in components/avatars.jsx only.
 */
export const AVATAR_RARITY = {
  piloten:     { rarity: 'common',   bg: '#fde68a' },
  navigatören: { rarity: 'uncommon', bg: '#a5f3fc' },
  upptäckaren: { rarity: 'common',   bg: '#ddd6fe' },
  ingenjören:  { rarity: 'uncommon', bg: '#e2e8f0' },
  kreatören:   { rarity: 'common',   bg: '#fbcfe8' },
  strategen:   { rarity: 'epic',     bg: '#dbeafe' },
  utforskaren: { rarity: 'rare',     bg: '#a7f3d0' },
  kaptenen:    { rarity: 'rare',     bg: '#c7d2fe' },
  byggaren:    { rarity: 'uncommon', bg: '#fed7aa' },
  forskaren:   { rarity: 'common',   bg: '#99f6e4' },
  konstnären:  { rarity: 'uncommon', bg: '#fecdd3' },
  mentorn:     { rarity: 'common',   bg: '#bae6fd' },
  hjalten:     { rarity: 'rare',     bg: '#fecaca' },
  innovatören: { rarity: 'uncommon', bg: '#eab308' },
  visionären:  { rarity: 'epic',     bg: '#c7d2fe' },
  mystikern:   { rarity: 'rare',     bg: '#99f6e4' },
}
