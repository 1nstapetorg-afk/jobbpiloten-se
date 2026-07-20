'use client'

/**
 * JobbPiloten's avatar library — NFT-style "collectible" redesign.
 *
 * 16 unique avatars in a Doodles-inspired style: bold black outlines,
 * solid-color background circles (no Soft gradients), generous head/face
 * proportions, and one signature prop that makes each figure immediately
 * readable. Each avatar carries a subtle JobbPiloten prop-plane watermark
 * at the bottom-right corner so the collectible set feels branded — the
 * pilot is always "in the corner".
 *
 * Trait slots compose each avatar the same way so the set reads as a
 * cohesive series rather than 16 independent doodles:
 *   1. Background circle  (solid color from `bg`)
 *   2. JobbPiloten watermark (drawn FIRST so it's behind the figure)
 *   3. Body silhouette   (filled clothing color, bold outline)
 *   4. Head circle       (skin tone)
 *   5. Hair / headwear  (the avatar's distinctive head piece)
 *   6. Face details     (eyes + mouth chosen for expression)
 *   7. Signature prop   (the trait that names the role)
 *
 * Style header (shared by every figure):
 *   - stroke="#0f172a" (slate-900), stroke-width="2" with linecap/join
 *     "round" so corners read soft, not pixel-pixel.
 *   - viewBox 0 0 144 144 so a 32-px nav, 64-px modal preview and
 *     120-px picker thumbnail all scale crisply.
 *   - Sky-tone skin (#fde7c8) so faces stay consistent across the set.
 *   - Bold solid background colors — no radialGradient — to match
 *     CryptoPunks / Doodles silhouettes rather than soft-pastel avatars.
 *
 * Each SVG fits well under 8KB; the registry + registration helpers
 * near the bottom of this file are unchanged from the previous set so
 * the picker grid, server-side validator, and `ProfileAvatar` all
 * keep working without code changes in the consumers.
 */

import { forwardRef } from 'react'
import { AVATAR_KEYS } from '@/lib/avatar-keys'

// Common skin tone + outline so consumers can re-theme if we ever want
// a winter/summer variant of the set without rewriting each component.
export const SKIN_TONE = '#fde7c8'
export const OUTLINE_DARK = '#0f172a'

// Inline watermark — a stylised JobbPiloten prop-plane silhouette
// drawn at the lower-right of every figure. Rendered first so the body
// silhouette overlays it. Kept tiny so the watermark reads as a brand
// mark, not a fly buzzing the avatar.
function PilotWatermark(props) {
  return (
    <g
      transform="translate(112 116) rotate(-30)"
      opacity="0.55"
      aria-hidden="true"
      {...props}
    >
      <path d="M0 0 L20 6 L4 9 L8 5 Z" fill="white" stroke={OUTLINE_DARK} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 5 L 20 6" fill="none" stroke={OUTLINE_DARK} strokeWidth="0.8" />
    </g>
  )
}

// Shared stroke defaults so every <circle>/<path> reads identically.
const SW = 2          // outline width
const SC = OUTLINE_DARK // outline color
const SK = SKIN_TONE    // face skin

const faceCommon = {
  fill: SK,
  stroke: SC,
  strokeWidth: SW,
}

// ------- 1. Piloten ----------------------------------------------------------
// Original JobbPiloten look — pilot cap, sunglasses, flight jacket. Amber bg.
function Piloten(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#fbbf24" />
      <PilotWatermark />
      {/* pilot cap */}
      <path d="M48 56 Q48 30 72 30 Q96 30 96 56 L98 60 L46 60 Z" fill={SC} strokeWidth="2" stroke={SC} strokeLinejoin="round" />
      <rect x="46" y="58" width="52" height="5" fill="#1e293b" stroke={SC} strokeWidth={SW} />
      {/* head */}
      <circle cx="72" cy="62" r="22" {...faceCommon} />
      {/* aviator sunglasses */}
      <ellipse cx="63" cy="62" rx="7" ry="5" fill={SC} />
      <ellipse cx="81" cy="62" rx="7" ry="5" fill={SC} />
      <line x1="69" y1="62" x2="75" y2="62" stroke={SC} strokeWidth="2" />
      {/* glints */}
      <circle cx="61" cy="60" r="1.4" fill="#fef9c3" />
      <circle cx="79" cy="60" r="1.4" fill="#fef9c3" />
      {/* smile */}
      <path d="M66 74 Q72 78 78 74" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body flight jacket */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#1e293b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* shirt collar */}
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* stripe accent */}
      <rect x="36" y="106" width="22" height="3" fill="#fef9c3" />
    </svg>
  )
}

