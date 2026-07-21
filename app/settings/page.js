'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// `useCallback` is used by the page-level `load` callback to keep
// the `useEffect([isLoaded, load])` dependency stable.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useUser } from '@/hooks/useAuth'
import { motion } from 'framer-motion'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import ErrorBoundary from '@/components/ErrorBoundary'

import {
  Plane, Settings as SettingsIcon, User, CreditCard, Bell, BellOff, Database,
  Download, Trash2, Save, Loader2, ArrowLeft, ShieldAlert,
  Briefcase, FileUp, AlertTriangle, Upload, Sparkles, Check, Puzzle, Bot,
  MessageSquareQuote, Pencil, Star as StarFill, BookOpen, ListChecks,
} from 'lucide-react'
import CVFileUpload from '@/components/CVFileUpload'
import ProfileAvatar from '@/components/ProfileAvatar'
import { AVATARS, AVATAR_ORDER } from '@/components/avatars'
import { AVATAR_RARITY, RARITY_TIERS } from '@/lib/avatar-keys'
import { SUPPORT_EMAIL, VAPID_PUBLIC_KEY, EXTENSION_PUBLISHED, EXTENSION_STORE_URL, EXTENSION_INSTALL_GUIDE_PATH } from '@/lib/siteConfig'
import { isClerkConfiguredClient as isClerkConfigured } from '@/lib/clerk-config'
import { STYLE_PRESETS, resolveStylePreset } from '@/lib/style-presets.mjs'
import { detectCvFormattingIssues } from '@/lib/ats-keywords'
import { findStyleInconsistencies, renderInconsistencyCopy } from '@/lib/style-consistency'
// 2026-07-16 (Round-12) — Auto-fill field registry. Single source of
// truth for the 16 new fields the extension's FIELD_PATTERNS dispatch
// on. lib/extension-profile.js#buildExtensionProfile imports the same
// module so the safe-JSON shape sent to the extension and the form
// shape here can never drift on keys, labels, defaults, or options.
import {
  ROUND12_BOOLEAN_KEYS,
  ROUND12_UI_BOOLEAN_KEYS,
  ROUND12_BOOLEAN_LABELS,
  ROUND12_STRING_KEYS,
  ROUND12_GENDER_OPTIONS,
  ROUND12_SKILL_OPTIONS,
  getRound12Defaults,
} from '@/lib/extension-profile-fields'

// Clerk user button — dynamic + crash-safe so the whole page still renders
// when @clerk/nextjs fails to load (e.g. in demo mode without keys).
const ClerkUserButton = dynamic(
  () => import('@clerk/nextjs').then(mod => ({ default: mod.UserButton })).catch(() => ({ default: () => null })),
  { ssr: false },
)

function SafeUserButton(props) {
  if (!isClerkConfigured()) return null
  return <ClerkUserButton {...props} />
}

// ---------------------- Helpers ----------------------

/** Split a comma-list text field into a cleaned string array, dropping
 *  empties / surrounding whitespace. Used for `jobTitles` and `locations`
 *  which the form exposes as a single text input. */
function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Inverse of `splitCsv` — turns an array back into the comma-separated
 *  string the user sees in the text input. */
function joinCsv(arr) {
  return Array.isArray(arr) ? arr.join(', ') : ''
}

/** Canonical list of Anställningstyp values exposed in the multi-select.
 *  Single source of truth for the form checkboxes (settings + onboarding)
 *  and the server-side filter (`lib/jobScraper.normalizeEmploymentType`).
 *  Order is preserved for visual stability in the picker — the most
 *  common value (`heltid`) sits first. */
const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'heltid', label: 'Heltid' },
  { value: 'deltid', label: 'Deltid' },
  { value: 'konsult', label: 'Konsult' },
  { value: 'praktik', label: 'Praktik' },
  { value: 'tillsvidare', label: 'Tillsvidare' },
  { value: 'visstid', label: 'Visstid' },
]

const INDUSTRY_OPTIONS = ['Försvar', 'Tobak', 'Spel', 'Olja & Gas']

// ---- 2026-07-16 (Round-12) — Auto-fill extension field options ----
// All 16 new fields' keys, labels, skill options, gender options, and
// defaults are imported from @/lib/extension-profile-fields so this
// page and lib/extension-profile.js#buildExtensionProfile share one
// source of truth. Adding a 17th field means editing the shared module
// only — both surfaces pick it up automatically.

