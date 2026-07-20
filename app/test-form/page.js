'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import ErrorBoundary from '@/components/ErrorBoundary'
import {
  Plane, Puzzle, CheckCircle2, AlertTriangle, Sparkles, Send, ArrowLeft,
  Wand2, Eye, Mail, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { EXTENSION_PUBLISHED, EXTENSION_STORE_URL, SUPPORT_EMAIL } from '@/lib/siteConfig'

/**
 * /test-form — öppen testsida för JobbPiloten Auto-Fill.
 *
 * Syftet är att ge QA-testare (och vänner & familj under soft-launch)
 * en "riktig" jobbansökningsliknande formulärmiljö att testa
 * extensionen mot — utan att besöka externa jobbsajter. Sidan
 * innehåller 7 fält vars etiketter matchar de exakta regex-ord som
 * extensionens `FIELD_PATTERNS`-tabell letar efter, så att alla
 * 7 huvudgrenar (förnamn, efternamn, e-post, telefon, personligt brev,
 * motivationsfråga, löneanspråk) utlöses.
 *
 * Sidan kräver INTE inloggning — den är publik så att en testare kan
 * nå den via en delad länk utan att först skapa ett konto. Vi
 * cachar inte heller några personuppgifter; allt fältinnehåll
 * lever i komponentens lokala state och rensas vid omladdning.
 *
 * Designval — "Testa Auto-Fill"-knappen:
 *   • Med installerat tillägg: knappen förklarar att ✈-ikonen
 *     nere till höger är den faktiska ifyllnads-affordancen, och
 *     pekar på popupens "Fyll i nu"-knapp som alternativ. Vi kan
 *     INTE trigga ifyllning direkt från sidan (extensionens
 *     content script lyssnar bara på chrome.runtime-meddelanden,
 *     inte på postMessage för fill-triggers) — det vore dessutom
 *     ett anti-pattern att en webbsida kan utlösa fill utan att
 *     användaren klickar på UI i extensionen.
 *   • Utan installerat tillägg: knappen länkar direkt till
 *     /extension-install med en tydlig svensk CTA.
 *
 * Designval — "Förhandsvisa ifyllning"-knappen:
 *   • Fyller formuläret med exempeldata (utan att kräva
 *     extensionen). Gör det möjligt att förhandsgranska hur en
 *     framgångsrik ifyllning ser ut, och fungerar även i
 *     Playwright-tester där extensionen inte kan laddas.
 *
 * Detektionsmekanism:
 *   • Extensionen sätter `data-jobbpiloten-ext="1"` på
 *     `document.documentElement` vid document_start (se
 *     extension/content.js). Vi pollar attributet på 1.5 s
 *     intervall + på window focus, samma mönster som
 *     /extension-install och /dashboard redan använder.
 */

// Demo-data som "Förhandsvisa ifyllning" skriver in. Hålls
// svenskspråkig och neutral så att sidan kan delas på sociala
// medier utan att exponera någon riktig jobbsökares uppgifter.
const PREVIEW_DATA = {
  firstName: 'Anna',
  lastName: 'Andersson',
  email: 'anna.andersson@example.se',
  phone: '070-123 45 67',
  coverLetter:
    'Hej!\n\n' +
    'Jag heter Anna och är en erfaren frontend-utvecklare med fokus på ' +
    'tillgänglighet och prestanda. Jag såg er annons och kände direkt ' +
    'att det här är en roll där min profil passar väl in — både tekniskt ' +
    'och vad gäller ert fokus på användarupplevelse.\n\n' +
    'Med vänliga hälsningar,\nAnna',
  whyCompany:
    'Ert företag sticker ut genom sitt tydliga fokus på hållbarhet och ' +
    'långsiktig produktutveckling. Det är något jag värderar högt och ' +
    'som jag gärna vill bidra till i min nästa roll.',
  salary: '45000',
}

export default function TestFormPage() {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    coverLetter: '',
    whyCompany: '',
    salary: '',
  })
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [extensionChecked, setExtensionChecked] = useState(false)
  // `fillResult` används för att visa en bekräftelsebanner efter
  // "Förhandsvisa ifyllning" — låter testaren se att knappen
  // faktiskt triggade en förändring utan att behöva öppna
  // devtools.
  const [fillResult, setFillResult] = useState(null)

  // Extension detection — samma mönster som
  // /extension-install + /dashboard + /settings redan använder.
  useEffect(() => {
    const check = () => {
      try {
        const v = document.documentElement.getAttribute('data-jobbpiloten-ext')
        setExtensionInstalled(v === '1')
        setExtensionChecked(true)
      } catch (_) {
        setExtensionChecked(true)
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

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFillResult(null)
  }, [])

  const handlePreview = () => {
    setForm(PREVIEW_DATA)
    setFillResult({ kind: 'preview', at: new Date().toISOString() })
    toast.success('Förhandsvisning ifylld — 7 fält med exempeldata')
  }

  const handleClear = () => {
    setForm({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      coverLetter: '',
      whyCompany: '',
      salary: '',
    })
    setFillResult(null)
    toast.success('Formuläret rensat')
  }

  // Auto-redirect after submit so the test form behaves like a
  // real ATS landing page (success state with green checkmark).
  // Submission is intentionally NOT wired to the JobbPiloten
  // profile — this is a test page, not a real application flow.
  const handleSubmit = (ev) => {
    ev.preventDefault()
    const emptyFields = Object.entries(form).filter(([, v]) => !String(v).trim()).map(([k]) => k)
    if (emptyFields.length > 0) {
      toast.error(`Tomma fält: ${emptyFields.join(', ')}`)
      return
    }
    toast.success('Skickat! (testformulär — inget skickades på riktigt)')
  }

  const renderExtensionStatus = () => {
    if (!extensionChecked) {
      return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-slate-300 animate-pulse" aria-hidden="true" />
          Kontrollerar om tillägget är installerat…
        </div>
      )
    }
    if (extensionInstalled) {
      return (
        <div
          data-testid="test-form-extension-status"
          data-extension-state="installed"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            <strong>Tillägget är installerat.</strong>{' '}
            Klicka på den orange ✈-ikonen nere till höger — eller öppna
            popupen och klicka <em>Fyll i nu</em>.
          </span>
        </div>
      )
    }
    return (
      <div
        data-testid="test-form-extension-status"
        data-extension-state="not-installed"
        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-center gap-2"
      >
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>
          <strong>Tillägget är inte installerat.</strong>{' '}
          <Link href="/extension-install" className="underline underline-offset-2 hover:text-amber-900">
            Installera JobbPiloten Auto-Fill
          </Link>{' '}
          för att testa auto-fill, eller använd knappen <em>Förhandsvisa ifyllning</em> nedan.
        </span>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-amber-50/40 via-white to-indigo-50/30">
        <nav className="border-b border-slate-100 bg-white/80 backdrop-blur sticky top-0 z-30">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
                <Plane className="w-4 h-4 text-white -rotate-45" />
              </div>
              <span className="font-semibold">JobbPiloten</span>
              <Badge variant="outline" className="ml-1 text-[10px] font-semibold px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200">
                Beta
              </Badge>
            </Link>
            <Link
              href="/extension-install"
              className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 transition-colors"
              data-testid="test-form-back"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Tillbaka
            </Link>
          </div>
        </nav>

        <div className="container mx-auto px-4 py-10 sm:py-16 max-w-3xl space-y-8" data-testid="test-form-root">
          <header className="space-y-4">
            <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full border border-indigo-100">
              <Puzzle className="w-3 h-3" />
              Testformulär för Auto-Fill
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Testa JobbPiloten Auto-Fill
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
              Den här sidan innehåller 7 fält som matchar de etiketter
              vår extension letar efter. Med tillägget installerat och
              anslutet fylls fälten i automatiskt — utan behöver du
              besöka en riktig jobbsajt. Använd gärna{' '}
              <em>Förhandsvisa ifyllning</em> för att se hur en
              lyckad ifyllning ser ut.
            </p>
            {renderExtensionStatus()}
          </header>

          {/* Hint card — förklarar exakt vad extensionen gör
              (utan att lova för mycket). */}
          <Card className="border-0 shadow-sm bg-indigo-50/40">
            <CardContent className="p-4 sm:p-5 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-700 leading-relaxed">
                <strong>Så här fungerar det:</strong> När du klickar på
                ✈-ikonen (eller <em>Fyll i nu</em> i popupen) läser
                extensionen av dina profilfält från Chrome-lagringen och
                fyller i matchande fält här. Fält som saknar data i din
                profil får en gul kontur; AI-genererade svar (när du
                slagit på det i /settings) får en blå streckad kontur.
                Tryck aldrig submit på en riktig arbetsgivares sida
                utan att granska varje fält först.
              </div>
            </CardContent>
          </Card>

          {/* The form itself. data-testid anchors every field so
              Playwright can target them without depending on label
              text (which may drift). The label text is what
              extension's FIELD_PATTERNS regex matches, so changing
              the label would break auto-fill — keep them in sync
              with lib/extension-profile.js + extension/content.js
              FIELD_PATTERNS. */}
          <Card className="border-0 shadow-md overflow-hidden" data-testid="test-form">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 text-white">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Ansökan — Frontend-utvecklare</h2>
              </div>
              <p className="text-sm text-amber-50/95 mt-1 leading-relaxed">
                Testformulär — inget du skickar här hamnar i en riktig ansökan.
              </p>
            </div>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-5" data-testid="test-form-element">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="test-form-firstname">Förnamn</Label>
                    <Input
                      id="test-form-firstname"
                      data-testid="test-form-firstname"
                      value={form.firstName}
                      onChange={(e) => setField('firstName', e.target.value)}
                      placeholder="Anna"
                      autoComplete="given-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="test-form-lastname">Efternamn</Label>
                    <Input
                      id="test-form-lastname"
                      data-testid="test-form-lastname"
                      value={form.lastName}
                      onChange={(e) => setField('lastName', e.target.value)}
                      placeholder="Andersson"
                      autoComplete="family-name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="test-form-email">E-post</Label>
                    <Input
                      id="test-form-email"
                      data-testid="test-form-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      placeholder="anna@example.se"
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="test-form-phone">Telefon</Label>
                    <Input
                      id="test-form-phone"
                      data-testid="test-form-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setField('phone', e.target.value)}
                      placeholder="070-123 45 67"
                      autoComplete="tel"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="test-form-cover-letter">Personligt brev</Label>
                  <Textarea
                    id="test-form-cover-letter"
                    data-testid="test-form-cover-letter"
                    value={form.coverLetter}
                    onChange={(e) => setField('coverLetter', e.target.value)}
                    rows={5}
                    placeholder="Kort presentation av dig och din bakgrund…"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="test-form-why-company">Varför vill du jobba hos oss?</Label>
                  <Textarea
                    id="test-form-why-company"
                    data-testid="test-form-why-company"
                    value={form.whyCompany}
                    onChange={(e) => setField('whyCompany', e.target.value)}
                    rows={4}
                    placeholder="Berätta vad som lockar dig med rollen och företaget…"
                  />
                </div>

                <div className="space-y-1.5 max-w-[240px]">
                  <Label htmlFor="test-form-salary">Löneanspråk (kr/mån)</Label>
                  <Input
                    id="test-form-salary"
                    data-testid="test-form-salary"
                    type="number"
                    min="0"
                    value={form.salary}
                    onChange={(e) => setField('salary', e.target.value)}
                    placeholder="45000"
                  />
                </div>

                {/* Action row — Testa Auto-Fill (the
                    extension-driven path) + Förhandsvisa
                    ifyllning (always-available demo path) +
                    Rensa. Both buttons emit Sonner toasts so
                    testers get a clear "yes that worked" signal
                    in the bottom-right corner. */}
                <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
                  {extensionInstalled ? (
                    <div
                      data-testid="test-form-fill-button"
                      data-extension-state="installed"
                      className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-amber-500 text-white font-semibold shadow-sm"
                    >
                      <Wand2 className="w-4 h-4" />
                      Klicka ✈-ikonen nere till höger
                    </div>
                  ) : (
                    <Link
                      href="/extension-install"
                      data-testid="test-form-fill-button"
                      data-extension-state="not-installed"
                      className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      <Puzzle className="w-4 h-4" />
                      Installera tillägget först
                    </Link>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePreview}
                    data-testid="test-form-preview-button"
                    className="h-11 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  >
                    <Eye className="w-4 h-4 mr-1.5" />
                    Förhandsvisa ifyllning
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleClear}
                    data-testid="test-form-clear-button"
                    className="h-11 text-slate-500 hover:text-slate-900"
                  >
                    Rensa
                  </Button>

                  <Button
                    type="submit"
                    className="h-11 bg-slate-900 hover:bg-slate-800 sm:ml-auto"
                    data-testid="test-form-submit-button"
                  >
                    <Send className="w-4 h-4 mr-1.5" />
                    Skicka (test)
                  </Button>
                </div>

                {fillResult && fillResult.kind === 'preview' && (
                  <div
                    data-testid="test-form-preview-banner"
                    className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 flex items-center gap-2"
                    role="status"
                    aria-live="polite"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Förhandsvisning ifylld — 7 fält med exempeldata. Tryck
                    <em>Rensa</em> och ladda sedan med tillägget för att
                    se hur en riktig ifyllning ser ut.
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Felsökning</CardTitle>
              <CardDescription>
                Om inget händer när du klickar ✈-ikonen, kontrollera följande:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 list-none p-0 m-0 text-sm text-slate-700">
                {[
                  'Är du inloggad på jobbpiloten.se? Utan en aktiv session kan tillägget inte hämta din profil.',
                  'Har du klickat "Anslut din profil" på Dashboard? Token sparas krypterad i Chrome — om du rensade webbläsardata behöver du ansluta igen.',
                  'Har du sparat dina uppgifter i /settings? Tomma profilfält ger gula konturer, inte ifyllning.',
                  'Får du toast-meddelandet "För många AI-svar"? Vänta en stund — servern har en rate-limit på 20 AI-svar per timme.',
                ].map((text, i) => (
                  <li key={i} className="flex items-start gap-2 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" aria-hidden="true" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="text-center text-xs text-slate-500">
            Frågor? Maila{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-slate-700">
              {SUPPORT_EMAIL}
            </a>
            .
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