// ------- 2. Navigatören -----------------------------------------------------
// Explorer hat + compass. Cyan bg.
function Navigatorn(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#22d3ee" />
      <PilotWatermark />
      {/* explorer hat (wide brim) */}
      <ellipse cx="72" cy="48" rx="34" ry="7" fill="#7c2d12" stroke={SC} strokeWidth={SW} />
      <path d="M52 48 Q72 28 92 48 Z" fill="#92400e" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <rect x="46" y="46" width="52" height="4" fill="#451a03" stroke={SC} strokeWidth="1.5" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes */}
      <circle cx="65" cy="64" r="2" fill={SC} />
      <circle cx="79" cy="64" r="2" fill={SC} />
      {/* smile */}
      <path d="M67 73 Q72 76 77 73" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body explorer jacket */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#134e4a" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* shirt collar */}
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* compass prop */}
      <circle cx="72" cy="110" r="13" fill="#fef3c7" stroke={SC} strokeWidth={SW} />
      <circle cx="72" cy="110" r="3" fill={SC} />
      <path d="M72 100 L75 110 L72 120 L69 110 Z" fill="#dc2626" stroke={SC} strokeWidth="1" />
    </svg>
  )
}

// ------- 3. Upptäckaren -----------------------------------------------------
// Detective magnifier + bowler hat. Violet bg.
function Upptackaren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#a855f7" />
      <PilotWatermark />
      {/* bowler hat */}
      <ellipse cx="72" cy="42" rx="28" ry="6" fill="#1e293b" stroke={SC} strokeWidth={SW} />
      <path d="M52 42 Q52 28 72 28 Q92 28 92 42 Z" fill="#1e293b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes — focused / squinting */}
      <ellipse cx="65" cy="64" rx="2.5" ry="3" fill={SC} />
      <ellipse cx="79" cy="64" rx="2.5" ry="3" fill={SC} />
      <path d="M67 73 Q72 75 77 73" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — vest */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#312e81" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* shirt */}
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* bow tie */}
      <path d="M66 100 L72 96 L78 100 L72 104 Z" fill="#fef3c7" stroke={SC} strokeWidth="1.5" />
      {/* magnifier prop */}
      <circle cx="50" cy="110" r="11" fill="none" stroke={SC} strokeWidth="3" />
      <circle cx="50" cy="110" r="6" fill="#bae6fd" opacity="0.7" />
      <line x1="58" y1="118" x2="68" y2="128" stroke={SC} strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

// ------- 4. Ingenjören ------------------------------------------------------
// Yellow hard hat + gear cog. Slate bg.
function Ingenjoren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#64748b" />
      <PilotWatermark />
      {/* hard hat */}
      <path d="M48 56 Q48 30 72 30 Q96 30 96 56 L96 60 L48 60 Z" fill="#facc15" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <rect x="48" y="58" width="48" height="5" fill="#a16207" stroke={SC} strokeWidth="1.5" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes */}
      <circle cx="65" cy="64" r="2" fill={SC} />
      <circle cx="79" cy="64" r="2" fill={SC} />
      {/* mouth — concentrated */}
      <line x1="68" y1="74" x2="76" y2="74" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — overalls */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#1e293b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* gear prop */}
      <g transform="translate(72 112)">
        <circle r="13" fill="#fbbf24" stroke={SC} strokeWidth={SW} />
        {[0, 60, 120, 180, 240, 300].map(deg => (
          <rect key={deg} x="-2.5" y="-17" width="5" height="5" fill="#fbbf24" stroke={SC} strokeWidth="1.4" transform={`rotate(${deg})`} />
        ))}
        <circle r="4" fill={SC} />
      </g>
    </svg>
  )
}

