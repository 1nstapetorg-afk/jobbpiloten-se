'use client'

import { Plane } from 'lucide-react'
import Avatar, { AVATARS } from '@/components/avatars'

/**
 * ProfileAvatar — universal avatar renderer.
 *
 * Three render paths, decided by `profile?.profilePicture?.type`:
 *
 *   1. `type === 'upload'` — render an `<img>` from the `value` data URL.
 *      The data URL is stored at upload time (see settings page) so we
 *      never re-encode the image after a refresh.
 *   2. `type === 'avatar'` — look up the registered SVG by id in
 *      `AVATARS` and render it. Unknown id falls through to default.
 *   3. no entry (or unknown type) — render the default JobbPiloten
 *      plane icon in an indigo-to-blue gradient circle. Always shown
 *      for new users.
 *
 * Props:
 *   - profile: the full profile object read from /api/profile. We only
 *     need `profile.profilePicture`; the entire object is taken so the
 *     caller has one stable prop to pass from dashboards / settings.
 *   - size: pixel size for both width and height. Default 32. Use a
 *     sensible number per call-site (32 nav, 64 modal, 120 settings).
 *   - ring: optional ring class to apply for picker / selected state
 *     (e.g. "ring-4 ring-amber-400"). Defaults to "".
 *   - className: extra classes merged onto the outermost wrapper.
 *   - alt: alt text for screen readers; defaults to "Profilbild".
 *   - data-testid: optional testid for e2e specs.
 *
 * The same component is used in 4 contexts with stable testids:
 *   - dashboard nav header: `profile-avatar-nav` (32px)
 *   - cover letter modal:    `profile-avatar-modal` (64px)
 *   - settings picker card:  `profile-avatar-picker` (28px swatch)
 *   - settings preview:      `profile-avatar-preview` (120px)
 */
export default function ProfileAvatar({
  profile,
  size = 32,
  ring = '',
  className = '',
  alt = 'Profilbild',
  dataTestid = 'profile-avatar',
}) {
  const pp = profile?.profilePicture
  const baseClass = `inline-block rounded-full overflow-hidden shrink-0 ${ring} ${className}`.trim()

  // Default avatar: indigo→blue gradient disc + JobbPiloten plane icon.
  // Same visual language as the navbar logo lockup so a fresh user
  // doesn't see a "blank circle". One helper, three call-sites
  // (no-pp / unknown-slug / defensive fallthrough) so future visual
  // tweaks propagate in one place.
  const renderDefault = () => (
    <span
      className={`${baseClass} bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center`}
      style={{ width: size, height: size }}
      aria-label={alt}
      role="img"
      data-testid={dataTestid}
      data-avatar-source="default"
    >
      <Plane
        className="text-white -rotate-45"
        style={{ width: Math.round(size * 0.55), height: Math.round(size * 0.55) }}
        aria-hidden="true"
      />
    </span>
  )

  // ---- Path 3: default (no profilePicture or unknown type) -------------
  if (!pp || (pp.type !== 'upload' && pp.type !== 'avatar')) {
    return renderDefault()
  }

  // ---- Path 1: user-uploaded photo -------------------------------------
  if (pp.type === 'upload' && typeof pp.value === 'string' && pp.value.length > 0) {
    return (
      <span
        className={baseClass}
        style={{ width: size, height: size }}
        data-testid={dataTestid}
        data-avatar-source="upload"
      >
        <img
          src={pp.value}
          alt={alt}
          width={size}
          height={size}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </span>
    )
  }

  // ---- Path 2: chosen cartoon avatar from the registry ----------------
  if (pp.type === 'avatar') {
    const entry = AVATARS[pp.value]
    if (!entry) {
      // Unknown avatar id (e.g. a slug from an older build) — render the
      // default rather than crash. Same logic renders whether `value`
      // is missing entirely or references a slug not in the registry.
      return renderDefault()
    }
    const Cmp = entry.component
    return (
      <span
        className={baseClass}
        style={{ width: size, height: size }}
        data-testid={dataTestid}
        data-avatar-source="avatar"
        data-avatar-id={pp.value}
      >
        <Cmp width={size} height={size} className="block w-full h-full" />
      </span>
    )
  }

  // Defensive fallthrough — all valid `type` values are handled above,
  // so if a future caller introduces a new `type` we land here and
  // render the default rather than an empty span.
  return renderDefault()
}
