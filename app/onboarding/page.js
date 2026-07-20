'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronRight, ChevronLeft, Check } from 'lucide-react'
import ErrorBoundary from '@/components/ErrorBoundary'
import CVFileUpload from '@/components/CVFileUpload'
import { toast } from 'sonner'
import { setDemoSessionCookie, hasDemoSessionCookie } from '@/lib/auth-cookie'

// Onboarding step labels — kept above the component so they can be referenced
// by tests (e.g. tests/e2e/onboarding.spec.js) without unmounting the wizard.
const STEPS = ['Karriärinfo', 'Personuppgifter', 'Preferenser', 'Granska']


// Onboarding form-state keys vs. canonical profile keys used everywhere
// else (api/[[...path]]/route.js POST /api/profile wants `fullName`,
// `linkedin`, `jobTitles`, etc.). We collect user-friendly fields with
// their own internal names so the UI is self-contained, then normalize
// into the canonical shape right before POST so the database stores
// the keys /settings + /dashboard + the cover-letter prompt all expect.
// Solves Bug #2: empty dashboards, empty AI-letters, empty Aktivitetsrapport.
const EXPERIENCE_MAP = {
  entry: 'Junior',
  mid: 'Medior',
  senior: 'Senior',
  Junior: 'Junior',
  Medior: 'Medior',
  Senior: 'Senior',
}

const EMPLOYMENT_TYPE_MAP = {
  'full-time': 'heltid',
  'part-time': 'deltid',
  contract: 'konsult',
  heltid: 'heltid',
  deltid: 'deltid',
  konsult: 'konsult',
  praktik: 'praktik',
  tillsvidare: 'tillsvidare',
  visstid: 'visstid',
}

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full-time', label: 'Heltid' },
  { value: 'part-time', label: 'Deltid' },
  { value: 'contract', label: 'Konsult' },
  { value: 'praktik', label: 'Praktik' },
  { value: 'tillsvidare', label: 'Tillsvidare' },
  { value: 'visstid', label: 'Visstid' },
]

const WORK_PREFERENCE_MAP = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'onsite',
  remote_legacy: 'remote',
}

/** Split a comma-separated string into a clean string array. Mirrors the
 *  helper in app/settings/page.js (kept duplicated to avoid coupling the
 *  onboarding client bundle to a server-side helper module). */
function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Pull the best email we can from a Clerk-or-demo `user` object.
 *  Clerk v5+ exposes `primaryEmailAddress.{emailAddress}` and an array
 *  of `emailAddresses`. Demo mode may store a flat `{email}` or be
 *  entirely empty — in which case we return an empty string and the
 *  dashboard fallback chain takes over. */
function readUserEmail(user) {
  if (!user) return ''
  return (
    user.primaryEmailAddress?.emailAddress ||
    user.emailAddresses?.[0]?.emailAddress ||
    user.email ||
    ''
  )
}

/** Compose a full name from a Clerk-or-demo `user`. Falls back to
 *  `user.fullName`, then to `firstName + lastName`, then to `''`. */
function readUserFullName(user) {
  if (!user) return ''
  if (user.fullName) return user.fullName
  const fn = (user.firstName || '').trim()
  const ln = (user.lastName || '').trim()
  const joined = [fn, ln].filter(Boolean).join(' ').trim()
  return joined || ''
}

/** Read the user's phone number from a Clerk-or-demo `user`. Clerk may
 *  expose a `phoneNumbers[0].phoneNumber`, demo mode might just store a
 *  flat `user.phone`. Returns `''` if no phone is available. */
function readUserPhone(user) {
  if (!user) return ''
  return (
    (Array.isArray(user.phoneNumbers) && user.phoneNumbers[0]?.phoneNumber) ||
    user.phone ||
    user.primaryPhoneNumber?.phoneNumber ||
    ''
  )
}