// ------- 5. Kreatören -------------------------------------------------------
// Curly bun + lightbulb. Pink bg.
function Kreatoren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#ec4899" />
      <PilotWatermark />
      {/* curly bun */}
      <path d="M50 56 Q56 28 72 26 Q88 28 94 56 L92 60 L52 60 Z" fill="#3f2410" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="72" cy="24" r="6" fill="#3f2410" stroke={SC} strokeWidth="1.5" />
      {/* head */}
      <circle cx="72" cy="62" r="20" {...faceCommon} />
      {/* sparkly eyes */}
      <circle cx="66" cy="62" r="2.4" fill={SC} />
      <circle cx="78" cy="62" r="2.4" fill={SC} />
      <circle cx="64" cy="60" r="0.6" fill="#fef9c3" />
      <circle cx="76" cy="60" r="0.6" fill="#fef9c3" />
      {/* excited smile — wide */}
      <path d="M65 73 Q72 80 79 73" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — smock */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#831843" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* button */}
      <circle cx="72" cy="108" r="1.8" fill="#fecdd3" stroke={SC} strokeWidth="1" />
      {/* lightbulb prop */}
      <g transform="translate(50 112)">
        <circle r="11" fill="#fde047" stroke={SC} strokeWidth={SW} />
        <rect x="-4" y="9" width="8" height="3" fill={SC} />
        <rect x="-3" y="12" width="6" height="2" fill={SC} />
        {/* spark rays */}
        <line x1="0" y1="-15" x2="0" y2="-19" stroke={SC} strokeWidth="2" strokeLinecap="round" />
        <line x1="-12" y1="-3" x2="-16" y2="-3" stroke={SC} strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="-3" x2="16" y2="-3" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  )
}

// ------- 6. Strategen -------------------------------------------------------
// Slicked back hair + chess queen + suit. Royal blue bg.
function Strategen(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#2563eb" />
      <PilotWatermark />
      {/* slicked hair */}
      <path d="M54 56 Q56 32 72 32 Q88 32 90 56 Q88 50 82 50 L62 50 Q56 50 54 56 Z" fill="#0f172a" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes — focused */}
      <line x1="62" y1="64" x2="69" y2="64" stroke={SC} strokeWidth="3" strokeLinecap="round" />
      <line x1="75" y1="64" x2="82" y2="64" stroke={SC} strokeWidth="3" strokeLinecap="round" />
      {/* determined mouth */}
      <path d="M68 74 L76 74" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* suit body */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#1e3a8a" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* shirt */}
      <path d="M58 84 L72 110 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* tie */}
      <path d="M68 96 L72 100 L76 96 L78 116 L72 122 L66 116 Z" fill="#fef3c7" stroke={SC} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ------- 7. Utforskaren -----------------------------------------------------
// Beanie + binoculars. Emerald bg.
function Utforskaren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#10b981" />
      <PilotWatermark />
      {/* beanie */}
      <path d="M52 50 Q52 28 72 28 Q92 28 92 50 L92 56 L52 56 Z" fill="#064e3b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <rect x="52" y="54" width="40" height="4" fill="#10b981" stroke={SC} strokeWidth="1.5" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes — warm smile */}
      <path d="M62 62 Q65 64 68 62" fill="none" stroke={SC} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M76 62 Q79 64 82 62" fill="none" stroke={SC} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M67 74 Q72 77 77 74" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — green jacket */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#065f46" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* backpack strap accent */}
      <rect x="38" y="100" width="3" height="22" fill={SC} />
      {/* binoculars prop */}
      <g transform="translate(72 110)">
        <rect x="-13" y="-5" width="11" height="11" rx="2" fill="#1e293b" stroke={SC} strokeWidth={SW} />
        <rect x="2" y="-5" width="11" height="11" rx="2" fill="#1e293b" stroke={SC} strokeWidth={SW} />
        <rect x="-2" y="-3" width="4" height="6" fill="#475569" />
        <circle cx="-7" cy="-5" r="2.5" fill="#86efac" opacity="0.8" />
        <circle cx="7" cy="-5" r="2.5" fill="#86efac" opacity="0.8" />
      </g>
    </svg>
  )
}