const fmtDate = (d) => {
  if (!d) return '—'
  const x = new Date(d)
  return Number.isNaN(x.getTime())
    ? '—'
    : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Profile → flat form-shape coercion. Used by both ProfileEditor's
 * `useState(() => …)` initializer and its `handleReset` so the two
 * entry points can't drift apart as fields are added in the future.
 * Profile-picture handling: stored as `{type, value}` OR null, so we
 * coerce non-objects (string, undefined, etc.) to null instead of
 * trying to read `pp.type` off a primitive.
 */
function formFromProfile(profile) {
  return {
    fullName: profile?.fullName ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    personalNumber: profile?.personalNumber ?? '',
    address: profile?.address ?? '',
    linkedin: profile?.linkedin ?? '',
    jobTitles: joinCsv(profile?.jobTitles),
    locations: joinCsv(profile?.locations),
    salaryMin: profile?.salaryMin ?? '',
    experience: profile?.experience ?? '',
    workPreference: profile?.workPreference ?? '',
    employmentType: Array.isArray(profile?.employmentType)
      ? [...profile.employmentType]
      : profile?.employmentType
        ? [profile.employmentType]
        : [],
    industriesToAvoid: Array.isArray(profile?.industriesToAvoid) ? profile.industriesToAvoid : [],
    cvSummary: profile?.cvSummary ?? '',
    afCaseNumber: profile?.afCaseNumber ?? '',
    profilePicture: profile?.profilePicture && typeof profile.profilePicture === 'object'
      ? profile.profilePicture
      : null,
    // Persisted collection progress — server-stamped array of avatar
    // slugs the user has unlocked. Seeded from the saved profile on
    // mount; pushed back into Mongo when the user clicks "Spara
    // ändringar". Empty array = empty collection.
    collectedAvatars: Array.isArray(profile?.collectedAvatars)
      ? [...profile.collectedAvatars]
      : [],
    // ---- 2026-07-16 (Round-12) — Auto-fill extension fields ----
    // These fields power the extension's Round-12 FIELD_PATTERNS
    // dispatch. The form keeps them as plain strings/booleans/numbers;
    // the dashboard's `buildExtensionProfile` (lib/extension-profile.js)
    // re-shapes them into the JSON shape sent to the extension via
    // postMessage JOBBPILOTEN_AUTH_SYNC. Defaults match the
    // extension's safe-empty defaults: booleans → false (untouched
    // host fields), number → 0, arrays → [], strings → ''. The two
    // non-empty defaults are `phoneCountryCode: '+46'` (Sweden) and
    // `gender: ''` (preserves the legacy fallback in buildExtensionProfile).
    hasDriversLicense: Boolean(profile?.hasDriversLicense) === true,
    // 2026-07-21 (Round-73 / BUG F) — nuvarande arbete split keys
    currentJobTitle: profile?.currentJobTitle ?? '',
    currentOrganization: profile?.currentOrganization ?? '',
    isEuCitizen: Boolean(profile?.isEuCitizen) === true,
    hasWorkPermit: Boolean(profile?.hasWorkPermit) === true,
    yearsExperience: Number.isFinite(Number(profile?.yearsExperience))
      ? Number(profile.yearsExperience)
      : 0,
    hasHighSchoolDiploma: Boolean(profile?.hasHighSchoolDiploma) === true,
    hasForkliftLicense: Boolean(profile?.hasForkliftLicense) === true,
    hasSecurityClearance: Boolean(profile?.hasSecurityClearance) === true,
    hasLeadershipExperience: Boolean(profile?.hasLeadershipExperience) === true,
    isBilingual: Boolean(profile?.isBilingual) === true,
    hasTechnicalEducation: Boolean(profile?.hasTechnicalEducation) === true,
    hasCustomerExperience: Boolean(profile?.hasCustomerExperience) === true,
    dateOfBirth: typeof profile?.dateOfBirth === 'string' ? profile.dateOfBirth : '',
    gender: typeof profile?.gender === 'string' ? profile.gender : '',
    nationality: typeof profile?.nationality === 'string' ? profile.nationality : '',
    phoneCountryCode: typeof profile?.phoneCountryCode === 'string' && profile.phoneCountryCode
      ? profile.phoneCountryCode
      : '+46',
    skills: Array.isArray(profile?.skills)
      ? profile.skills.filter((s) => typeof s === 'string')
      : [],
    // GDPR / terms auto-consent — DEFAULT FALSE for legal safety.
    // The extension paints this with a dedicated `consent_unchecked`
    // slate-grey outline and never clicks the host checkbox unless
    // the user explicitly toggles this on.
    autoConsent: Boolean(profile?.autoConsent) === true,
  }
}

// ---------------------- Sub-components ----------------------

/** Field-level diff helper. Builds a sparse object containing only the keys
 *  where the form differs from the loaded profile. Used so the form only
 *  sends dirty fields — every cloud-saved value stays exactly as-is on
 *  partial saves. */
function buildPatch(profile, form) {
  const out = {}
  // Direct string fields
  const directFields = [
    'fullName', 'email', 'phone', 'personalNumber', 'address', 'linkedin', 'cvSummary', 'afCaseNumber',
    'currentJobTitle',
    'currentOrganization',
  ]
  for (const k of directFields) {
    const prev = profile?.[k] ?? ''
    if ((form[k] ?? '') !== prev) out[k] = form[k]
  }
  // Numeric field — parse so "" doesn't round-trip as the literal string.
  const salaryNum = form.salaryMin === '' || form.salaryMin == null ? null : Number(form.salaryMin)
  const prevSalary = profile?.salaryMin ?? null
  if (salaryNum !== prevSalary) out.salaryMin = Number.isFinite(salaryNum) ? salaryNum : null
  // Array fields (CSV text → string[]). Compared *sorted* so reordering
  // an array doesn't trigger a no-op save.
  const a = splitCsv(form.jobTitles)
  const b = profile?.jobTitles || []
  if (JSON.stringify([...a].sort()) !== JSON.stringify([...b].sort())) out.jobTitles = a
  const c = splitCsv(form.locations)
  const d = profile?.locations || []
  if (JSON.stringify([...c].sort()) !== JSON.stringify([...d].sort())) out.locations = c
  // Profile picture — compare structurally. Stored as either `null` or
  // `{ type, value }`. Treats undefined server-side as null for the compare.
  const prev = profile?.profilePicture || null
  if (JSON.stringify(prev) !== JSON.stringify(form.profilePicture)) {
    out.profilePicture = (form.profilePicture === null) ? null : {
      type: form.profilePicture.type,
      value: form.profilePicture.value,
    }
  }
  // Select fields are compared as-is. Neither the form nor the server
  // serialises these with '|' separators historically — the earlier
  // `.split('|')[0]` here was a vestige of an older multi-value
  // encoding; current callers pass plain strings end-to-end.
  //
  // Issue 2 (2026-07-10): `employmentType` is now an array (multi-
  // select) while `experience` and `workPreference` remain single
  // values. We compare the array as a sorted JSON to keep dirty-
  // detection stable across reorderings, with a backwards-compat
  // step that wraps a legacy string value into a single-item array
  // so an old profile's `employmentType: 'heltid'` still shows as
  // dirty when the form reads it as `['heltid']` (it shouldn't).
  const sel = ['experience', 'workPreference']
  for (const k of sel) {
    const fv = form[k] ?? ''
    const pv = (profile?.[k] ?? '').toString()
    if (fv !== pv) out[k] = fv || undefined
  }
  const profEmpArr = Array.isArray(profile?.employmentType)
    ? profile.employmentType
    : (profile?.employmentType ? [profile.employmentType] : [])
  const formEmpArr = Array.isArray(form.employmentType) ? form.employmentType : []
  if (JSON.stringify([...formEmpArr].sort()) !== JSON.stringify([...profEmpArr].sort())) {
    out.employmentType = formEmpArr
  }
  // Industries — sorted-compare so reordering doesn't trigger a save.
  const formInd = [...(form.industriesToAvoid || [])].sort()
  const profInd = [...(profile?.industriesToAvoid || [])].sort()
  if (JSON.stringify(formInd) !== JSON.stringify(profInd)) {
    out.industriesToAvoid = formInd
  }
  // Persisted collection progress — sorted-compare for the same reason
  // (reordering ids is a no-op). Always send the array so the server
  // clears stale ids on a round-trip.
  const formCol = [...(form.collectedAvatars || [])].sort()
  const profCol = [...(profile?.collectedAvatars || [])].sort()
  if (JSON.stringify(formCol) !== JSON.stringify(profCol)) {
    out.collectedAvatars = formCol
  }
  // ---- 2026-07-16 (Round-12) — Auto-fill extension fields ----
  // Each field is compared against its saved value (treating
  // undefined and false as equivalent so a fresh profile with all
  // booleans undefined doesn't trigger a no-op save when the user
  // toggles them on). Boolean fields are normalised via Boolean(x)
  // to make the comparison robust to the form's uncontrolled-input
  // quirks (the Switch component's onCheckedChange gives us a
  // boolean, but if a future control returns a string 'true' /
  // 'false' we'd still classify it correctly). yearsExperience is
  // normalised to a number with a `Number.isFinite` guard so a
  // NaN never gets written to Mongo.
  // `ROUND12_BOOLEAN_KEYS` from lib/extension-profile-fields.js
  // includes `autoConsent` (the GDPR toggle). We compare the form
  // value against the profile value, falling back to the shared
  // default (false) on a fresh profile so toggling on a brand-new
  // account surfaces as a real save.
  for (const k of ROUND12_BOOLEAN_KEYS) {
    const fv = Boolean(form[k]) === true
    const pv = Boolean(profile?.[k]) === true
    if (fv !== pv) out[k] = fv
  }
  const yearsForm = Number(form.yearsExperience)
  const yearsPrev = Number(profile?.yearsExperience)
  const yearsFormOk = Number.isFinite(yearsForm)
  const yearsPrevOk = Number.isFinite(yearsPrev)
  // Compare against the safe defaults (0 / 0) so a user typing "3"
  // on a profile that was never saved with yearsExperience triggers
  // a save. Both sides coerced to finite numbers before compare.
  if (yearsFormOk && yearsForm !== (yearsPrevOk ? yearsPrev : 0)) {
    out.yearsExperience = yearsForm
  } else if (!yearsFormOk && yearsPrevOk && yearsPrev !== 0) {
    // Form has invalid input (NaN) but server had a real value —
    // skip the round-trip rather than write garbage.
  }
  // String fields: direct compare. Default '' on both sides so a
  // profile that never set dateOfBirth doesn't trigger a save when
  // the user later types a value. `ROUND12_STRING_KEYS` from the
  // shared registry includes phoneCountryCode (which has a real
  // '+46' default — the form's `formFromProfile` always emits
  // '+46' for the empty-profile case, so we normalise the profile
  // side to the same default to prevent a never-dirty state).
  for (const k of ROUND12_STRING_KEYS) {
    const fv = String(form[k] ?? '')
    let pv = String(profile?.[k] ?? '')
    // phoneCountryCode: treat empty/undefined profile value the same
    // as the '+46' default that formFromProfile emits, otherwise the
    // form starts dirty on every page load.
    if (k === 'phoneCountryCode' && pv === '') pv = '+46'
    if (fv !== pv) out[k] = fv
  }
  // Skills — sorted-compare so reordering the chips doesn't trigger
  // a no-op save. Same pattern as industriesToAvoid above.
  const formSkills = [...(form.skills || [])].sort()
  const profSkills = [...(Array.isArray(profile?.skills) ? profile.skills : [])].sort()
  if (JSON.stringify(formSkills) !== JSON.stringify(profSkills)) {
    out.skills = formSkills
  }
  // Drop undefined entries (from "|| undefined") so the patch is clean.
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

/**
 * ProfilePictureSection — top-of-form section that lets the user pick a
 * cartoon avatar OR upload their own photo. The two modes share the same
 * form field (`form.profilePicture = { type, value } | null`) so the section
 * is fully controlled by the parent ProfileEditor — saves via the page's
 * "Spara ändringar" button exactly like the rest of the form fields.
 *
 * Conventions:
 *   • `value` is the current selection (matches the saved server state on
 *     first render). It can be `undefined` (= default), `null` (= cleared),
 *     or `{ type: 'avatar'|'upload', value }`.
 *   • `onChange(next)` writes back to the form via `setField('profilePicture', next)`.
 *   • Each avatar cell uses the shared ProfileAvatar component so the
 *     picker grid, dashboard nav, and modal all render the same way.
 *   • The 120x120 preview at the top reflects the LIVE selection so
 *     users see what they're about to save.
 */
const PICTURE_MAX_BYTES = 2 * 1024 * 1024 // 2 MB — matches server-side guard
const PICTURE_ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
function ProfilePictureSection({ profile, value, onChange, collectedAvatars = [], onCollectedAvatarsChange }) {
  const initialTab = value?.type === 'upload' ? 'upload' : 'avatar'
  const [tab, setTab] = useState(initialTab)
  const [error, setError] = useState('')


  const fileInputRef = useRef(null)

  const handleFile = (file) => {
    setError('')
    if (!file) return
    if (file.size > PICTURE_MAX_BYTES) {
      setError(`Filen är för stor — max ${(PICTURE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`)
      return
    }
    if (!PICTURE_ACCEPTED_MIME.has(file.type)) {
      setError('Endast JPG, PNG och WebP stöds.')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = String(e.target?.result || '')
      if (!dataUrl.startsWith('data:image/')) {
        setError('Kunde inte läsa bilden — försök igen.')
        return
      }
      onChange({ type: 'upload', value: dataUrl })
    }
    reader.onerror = () => setError('Kunde inte läsa filen — försök igen.')
    reader.readAsDataURL(file)
  }

  const onFileInputChange = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset so the same file can be reselected after a fix-and-retry.
    e.target.value = ''
  }

  const pickAvatar = (id) => {
    onChange({ type: 'avatar', value: id })
    // Persist the addition: pickAvatar is now the only path that updates
    // the server-backed collectedAvatars array. Mirror it in the parent
    // form so it round-trips to Mongo on the next Save. Idempotent:
    // buildPatch compares sorted arrays so duplicates don't cause a
    // no-op save. We also .sort() the emitted array so form state
    // matches the wire format and the persisted Mongo doc is order-
    // stable.
    if (typeof onCollectedAvatarsChange === 'function') {
      const next = Array.from(new Set([...(collectedAvatars || []), id])).sort()
      onCollectedAvatarsChange(next)
    }
  }

  const clearPicture = () => {
    onChange(null)
    setError('')
  }

  const selectedAvatarName =
    value?.type === 'avatar' ? AVATARS[value.value]?.name : null

  // Snake-cased tab keys so data-testid values stay URL-safe in e2e specs.
  return (
    <section className="space-y-4" data-testid="settings-profile-picture">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <Sparkles className="w-4 h-4 text-indigo-600" />
        <h3 className="text-sm font-semibold text-slate-900">Din profilbild</h3>
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        Välj en av våra tecknade avatarer eller ladda upp ett eget foto —
        bilden visas i dashboardens sidhuvud och i brev-modalen.
      </p>

      {/* 120x120 live preview, centred. Uses the actual `value` (and
          falls back to `profile` if value is undefined) so the user
          always sees what will be saved at Spara. */}
      <div className="flex items-center gap-4">
        <ProfileAvatar
          profile={value ? { profilePicture: value } : profile}
          size={120}
          dataTestid="profile-avatar-preview"
          ring="ring-2 ring-slate-200"
          className="bg-slate-100"
        />
        <div className="flex-1 min-w-0">
          {selectedAvatarName ? (
            <p className="text-sm text-slate-700">
              Du har valt: <strong className="text-indigo-700">{selectedAvatarName}</strong>
            </p>
          ) : value?.type === 'upload' ? (
            <p className="text-sm text-slate-700">
              Eget foto är valt. Växla till <em>Välj avatar</em> om du vill byta.
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Ingen bild vald — JobbPilotens standardikon visas just nu.
            </p>
          )}
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearPicture}
              className="mt-1 h-7 px-2 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50"
              data-testid="settings-pp-clear"
            >
              <Trash2 className="w-3 h-3 mr-1" /> Återställ till standard
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Profilbildkälla"
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1"
      >
        {[
          { key: 'avatar', label: 'Välj avatar' },
          { key: 'upload', label: 'Ladda upp foto' },
        ].map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`settings-pp-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={
                active
                  ? 'px-3 py-1.5 rounded-md text-xs font-medium bg-white shadow-sm text-slate-900 transition-colors'
                  : 'px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors'
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'avatar' && (
        <div className="space-y-3">
        <div
          data-testid="settings-pp-collection-progress"
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700"
          aria-label="Samlingsstatus för JobbPiloten-avatarerna"
        >
          <span className="font-semibold">
            <Sparkles className="w-3 h-3 inline mr-1 text-amber-600" />
            {collectedAvatars.length} av {AVATAR_ORDER.length} samlade
          </span>
          <span className="text-slate-400">·</span>
          {RARITY_TIERS.map(t => {
            const total = AVATAR_ORDER.filter(id => AVATAR_RARITY[id]?.rarity === t.rarity).length
            if (total === 0) return null
            const owned = AVATAR_ORDER.filter(id => AVATAR_RARITY[id]?.rarity === t.rarity && collectedAvatars.includes(id)).length
            return (
              <span
                key={t.rarity}
                className="inline-flex items-center gap-1.5"
                title={`${t.label} ${owned}/${total}`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: t.color }}
                  aria-hidden="true"
                />
                <span className="text-slate-600">{t.label}</span>
                <span className="font-semibold text-slate-900 tabular-nums">{owned}/{total}</span>
              </span>
            )
          })}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" data-testid="settings-pp-avatar-grid">
          {AVATAR_ORDER.map(id => {
            const entry = AVATARS[id]
            const isSelected = value?.type === 'avatar' && value.value === id
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid={`settings-pp-avatar-${id}`}
                onClick={() => pickAvatar(id)}
                title={`${entry.name} — klicka för att välja`}
                className={
                  'group flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ' +
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
                  (isSelected
                    ? 'border-amber-400 bg-amber-50 ring-[3px] ring-amber-300 scale-[1.05] shadow-sm'
                    : 'border-slate-200 hover:border-amber-300 hover:bg-amber-50/40 hover:scale-[1.05] hover:shadow-md')
                }
              >
                <ProfileAvatar
                  profile={{ profilePicture: { type: 'avatar', value: id } }}
                  size={56}
                  dataTestid={`profile-avatar-picker`}
                  data-avatar-id={id}
                />
                <span className="text-xs font-medium text-slate-700 text-center">{entry.name}</span>
                {isSelected && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                    <Check className="w-3 h-3" /> Vald
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      )}

      {tab === 'upload' && (
        <div className="space-y-2" data-testid="settings-pp-upload-zone">
          {/* Either dropzone (no file) or file card (upload present) */}
          {value?.type !== 'upload' ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer?.files?.[0]
                if (file) handleFile(file)
              }}
              onDragOver={(e) => e.preventDefault()}
              className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/60 hover:border-amber-400 hover:bg-amber-50/40 px-4 py-7 text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              data-testid="settings-pp-dropzone"
            >
              <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                <Upload className="w-6 h-6 text-amber-600" />
              </div>
              <p className="text-sm font-medium text-slate-800">
                Dra och släpp en bild, eller klicka för att välja fil
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white border border-slate-200 text-slate-600">
                  JPG, PNG, WebP
                </span>
                <span className="text-[11px] text-slate-500">Max 2 MB</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onFileInputChange}
                data-testid="settings-pp-fileinput"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 flex items-center gap-3">
              <ProfileAvatar
                profile={{ profilePicture: value }}
                size={48}
                ring="ring-1 ring-emerald-300"
                className="border border-emerald-200"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 truncate">Eget foto uppladdat</p>
                <p className="text-[11px] text-slate-500">Sparas när du klickar <strong>Spara ändringar</strong>.</p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-7 text-xs"
                    data-testid="settings-pp-replace"
                  >
                    Byt bild
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={clearPicture}
                    className="h-7 text-xs text-red-600 hover:bg-red-50"
                    data-testid="settings-pp-remove"
                  >
                    Ta bort
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={onFileInputChange}
                  data-testid="settings-pp-fileinput"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5"
          data-testid="settings-pp-error"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Bilden lagras som en del av din profil (max 2 MB). Inga tredjeparts-API:er används — allt
        ligger i din egen MongoDB-dokument och visas bara i JobbPiloten.
      </p>
    </section>
  )
}

function ProfileEditor({ profile, onSaved }) {
  // Form state. `jobTitles` and `locations` are kept as comma-separated
  // strings (single text input) — split into arrays only at save time.
  // The coercion `profile -> form` shape lives in `formFromProfile` so
  // the `useState` initializer and `handleReset` cannot drift apart.
  const [form, setForm] = useState(() => formFromProfile(profile))
  // Sync form state when the profile reference changes (e.g. after a
  // successful save triggers load() which fetches the updated profile).
  // This clears the "osparade ändringar" indicator so the user sees the
  // save took effect — without this, buildPatch(profile, form) would
  // still see differences because the form state was captured at mount.
  useEffect(() => {
    setForm(formFromProfile(profile))
  }, [profile])
  const [saving, setSaving] = useState(false)
  // Part 5: CV enhancement state lives at the component top level
  // (not inside a JSX expression) so the hook call order is stable
  // across renders — Rules of Hooks compliance. The handler
  // `enhanceCvSummary` is defined right after the other handlers
  // and reads the latest `form.cvSummary` via the setter path.
  const [enhancingCv, setEnhancingCv] = useState(false)
  const enhanceCvSummary = async () => {
    if (enhancingCv) return
    setEnhancingCv(true)
    try {
      const res = await fetch('/api/cv-enhance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: form.cvSummary, focus: 'resultat' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Kunde inte förbättra.')
      setField('cvSummary', String(json.enhanced || form.cvSummary))
      toast.success(`Förbättrad (${json.source || 'pure'}). Granska och spara.`)
    } catch (err) {
      toast.error('Kunde inte förbättra: ' + err.message)
    } finally {
      setEnhancingCv(false)
    }
  }

  // Ref for the manual summary textarea. CVFileUpload fires its
  // `onFallbackRequired` callback whenever parsing fails or returns
  // empty (scanned/imagePDF); we scroll/focus the textarea in those
  // cases so the user can keep going without leaving the page.
  const cvSummaryRef = useRef(null)
  const focusManualTextarea = () => {
    const el = cvSummaryRef.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Defer focus one tick so the smooth scroll has started; the
    // browser then focuses the textarea without re-scrolling on top
    // of our request.
    setTimeout(() => {
      try { el.focus({ preventScroll: true }) } catch (_) { /* old browsers */ }
    }, 60)
  }

  // Diff between form and loaded profile. memoized to avoid re-computing
  // every render — only when form changes.
  const patch = useMemo(() => buildPatch(profile, form), [profile, form])
  const dirty = Object.keys(patch).length > 0

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const toggleIndustry = (industry) => {
    setField('industriesToAvoid',
      form.industriesToAvoid.includes(industry)
        ? form.industriesToAvoid.filter((x) => x !== industry)
        : [...form.industriesToAvoid, industry],
    )
  }
  // Issue 2 (2026-07-10): employmentType is now a multi-select array
  // (was a single string). `toggleEmploymentType` is the standard
  // add/remove pattern — same shape as `toggleIndustry` above so the
  // two checkbox grids feel consistent to the user. The form value is
  // never `null`/`undefined` because `formFromProfile` always returns
  // an array (possibly empty), so the `|| []` guards below are belt-
  // and-suspenders against any future code path that might bypass
  // the initialiser.
  const toggleEmploymentType = (type) => {
    const current = Array.isArray(form.employmentType) ? form.employmentType : []
    setField('employmentType',
      current.includes(type)
        ? current.filter((x) => x !== type)
        : [...current, type],
    )
  }
  // ---- 2026-07-16 (Round-12) — Skills multi-select ----
  // Mirrors `toggleEmploymentType` exactly: array add/remove with the
  // same shape so the chips grid feels consistent with the
  // anställningstyp and industries grids above. `formFromProfile`
  // always returns an array for `skills` so the `|| []` guard is
  // belt-and-suspenders against any future code path that bypasses
  // the initialiser.
  const toggleSkill = (skill) => {
    const current = Array.isArray(form.skills) ? form.skills : []
    setField('skills',
      current.includes(skill)
        ? current.filter((x) => x !== skill)
        : [...current, skill],
    )
  }

  const handleSave = async () => {
    if (saving || !dirty) return
    setSaving(true)
    try {
      const res = await fetch('/api/profile-update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        toast.error(json.error || 'Kunde inte spara ändringarna')
        return
      }
      toast.success(`Profil uppdaterad (${json.updated ?? Object.keys(patch).length} fält)`)
      onSaved?.()
    } catch (err) {
      toast.error('Oj, något gick fel: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!profile) return
    setForm(formFromProfile(profile))
  }

  return (
    <div className="space-y-6">
      {/* ---- Profilbild (top of form so users see their face first) ---- */}
      <ProfilePictureSection
        profile={profile}
        value={form.profilePicture}
        onChange={(v) => setField('profilePicture', v)}
        collectedAvatars={form.collectedAvatars}
        onCollectedAvatarsChange={(next) => setField('collectedAvatars', next)}
      />

      {/* ---- Personuppgifter ---- */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <User className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">Personuppgifter</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Fullständigt namn</Label>
            <Input
              id="fullName"
              data-testid="settings-fullName"
              value={form.fullName}
              onChange={(e) => setField('fullName', e.target.value)}
              placeholder="Anna Andersson"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">E-post</Label>
            <Input
              id="email"
              type="email"
              data-testid="settings-email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="anna@example.se"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefon</Label>
            <Input
              id="phone"
              type="tel"
              data-testid="settings-phone"
              value={form.phone}
              onChange={(e) => setField('phone', e.target.value)}
              placeholder="070-123 45 67"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="personalNumber">Personnummer</Label>
            <Input
              id="personalNumber"
              data-testid="settings-personalNumber"
              value={form.personalNumber}
              onChange={(e) => setField('personalNumber', e.target.value)}
              placeholder="YYYYMMDD-XXXX"
            />
          </div>
          {/* 2026-07-21 (Round-73 / BUG F) — split nuvarande arbete */}
          <div className="space-y-1.5">
            <Label htmlFor="currentJobTitle">Nuvarande arbete / titel</Label>
            <Input
              id="currentJobTitle"
              data-testid="settings-currentJobTitle"
              value={form.currentJobTitle}
              onChange={(e) => setField('currentJobTitle', e.target.value)}
              placeholder="Lagerarbetare"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currentOrganization">Nuvarande arbetsgivare / organisation</Label>
            <Input
              id="currentOrganization"
              data-testid="settings-currentOrganization"
              value={form.currentOrganization}
              onChange={(e) => setField('currentOrganization', e.target.value)}
              placeholder="PostNord AB"
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="address">Adress</Label>
            <Input
              id="address"
              data-testid="settings-address"
              value={form.address}
              onChange={(e) => setField('address', e.target.value)}
              placeholder="Storgatan 1, 111 22 Stockholm"
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="linkedin">LinkedIn-URL</Label>
            <Input
              id="linkedin"
              type="url"
              data-testid="settings-linkedin"
              value={form.linkedin}
              onChange={(e) => setField('linkedin', e.target.value)}
              placeholder="https://linkedin.com/in/anna"
            />
          </div>
          {/* Part 7 — AF ärendenummer. Optional field. The user
              can paste their AF case number here so the dashboard
              can include it in the Aktivitetsrapport (PDF) and
              the AF-compliance check. Free-form text (no Swedish
              personnummer validation here — that's a separate
              field above) so the user can paste a foreign-issued
              case id if their AF-handläggare uses one. */}
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="afCaseNumber">Arbetsförmedlingens ärendenummer (valfritt)</Label>
            <Input
              id="afCaseNumber"
              data-testid="settings-afCaseNumber"
              value={form.afCaseNumber ?? ''}
              onChange={(e) => setField('afCaseNumber', e.target.value)}
              placeholder="t.ex. 2024-12345"
            />
            <p className="text-[10px] text-slate-500">Visas i din Aktivitetsrapport så AF kan koppla rapporten till ditt ärende.</p>
          </div>
        </div>
      </section>

      {/* ---- Karriär ---- */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Briefcase className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">Karriärprofil</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="jobTitles">Önskade jobbtitlar (komma-separerade)</Label>
            <Input
              id="jobTitles"
              data-testid="settings-jobTitles"
              value={form.jobTitles}
              onChange={(e) => setField('jobTitles', e.target.value)}
              placeholder="Frontend Developer, UX Designer"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="locations">Önskade orter (komma-separerade)</Label>
            <Input
              id="locations"
              data-testid="settings-locations"
              value={form.locations}
              onChange={(e) => setField('locations', e.target.value)}
              placeholder="Stockholm, Göteborg, Distans"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salaryMin">Minimilön (kr/mån)</Label>
            <Input
              id="salaryMin"
              type="number"
              min="0"
              data-testid="settings-salaryMin"
              value={form.salaryMin}
              onChange={(e) => setField('salaryMin', e.target.value)}
              placeholder="35000"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="experience">Erfarenhetsnivå</Label>
            <Select value={form.experience} onValueChange={(v) => setField('experience', v)}>
              <SelectTrigger id="experience" data-testid="settings-experience">
                <SelectValue placeholder="Välj nivå" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Junior">Junior</SelectItem>
                <SelectItem value="Medior">Medior</SelectItem>
                <SelectItem value="Senior">Senior</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workPreference">Arbetsform</Label>
            <Select value={form.workPreference} onValueChange={(v) => setField('workPreference', v)}>
              <SelectTrigger id="workPreference" data-testid="settings-workPreference">
                <SelectValue placeholder="Välj arbetsform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="remote">Distansarbete</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="onsite">På plats</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Anställningstyp (välj en eller flera)</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="settings-employmentType">
              {EMPLOYMENT_TYPE_OPTIONS.map((opt) => {
                const isChecked = Array.isArray(form.employmentType) && form.employmentType.includes(opt.value)
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 text-sm text-slate-700 px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleEmploymentType(opt.value)}
                      data-testid={`settings-employmentType-${opt.value}`}
                    />
                    <span>{opt.label}</span>
                  </label>
                )
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              Tomt = alla typer visas. AI:n använder dina val för att filtrera bort jobb som inte matchar.
            </p>
          </div>
        </div>

        {/* Industries to avoid — checkbox row */}
        <div className="space-y-2">
          <Label>Branscher att undvika</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {INDUSTRY_OPTIONS.map((ind) => (
              <label
                key={ind}
                className="flex items-center gap-2 text-sm text-slate-700 px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={form.industriesToAvoid.includes(ind)}
                  onCheckedChange={() => toggleIndustry(ind)}
                  data-testid={`settings-industry-${ind}`}
                />
                <span>{ind}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* ---- CV ---- */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <FileUp className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">CV-fil</h3>
        </div>
        <p className="text-xs text-slate-500 -mt-1">
          Ladda upp ditt CV så använder AI:n texten i dina personliga brev.
          Du kan fortfarande skriva en kort sammanfattning nedan som reserv eller komplement.
        </p>
        {/* CVFileUpload shows the drag-and-drop zone + file card. When
            parsing fails or returns empty text (scanned/image-only PDF),
            its `onFallbackRequired` callback fires the parent-defined
            `focusManualTextarea` so the user is one keystroke away from
            typing the manual summary right below. */}
        <CVFileUpload
          profile={profile}
          onChanged={onSaved}
          onFallbackRequired={focusManualTextarea}
        />

        {/* Manual override / fallback — kept below the upload as the
            spec asks. Only saved via the page-level Spara button; the
            AI prompt in lib/groq.js prefers cvText over cvSummary, so
            this textarea is a fallback that only matters when no file
            is attached. */}
        <div className="space-y-1.5 pt-3 border-t border-dashed border-slate-200">
          <Label htmlFor="cvSummary">Eller skriv manuell sammanfattning</Label>
          <Textarea
            id="cvSummary"
            ref={cvSummaryRef}
            data-testid="settings-cvSummary"
            value={form.cvSummary}
            onChange={(e) => setField('cvSummary', e.target.value)}
            placeholder="Valfri kort sammanfattning. AI:n använder CV-filen om den finns — detta är ett reservalternativ."
            rows={4}
            maxLength={1500}
          />
          <p className="text-xs text-slate-400 text-right">
            {form.cvSummary.length} / 1500 tecken
          </p>
          {/* Part 5 — CV enhancement: "Förbättra formulering" + "Ladda ner CV-PDF".
              Two side-by-side buttons below the manual-summary
              textarea. The enhance button POSTs to /api/cv-enhance
              and writes the result back into the form so the user
              can review + save. The PDF link is a direct GET to
              /api/cv-pdf (Content-Disposition: attachment handles
              the download). Both surfaces are gated on the user's
              auth state by the route's requireAuth — no client-side
              guard needed. */}
          {/* Code-reviewer fix: render the enhance button ALWAYS (not
              conditionally) so the user can discover the feature +
              the 50-char threshold. Disabled state + tooltip when the
              summary is too short. The PDF download link is always
              shown too — the route's requireAuth gates unauth users. */}
          <div className="flex flex-wrap items-center gap-2 pt-2" data-testid="settings-cv-enhance-row">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={enhancingCv || (form.cvSummary || '').trim().length < 50}
              onClick={enhanceCvSummary}
              data-testid="settings-cv-enhance"
              title={(form.cvSummary || '').trim().length < 50 ? 'Minst 50 tecken krävs för att förbättra.' : 'Förbättra formuleringen med AI (resultatfokus).'}
              className="text-xs"
            >
              {enhancingCv ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Förbättrar...</> : <><Sparkles className="w-3 h-3 mr-1" /> Förbättra formulering</>}
            </Button>
            <a
              href="/api/cv-pdf"
              download
              data-testid="settings-cv-pdf"
              className="inline-flex items-center h-7 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <Download className="w-3 h-3 mr-1" /> Ladda ner CV-PDF
            </a>
            <span className="text-[10px] text-slate-400">Resultatfokus — ton: starka verb, mätbara effekter.</span>
          </div>
          {/* Part 5 — CV formatting cleanup hint. Surfaces the
              detectCvFormattingIssues() output above the textarea
              so the user can fix common issues (mixed date
              separators, missing sections, too-short summary)
              before the AI ingests the text. */}
          {(() => {
            const text = (profile?.cvText && String(profile.cvText).trim()) || form.cvSummary || ''
            if (!text) return null
            const { issues } = detectCvFormattingIssues(text)
            if (!issues || issues.length === 0) return null
            return (
              <div className="rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900 space-y-1" data-testid="settings-cv-format-issues">
                <strong className="font-semibold">Förbättringsförslag:</strong>
                <ul className="list-disc pl-4 space-y-0.5">
                  {issues.map((issue) => (
                    <li key={issue.key}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )
          })()}
          {/* 2026-07-12 (bug sweep): visual cue when the manual summary
              is the source the AI reads. Without this badge users
              (and the previous bug report) assumed the textarea was
              "not saving" — in fact it WAS saving via /api/profile-update,
              but the lack of feedback created the wrong mental model.
              The badge surfaces the actual state so the user knows
              the manual summary drives cover-letter generation when no
              PDF text is on file.
              Code-reviewer fix 2026-07-12: gate uses `!profile?.cvText`
              (extraction result) instead of `!profile?.cvFileName`
              (upload presence), so a scanned-PDF upload with empty
              extracted text ALSO qualifies as "manual fallback in
              use" — the bug report's spec said "If both PDF extraction
              AND manual summary are empty", which means the gate
              hinge is the extraction result, not the file presence. */}
          {!profile?.cvText && profile?.cvSummary && String(profile.cvSummary).trim().length > 0 && (
            <div
              className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-800"
              data-testid="settings-cvsummary-active"
              role="status"
            >
              <Check className="w-3 h-3 shrink-0" />
              <span>
                <strong className="font-semibold">Använder manuell sammanfattning i AI:n.</strong>{' '}
                Dina personliga brev använder texten ovan som CV-källa.
              </span>
            </div>
          )}
          {/* 2026-07-12 (bug sweep): clear error when BOTH cvText AND
              cvSummary are empty. The Groq prompt degrades to a
              generic answer without CV context (see lib/groq.js
              normaliseProfile) so the user sees vague cover letters.
              This amber alert prompts them to write a manual summary
              instead, with the same Swedish phrasing the bug report
              requested. Renders only on the loaded profile's actual
              state (not the form's draft) so a user about to save a
              summary doesn't see this warning flicker + disappear.
              Code-reviewer fix 2026-07-12: same extraction-result gate
              as the badge above (cvText not cvFileName). */}
          {!profile?.cvText && (!profile?.cvSummary || String(profile.cvSummary).trim().length === 0) && (
            <div
              className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900"
              data-testid="settings-cvsummary-empty"
              role="alert"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong className="font-semibold">Skriv en kort sammanfattning av ditt CV</strong> så
                AI:n kan skriva personliga brev. Utan en källa genereras bara
                generiska svar.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ---- 2026-07-16 (Round-12) — Auto-fill-inställningar ---- */}
      <section className="space-y-4" data-testid="settings-round12-autofill">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <ListChecks className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">Auto-fill-inställningar</h3>
        </div>
        <p className="text-xs text-slate-500 -mt-1 leading-relaxed">
          Dessa fält styr hur JobbPiloten-tillägget fyller i ansökningsformulär åt dig.
          Kryssrutorna motsvarar ja/nej-frågor (körkort, arbetstillstånd, erfarenhet, språk, etc.).
          Dropdowns och datum används för frågor om ålder, kön och nationalitet.
          Kompetenserna matchas mot kryssrute-listor i ansökan (Maskiner, Service, etc.).
        </p>

        {/* Boolean toggles — 2-column grid so the section fits without
            scrolling on desktop. Each toggle is keyed by profileKey so
            the data-testid mirrors the FIELD_PATTERNS entry, making
            it easy to trace a click back to the source field. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1" data-testid="settings-round12-booleans">
          {/* `ROUND12_UI_BOOLEAN_KEYS` excludes `autoConsent` — that
              toggle lives in its own amber safety block below. */}
          {ROUND12_UI_BOOLEAN_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-b-0">
              <Label htmlFor={key} className="flex-1 cursor-pointer text-sm text-slate-700">
                {ROUND12_BOOLEAN_LABELS[key]}
              </Label>
              <Switch
                id={key}
                checked={Boolean(form[key]) === true}
                onCheckedChange={(v) => setField(key, v === true)}
                data-testid={`settings-${key}`}
              />
            </div>
          ))}
        </div>

        {/* Number / date / select / text — the non-boolean fields.
            Two-column grid on desktop, single column on mobile.
            `phoneCountryCode` spans both columns so its placeholder
            ("+46") has room to breathe. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-dashed border-slate-200">
          <div className="space-y-1.5">
            <Label htmlFor="yearsExperience">År av erfarenhet</Label>
            <Input
              id="yearsExperience"
              type="number"
              min="0"
              max="60"
              step="1"
              data-testid="settings-yearsExperience"
              value={form.yearsExperience}
              onChange={(e) => {
                // Keep the form value as the raw string so the user
                // can clear the field and type a fresh number; buildPatch
                // normalises to Number() for the wire payload and rejects
                // NaN. Storing '' for an empty field keeps the dirty
                // detector simple (prev was 0 from the form initialiser).
                const raw = e.target.value
                setField('yearsExperience', raw === '' ? 0 : Number(raw))
              }}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dateOfBirth">Födelsedatum</Label>
            <Input
              id="dateOfBirth"
              type="date"
              data-testid="settings-dateOfBirth"
              value={form.dateOfBirth}
              onChange={(e) => setField('dateOfBirth', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gender">Kön</Label>
            <Select value={form.gender} onValueChange={(v) => setField('gender', v)}>
              <SelectTrigger id="gender" data-testid="settings-gender">
                <SelectValue placeholder="Välj kön" />
              </SelectTrigger>
              <SelectContent>
                {ROUND12_GENDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nationality">Nationalitet</Label>
            <Input
              id="nationality"
              data-testid="settings-nationality"
              value={form.nationality}
              onChange={(e) => setField('nationality', e.target.value)}
              placeholder="Svensk, Norsk, ..."
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="phoneCountryCode">Telefon landskod (default +46)</Label>
            <Input
              id="phoneCountryCode"
              data-testid="settings-phoneCountryCode"
              value={form.phoneCountryCode}
              onChange={(e) => setField('phoneCountryCode', e.target.value)}
              placeholder="+46"
              maxLength={8}
            />
            <p className="text-[10px] text-slate-500">Används i dropdown-menyn för landskod på ansökningsformulär.</p>
          </div>
        </div>

        {/* Skills multi-select — chips layout matching the
            anställningstyp grid above for visual consistency. */}
        <div className="space-y-2 pt-3 border-t border-dashed border-slate-200">
          <Label>Kompetenser (välj alla som gäller)</Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="settings-skills">
            {ROUND12_SKILL_OPTIONS.map((skill) => {
              const isChecked = Array.isArray(form.skills) && form.skills.includes(skill)
              return (
                <label
                  key={skill}
                  className={
                    'flex items-center gap-2 text-sm text-slate-700 px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ' +
                    (isChecked
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')
                  }
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleSkill(skill)}
                    data-testid={`settings-skill-${skill}`}
                  />
                  <span>{skill}</span>
                </label>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-500">
            JobbPiloten klickar automatiskt i motsvarande kryssrutor i ansökningsformulär (t.ex.
            en lista “Markera alla som gäller”).
          </p>
        </div>

        {/* Auto-consent — separated visually with an amber border so
            the GDPR warning is always adjacent to its toggle. The
            default is OFF (profile.autoConsent = false). The
            extension paints this with a dedicated `consent_unchecked`
            slate-grey dashed outline when it's off so the user
            understands the data IS on their profile — they just
            haven't opted in to letting the extension click GDPR
            boxes on their behalf. */}
        <div
          className="pt-3 mt-3 border-t border-amber-200 bg-amber-50/60 -mx-2 px-4 py-3 rounded-md"
          data-testid="settings-auto-consent-block"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Label htmlFor="autoConsent" className="text-sm font-semibold text-amber-900 flex items-center gap-1.5 cursor-pointer">
                <ShieldAlert className="w-4 h-4" />
                Auto-godkänn GDPR-samtycke
              </Label>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                <strong>Som standard är detta AV.</strong> Om du slår på det kommer JobbPiloten-tillägget
                automatiskt klicka i GDPR/cookies-rutor som matchar mönstret <em>jag har läst och
                godkänner</em>. Detta binder dig juridiskt — slå bara på det om du är säker på att du
                vill godkänna alla sådana villkor i förväg.
              </p>
            </div>
            <Switch
              id="autoConsent"
              checked={Boolean(form.autoConsent) === true}
              onCheckedChange={(v) => setField('autoConsent', v === true)}
              data-testid="settings-autoConsent"
            />
          </div>
        </div>
      </section>

      {/* ---- Save row ---- */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
        <div className="text-xs text-slate-500">
          {dirty
            ? <>Du har <strong className="text-indigo-600">{Object.keys(patch).length}</strong> osparade ändringar.</>
            : 'Alla ändringar är sparade.'}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} disabled={!dirty || saving}>
            Återställ
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            data-testid="settings-save"
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {saving ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Sparar...</> : <><Save className="w-3 h-3 mr-1" /> Spara ändringar</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SubscriptionCard({ subscription, profile, onPortal }) {
  const [opening, setOpening] = useState(false)
  const handleManage = async () => {
    if (opening) return
    setOpening(true)
    try {
      await onPortal()
    } finally {
      // Whether the portal opens or not is decided by `onPortal` which is
      // provided by the outer page. Don't keep the spinner forever if the
      // outer handler throws — let it propagate.
      setOpening(false)
    }
  }

  if (!subscription) {
    return (
      <Card className="border-0 shadow-sm" data-testid="settings-subscription">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-indigo-600" /> Prenumeration</CardTitle>
          <CardDescription>Ingen aktiv prenumeration hittades.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">
            Uppgradera från startsidan för att låsa upp AI-brev, push-notiser och Aktivitetsrapporten.
          </p>
          <div className="mt-4">
            <Button asChild={false} onClick={() => window.location.href = '/#priser'} variant="outline">
              Se priser
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const tierLabels = { Basic: 'Basic', Professional: 'Professional', Elite: 'Elite' }
  const statusLabels = {
    active: { label: 'Aktiv', tone: 'bg-emerald-100 text-emerald-800' },
    trialing: { label: 'Provperiod', tone: 'bg-blue-100 text-blue-800' },
    past_due: { label: 'Förfallen', tone: 'bg-red-100 text-red-800' },
    canceled: { label: 'Avslutad', tone: 'bg-slate-200 text-slate-700' },
    inactive: { label: 'Inaktiv', tone: 'bg-slate-200 text-slate-700' },
  }
  const status = statusLabels[subscription.status] || statusLabels.inactive
  const intervalLabels = { month: 'Månadsvis', year: 'Årsvis' }

  return (
    <Card className="border-0 shadow-sm" data-testid="settings-subscription">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-indigo-600" /> Prenumeration
        </CardTitle>
        <CardDescription>Hantera din plan och fakturering via Stripe.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">Plan</div>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">{tierLabels[subscription.tier] || subscription.tier || '—'}</Badge>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">Status</div>
            <div className="mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.tone}`}>{status.label}</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">Intervall</div>
            <div className="mt-1 text-sm text-slate-900">
              {intervalLabels[subscription.billingInterval] || '—'}
            </div>
          </div>
          {subscription.currentPeriodEnd && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 font-medium">
                {subscription.cancelAtPeriodEnd ? 'Avslutas' : 'Förnyas'}
              </div>
              <div className="mt-1 text-sm text-slate-900">{fmtDate(subscription.currentPeriodEnd)}</div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
          {subscription.hasStripeCustomer ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleManage}
              disabled={opening}
              data-testid="settings-open-portal"
            >
              {opening ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Öppnar...</> : <><ExternalLink2 className="w-3 h-3 mr-1" /> Hantera prenumeration</>}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => window.location.href = '/#priser'}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Välj plan
            </Button>
          )}
          <span className="text-xs text-slate-500">
            Betalningar hanteras av Stripe — vi ser aldrig ditt kortnummer.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// Local-external-link icon — kept inline because lucide-react's `ExternalLink`
