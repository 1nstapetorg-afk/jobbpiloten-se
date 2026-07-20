'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ErrorBoundary from '@/components/ErrorBoundary'
import {
  Plane, Chrome, CheckCircle2, Download, Settings, Puzzle, ArrowLeft, Copy,
  AlertTriangle, Mail, Sparkles, FolderTree, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { useUser } from '@/hooks/useAuth'
import { EXTENSION_PUBLISHED, EXTENSION_STORE_URL } from '@/lib/siteConfig'

/**
 * /extension-install — dedicated install guide for the JobbPiloten
 * Auto-Fill browser extension. Reachable from the dashboard install
 * banner and the /settings extension card during the soft-launch
 * window (when NEXT_PUBLIC_EXTENSION_PUBLISHED is unset). Once the
 * extension is published on the Chrome Web Store, the same link is
 * resolved against the real CWS slug.
 *
 * Two install paths are documented:
 *   1. "Installera från Chrome Web Store" — for after the CWS
 *      review is approved. Single-click install.
 *   2. "Sideload (utvecklarläge)" — for friends-&-family testers
 *      who want to try the extension before public release. Walks
 *      through `chrome://extensions → Load unpacked`.
 *
 * The page is intentionally lightweight (no DB calls, no auth gate)
 * so anonymous users can reach it from a shared link. Detection of
 * "already installed" relies on the same `data-jobbpiloten-ext="1"`
 * document attribute the dashboard already polls.
 */

// Visual representation of the unzipped extension folder. Real DOM
// indentation (paddingLeft per row) instead of literal-space indents
// so the tree wraps gracefully on narrow viewports — the earlier
// version used leading spaces in the text content, which forced
// `overflow-x-auto` on the wrapper and produced a horizontal scroll
// bar on mobile. The icon-line spacing (≈1.25rem per level) matches
// the visual rhythm of `tree(1)` output.
function ExtensionFolderTree() {
  // Each row is `{ depth, text, highlight }` so the JSX controls the
  // indent rather than baking it into the text. depth=0 is the root
  // folder, depth=1 is the file level, depth=2 is the icons/ children.
  const rows = [
    { depth: 0, text: '📁 jobbpiloten-extension/', highlight: false },
    { depth: 1, text: '├── manifest.json   ← Chrome läser denna fil', highlight: true },
    { depth: 1, text: '├── background.js', highlight: false },
    { depth: 1, text: '├── content.js', highlight: false },
    { depth: 1, text: '├── popup.html', highlight: false },
    { depth: 1, text: '├── popup.js', highlight: false },
    { depth: 1, text: '├── popup.css', highlight: false },
    { depth: 1, text: '└── 📁 icons/', highlight: false },
    { depth: 2, text: '    ├── icon16.png', highlight: false },
    { depth: 2, text: '    ├── icon48.png', highlight: false },
    { depth: 2, text: '    └── icon128.png', highlight: false },
  ]
  // 1.25rem (~20px) per depth level matches the conventional
  // `tree(1)` indentation and gives the tree chars room to breathe
  // even at narrow viewports.
  return (
    <div
      data-testid="extension-folder-tree"
      className="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 font-mono text-[12px] leading-6 px-4 py-3 shadow-inner"
    >
      {rows.map((r, i) => (
        <div
          key={i}
          className={r.highlight ? 'text-amber-300 font-semibold' : 'text-slate-200'}
          style={{ paddingLeft: `${r.depth * 1.25}rem` }}
        >
          <span className="whitespace-pre">{r.text}</span>
        </div>
      ))}
      <p className="mt-3 pt-3 border-t border-slate-700 text-slate-400 text-[11px] font-sans leading-relaxed">
        💡 Välj mappen <code className="bg-slate-800 px-1 py-0.5 rounded text-amber-200">jobbpiloten-extension/</code> i
        steg 3 nedan — <strong className="text-amber-200">inte</strong> mappen
        <code className="bg-slate-800 px-1 py-0.5 rounded text-slate-200"> icons/</code> eller någon annan undermapp.
      </p>
    </div>
  )
}

function InstallSteps({ extensionInstalled }) {
  return (
    <ol className="space-y-4 list-none p-0 m-0">
      {[
        {
          n: 1,
          title: 'Ladda ner tillägget',
          body: extensionInstalled
            ? 'Tillägget är redan installerat i din webbläsare — du kan hoppa över steg 1 och 2.'
            : 'Klicka den stora gröna knappen nedan. Webbläsaren laddar ner en zip-fil (jobbpiloten-extension-v0.2.1.zip).',
        },
        {
          n: 2,
          title: 'Packa upp zip-filen',
          body: 'Högerklicka den nedladdade zip-filen och välj "Extrahera alla" / "Packa upp". Du får en mapp som heter jobbpiloten-extension/ — öppna den så att du ser manifest.json, content.js m.fl. direkt i mappen.',
        },
        {
          n: 3,
          title: 'Öppna Chrome-tilläggssidan',
          body: 'Skriv chrome://extensions i adressfältet och tryck Enter. Slå på "Utvecklarläge" (Developer mode) uppe till höger.',
        },
        {
          n: 4,
          title: 'Ladda upp tillägget',
          body: 'Klicka "Ladda upp okomprimerad" (Load unpacked). I filväljaren: navigera till mappen jobbpiloten-extension/ och välj SJÄLVA MAPPEN (inte någon fil inuti). Mappen som innehåller manifest.json — se trädet nedan för exakt struktur.',
        },
        {
          n: 5,
          title: 'Anslut din JobbPiloten-profil',
          // v0.2.3 — copy updated to match the v0.2.2 popup-based
          // auth flow. The user clicks the extension icon in
          // Chrome's toolbar (not the dashboard), the popup
          // opens a small auth window, the user signs in, and the
          // token is delivered back to the popup via postMessage.
          // The dashboard "tilläggs-kortet" path is no longer
          // primary — it remains a fallback in /settings.
          body: 'Klicka på tilläggs-ikonen (✈️) i Chrome → klicka "Anslut din profil" → ett litet fönster öppnas där du loggar in på JobbPiloten → klart! ✈-ikonen dyker nu upp på alla jobbsidor med matchande formulär.',
        },
      ].map(step => (
        <li
          key={step.n}
          className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4"
          data-testid={`install-step-${step.n}`}
        >
          <div className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-sm shadow-sm">
            {step.n}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function CopyToClipboardButton({ text, label = 'Kopiera', copiedLabel = 'Kopierad!', className = '' }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(copiedLabel)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      toast.error('Kunde inte kopiera — välj texten manuellt.')
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium border transition-colors ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
        (copied
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900') +
        ' ' + className
      }
      data-testid="copy-to-clipboard"
      aria-label={copied ? copiedLabel : label}
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Kopierad!' : label}
    </button>
  )
}

export default function ExtensionInstallPage() {
  const { isLoaded } = useUser()
  const router = useRouter()
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [extensionChecked, setExtensionChecked] = useState(false)

  // Same DOM-attribute detection pattern as the dashboard. The
  // content script (extension/content.js) sets
  // `data-jobbpiloten-ext="1"` on documentElement at document_start,
  // so a simple attribute read is enough to confirm the extension is
  // present.
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

  // Render an explicit "already installed" success state when the
  // detection loop confirms the extension is present. Catches the
  // case where the user lands here via a shared link after having
  // already installed the extension.
  const renderStatus = () => {
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
          data-testid="extension-already-installed"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            <strong>Tillägget är redan installerat.</strong>{' '}
            <Link href="/dashboard" className="underline underline-offset-2 hover:text-emerald-900">
              Gå till Dashboard
            </Link>{' '}
            och klicka "Anslut din profil" för att aktivera auto-fill.
          </span>
        </div>
      )
    }
    return null
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-amber-50/60 via-white to-indigo-50/40">
        {/* Top nav — back link to dashboard or home */}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(isLoaded ? '/dashboard' : '/')}
              className="text-slate-600 hover:text-slate-900"
              data-testid="extension-install-back"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Tillbaka
            </Button>
          </div>
        </nav>

        <div className="container mx-auto px-4 py-10 sm:py-16 max-w-3xl space-y-10" data-testid="extension-install-root">
          {/* Hero */}
          <header className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full border border-indigo-100">
              <Puzzle className="w-3 h-3" />
              JobbPiloten Auto-Fill
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
              Installera{' '}
              <span className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
                JobbPiloten Auto-Fill
              </span>
            </h1>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl mx-auto">
              Fyll i jobbansökningar med ett klick — förnamn, e-post, personligt brev, LinkedIn
              och mer direkt från din JobbPiloten-profil. Ingen inmatning, inga misstag, och
              inget lämnar din webbläsare utan din knapp.
            </p>
            {renderStatus()}
          </header>

          {/* Main CTA — chrome web store or sideload */}
          <Card className="border-0 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 text-white">
              <div className="flex items-center gap-2">
                <Chrome className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Installera i Chrome</h2>
              </div>
              <p className="text-sm text-amber-50/95 mt-1 leading-relaxed">
                {EXTENSION_PUBLISHED
                  ? 'Tillägget är publicerat på Chrome Web Store — ett klick räcker.'
                  : 'Under soft-launch-perioden använder vi Chrome\'s "Load unpacked"-läge för att låta vänner & familj testa tillägget innan det publiceras på Chrome Web Store.'}
              </p>
            </div>
            <CardContent className="p-6 space-y-5">
              {EXTENSION_PUBLISHED ? (
                <a
                  href={EXTENSION_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="install-cws-button"
                  className="w-full inline-flex items-center justify-center gap-2 h-12 px-5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-base font-semibold shadow-sm shadow-amber-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <Download className="w-5 h-5" />
                  Installera från Chrome Web Store
                </a>
              ) : (
                <div className="space-y-4">
                  {/* BIG GREEN ONE-CLICK DOWNLOAD BUTTON
                      —
                      The primary CTA for soft-launch friends-&-family.
                      Pure <a download> link, no client-side fetch needed
                      (the server returns the zip with the right
                      Content-Disposition header so the browser saves it
                      automatically). The version is in the filename so a
                      tester who has a stale copy from a previous release
                      can tell at a glance which build they have. */}
                  <a
                    href="/api/extension/download"
                    download
                    data-testid="extension-download-button"
                    className="group w-full inline-flex items-center justify-center gap-3 h-14 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white text-base font-bold shadow-lg shadow-emerald-500/30 transition-all hover:scale-[1.015] active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
                  >
                    <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
                    Ladda ner & Installera
                    <span className="hidden sm:inline-block ml-1 px-2 py-0.5 rounded-md bg-emerald-700/30 text-emerald-50 text-xs font-medium">
                      .zip
                    </span>
                  </a>

                  {/* What you'll get — the folder tree */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <FolderTree className="w-4 h-4 text-slate-500" />
                      Efter uppackning ser mappen ut så här:
                    </div>
                    <ExtensionFolderTree />
                  </div>

                  {/* Secondary CTA — for users who prefer to build
                      from source (developers + anyone who wants the
                      absolute latest from the git repo). */}
                  <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3 group">
                    <summary className="text-sm font-medium text-slate-700 cursor-pointer flex items-center gap-2 list-none">
                      <span className="text-slate-400 group-open:rotate-90 transition-transform">▸</span>
                      Bygga från källkod istället?
                    </summary>
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Klona repot och kör paketeraren lokalt — samma zip-format som knappen ovan:
                      </p>
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 flex items-center justify-between gap-3">
                        <code className="text-[12px] text-slate-800 font-mono">
                          yarn package:extension
                        </code>
                        <CopyToClipboardButton
                          text="yarn package:extension"
                          label="Kopiera kommando"
                          copiedLabel="Kommando kopierat!"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Detta kör först <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px]">validate:extension</code> för att
                        bekräfta att manifest + filer + ikoner är intakta, och producerar sedan
                        <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px]"> dist/jobbpiloten-extension.zip</code>.
                      </p>
                    </div>
                  </details>
                </div>
              )}

              {/* Step-by-step install walkthrough */}
              <div className="pt-2 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">
                  Steg-för-steg
                </h3>
                <InstallSteps extensionInstalled={extensionInstalled} />
              </div>
            </CardContent>
          </Card>

          {/* Verify section */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Verifiera att det fungerar
              </CardTitle>
              <CardDescription>
                Tre snabba test för att bekräfta att tillägget är aktivt — eller öppna vårt testformulär för ett färdigt formulär att testa på.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-3 list-none p-0 m-0">
                {[
                  'Öppna en jobbsida (t.ex. arbetsformedlingen.se/platsbanken/annonser/...) — den orange ✈-ikonen ska dyka upp nere till höger.',
                  // v0.2.3 — copy updated to match the v0.2.2 popup
                  // flow. The dashboard-card Anslut-button is no
                  // longer the primary path — the popup's own
                  // "Anslut din profil" CTA is.
                  'Klicka på ✈️-ikonen i Chrome → "Anslut din profil" → logga in i det lilla fönstret som öppnas. En grön "Ansluten"-status visas i popupen.',
                  'Prova att fylla i ett formulär — fält som matchar din profil får en grön kontur, okända fält får en blå streckad kontur om AI-hjälp är på.',
                ].map((text, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 text-sm text-slate-700"
                    data-testid={`verify-step-${i + 1}`}
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{text}</span>
                  </li>
                ))}
              </ul>
              {/* Test-formulär-länk — låter testare snabbt verifiera
                  auto-fill på en "riktig" ansökningsliknande sida
                  utan att lämna jobbpiloten.se. Snabbaste sättet att
                  bekräfta att extensionen fungerar innan man testar
                  på externa jobbsajter. */}
              <div className="pt-3 border-t border-slate-100">
                <Link
                  href="/test-form"
                  data-testid="open-test-form-link"
                  className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-300 text-amber-800 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <Puzzle className="w-4 h-4" />
                  Öppna testformulär
                </Link>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Sida med 7 fält som matchar extensionens regex — perfekt för ett första
                  smoke-test utan att behöva lämna jobbpiloten.se.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Felsökning */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Felsökning
              </CardTitle>
              <CardDescription>
                Vanliga orsaker till att ✈-ikonen inte syns eller att fält inte fylls i.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 list-none p-0 m-0">
                {[
                  {
                    title: '"Manifest file is missing or unreadable" i Chrome',
                    body: 'Du har förmodligen valt fel mapp i steg 4. Mappen du väljer MÅSTE innehålla manifest.json direkt (se trädet ovanför stegen). Öppna mappen i Utforskaren/Finder först och bekräfta att du ser manifest.json — om du ser filerna i en undermapp som heter extension eller icons, gå upp en nivå.',
                  },
                  {
                    title: '✈-ikonen syns inte alls',
                    body: 'Kontrollera att tillägget är aktiverat i chrome://extensions/ — knappen "Ta bort" ska vara synlig. Försök sedan ladda om sidan (Ctrl/Cmd+R).',
                  },
                  {
                    title: 'Fält fylls inte i när jag klickar',
                    body: 'Öppna Dashboard → "Anslut din profil" och kontrollera att anslutningen är aktiv (grön status). Token sparas krypterad i Chrome — om du rensade webbläsardata behöver du ansluta igen.',
                  },
                  {
                    title: 'Fältet jag vill fylla saknar kontur',
                    body: 'Tilläggets fält-matchare känner igen vanliga svenska/engelska etiketter (förnamn, e-post, personligt brev osv). Egna eller ovanliga fältnamn kan behöva en manuell justering.',
                  },
                  {
                    title: 'Tillägget syns i Chrome men inget händer',
                    body: 'En del jobbsajter (Workday, Greenhouse) laddar formuläret i en iframe från annan origin. Tillägget känner igen de flesta Workday/Teamtailor-mönster men kan behöva en uppdatering för nya ATS-plattformar.',
                  },
                ].map((q, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-slate-200 bg-slate-50/40 px-4 py-3"
                    data-testid={`faq-item-${i + 1}`}
                  >
                    <div className="text-sm font-medium text-slate-900">{q.title}</div>
                    <p className="text-sm text-slate-600 mt-1 leading-relaxed">{q.body}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Footer card */}
          <Card className="border-0 shadow-sm bg-gradient-to-br from-indigo-50 to-blue-50/60">
            <CardContent className="p-6 sm:p-8 text-center space-y-3">
              <Sparkles className="w-7 h-7 text-indigo-600 mx-auto" />
              <h3 className="text-lg font-semibold text-slate-900">
                Redo att ansluta din profil?
              </h3>
              {/* v0.2.3 — copy updated to match the v0.2.2 popup
                  flow. The footer CTA still opens /dashboard, but
                  the body no longer references the (now-removed)
                  dashboard "tilläggs-kortet" — the connect happens
                  from the popup itself. */}
              <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                När tillägget är installerat klickar du på ✈️-ikonen i
                Chrome och väljer "Anslut din profil". Klart på under
                en minut.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <Button
                  onClick={() => router.push('/dashboard')}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  data-testid="install-cta-dashboard"
                >
                  Öppna Dashboard
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.location.href = 'mailto:hej@jobbpiloten.se'}
                  data-testid="install-cta-support"
                >
                  <Mail className="w-3.5 h-3.5 mr-1" />
                  Få hjälp
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ErrorBoundary>
  )
}