// ------- 8. Kaptenen --------------------------------------------------------
// Captain hat + anchor badge. Indigo bg.
function Kaptenen(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#4f46e5" />
      <PilotWatermark />
      {/* captain hat */}
      <path d="M50 50 Q50 30 72 30 Q94 30 94 50 L98 56 L46 56 Z" fill="#1e1b4b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <rect x="46" y="54" width="52" height="5" fill="#fbbf24" stroke={SC} strokeWidth="1.5" />
      {/* captain star badge */}
      <circle cx="72" cy="42" r="4.5" fill="#fbbf24" stroke={SC} strokeWidth="1.5" />
      <circle cx="72" cy="42" r="1.5" fill="#1e1b4b" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes — confident */}
      <line x1="62" y1="64" x2="69" y2="64" stroke={SC} strokeWidth="3" strokeLinecap="round" />
      <line x1="75" y1="64" x2="82" y2="64" stroke={SC} strokeWidth="3" strokeLinecap="round" />
      {/* beard stubble */}
      <path d="M58 72 Q72 86 86 72 Q72 78 58 72 Z" fill="#1e293b" opacity="0.7" />
      {/* smile */}
      <path d="M67 74 Q72 77 77 74" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — naval uniform */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#1e1b4b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* gold stripes */}
      <rect x="36" y="100" width="20" height="3" fill="#fbbf24" stroke={SC} strokeWidth="1" />
      <rect x="36" y="106" width="20" height="3" fill="#fbbf24" stroke={SC} strokeWidth="1" />
    </svg>
  )
}

// ------- 9. Byggaren -------------------------------------------------------
// Yellow hard hat + wrench. Orange bg.
function Byggaren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#f97316" />
      <PilotWatermark />
      {/* hard hat */}
      <path d="M48 56 Q48 30 72 30 Q96 30 96 56 L96 60 L48 60 Z" fill="#facc15" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <rect x="48" y="58" width="48" height="5" fill="#a16207" stroke={SC} strokeWidth="1.5" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes — squinting */}
      <line x1="62" y1="64" x2="70" y2="64" stroke={SC} strokeWidth="3" strokeLinecap="round" />
      <line x1="74" y1="64" x2="82" y2="64" stroke={SC} strokeWidth="3" strokeLinecap="round" />
      <path d="M67 75 Q72 78 77 75" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — high-vis vest */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#7c2d12" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* safety stripes */}
      <rect x="34" y="110" width="22" height="3" fill="#fef3c7" stroke={SC} strokeWidth="1" />
      <rect x="34" y="116" width="22" height="3" fill="#fef3c7" stroke={SC} strokeWidth="1" />
      <rect x="88" y="110" width="22" height="3" fill="#fef3c7" stroke={SC} strokeWidth="1" />
      <rect x="88" y="116" width="22" height="3" fill="#fef3c7" stroke={SC} strokeWidth="1" />
    </svg>
  )
}

// ------- 10. Forskaren ------------------------------------------------------
// Labcoat + beaker. Teal bg.
function Forskaren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#14b8a6" />
      <PilotWatermark />
      {/* short hair */}
      <path d="M54 56 Q60 34 72 34 Q84 34 90 56 L88 60 Q72 56 56 60 Z" fill="#1e293b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* round smart glasses */}
      <circle cx="65" cy="64" r="5" fill="none" stroke={SC} strokeWidth="2" />
      <circle cx="79" cy="64" r="5" fill="none" stroke={SC} strokeWidth="2" />
      <line x1="70" y1="64" x2="74" y2="64" stroke={SC} strokeWidth="2" />
      <circle cx="65" cy="64" r="1.4" fill={SC} />
      <circle cx="79" cy="64" r="1.4" fill={SC} />
      <path d="M67 74 Q72 76 77 74" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — white labcoat */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#f8fafc" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* lapels */}
      <path d="M58 84 L72 110 L86 84 Z" fill="#cbd5e1" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* beaker prop */}
      <g transform="translate(50 112)">
        <path d="M-8 -8 L8 -8 L5 8 Q0 11 -5 8 Z" fill="#bae6fd" stroke={SC} strokeWidth={SW} />
        <rect x="-8" y="-12" width="16" height="4" fill={SC} />
        <circle cx="0" cy="2" r="2" fill="#67e8f9" />
        <circle cx="3" cy="-2" r="1.4" fill="#67e8f9" />
      </g>
    </svg>
  )
}