// was already imported elsewhere with a sloped look and we want a cleaner
// rendering here.
function ExternalLink2(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  )
}

function NotificationsCard({ pushActive, onToggle, pushLoading }) {
  return (
    <Card className="border-0 shadow-sm" data-testid="settings-notifications">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {pushActive ? <Bell className="w-5 h-5 text-emerald-600" /> : <BellOff className="w-5 h-5 text-slate-400" />}
          Push-notiser
        </CardTitle>
        <CardDescription>Få en notis när AI-assistenten hittar nya matchande jobb.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm">
            <div className={`w-2.5 h-2.5 rounded-full ${pushActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="text-slate-700">{pushActive ? 'Aktiva' : 'Inaktiva'}</span>
          </div>
          <Button
            size="sm"
            variant={pushActive ? 'outline' : 'default'}
            disabled={pushLoading}
            onClick={onToggle}
            className={pushActive ? '' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}
            data-testid="settings-toggle-push"
          >
            {pushLoading
              ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Laddar...</>
              : pushActive
                ? <><BellOff className="w-3 h-3 mr-1" /> Avaktivera</>
                : <><Bell className="w-3 h-3 mr-1" /> Aktivera push-notiser</>}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          Push-notiser används bara för nya jobb-träffar. Inga reklam eller nyhetsbrev skickas via push.
          Du kan när som helst slå av notiserna ovan eller i webbläsarens inställningar.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Delete-account confirmation dialog. Asks the user to type the literal
 * phrase "RADERA MITT KONTO" before the destructive call goes through.
 * Compared to a single confirm button, this is the standard "are you sure"
 * gate pattern recommended by Cloudflare, GitHub, AWS and others for
 * irreversible actions. Empty / wrong phrases are rejected server-side too.
 */
function DeleteAccountDialog({ open, onOpenChange, onConfirm, deleting, deletionResult }) {
  const [phrase, setPhrase] = useState('')
  const phraseOk = phrase === 'RADERA MITT KONTO'

  // Reset phrase whenever the dialog re-opens — leaves the destructive
  // intent explicitly out of the form state across opens.
  useEffect(() => {
    if (open) setPhrase('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <ShieldAlert className="w-5 h-5" />
            Radera mitt konto
          </DialogTitle>
          <DialogDescription>
            Detta raderar alla uppgifter vi har om dig — profil, ansökningar,
            push-prenumerationer och kronologgar. Åtgärden går inte att ångra.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              Din prenumeration hos Stripe <strong>avslutas inte automatiskt</strong> —
              för att stoppa framtida fakturor, avbryt den via
              &quot;Hantera prenumeration&quot;, <em>före</em> raderingen.
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-phrase">
              Skriv <code className="font-mono text-red-700">RADERA MITT KONTO</code> för att bekräfta:
            </Label>
            <Input
              id="confirm-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="RADERA MITT KONTO"
              autoComplete="off"
              data-testid="settings-delete-confirm"
              disabled={deleting}
            />
            {phrase && !phraseOk && (
              <p className="text-xs text-red-600">Frasen stämmer inte — skriv exakt som visas ovan.</p>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Avbryt
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(phrase)}
            disabled={!phraseOk || deleting}
            data-testid="settings-delete-confirm-button"
          >
            {deleting
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Raderar...</>
              : <><Trash2 className="w-4 h-4 mr-2" /> Radera permanent</>}
          </Button>
        </DialogFooter>

        {deletionResult && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Kontot är raderat. Raderade poster:{' '}
            {Object.entries(deletionResult)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k}=${n}`)
              .join(', ') || 'inga (kontot var redan tomt)'}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}


