import Link from 'next/link'
import { Plane, Shield, Cookie, Check, X, Eye, Settings as SettingsIcon } from 'lucide-react'
import Section from '@/components/legal/Section'
import { SUPPORT_EMAIL } from '@/lib/siteConfig'

export const metadata = {
  title: 'Cookie-policy — JobbPiloten',
  description: 'Förteckning över alla cookies vi använder: nödvändiga, analys och marknadsföring.',
}

/**
 * Cookie-policy för JobbPiloten.
 *
 * Uppdelad i tre kategorier enligt GDPR + svensk cookie-lag (SFS 2018:218):
 *   1. Nödvändiga — krävs för att tjänsten ska fungera (auth, säkerhet)
 *   2. Analys — frivillig statistik (vi använder INGA idag)
 *   3. Marknadsföring — frivillig spårning (vi använder INGA idag)
 *
 * Varje cookie listas med: namn, syfte, leverantör, livslängd (TTL).
 *
 * Round-34 (Part 9 — Trust & Compliance: Legal Text Expansion) — ny
 * dedikerad cookie-policy-sida. Tabellen är genererad från en
 * konstant-array längre ner så att framtida cookie-läggningar
 * kräver en enda redigering (samma mönster som
 * `lib/constants/testIds`).
 */
export default function CookiesPage() {
  const updated = '2026-07-12'

  // ---- Cookie-tabell (single source of truth) ----
  // `category` styr både rad-färgen och den utfällbara sektionen ovanför
  // tabellen. `duration` används verbatim i Duration-kolumnen. `provider`
  // pekar på tredje part eller "JobbPiloten" för first-party-cookies.
  const cookies = [
    {
      name: '__session',
      category: 'necessary',
      purpose: 'Håller dig inloggad mellan sidladdningar. Krypterad sessionstoken.',
      provider: 'JobbPiloten (Clerk)',
      duration: 'Session',
    },
    {
      name: 'demoUserId',
      category: 'necessary',
      purpose: 'Identifierar dig i demo-läget (när Clerk inte är konfigurerat). Sätts endast om du klickar "Demo" på /sign-in.',
      provider: 'JobbPiloten',
      duration: '30 dagar',
    },
    {
      name: 'cookieConsent',
      category: 'necessary',
      purpose: 'Kom ihåg ditt val i cookie-bannern (accepterat / endast nödvändiga). Krävs enligt svensk cookie-lag.',
      provider: 'JobbPiloten',
      duration: '365 dagar',
    },
    {
      name: 'CSRF-token',
      category: 'necessary',
      purpose: 'Skyddar formulär mot cross-site request forgery. Sätts automatiskt av Next.js / Clerk.',
      provider: 'Clerk',
      duration: 'Session',
    },
    {
      name: '__cf_bm',
      category: 'necessary',
      purpose: 'Bot-skydd framför allt för /sign-up, /sign-in och /api/checkout. Sätts av Cloudflare när domänen ligger bakom deras nät.',
      provider: 'Cloudflare',
      duration: '30 minuter',
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-100 bg-white sticky top-0 z-30">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
              <Plane className="w-4 h-4 text-white -rotate-45" />
            </div>
            <span className="font-semibold">JobbPiloten</span>
          </Link>
          <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">← Tillbaka till startsidan</Link>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <header className="mb-10">
          <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-800 text-xs font-semibold px-3 py-1 rounded-full mb-4 border border-amber-200">
            <Cookie className="w-3 h-3" /> Cookie-policy
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 leading-tight">Cookies & spårning</h1>
          <p className="text-slate-600 mt-3 text-lg">
            Här är varje cookie vi använder — vad den gör, vem som sätter den och hur länge den lever.
          </p>
          <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
            Senast uppdaterad: {updated}
          </p>
        </header>

        {/* ---- Top-line summary ---- */}
        <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6 md:p-8 mb-6">
          <div className="grid sm:grid-cols-3 gap-4" data-testid="cookies-summary">
            <SummaryCard
              icon={Check}
              tone="emerald"
              label="Nödvändiga"
              count={cookies.filter((c) => c.category === 'necessary').length}
              note="Alltid aktiva — kan inte stängas av"
            />
            <SummaryCard
              icon={X}
              tone="slate"
              label="Analys"
              count={0}
              note="Vi använder inga analys-cookies idag"
            />
            <SummaryCard
              icon={X}
              tone="slate"
              label="Marknadsföring"
              count={0}
              note="Vi använder inga reklam-cookies idag"
            />
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-slate-100 shadow-sm divide-y divide-slate-100">
          <Section icon={Shield} title="1. Vad är en cookie?">
            <p>
              En cookie är en liten textfil som webbläsaren lagrar lokalt på din dator när du besöker
              en webbplats. Cookies används för att webbplatsen ska komma ihåg dina val mellan
              sidladdningar — till exempel att du är inloggad eller vilket språk du föredrar.
            </p>
            <p className="mt-2">
              Enligt <strong>svensk cookie-lag (SFS 2018:218)</strong> måste webbplatser inhämta
              samtycke innan de lagrar cookies som <em>inte är strikt nödvändiga</em> för
              tjänsten. De cookies vi listar i kategori 1 (Nödvändiga) undantas från
              samtyckeskravet — de krävs för att du över huvud taget ska kunna använda
              webbplatsen.
            </p>
          </Section>

          <Section icon={Eye} title="2. Vilka cookies använder vi?">
            <p>
              Tabellen nedan listar <strong>alla</strong> cookies som kan sättas när du besöker
              jobbpiloten.se. Vi använder för närvarande <strong>inga analys- eller
              marknadsförings-cookies</strong> — alla cookies är strikt nödvändiga.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs border-collapse" data-testid="cookies-table">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="py-2 pr-3 font-semibold">Namn</th>
                    <th className="py-2 pr-3 font-semibold">Syfte</th>
                    <th className="py-2 pr-3 font-semibold">Leverantör</th>
                    <th className="py-2 pr-3 font-semibold">Livslängd</th>
                    <th className="py-2 font-semibold">Kategori</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cookies.map((c) => (
                    <tr key={c.name} data-testid={`cookie-row-${c.name}`}>
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-800">{c.name}</td>
                      <td className="py-2 pr-3 text-slate-600 leading-snug">{c.purpose}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.provider}</td>
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{c.duration}</td>
                      <td className="py-2">
                        <CategoryPill category={c.category} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section icon={SettingsIcon} title="3. Hur hanterar du cookies?">
            <p>
              Du kan när som helst ändra eller återkalla ditt samtycke genom att:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                <strong>Rensa cookies i din webbläsare</strong> — instruktioner för
                {' '}<a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Chrome</a>,{' '}
                <a href="https://support.mozilla.org/sv/kb/webblocsare-och-spårning" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Firefox</a>,{' '}
                <a href="https://support.apple.com/sv-se/guide/safari/ibrw1075/mac" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Safari</a>.
              </li>
              <li>
                <strong>Stänga av tredjeparts-cookies</strong> i webbläsarens inställningar. Detta
                kan dock göra att vissa funktioner på sajten slutar fungera (t.ex. inloggning).
              </li>
              <li>
                <strong>Återkalla ditt samtycke</strong> via
                {' '}<Link href="/settings" className="text-indigo-600 hover:underline">Inställningar</Link> (om funktionen är tillgänglig).
              </li>
            </ul>
            <p className="mt-3">
              Vissa cookies är <strong>förstahandscookies</strong> (sätts av jobbpiloten.se direkt).
              Andra är <strong>tredjepartscookies</strong> (sätts av våra underleverantörer — se
              avsnitt 4). Du kan blockera tredjepartscookies utan att förstahandscookies slutar fungera.
            </p>
          </Section>

          <Section title="4. Tredjepartscookies">
            <p>
              Vissa cookies sätts av våra underleverantörer (personuppgiftsbiträden). Dessa listas
              i tabellen ovan med sin respektive leverantör. För en fullständig förteckning över
              våra underleverantörer och deras DPA-avtal, se
              {' '}<Link href="/privacy" className="text-indigo-600 hover:underline">Integritetspolicy → avsnitt 7</Link>.
            </p>
          </Section>

          <Section title="5. Ändringar i cookie-policyn">
            <p>
              Vi kan komma att uppdatera denna cookie-policy om vi lägger till eller tar bort
              cookies. Den senaste versionen finns alltid på denna sida, och vi uppdaterar
              datumet längst upp vid varje ändring. För väsentliga förändringar (t.ex. om vi börjar
              använda analys-cookies) kommer vi att visa en cookie-banner igen och be om ditt
              samtycke.
            </p>
            <p className="mt-3">
              Frågor? Maila <a href={`mailto:${SUPPORT_EMAIL}`} className="text-indigo-600 hover:underline">{SUPPORT_EMAIL}</a>.
            </p>
          </Section>
        </div>

        <p className="text-xs text-slate-400 mt-8 text-center">
          Läs också vår <Link href="/privacy" className="underline hover:text-slate-900">integritetspolicy</Link> och våra <Link href="/terms" className="underline hover:text-slate-900">användarvillkor</Link>.
        </p>
      </main>
    </div>
  )
}

// ---- Sub-components ----

function SummaryCard({ icon: Icon, tone, label, count, note }) {
  const tones = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
  }[tone]
  return (
    <div className={`rounded-lg border p-4 ${tones}`} data-testid={`cookies-summary-${label.toLowerCase()}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{count}</div>
      <div className="text-[11px] opacity-80">{note}</div>
    </div>
  )
}

function CategoryPill({ category }) {
  const map = {
    necessary: { label: 'Nödvändig', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    analytics: { label: 'Analys', className: 'bg-amber-100 text-amber-800 border-amber-200' },
    marketing: { label: 'Marknadsföring', className: 'bg-rose-100 text-rose-800 border-rose-200' },
  }[category] || { label: category, className: 'bg-slate-100 text-slate-700 border-slate-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${map.className}`}>
      {map.label}
    </span>
  )
}