// ------- 11. Konstnären -----------------------------------------------------
// Beret + palette with paint blobs. Rose bg.
function Konstnaren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#f43f5e" />
      <PilotWatermark />
      {/* beret */}
      <path d="M50 50 Q72 14 94 50 Q94 56 72 56 Q50 56 50 50 Z" fill="#7f1d1d" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="72" cy="26" r="3.5" fill="#7f1d1d" stroke={SC} strokeWidth="1" />
      {/* head */}
      <circle cx="72" cy="64" r="20" {...faceCommon} />
      {/* eyes */}
      <circle cx="65" cy="64" r="2" fill={SC} />
      <circle cx="79" cy="64" r="2" fill={SC} />
      <path d="M67 74 Q72 77 77 74" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — buttoned jacket */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#9f1239" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="72" cy="108" r="1.5" fill="#fecdd3" stroke={SC} strokeWidth="0.8" />
      <circle cx="72" cy="116" r="1.5" fill="#fecdd3" stroke={SC} strokeWidth="0.8" />
      {/* palette prop */}
      <g transform="translate(94 108)">
        <ellipse rx="11" ry="8" fill="#fef3c7" stroke={SC} strokeWidth={SW} />
        <circle cx="-6" cy="-3" r="2.2" fill="#dc2626" stroke={SC} strokeWidth="1" />
        <circle cx="-2" cy="-5" r="2.2" fill="#f59e0b" stroke={SC} strokeWidth="1" />
        <circle cx="3" cy="-5" r="2.2" fill="#10b981" stroke={SC} strokeWidth="1" />
        <circle cx="7" cy="-3" r="2.2" fill="#3b82f6" stroke={SC} strokeWidth="1" />
        <circle cx="-6" cy="3" r="2" fill="#8b5cf6" stroke={SC} strokeWidth="1" />
        <ellipse cx="6" cy="6" rx="3" ry="2" fill={SK} stroke={SC} strokeWidth="0.8" />
      </g>
    </svg>
  )
}

// ------- 13. Hjälten ------------------------------------------------------
// Hero pose with cape + golden star chest emblem. Royal-red bg.
// Added 2026-07-10 to extend the 12-slot set to 16. The cape is the
// first silhouette element in the set to break outside the body path
// (extends to the lower-left of the circle bg) so it's instantly
// distinguishable from every other character — even at 28px preview
// size in the picker grid the cape reads as a "flame".
function Hjalten(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#b91c1c" />
      <PilotWatermark />
      {/* cape — flows down behind the body to lower-left */}
      <path d="M52 84 Q40 110 30 132 L46 132 L62 110 Z" fill="#7f1d1d" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* head with short cropped hair */}
      <circle cx="72" cy="60" r="20" {...faceCommon} />
      {/* mask stripe across eyes — narrow, doesn't fully cover them */}
      <rect x="48" y="56" width="48" height="6" fill={SC} stroke={SC} strokeWidth="1" />
      <circle cx="64" cy="58" r="1.6" fill={SK} />
      <circle cx="80" cy="58" r="1.6" fill={SK} />
      {/* confident smile */}
      <path d="M66 72 Q72 76 78 72" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — suit */}
      <path d="M28 132 Q28 92 58 84 L86 84 Q116 92 116 132 Z" fill="#1e3a8a" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* shirt collar */}
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* star chest emblem — 5-pointed, filled gold */}
      <path d="M72 110 L75 119 L84 119 L77 124 L80 132 L72 128 L64 132 L67 124 L60 119 L69 119 Z" fill="#fbbf24" stroke={SC} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