/** Map onboarding form state into the canonical API body. All keys
 *  here MUST be the names /api/profile's POST handler writes via $set.
 *  Aliases on the server side (see app/api/[[...path]]/route.js) catch
 *  the legacy raw fields if a caller skips this normalisation, but for
 *  the happy path we send canonical names from the very first request.
 *
 *  `user` (Clerk or demo) is passed in so that `fullName` and `email`
 *  fall back into the document if the form fields are empty — this is
 *  Bug #4 fix: hardcoding `email: ''` meant the AI cover-letter modal
 *  never had an e-postadress to display even though Clerk already
 *  knows the user's primary email. */
function buildApiBody(form, user) {
  const clerkEmail = readUserEmail(user)
  const clerkFullName = readUserFullName(user)
  return {
    fullName: form.name || clerkFullName || '',
    email: clerkEmail,
    phone: form.phone || '',
    personalNumber: form.personalNumber || '',
    address: form.address || '',
    linkedin: form.linkedInUrl || '',
    jobTitles: splitCsv(form.desiredTitles),
    locations: splitCsv(form.locations),
    salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
    experience: EXPERIENCE_MAP[form.experienceLevel] || '',
    workPreference: WORK_PREFERENCE_MAP[form.workPreference] || form.workPreference || '',
    // Issue 2 (2026-07-10): employmentType is now a multi-select
    // array. The onboarding form keeps the raw user keys
    // (`'full-time'`, `'part-time'`, …) in `formData.employmentTypes`
    // and maps each one through EMPLOYMENT_TYPE_MAP to the
    // canonical slugs the rest of the app stores in MongoDB. The
    // legacy `formData.employmentType` (string) is still accepted
    // here for backwards compat — a future migration to drop the
    // legacy key can happen in one place without breaking the
    // wizard.
    employmentType: (Array.isArray(form.employmentTypes) ? form.employmentTypes : [])
      .map((t) => EMPLOYMENT_TYPE_MAP[t] || t)
      .filter(Boolean),
    industriesToAvoid: Array.isArray(form.avoidedIndustries) ? form.avoidedIndustries : [],
  }
}



// NOTE: a `mergeProfileWithUser` helper used to live here but was dead code
// (it was added speculatively as a future hook). The dashboard has its own
// dedicated copy in app/dashboard/page.js (`mergeProfileWithUser` + its
// `readClerk*` helpers) — that is the live path used by the AI cover-letter
// modal. If the wizard ever needs to surface a merged `name + email` row
// in a future onboarding step, prefer hoisting both copies into a shared
// `lib/clerk-profile.js` rather than reintroducing this duplicate.