function fmtRelative(d) {
  if (!d) return '—'
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return '—'
  const diffMin = Math.floor((Date.now() - x.getTime()) / 60000)
  if (diffMin < 1) return 'just nu'
  if (diffMin < 60) return `${diffMin} min sedan`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} h sedan`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD} dagar sedan`
  return fmtDate(x)
}

// Pricing tier display table — mirrors lib/ai-usage.js's AI_TIER_LIMITS
// exactly. The /settings card renders the user's CURRENT cap; the
// `/pricing` copy on the landing page uses the same table so the
// user-visible numbers can't drift from the server's enforcement.
// Adding a new tier requires touching BOTH this table AND
// AI_TIER_LIMITS — a future migration to a single source could be
// to expose /api/pricing and read from there.
const AI_TIER_PRICING_DISPLAY = [
  { tier: 'Basic', label: 'Basic', monthlyCap: 10, hint: 'Ingår i gratisplanen' },
  { tier: 'Professional', label: 'Pro', monthlyCap: 50, hint: 'Ingår i Pro' },
  { tier: 'Elite', label: 'Elite', monthlyCap: Infinity, hint: 'Obegränsat i Elite' },
]

// Human-friendly rendering of an `Infinity` cap so the user never
// sees the literal string. Used by AIUsageCard's "återstående" row.
function fmtLimit(n) {
  return n === Infinity || n == null ? 'obegränsat' : String(n)
}