// ------- 14. Innovatören --------------------------------------------------
// Messy creative hair + lightbulb + small gear prop. Sunny yellow bg.
// Co-exists with Kreatören (pink bg, lightbulb) because the GEAR is
// the visual cue — Innovatören's gear is the first mechanic-prop in
// the set and is consistent with the user's spec ("lightbulb, gear,
// creative tools").
function Innovatorn(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#eab308" />
      <PilotWatermark />
      {/* messy creative hair — tufts sticking out */}
      <path d="M50 52 Q52 28 72 26 Q92 28 94 52 L94 56 L50 56 Z" fill="#3f2410" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="52" cy="32" r="3" fill="#3f2410" stroke={SC} strokeWidth="1.2" />
      <circle cx="92" cy="32" r="3" fill="#3f2410" stroke={SC} strokeWidth="1.2" />
      {/* head */}
      <circle cx="72" cy="62" r="20" {...faceCommon} />
      {/* sparkly excited eyes */}
      <circle cx="66" cy="62" r="2.2" fill={SC} />
      <circle cx="78" cy="62" r="2.2" fill={SC} />
      <circle cx="64" cy="60" r="0.6" fill="#fef9c3" />
      <circle cx="76" cy="60" r="0.6" fill="#fef9c3" />
      {/* wide smile */}
      <path d="M65 73 Q72 80 79 73" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — overalls */}
      <path d="M28 132 Q28 92 58 84 L86 84 Q116 92 116 132 Z" fill="#1e293b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* gear prop — bottom-right, mechanical cog with 6 teeth */}
      <g transform="translate(108 110)">
        <circle r="11" fill="#475569" stroke={SC} strokeWidth={SW} />
        {[0, 60, 120, 180, 240, 300].map(deg => (
          <rect key={deg} x="-2" y="-15" width="4" height="5" fill="#475569" stroke={SC} strokeWidth="1.2" transform={`rotate(${deg})`} />
        ))}
        <circle r="3" fill={SC} />
      </g>
      {/* lightbulb prop — above-right of head */}
      <g transform="translate(106 38)">
        <circle r="9" fill="#fde047" stroke={SC} strokeWidth={SW} />
        <rect x="-3" y="7" width="6" height="3" fill={SC} />
        <rect x="-2.5" y="10" width="5" height="2" fill={SC} />
        {/* spark rays */}
        <line x1="0" y1="-13" x2="0" y2="-17" stroke={SC} strokeWidth="2" strokeLinecap="round" />
        <line x1="-11" y1="-3" x2="-14" y2="-3" stroke={SC} strokeWidth="2" strokeLinecap="round" />
        <line x1="11" y1="-3" x2="14" y2="-3" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  )
}

// ------- 15. Visionären ---------------------------------------------------
// Futuristic visor + telescope + scattered stars. Deep indigo bg.
// Epic-rarity character — the only set member with a forward-leaning
// telescope prop, which breaks the existing "prop points down" idiom
// and tells the user at-a-glance "futurist/explorer" without leaning
// on the rare-tier's badge color.
function Visionaren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#4338ca" />
      <PilotWatermark />
      {/* scattered stars in the background */}
      <Star3 cx={28} cy={26} r={1.6} />
      <Star3 cx={114} cy={32} r={2} />
      <Star3 cx={42} cy={42} r={1} />
      <Star3 cx={104} cy={54} r={1.4} />
      {/* short smooth hair */}
      <path d="M54 52 Q60 30 72 30 Q84 30 90 52 L88 56 L56 56 Z" fill="#1e1b4b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* head */}
      <circle cx="72" cy="62" r="20" {...faceCommon} />
      {/* visor — wide wrap-around futuristic goggles */}
      <ellipse cx="72" cy="62" rx="20" ry="6" fill={SC} />
      <ellipse cx="72" cy="62" rx="18" ry="4" fill="#06b6d4" />
      <circle cx="64" cy="60" r="1.4" fill="#fef9c3" />
      <circle cx="80" cy="60" r="1.4" fill="#fef9c3" />
      {/* determined mouth */}
      <line x1="68" y1="74" x2="76" y2="74" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — sleek space jacket */}
      <path d="M28 132 Q28 92 58 84 L86 84 Q116 92 116 132 Z" fill="#1e1b4b" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* chest emblem — diamond */}
      <path d="M72 110 L78 116 L72 124 L66 116 Z" fill="#06b6d4" stroke={SC} strokeWidth="1.4" />
      {/* telescope prop — angled barrel pointing up-right */}
      <g transform="translate(98 108) rotate(-30)">
        <rect x="-2" y="-22" width="14" height="6" rx="1" fill="#a78bfa" stroke={SC} strokeWidth={SW} />
        <rect x="10" y="-20" width="4" height="2" fill={SC} />
        <circle cx="-2" cy="-19" r="3" fill="#fbbf24" stroke={SC} strokeWidth="1.2" />
      </g>
    </svg>
  )
}