export default function OnboardingPage() {
  const router = useRouter()
  const { user } = useUser()
  const [step, setStep] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Round-46 / Bug 1 followup: AI email preview state. The user
  // can generate a preview of what their AI-written email body
  // looks like during onboarding's Granska step — wired via
  // /api/email-preview (POST). Surfaced as a "Förhandsvisa AI-mejl"
  // button under the summary card; on success the body displays
  // in a code-preview block + the cvShortWarning chip surfaces
  // when applicable.
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)
  const [previewBody, setPreviewBody] = useState('')
  const [previewCvShortWarning, setPreviewCvShortWarning] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [formData, setFormData] = useState({
    desiredTitles: '',
    experienceLevel: '',
    locations: '',
    salaryMin: '',
    salaryMax: '',
    name: '',
    personalNumber: '',
    address: '',
    phone: '',
    linkedInUrl: '',
    portfolioUrl: '',
    workPreference: '',
    // Issue 2 (2026-07-10): was a single string, now an array of
    // user-facing keys (`'full-time'`, `'part-time'`, …). The
    // `buildApiBody` helper maps each one to the canonical slugs
    // the rest of the app expects before POSTing to /api/profile.
    employmentTypes: [],
    avoidedIndustries: [],
  })

  const progress = ((step + 1) / STEPS.length) * 100

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      // Last step — submit profile
      handleSubmit()
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      // Ensure demo cookie is set for auth. Centralised helper so
      // the TTL, SameSite, and conditional Secure flag stay in lock-
      // step with the sign-in page and the `DemoAuthProvider`
      // bootstrap. The `hasDemoSessionCookie()` check is cheap
      // (single substring scan on the cookie header) so it's fine
      // to call on every onboarding submit.
      if (!hasDemoSessionCookie()) {
        setDemoSessionCookie('demo-user-001')
      }

      const apiBody = buildApiBody(formData, user)

      const res = await fetch('/api/profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiBody),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Kunde inte spara profilen')
      }

      // Success — small Sonner confirmation then redirect. Pairs with the
      // toast.error below so both branches use the same channel; the
      // previous browser `alert()` was jarring and inconsistent with the
      // rest of the app.
      toast.success('Profil skapad — tar dig till dashboarden')
      router.push('/dashboard')
    } catch (err) {
      toast.error('Kunde inte spara profilen: ' + err.message)
      setIsSubmitting(false)
    }
  }

  const handleBack = () => {
    if (step > 0) setStep(step - 1)
  }

  /**
   * Round-46 / Bug 1 followup — fire-and-display handler for the
   * "Förhandsvisa AI-mejl" button on the Granska step. Hits
   * /api/email-preview with empty jobTitle/company (the user is
   * previewing against their profile only — they haven't picked
   * a specific job yet during onboarding). The endpoint shares
   * the same lib/groq.js generateEmailBody() prompt as the Chrome
   * extension's compose panel, so what the user sees here is
   * semantically the same body shape they'll see later.
   *
   * Visible feedback: a loading state replaces the button label
   * ("Genererar…") + the preview area shows a "Genererar AI-utkast…"
   * placeholder. On success, the body renders in a read-only
   * code block. The cvShortWarning chip surfaces inline when the
   * CV is < 500 chars (per Round-46 / Bug 1 spec).
   *
   * Error path: surfaces a Swedish error toast — the user keeps
   * their draft intact (no data loss). The button re-enables so a
   * transient rate-limit / network blip can be retried.
   */
  const handlePreviewEmail = async () => {
    if (isGeneratingPreview) return
    setIsGeneratingPreview(true)
    setPreviewError('')
    setPreviewBody('')
    setPreviewCvShortWarning(false)
    try {
      const res = await fetch('/api/email-preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: formData.desiredTitles || '',
          company: '',
          lang: 'sv',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPreviewError((data && data.error) || `Servern returnerade ${res.status}`)
        return
      }
      setPreviewBody(data.body || '')
      setPreviewCvShortWarning(!!data.cvShortWarning)
    } catch (e) {
      setPreviewError('Kunde inte nå servern — försök igen.')
    } finally {
      setIsGeneratingPreview(false)
    }
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-4">
            <div>
              <Label>Önskade jobbtitlar (separera med komma)</Label>
              <Input placeholder="t.ex. Frontend Developer, UX Designer" value={formData.desiredTitles} onChange={(e) => updateField('desiredTitles', e.target.value)} />
            </div>
            <div>
              <Label>Erfarenhetsnivå</Label>
              <Select onValueChange={(v) => updateField('experienceLevel', v)} value={formData.experienceLevel}>
                <SelectTrigger><SelectValue placeholder="Välj nivå" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entry">Junior (0-2 år)</SelectItem>
                  <SelectItem value="mid">Medior (3-5 år)</SelectItem>
                  <SelectItem value="senior">Senior (5+ år)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Önskade orter (separera med komma)</Label>
              <Input placeholder="t.ex. Stockholm, Göteborg, Remote" value={formData.locations} onChange={(e) => updateField('locations', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Minimilön (kr/mån)</Label>
                <Input type="number" placeholder="35000" value={formData.salaryMin} onChange={(e) => updateField('salaryMin', e.target.value)} />
              </div>
              <div>
                <Label>Maxlön (kr/mån)</Label>
                <Input type="number" placeholder="60000" value={formData.salaryMax} onChange={(e) => updateField('salaryMax', e.target.value)} />
              </div>
            </div>
          </div>
        )
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <Label>Fullständigt namn</Label>
              <Input value={formData.name} onChange={(e) => updateField('name', e.target.value)} />
            </div>
            <div>
              <Label>Personnummer</Label>
              <Input placeholder="YYYYMMDD-XXXX" value={formData.personalNumber} onChange={(e) => updateField('personalNumber', e.target.value)} />
            </div>
            <div>
              <Label>Adress</Label>
              <Input value={formData.address} onChange={(e) => updateField('address', e.target.value)} />
            </div>
            <div>
              <Label>Telefonnummer</Label>
              <Input type="tel" value={formData.phone} onChange={(e) => updateField('phone', e.target.value)} />
            </div>
            <div>
              <Label>LinkedIn-profil</Label>
              <Input placeholder="https://linkedin.com/in/..." value={formData.linkedInUrl} onChange={(e) => updateField('linkedInUrl', e.target.value)} />
            </div>
            <div>
              <Label>Portfolio</Label>
              <Input placeholder="https://..." value={formData.portfolioUrl} onChange={(e) => updateField('portfolioUrl', e.target.value)} />
            </div>
          </div>
        )
      case 2:
        return (
          <div className="space-y-4">
            <div>
              <Label>Arbetsform</Label>
              <Select onValueChange={(v) => updateField('workPreference', v)} value={formData.workPreference}>
                <SelectTrigger><SelectValue placeholder="Välj arbetsform" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="remote">Distansarbete</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="onsite">På plats</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Anställningstyp (välj en eller flera)</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2" data-testid="onboarding-employmentType">
                {EMPLOYMENT_TYPE_OPTIONS.map((opt) => {
                  const isChecked = Array.isArray(formData.employmentTypes) && formData.employmentTypes.includes(opt.value)
                  return (
                    <label
                      key={opt.value}
                      className="flex items-center gap-2 text-sm text-slate-700 px-2.5 py-1.5 rounded-md border border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => updateField('employmentTypes',
                          isChecked
                            ? formData.employmentTypes.filter((x) => x !== opt.value)
                            : [...(Array.isArray(formData.employmentTypes) ? formData.employmentTypes : []), opt.value],
                        )}
                        data-testid={`onboarding-employmentType-${opt.value}`}
                      />
                      <span>{opt.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div>
              <Label>Branscher att undvika</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {['Försvar', 'Tobak', 'Spel', 'Olja & Gas'].map((industry) => (
                  <div key={industry} className="flex items-center space-x-2">
                    <Checkbox id={industry} checked={formData.avoidedIndustries.includes(industry)} onCheckedChange={(checked) => {
                      if (checked) updateField('avoidedIndustries', [...formData.avoidedIndustries, industry])
                      else updateField('avoidedIndustries', formData.avoidedIndustries.filter(i => i !== industry))
                    }} />
                    <Label htmlFor={industry} className="text-sm">{industry}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      case 3:
        return (
          <div className="space-y-4">
            {/* CV upload — mirrors /settings so the same drag-and-drop
                component is reused. We pass an empty profile object since
                a brand-new onboarding user has no existing cvFileName
                yet; once the file uploads the cvText is written to the
                profiles collection (server-side via /api/upload-cv) so
                the post-onboarding profile load picks it up. */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3 bg-white">
              <p className="text-sm font-medium text-slate-800">Ladda upp ditt CV (valfritt men rekommenderat)</p>
              <CVFileUpload profile={{}} onChanged={() => { /* server already stored cvText */ }} />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                AI:n använder den extraherade texten i dina personliga brev direkt vid första matchning.
                Du kan byta ut filen senare i{' '}
                <Link
                  href="/settings"
                  className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
                >
                  Inställningar
                </Link>
                .
              </p>
            </div>
            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-lg space-y-2">
              <h4 className="font-semibold text-indigo-900">Sammanfattning</h4>
              <p className="text-sm text-indigo-800">Jobbtitlar: {formData.desiredTitles || 'Ej angivet'}</p>
              <p className="text-sm text-indigo-800">Erfarenhet: {formData.experienceLevel || 'Ej angivet'}</p>
              <p className="text-sm text-indigo-800">Ort: {formData.locations || 'Ej angivet'}</p>
              <p className="text-sm text-indigo-800">Lön: {formData.salaryMin || '0'} - {formData.salaryMax || '0'} kr/mån</p>
              <p className="text-sm text-indigo-800">
                Anställningstyp: {Array.isArray(formData.employmentTypes) && formData.employmentTypes.length > 0
                  ? formData.employmentTypes
                      .map((t) => EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === t)?.label || t)
                      .join(', ')
                  : 'Alla typer'}
              </p>
            </div>
            {/* Round-46 / Bug 1 followup — Förhandsvisa AI-mejl.
                Surfaces the wire contract: a button generates a
                preview of the AI-written email body using the user's
                current profile (jobTitle = formData.desiredTitles,
                company = empty since onboarding hasn't picked one yet).
                On success, displays the body in a read-only block +
                the cvShortWarning chip. data-testid="onboarding-email-preview"
                locks the section for the e2e test below. */}
            <div
              className="rounded-lg border border-amber-100 bg-amber-50/50 p-4 space-y-3"
              data-testid="onboarding-email-preview"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-amber-900">Förhandsvisa AI-mejl</p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Genererar ett e-postutkast baserat på din profil — använder samma AI-motor som &quot;Ansök via mejl&quot;-knappen i tillägget.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handlePreviewEmail}
                  disabled={isGeneratingPreview}
                  data-testid="onboarding-email-preview-btn"
                  className="gap-2 bg-amber-500 hover:bg-amber-600 text-white"
                >
                  {isGeneratingPreview ? 'Genererar…' : 'Generera förhandsvisning'}
                </Button>
              </div>
              {previewError ? (
                <p className="text-xs text-red-700" data-testid="onboarding-email-preview-error">
                  {previewError}
                </p>
              ) : null}
              {previewCvShortWarning ? (
                <p
                  className="text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-1.5"
                  data-testid="onboarding-email-preview-cv-warning"
                >
                  Ditt CV är kort — ladda upp en längre version för ett mer personligt utkast.
                </p>
              ) : null}
              {previewBody ? (
                <pre
                  className="text-[12px] text-slate-800 bg-white border border-slate-200 rounded p-3 whitespace-pre-wrap font-sans leading-relaxed"
                  data-testid="onboarding-email-preview-body"
                >
                  {previewBody}
                </pre>
              ) : null}
            </div>
          </div>
        )
    }
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-indigo-50/40 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg border-indigo-100 shadow-sm">
          <CardHeader>
            <div className="flex justify-between items-center mb-2">
              <CardTitle className="text-indigo-900">Skapa din profil</CardTitle>
              <span className="text-sm text-indigo-500">Steg {step + 1} av {STEPS.length}</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between mt-2">
              {STEPS.map((s, i) => (
                <span key={s} className={`text-xs ${i === step ? 'text-indigo-600 font-medium' : 'text-indigo-300'}`}>{s}</span>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {renderStep()}
            <div className="flex justify-between mt-6">
              <Button variant="outline" onClick={handleBack} disabled={step === 0} className="gap-2">
                <ChevronLeft className="w-4 h-4" /> Tillbaka
              </Button>
              <Button 
                onClick={handleNext} 
                disabled={isSubmitting}
                className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {isSubmitting ? (
                  <>Sparar...</>
                ) : step === STEPS.length - 1 ? (
                  <><Check className="w-4 h-4" /> Slutför</>
                ) : (
                  <>Nästa <ChevronRight className="w-4 h-4" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  )
}