/**
 * AIUsageCard — /settings block exposing the AI-toggle + the monthly
 * usage counter + the tier price ladder. Kept as its own component
 * because it has independent loading + saving state, distinct from
 * the main ProfileEditor save flow.
 *
 * Props:
 *   • stats       — { count, limit, remaining, tier, month, aiFallbackEnabled }
 *                   served by GET /api/ai-usage
 *   • loading     — boolean from parent (suspends render of the counter)
 *   • onToggle    — (nextValue: boolean) => void  parent passes a setter
 *                   that PATCHes /api/profile-update (the route already
 *                   has `aiFallbackEnabled` in its ALLOWED list).
 */
function AIUsageCard({ stats, loading, onToggle, toggleLoading }) {
  const tier = stats?.tier || 'Basic'
  const monthlyCap = stats?.limit ?? 10
  const used = stats?.count ?? 0
  const remaining = stats?.remaining ?? monthlyCap
  const aiEnabled = stats?.aiFallbackEnabled !== false
  // Tier display label — map the storage value to the user-visible
  // "Basic/Pro/Elite" ladder.
  const tierRow = AI_TIER_PRICING_DISPLAY.find((r) => r.tier === tier) || AI_TIER_PRICING_DISPLAY[0]
  const capped = monthlyCap !== Infinity && used >= monthlyCap
  return (
    <Card className="border-0 shadow-sm" data-testid="settings-ai-usage">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-indigo-600" /> AI-hjälp i ansökningsformulär
        </CardTitle>
        <CardDescription>
          Låter AI skriva svar på frågor som "Varför vill du jobba hos oss?" när du fyller i ansökningar via vår browser-extension.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* --- Toggle --- */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3 hover:border-slate-300 transition-colors">
          <div className="space-y-0.5 min-w-0">
            <Label htmlFor="ai-fallback-toggle" className="text-sm font-medium text-slate-900">
              Låt AI skriva svar på okända frågor
            </Label>
            <p className="text-xs text-slate-500 leading-snug">
              När på fyller JobbPiloten fält som saknar matchande profilvärde
              via Groq (max 12 svar per klick, max 200 ord per svar).
            </p>
          </div>
          <Switch
            id="ai-fallback-toggle"
            checked={aiEnabled}
            onCheckedChange={onToggle}
            disabled={toggleLoading}
            data-testid="settings-ai-toggle"
            aria-label="Aktivera AI-svar på okända frågor"
          />
        </div>
        {/* --- Usage counter --- */}
        <div className="rounded-lg border border-slate-200 px-4 py-3 space-y-2" data-testid="settings-ai-counter">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
              AI har skrivit {used} svar åt dig denna månad
            </div>
            <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${capped ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {capped ? 'Tak nått' : 'Aktiv'}
            </div>
          </div>
          {/* Progress bar — thin, indigo accent. Hidden when the
              cap is Infinity so the Elite user doesn't see a confusing
              "0 of ∞" bar. */}
          {monthlyCap !== Infinity ? (
            <>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-all ${capped ? 'bg-red-500' : 'bg-indigo-500'}`}
                  style={{ width: `${Math.min(100, (used / monthlyCap) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{used} / {fmtLimit(monthlyCap)} använda</span>
                <span>{fmtLimit(remaining)} kvar</span>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500">
              Du har obegränsat med AI-svar denna månad.
            </div>
          )}
        </div>
        {/* --- Pricing tier ladder --- */}
        <div className="rounded-lg border border-slate-200 px-4 py-3 bg-slate-50/40">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
            Månadstak per plan
          </div>
          <ul className="space-y-1.5 text-sm">
            {AI_TIER_PRICING_DISPLAY.map((row) => (
              <li key={row.tier} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Badge variant="secondary" className={`text-[10px] ${row.tier === tier ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>{row.label}</Badge>
                  <span className="text-xs text-slate-500">{row.hint}</span>
                </span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {fmtLimit(row.monthlyCap)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-xs text-slate-500">
            <a href="/#priser" className="underline hover:text-slate-700">Se pris &nbsp;→</a>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * ExtensionInstallCard — /settings helper that surfaces the
 * browser-extension install state + install CTA. Companion to
 * `BrowserExtensionCard` (which lists already-connected devices);
 * the install card sits BEFORE the device list so a brand-new
 * user lands on the install prompt first.
 *
 * Detection reuses the same `data-jobbpiloten-ext="1"` DOM
 * attribute the dashboard polls. We poll on a 1.5 s interval
 * because the soft-launch install path involves the user
 * clicking "Load unpacked" in a separate chrome:// tab; the
 * attribute read picks up the new extension on the very next
 * focus event so the user sees the success state immediately
 * after switching back to this tab.
 *
 * The CTA label + link target branches on `EXTENSION_PUBLISHED`:
 *   • published → CWS slug for 1-click install
 *   • soft-launch → /extension-install with sideload walkthrough
 */
function ExtensionInstallCard({ published, storeUrl, installGuidePath }) {
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const check = () => {
      try {
        const v = document.documentElement.getAttribute('data-jobbpiloten-ext')
        setExtensionInstalled(v === '1')
        setChecked(true)
      } catch (_) {
        setChecked(true)
      }
    }
    check()
    const interval = setInterval(check, 1500)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', check)
    }
  }, [])

  const ctaHref = published ? storeUrl : installGuidePath
  const ctaLabel = published ? 'Installera från Chrome Web Store' : 'Installera (steg-för-steg)'

  return (
    <Card className="border-0 shadow-sm" data-testid="settings-extension-install">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Puzzle className="w-5 h-5 text-indigo-600" /> Webbläsartillägg
        </CardTitle>
        <CardDescription>
          Installera JobbPiloten Auto-Fill för att fylla i ansökningsformulär med ett klick.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm min-w-0">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${!checked ? 'bg-slate-300 animate-pulse' : extensionInstalled ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="text-slate-700">
              {!checked
                ? 'Kontrollerar...'
                : extensionInstalled
                  ? 'Installerat — redo att anslutas från Dashboard'
                  : 'Inte installerat'}
            </span>
          </div>
          {extensionInstalled ? (
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard" data-testid="settings-extension-go-dashboard">
                Öppna Dashboard
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              asChild
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              <Link
                href={ctaHref}
                target={published ? '_blank' : undefined}
                rel={published ? 'noopener noreferrer' : undefined}
                data-testid="settings-extension-install-link"
              >
                {ctaLabel}
              </Link>
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          {extensionInstalled
            ? 'Öppna Dashboard och klicka "Anslut din profil" i tilläggs-kortet för att aktivera auto-fill.'
            : published
              ? 'Ett klick — Chrome tar hand om resten.'
              : 'Soft-launch — vi laddar via Chrome\'s "Load unpacked"-läge tills Chrome Web Store-granskningen är klar.'}
        </p>
      </CardContent>
    </Card>
  )
}

function BrowserExtensionCard({ sessions, loading, onDisconnectOne, disconnectingOneId, onDisconnectAll, disconnectingAll, onOpenDisconnectAll }) {
  return (<Card className="border-0 shadow-sm">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Puzzle className="w-5 h-5 text-indigo-600" /> JobbPiloten Auto-Fill</CardTitle>
      <CardDescription>Webbläsare och enheter som är anslutna till din profil.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {loading ? <Skeleton className="h-9 w-full" /> : sessions.length === 0 ? <div className="text-sm text-slate-600">Inga anslutna enheter</div> : (
        <ul className="space-y-2">{sessions.map((s) => {
          // Pop-up-driven mints carry `source: 'extension-popup-auth'`
          // (see app/extension-auth/page.js + app/api/extension/token/route.js).
          // The "Popup" / "Dashboard" badge is the user-visible surface
          // the soft-launch review checklist references — without it
          // the audit list looks like a uniform list of devices even
          // though the DB now discriminates the two mint code paths.
          // Pre-Round-9 rows (mint source landed before this field
          // existed) get the Dashboard badge by default — a tidier
          // UX than hiding them silently.
          const isPopup = s.source === 'extension-popup-auth'
          return (
            <li key={s._id || s.token} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{s.userAgent || '(okänd webbläsare)'}</div>
                  {isPopup ? (
                    <Badge
                      className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
                      data-testid="settings-extension-source-popup"
                      title="Ansluten via tilläggets popup-fönster (klickade 'Anslut din profil' i webbläsartillägget)."
                    >Popup</Badge>
                  ) : (
                    <Badge
                      className="bg-slate-100 text-slate-700 border-slate-200 text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap"
                      data-testid="settings-extension-source-dashboard"
                      title="Ansluten via /dashboard-knappen på webbplatsen."
                    >Dashboard</Badge>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">Ansluten {fmtRelative(s.createdAt)}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => onDisconnectOne(s)} disabled={disconnectingOneId === (s._id || s.token)}>Koppla från</Button>
            </li>
          )
        })}</ul>
      )}
      {sessions.length > 0 && <Button size="sm" variant="outline" className="text-red-700" onClick={onOpenDisconnectAll}>Logga ut från alla enheter</Button>}
    </CardContent>
</Card>)}

function DisconnectAllDialog({ open, onOpenChange, onConfirm, disconnecting }) {
  const [phrase, setPhrase] = useState('')
  const phraseOk = phrase === 'LOGGA UT ALLA' || phrase === 'LOGGA UT FRAN ALLA'
  return (<Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent><DialogHeader><DialogTitle>Logga ut från alla enheter</DialogTitle></DialogHeader>
      <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="LOGGA UT ALLA" />
      <DialogFooter><Button onClick={onConfirm} disabled={!phraseOk || disconnecting}>Logga ut alla</Button></DialogFooter>
    </DialogContent>
</Dialog>)}

/**
 * AIStyleCard — /settings block for the 5-style answer-voice picker
 * (Round-35 / Part 3 — Answer Diversity). The user picks ONE default
 * style; the Groq prompt builder reads `profile.stylePreference` and
 * appends the chosen preset's `prompt` modifier to every generation
 * call (cover letters, motivation-class answers, adaptive batch
 * answers). Per-question override is a future-extension concern
 * (deferred to Part 6) — the /settings page only needs to expose
 * the default toggle.
 *
 * The card lives independently from the main ProfileEditor save
 * flow (no `dirty` / `Spara` button) because the style change is
 * a single field write — PUT-style semantics, not a PATCH over
 * the whole form. Each radio click immediately PATCHes
 * /api/profile-update with the new value, then shows a toast.
 *
 * Visual shape: 5 rows, each with a radio, the Swedish label, and
 * a one-line description. The currently-active row gets an
 * emerald checkmark on the right. The list is wrapped in a
 * `role="radiogroup"` for screen readers; each row is a real
 * `<label>` so clicking the description text toggles the radio.
 */
function AIStyleCard({ currentStyleId, onStyleChanged }) {
  // Resolve the initial value from the canonical resolver so an
  // unknown stored value (e.g. from a future-removed preset) falls
  // back to the default and renders the radio for the default,
  // not an unchecked state. The useState seed is the resolved id
  // — the local state stays in sync with the resolver's contract
  // without needing a second effect.
  const [activeId, setActiveId] = useState(() => {
    return resolveStylePreset(currentStyleId).id
  })
  const [saving, setSaving] = useState(false)
  // Round-38 (Part 3 polish): voice preview state. The user can
  // hover a style to see a sample opening line rendered in the
  // style's voice (synthesized client-side from the preset's
  // `prompt` field + the user's `jobTitles[0]`). This is a UI
  // affordance only — the actual Groq prompt still uses
  // `profile.stylePreference` server-side. The preview is hidden
  // on small screens to keep the radio card compact.
  const [hoveredId, setHoveredId] = useState(null)

  // When the parent profile reloads (e.g. after a successful save
  // elsewhere on the page), resync the local state so the radio
  // reflects the canonical server value. Without this, an external
  // mutation of profile.stylePreference would leave the radio stale.
  useEffect(() => {
    setActiveId(resolveStylePreset(currentStyleId).id)
  }, [currentStyleId])

  const pick = async (id) => {
    if (saving || id === activeId) return
    setSaving(true)
    // Optimistic update — flip the radio immediately so the UI
    // feels instant, then re-sync from the server response.
    const prev = activeId
    setActiveId(id)
    try {
      const res = await fetch('/api/profile-update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stylePreference: id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        // Roll back the optimistic flip — the toast surfaces the
        // server's reason so the user knows what to try.
        setActiveId(prev)
        toast.error(json.error || 'Kunde inte spara AI-stilen')
        return
      }
      const preset = STYLE_PRESETS.find((p) => p.id === id)
      toast.success(`AI-stil: ${preset?.label || id}`)
      // Round-38 (Part 3 polish): notify the parent so the
      // profile's stylePreference field is updated locally. The
      // SettingsPage parent uses this to keep its in-memory
      // profile in sync (so the next cover-letter generation picks
      // up the new style without a full page reload).
      onStyleChanged?.(id)
    } catch (err) {
      setActiveId(prev)
      toast.error('Oj, något gick fel: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Round-38 (Part 3 polish): voice-preview sample sentence
  // composer. Synthesizes a one-line preview from the preset's
  // first opener + the user's primary job title (if any). Pure
  // client-side — no API call, no Groq round-trip — so the
  // affordance stays sub-millisecond.
  const composePreview = (preset) => {
    if (!preset || !Array.isArray(preset.openers) || preset.openers.length === 0) {
      return ''
    }
    // Pick the first opener; future polish could randomize, but a
    // deterministic pick makes the hover state predictable for
    // e2e tests.
    return preset.openers[0]
  }

  return (
    <Card className="border-0 shadow-sm" data-testid="settings-ai-style">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-600" /> AI-stil för ansökningar
        </CardTitle>
        <CardDescription>
          Välj vilken röst AI:n ska använda när den skriver dina personliga brev och svar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-label="AI-skrivstil"
          data-testid="settings-ai-style-list"
          className="space-y-2"
        >
          {STYLE_PRESETS.map((preset) => {
            const isActive = preset.id === activeId
            const isHovered = hoveredId === preset.id
            const preview = composePreview(preset)
            return (
              <label
                key={preset.id}
                data-testid={`settings-ai-style-row-${preset.id}`}
                onMouseEnter={() => setHoveredId(preset.id)}
                onMouseLeave={() => setHoveredId((curr) => (curr === preset.id ? null : curr))}
                onFocus={() => setHoveredId(preset.id)}
                onBlur={() => setHoveredId((curr) => (curr === preset.id ? null : curr))}
                className={
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ' +
                  'focus-within:ring-2 focus-within:ring-indigo-400 ' +
                  (isActive
                    ? 'border-indigo-300 bg-indigo-50/60'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')
                }
              >
                <input
                  type="radio"
                  name="ai-style"
                  value={preset.id}
                  checked={isActive}
                  onChange={() => pick(preset.id)}
                  disabled={saving}
                  data-testid={`settings-ai-style-radio-${preset.id}`}
                  className="mt-1 h-4 w-4 text-indigo-600 border-slate-300 focus:ring-indigo-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{preset.label}</span>
                    {isActive && (
                      <span
                        data-testid={`settings-ai-style-active-${preset.id}`}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700"
                      >
                        <Check className="w-3 h-3" /> Aktiv
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">{preset.description}</p>
                  {/* Round-38 (Part 3 polish): inline voice preview. The
                      sample sentence is the preset's first opener. We
                      show it on (a) active style — always visible, or
                      (b) hover/focus state — discoverable but quiet.
                      Hidden on mobile to keep the card compact; the
                      existing `openers` list below still surfaces them
                      for the active style. */}
                  {preview && (isActive || isHovered) && (
                    <p
                      data-testid={`settings-ai-style-preview-${preset.id}`}
                      className="hidden sm:block text-[11px] text-slate-700 mt-1.5 leading-snug italic"
                    >
                      <span className="text-indigo-600 font-semibold not-italic mr-1">“</span>
                      {preview}
                      <span className="text-indigo-600 font-semibold not-italic ml-1">”</span>
                    </p>
                  )}
                  {isActive && preset.openers && preset.openers.length > 0 && (
                    <p
                      data-testid={`settings-ai-style-openers-${preset.id}`}
                      className="text-[11px] text-slate-400 mt-1.5 leading-snug italic"
                    >
                      <ListChecks className="w-3 h-3 inline mr-1 -mt-0.5" />
                      Alla öppningar: {preset.openers.map((o) => `“${o}”`).join(' · ')}
                    </p>
                  )}
                </div>
              </label>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
          Stilvalet sparas direkt och börjar gälla vid nästa AI-generering. Du kan när som helst byta tillbaka.
        </p>
      </CardContent>
    </Card>
  )
}
// ---- Sparade svar (Round-38 / Part 2 — Answer memory backend) ----
//
// Replaces the Round-33.2 frontend mock (SAVED_ANSWERS_MOCK) with
// real Mongo persistence. The card hydrates from
// GET /api/saved-answers on mount; edits / star toggles / deletes
// are POST / DELETE upserts against the same endpoint. The
// frontend state is the optimistic copy; server responses re-sync
// when the JSON shape differs (timestamp updates, id collisions).
const SAVED_ANSWERS_EMPTY = [] // sentinel — the empty state below renders this branch
// Optional client-side fallback so a server cold-start that takes
// >5s shows SOMETHING. The list is empty (no real data), the
// empty-state copy takes over, and a refresh after the load
// completes surfaces the actual list. Without this, the user
// sees the loading skeleton forever on a slow network.

/**
 * AnswerMemoryCard — Round-38 (Part 2). Real-data version.
 *
 * Hydrates the saved-answers list from GET /api/saved-answers on
 * mount, then mirrors edits/stars/deletes via POST (upsert) /
 * DELETE against the same endpoint. Optimistic updates: each
 * mutation flips local state immediately, then re-syncs from
 * the server response so the timestamp + id stay canonical.
 *
 * Empty / loading / error states are three distinct branches
 * (all keep the same `data-testid="settings-saved-answers"`
 * wrapper so e2e assertions on the parent testid never break).
 */
function AnswerMemoryCard() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [draftAnswer, setDraftAnswer] = useState('')

  // Fetch on mount. Errors surface as a Swedish toast + a non-blocking
  // retry button so the user can recover without a full page reload.
  // The fetch is intentionally NOT cancelled on unmount — the route
  // returns quickly enough that a stale-write-after-unmount isn't
  // a realistic concern for a settings page that's never
  // short-lived.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/saved-answers', { credentials: 'include' })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !json.ok) {
          setError(json.error || 'Kunde inte läsa sparade svar.')
          setItems([])
          return
        }
        setItems(Array.isArray(json.answers) ? json.answers : [])
        setError('')
      } catch (e) {
        if (cancelled) return
        setError('Nätverksfel — kunde inte läsa sparade svar.')
        setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // POST upsert helper — used by both toggleStar (quality change)
  // and saveEdit (answer text change). Same id = same doc server-
  // side, so the upsert semantics map naturally to "re-save" /
  // "edit existing".
  const upsertItem = async (item) => {
    const res = await fetch('/api/saved-answers', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Kunde inte spara svaret.')
    }
    return json.answer
  }

  const toggleStar = async (id) => {
    const current = items.find((it) => it.id === id)
    if (!current) return
    const nextQuality = current.quality >= 5 ? 4 : 5
    // Optimistic flip.
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, quality: nextQuality } : it))
    try {
      const saved = await upsertItem({
        id: current.id,
        field: current.field || 'custom',
        question: current.question,
        answer: current.answer,
        quality: nextQuality,
      })
      if (saved && saved.updatedAt) {
        setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...saved } : it))
      }
      toast.success(nextQuality >= 5 ? 'Markerad som bra' : 'Stjärnan borttagen')
    } catch (err) {
      // Roll back.
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, quality: current.quality } : it))
      toast.error('Oj, något gick fel: ' + err.message)
    }
  }

  const startEdit = (it) => {
    setEditingId(it.id)
    setDraftAnswer(it.answer)
  }

  const saveEdit = async () => {
    if (!editingId) return
    const current = items.find((it) => it.id === editingId)
    if (!current) return
    const nextAnswer = draftAnswer.trim()
    if (!nextAnswer) {
      toast.error('Svaret kan inte vara tomt.')
      return
    }
    // Optimistic update.
    const prevAnswer = current.answer
    setItems((prev) => prev.map((it) => it.id === editingId ? { ...it, answer: nextAnswer } : it))
    setEditingId(null)
    setDraftAnswer('')
    try {
      const saved = await upsertItem({
        id: current.id,
        field: current.field || 'custom',
        question: current.question,
        answer: nextAnswer,
        quality: current.quality,
      })
      if (saved && saved.updatedAt) {
        setItems((prev) => prev.map((it) => it.id === current.id ? { ...it, ...saved } : it))
      }
      toast.success('Svar sparat')
    } catch (err) {
      // Roll back.
      setItems((prev) => prev.map((it) => it.id === current.id ? { ...it, answer: prevAnswer } : it))
      toast.error('Oj, något gick fel: ' + err.message)
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraftAnswer('')
  }

  const remove = async (id) => {
    const prev = items
    setItems((p) => p.filter((it) => it.id !== id))
    try {
      const res = await fetch(`/api/saved-answers?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Kunde inte radera.')
      toast.success('Svar borttaget')
    } catch (err) {
      setItems(prev)
      toast.error('Oj, något gick fel: ' + err.message)
    }
  }

  if (loading) {
    return (
      <Card className="border-0 shadow-sm" data-testid="settings-saved-answers">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-indigo-600" /> Sparade svar
          </CardTitle>
          <CardDescription>
            AI:n återanvänder dessa svar när du möter en liknande fråga i nästa ansökan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2" data-testid="settings-saved-answers-loading">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-11/12" />
            <Skeleton className="h-12 w-10/12" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-0 shadow-sm" data-testid="settings-saved-answers">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-indigo-600" /> Sparade svar
          </CardTitle>
          <CardDescription>
            AI:n återanvänder dessa svar när du möter en liknande fråga i nästa ansökan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="alert"
            data-testid="settings-saved-answers-error"
            className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (items.length === 0) {
    // Round-33.3 review-fix: empty state renders the SAME Card +
    // mock-badge + list-region surface as the populated branch so
    // e2e assertions on the parent testid never break during a
    // list-empties transition. The empty li sits inside the
    // settings-saved-answers-list ul — both are stable across the
    // population change.
    return (
      <Card className="border-0 shadow-sm" data-testid="settings-saved-answers">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-indigo-600" /> Sparade svar
          </CardTitle>
          <CardDescription>
            AI:n återanvänder dessa svar när du möter en liknande fråga i nästa ansökan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2.5" data-testid="settings-saved-answers-list">
            <li
              data-testid="settings-saved-answers-empty"
              className="text-sm text-slate-500 py-6 text-center"
            >
              Inga sparade svar — klicka <strong>Spara</strong> på ett AI-svar för att lägga till.
            </li>
          </ul>
        </CardContent>
      </Card>
    )
  }

  // Part 3 (Round-43) — style consistency check. Walks the
  // saved-answers corpus and surfaces a Swedish warning when the
  // user has answered the same company with two different writing
  // styles within 30 days. Pure client-side computation, no API
  // call. Rendered as a single amber block above the list so the
  // user can act on it (the "harmonize" action is a future
  // server-side endpoint; for now the copy is informational).
  const consistencyCheck = findStyleInconsistencies(items)
  const consistencyWarnings = consistencyCheck.warnings || []

  return (
    <Card className="border-0 shadow-sm" data-testid="settings-saved-answers">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareQuote className="w-5 h-5 text-indigo-600" /> Sparade svar
        </CardTitle>
        <CardDescription>
          AI:n återanvänder dessa svar när du möter en liknande fråga i nästa ansökan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {consistencyWarnings.length > 0 && (
          <div
            role="status"
            data-testid="settings-style-inconsistency"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 space-y-1"
          >
            <strong className="font-semibold">Blandade skrivstilar:</strong>
            <ul className="list-disc pl-4 space-y-0.5">
              {consistencyWarnings.map((w, i) => (
                <li key={`${w.company}-${i}`}>{renderInconsistencyCopy(w)}</li>
              ))}
            </ul>
          </div>
        )}
        <ul className="space-y-2.5" data-testid="settings-saved-answers-list">
          {items.map((it) => {
            const isEditing = editingId === it.id
            return (
              <li
                key={it.id}
                data-testid={`settings-saved-answer-${it.id}`}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 leading-snug">{it.question}</div>
                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <Textarea
                          value={draftAnswer}
                          onChange={(e) => setDraftAnswer(e.target.value)}
                          rows={4}
                          maxLength={1500}
                          className="text-sm"
                          data-testid={`settings-saved-answer-edit-${it.id}`}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] text-slate-400">{draftAnswer.length} / 1500 tecken</div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={cancelEdit} className="h-7 text-xs">Avbryt</Button>
                            <Button
                              size="sm"
                              onClick={saveEdit}
                              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                              data-testid={`settings-saved-answer-save-${it.id}`}
                            >Spara svar</Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed line-clamp-2">{it.answer}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleStar(it.id)}
                      aria-pressed={it.quality >= 5}
                      title={it.quality >= 5 ? 'Markerad som bra — klicka för att ta bort stjärnan' : 'Klicka för att markera som bra'}
                      data-testid={`settings-saved-answer-star-${it.id}`}
                      className={
                        'inline-flex items-center justify-center w-8 h-8 rounded-md transition ' +
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
                        (it.quality >= 5
                          ? 'text-amber-500 hover:text-amber-600'
                          : 'text-slate-300 hover:text-amber-400 hover:scale-110 active:scale-95')
                      }
                    >
                      <StarFill className={'w-4 h-4 ' + (it.quality >= 5 ? 'fill-amber-500 stroke-amber-600' : '')} />
                    </button>
                    {!isEditing && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(it)}
                        className="h-7 text-xs"
                        data-testid={`settings-saved-answer-edit-btn-${it.id}`}
                      >
                        <Pencil className="w-3 h-3 mr-1" /> Redigera
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(it.id)}
                      className="h-7 text-xs text-red-600 hover:bg-red-50"
                      data-testid={`settings-saved-answer-delete-${it.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

// ---------------------- Page ----------------------

export default function SettingsPage() {
  const { isLoaded } = useUser()
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [pushActive, setPushActive] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletionResult, setDeletionResult] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [disconnectingOneId, setDisconnectingOneId] = useState(null)
  const [disconnectingAll, setDisconnectingAll] = useState(false)
  const [disconnectAllOpen, setDisconnectAllOpen] = useState(false)
  // AI section — mirror the page-level fetch pattern so the card
  // states are independent of the ProfileEditor's "dirty" flag.
  const [aiStats, setAiStats] = useState(null)
  const [aiLoading, setAiLoading] = useState(true)
  const [aiToggleLoading, setAiToggleLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const [p, sub, push, sessionsRes] = await Promise.all([
        fetch('/api/profile').then((r) => r.json()),
        fetch('/api/subscription').then((r) => r.json()),
        fetch('/api/push-status').then((r) => r.json()),
        fetch('/api/extension/token', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ tokens: [] })),
      ])
      // Profile is required — without it the editor has nothing to show.
      // Redirect to onboarding for the (rare) case where a user reaches
      // here before completing the welcome flow.
      if (!p?.profile) {
        router.replace('/onboarding')
        return
      }
      setProfile(p.profile)
      setSubscription(sub.subscription)
      setPushActive(!!push?.active)
      setSessions(Array.isArray(sessionsRes?.tokens) ? sessionsRes.tokens : [])
      setLoadingSessions(false)
    } catch (e) {
      console.error('load err', e)
      toast.error('Kunde inte ladda inställningar')
    }
    setLoading(false)
  }, [router])

  // Separate AI fetch — the AI usage card doesn't need the full
  // profile, just the monthly snapshot. Splitting it out keeps a
  // failed AI usage fetch from breaking the rest of the page.
  const loadAiStats = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-usage', { credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        // Route already returns a safe default payload even on 5xx;
        // we still guard in case a future change drops that fallback.
        setAiStats(null)
        return
      }
      setAiStats(json)
    } catch (e) {
      console.warn('[settings] ai-usage fetch failed:', e?.message)
      setAiStats(null)
    } finally {
      setAiLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isLoaded) {
      load()
      loadAiStats()
    }
  }, [isLoaded, load, loadAiStats])

  const toggleAi = async (nextValue) => {
    if (aiToggleLoading) return
    setAiToggleLoading(true)
    try {
      const res = await fetch('/api/profile-update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiFallbackEnabled: nextValue }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        toast.error(json.error || 'Kunde inte uppdatera AI-inställning')
        return
      }
      // Re-read stats so the counter / progress / toggle are in sync
      // after a server roundtrip — keeps optimistic-update drift at
      // zero when the server writes the value unchanged.
      setAiStats((prev) => prev ? { ...prev, aiFallbackEnabled: nextValue } : prev)
      toast.success(nextValue ? 'AI-svar aktiverat' : 'AI-svar avaktiverat')
    } catch (err) {
      toast.error('Oj, något gick fel: ' + err.message)
    } finally {
      setAiToggleLoading(false)
    }
  }

  const openPortal = async () => {
    try {
      const res = await fetch('/api/portal', { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.url) {
        window.location.href = json.url
        return
      }
      toast.error(json.error || 'Kunde inte öppna portalen')
    } catch (err) {
      toast.error('Oj, något gick fel: ' + err.message)
    }
  }

  // ---- Push toggle (mirrors dashboard's wire-up) ----
  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
    return outputArray
  }

  const togglePush = async () => {
    setPushLoading(true)
    try {
      if (pushActive) {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) await subscription.unsubscribe()
        await fetch('/api/push-unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        setPushActive(false)
        toast.success('Push-notiser avaktiverade')
      } else {
        if (!('Notification' in window)) {
          toast.error('Push-notiser stöds inte i din webbläsare.')
          return
        }
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          toast.error('Du måste tillåta push-notiser i webbläsaren.')
          return
        }
        const registration = await navigator.serviceWorker.register('/service-worker.js')
        await navigator.serviceWorker.ready
        const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey,
        })
        const subRes = await fetch('/api/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription }),
        })
        const json = await subRes.json()
        setPushActive(json.active || false)
        toast.success('Push-notiser aktiverade!')
      }
    } catch (e) {
      console.error('push error', e)
      toast.error('Kunde inte aktivera push-notiser: ' + e.message)
    } finally {
      setPushLoading(false)
    }
  }

  // ---- Data export (GDPR art. 20) ----
  const exportData = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch('/api/account-export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error || 'Kunde inte ladda ner data')
        return
      }
      // Server returns Content-Disposition: attachment; filename=… so a
      // plain blob download is the right UX — otherwise this file would
      // just open as raw JSON inside the browser tab.
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const filename = `jobbpiloten-data-${new Date().toISOString().slice(0, 10)}.json`
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Data nedladdad — kolla din mapp för nedladdningar')
    } catch (err) {
      toast.error('Oj, något gick fel: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // ---- Account deletion (GDPR art. 17) ----
  const handleDelete = async (phrase) => {
    if (deleting) return
    setDeleting(true)
    setDeletionResult(null)
    try {
      const res = await fetch('/api/account-delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: phrase }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        toast.error(json.error || 'Kunde inte radera kontot')
        return
      }
      setDeletionResult(json.deleted || {})
      toast.success('Ditt konto är raderat')
      // After successful deletion, write out a clean slate — clear the
      // demo-mode marker, drop the demo cookie, then navigate home so the
      // user sees the landing page rather than a dead /settings.
      try {
        localStorage.removeItem('demoUser')
        document.cookie = 'demoUserId=; path=/; max-age=0'
      } catch (_) { /* ignore */ }
      setTimeout(() => {
        window.location.href = '/?account-deleted=1'
      }, 1500)
    } catch (err) {
      toast.error('Oj, något gick fel: ' + err.message)
    } finally {
      setDeleting(false)
    }
  }

  const disconnectOne = async (session) => {
    if (!session || disconnectingOneId) return
    setDisconnectingOneId(session._id || session.token)
    try {
      const res = await fetch('/api/extension/token?token=' + encodeURIComponent(session.token), { method: 'DELETE', credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { toast.error(json.error || 'Kunde inte koppla från.'); return }
      setSessions((prev) => prev.filter((s) => (s._id || s.token) !== (session._id || session.token)))
      toast.success('Enhet frånkopplad')
    } catch (e) { toast.error('Oj, något gick fel: ' + e.message) } finally { setDisconnectingOneId(null) }
  }

  const disconnectAll = async () => {
    if (disconnectingAll) return
    setDisconnectingAll(true)
    try {
      const res = await fetch('/api/extension/token', { method: 'DELETE', credentials: 'include' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { toast.error(json.error || 'Kunde inte frånkoppla.'); return }
      setSessions([])
      setDisconnectAllOpen(false)
      toast.success('Alla enheter frånkopplade')
    } catch (e) { toast.error('Oj, något gick fel: ' + e.message) } finally { setDisconnectingAll(false) }
  }

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50">
        <nav className="border-b border-slate-100 bg-white sticky top-0 z-30">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
                <Plane className="w-4 h-4 text-white -rotate-45" />
              </div>
              <span className="font-semibold">JobbPiloten</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                data-testid="settings-back-to-dashboard"
                className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
              </Link>
              <SafeUserButton afterSignOutUrl="/" />
            </div>
          </div>
        </nav>

        <div className="container mx-auto px-4 py-8 max-w-4xl" data-testid="settings-root">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mb-8"
          >
            <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full mb-3 border border-indigo-100">
              <SettingsIcon className="w-3 h-3" />
              Konto
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900">Inställningar</h1>
            <p className="text-slate-600 mt-2 text-base max-w-2xl">
              Hantera din profil, prenumeration och notiser. Du kan också exportera eller radera dina uppgifter när som helst.
            </p>
          </motion.div>

          {/* Profile */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5 text-indigo-600" /> Profil
                </CardTitle>
                <CardDescription>
                  Informationen AI:n använder för att skriva dina personliga brev.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {profile ? (
                  <ProfileEditor
                    key={profile.clerkId || profile.id || 'profile'}
                    profile={profile}
                    onSaved={() => load()}
                  />
                ) : (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-1/2" />
                    <Skeleton className="h-8 w-2/3" />
                    <Skeleton className="h-8 w-1/3" />
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Subscription */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.10, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            <SubscriptionCard
              subscription={subscription}
              profile={profile}
              onPortal={openPortal}
            />
          </motion.div>

          {/* Notifications */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            <NotificationsCard
              pushActive={pushActive}
              pushLoading={pushLoading}
              onToggle={togglePush}
            />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.175, ease: [0.16, 1, 0.3, 1] }} className="mb-6">
            <ExtensionInstallCard
              published={EXTENSION_PUBLISHED}
              storeUrl={EXTENSION_STORE_URL}
              installGuidePath={EXTENSION_INSTALL_GUIDE_PATH}
            />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18, ease: [0.16, 1, 0.3, 1] }} className="mb-6">
            <BrowserExtensionCard sessions={sessions} loading={loadingSessions} onDisconnectOne={disconnectOne} disconnectingOneId={disconnectingOneId} onDisconnectAll={disconnectAll} disconnectingAll={disconnectingAll} onOpenDisconnectAll={() => setDisconnectAllOpen(true)} />
          </motion.div>

          {/* ---- AI usage / toggle ---- */}
          {/* Rendered independently from `profile` because the AI
              card reads from /api/ai-usage only — a profile load
              failure (e.g. unreachable Clerk) shouldn't blank the
              AI counter for the demo user. The card shows its own
              skeleton until aiLoading clears. */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.19, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            {aiLoading ? (
              <Card className="border-0 shadow-sm" data-testid="settings-ai-usage-loading">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-indigo-600" /> AI-hjälp i ansökningsformulär
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-3/4" />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <AIUsageCard
                stats={aiStats}
                loading={aiLoading}
                onToggle={(v) => toggleAi(v)}
                toggleLoading={aiToggleLoading}
              />
            )}
          </motion.div>

          {/* AI-stil för ansökningar (Round-35 / Part 3). Sits right
              after the AI usage card so the user sees the related
              "how the AI behaves" controls together. Independent
              save flow — a single-field PUT to /api/profile-update,
              not a multi-field form patch — so it manages its own
              loading + toast state instead of piggybacking on the
              page-level ProfileEditor. */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.195, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            <AIStyleCard
              currentStyleId={profile?.stylePreference}
              onStyleChanged={() => load()}
            />
          </motion.div>

          {/* Sparade svar (frontend-förhandsvisning) */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.195, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            <AnswerMemoryCard />
          </motion.div>

          {/* Data & privacy */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.20, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            <Card className="border-0 shadow-sm" data-testid="settings-data">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-600" /> Data & integritet
                </CardTitle>
                <CardDescription>
                  Exportera eller radera dina uppgifter — rättigheter enligt GDPR art. 17 och 20.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                  <div className="space-y-1">
                    <div className="font-medium text-sm text-slate-900 flex items-center gap-2">
                      <Download className="w-4 h-4 text-slate-400" /> Ladda ner mina uppgifter
                    </div>
                    <div className="text-xs text-slate-500 max-w-md">
                      Hämtar en JSON-fil med allt vi lagrar om dig: profil, ansökningar,
                      push-prenumeration och de senaste cron-loggarna. Inga externa system anropas.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={exportData}
                    disabled={exporting}
                    data-testid="settings-export"
                    className="shrink-0"
                  >
                    {exporting
                      ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Förbereder...</>
                      : <><Download className="w-3 h-3 mr-1" /> Ladda ner JSON</>}
                  </Button>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border-2 border-red-200 p-4 bg-red-50/40 hover:border-red-300 transition-colors">
                  <div className="space-y-1">
                    <div className="font-medium text-sm text-red-900 flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-red-600" /> Radera mitt konto
                    </div>
                    <div className="text-xs text-red-800/80 max-w-md">
                      Raderar permanent alla dina uppgifter. Kan inte ångras.
                      Kom ihåg att avbryta din prenumeration via Stripe först — det gör den inte automatiskt.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                    disabled={deleting}
                    data-testid="settings-open-delete"
                    className="shrink-0 bg-red-600 hover:bg-red-700 text-white"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Radera konto
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Footer light */}
          <footer className="mt-8 text-center text-xs text-slate-400">
            Frågor? Maila{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-slate-700">
              {SUPPORT_EMAIL}
            </a>.
          </footer>
        </div>

        <DeleteAccountDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          deleting={deleting}
          deletionResult={deletionResult}
        />

        <DisconnectAllDialog open={disconnectAllOpen} onOpenChange={setDisconnectAllOpen} onConfirm={disconnectAll} disconnecting={disconnectingAll} />
      </div>
    </ErrorBoundary>
  )
}