// Tiny offscreen star helper used by Visionären's background field.
function Star3({ cx, cy, r }) {
  return (
    <circle cx={cx} cy={cy} r={r} fill="#fde68a" opacity="0.85" />
  )
}

// ------- 16. Mystikern ----------------------------------------------------
// Hood + glowing orb hand-prop. Deep teal bg with a narrow face slot.
// Adds the first "most of the face obscured" silhouette to the set —
// the hood drapes over the hair + forehead so only the eyes + mouth
// are visible. Pairs with the glowing orb on the lower-right to read
// as "mysterious clairvoyant" without writing that on the chest.
function Mystikern(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#134e4a" />
      <PilotWatermark />
      {/* hood — drapes over top of head + sides */}
      <path d="M40 70 Q40 30 72 28 Q104 30 104 70 L100 90 L86 88 L86 78 Q86 60 72 58 Q58 60 58 78 L58 88 L44 90 Z" fill="#0f766e" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* face oval — small, only eyes + mouth visible */}
      <ellipse cx="72" cy="68" rx="14" ry="16" {...faceCommon} />
      {/* narrow mysterious eyes — thin slits */}
      <path d="M62 64 Q66 66 70 64" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      <path d="M74 64 Q78 66 82 64" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* tiny neutral mouth */}
      <line x1="68" y1="76" x2="76" y2="76" stroke={SC} strokeWidth="1.6" strokeLinecap="round" />
      {/* body — flowing robe */}
      <path d="M28 132 Q28 96 56 88 L88 88 Q116 96 116 132 Z" fill="#0f766e" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* robe sash */}
      <path d="M58 110 L72 100 L86 110 L72 116 Z" fill="#fbbf24" stroke={SC} strokeWidth="1.4" strokeLinejoin="round" />
      {/* glowing orb — halo + bright core */}
      <g transform="translate(40 112)">
        <circle r="11" fill="#fbbf24" opacity="0.18" />
        <circle r="7" fill="#fef9c3" stroke={SC} strokeWidth={SW} />
        <circle r="3" fill="#fbbf24" />
      </g>
    </svg>
  )
}

// ------- 12. Mentorn -------------------------------------------------------
// Long hair + open book. Sky blue bg.
function Mentoren(props) {
  return (
    <svg viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="72" cy="72" r="72" fill="#0ea5e9" />
      <PilotWatermark />
      {/* long hair */}
      <path d="M50 80 Q48 30 72 28 Q96 30 94 80 Q92 64 84 60 Q72 62 60 60 Q52 64 50 80 Z" fill="#365314" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* head */}
      <circle cx="72" cy="62" r="20" {...faceCommon} />
      {/* kind eyes — crescents */}
      <path d="M62 62 Q65 60 68 62" fill="none" stroke={SC} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M76 62 Q79 60 82 62" fill="none" stroke={SC} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M67 72 Q72 75 77 72" fill="none" stroke={SC} strokeWidth="2" strokeLinecap="round" />
      {/* body — cozy sweater */}
      <path d="M28 130 Q28 92 58 84 L86 84 Q116 92 116 130 Z" fill="#0369a1" stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 84 L72 100 L86 84 Z" fill={SK} stroke={SC} strokeWidth={SW} strokeLinejoin="round" />
      {/* knit pattern */}
      <path d="M40 110 Q46 106 52 110 Q58 114 64 110" fill="none" stroke="#7dd3fc" strokeWidth="1.5" />
      <path d="M80 110 Q86 106 92 110 Q98 114 104 110" fill="none" stroke="#7dd3fc" strokeWidth="1.5" />
      {/* guiding star above */}
      <path d="M72 20 L73 16 L75 15 L73 14 L72 10 L71 14 L69 15 L71 16 Z" fill="#fbbf24" stroke={SC} strokeWidth="1" />
    </svg>
  )
}

// -----------------------------------------------------------------
// AVATARS registry — id ↔ React component. Drives both the picker
// grid and the server-side validator (via lib/avatar-keys.js). Add
// new entries at the END of AVATAR_KEYS in lib/avatar-keys.js and at
// the END of this object so existing saved preferences stay stable
// across deployments.
// -----------------------------------------------------------------
export const AVATARS = {
  piloten:      { id: 'piloten',      name: 'Piloten',      component: Piloten },
  navigatören:  { id: 'navigatören',  name: 'Navigatören',  component: Navigatorn },
  upptäckaren:  { id: 'upptäckaren',  name: 'Upptäckaren',  component: Upptackaren },
  ingenjören:   { id: 'ingenjören',   name: 'Ingenjören',   component: Ingenjoren },
  kreatören:    { id: 'kreatören',    name: 'Kreatören',    component: Kreatoren },
  strategen:    { id: 'strategen',    name: 'Strategen',    component: Strategen },
  utforskaren:  { id: 'utforskaren',  name: 'Utforskaren',  component: Utforskaren },
  kaptenen:     { id: 'kaptenen',     name: 'Kaptenen',     component: Kaptenen },
  byggaren:     { id: 'byggaren',     name: 'Byggaren',     component: Byggaren },
  forskaren:    { id: 'forskaren',    name: 'Forskaren',    component: Forskaren },
  konstnären:   { id: 'konstnären',   name: 'Konstnären',   component: Konstnaren },
  mentorn:      { id: 'mentorn',      name: 'Mentorn',      component: Mentoren },
  hjalten:      { id: 'hjalten',      name: 'Hjälten',      component: Hjalten },
  innovatören:  { id: 'innovatören',  name: 'Innovatören',  component: Innovatorn },
  visionären:   { id: 'visionären',   name: 'Visionären',   component: Visionaren },
  mystikern:    { id: 'mystikern',    name: 'Mystikern',    component: Mystikern },
}

// Picker iteration order — sourced from lib/avatar-keys.js so the
// server allow-list (PROFILE_PICTURE_AVATARS Set) and the picker grid
// never drift. The keys are already deduplicated + ordered there.
export const AVATAR_ORDER = AVATAR_KEYS

// Module-load invariant check (mirrors previous set). Object.keys
// returns insertion order; AVATAR_KEYS is the canonical order the
// picker grid walks. If they diverge the picker would skip slots or
// show duplicates, so we log a single warning in dev to surface the
// mistake at the earliest possible moment.
if (process.env.NODE_ENV !== 'production') {
  const registryKeys = Object.keys(AVATARS)
  const same = registryKeys.length === AVATAR_KEYS.length
    && registryKeys.every((k, i) => k === AVATAR_KEYS[i])
  if (!same) {
    // eslint-disable-next-line no-console
    console.warn('[avatars] registry/keys mismatch — pickers will skip slots', {
      registry: registryKeys,
      shared: [...AVATAR_KEYS],
    })
  }
}

/**
 * Avatar — pick the right SVG by id. Returns null for unknown ids so
 * fall-through to a default is one-line. Used by ProfileAvatar and the
 * picker grid alike. `forwardRef` so parents can pass refs for tooltip
 * / focus management.
 */
const Avatar = forwardRef(function Avatar({ id, ...svgProps }, ref) {
  const entry = AVATARS[id]
  if (!entry) return null
  const Cmp = entry.component
  return <Cmp ref={ref} {...svgProps} />
})

export default Avatar
