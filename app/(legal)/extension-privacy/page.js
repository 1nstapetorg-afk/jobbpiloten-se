import Link from 'next/link'
import { FormInput, Globe, Shield, Eye, Mail, Lock, Trash2, Database } from 'lucide-react'
import Section from '@/components/legal/Section'
import { LEGAL_COMPANY_NAME, PRIVACY_EMAIL } from '@/lib/siteConfig'

export const metadata = {
  title: 'Integritet för tillägget — JobbPiloten Auto-Fill',
  description:
    'Vad Chrome-tillägget JobbPiloten Auto-Fill läser, skickar och aldrig samlar in — på klarspråk.',
}

/**
 * Extension-specific privacy policy (/extension-privacy) — required by
 * the Chrome Web Store for extensions that read form fields. Short and
 * concrete: WHAT the extension reads (form fields + page URL), WHERE
 * it sends data (only JobbPiloten's server, on your action), and what
 * it does NOT collect. Links back to the main privacy policy
 * (/privacy) which covers the web app as a whole (GDPR).
 */
export default function ExtensionPrivacyPage() {
  const updated = '2026-08-06'
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-100 bg-white sticky top-0 z-30">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center">
              <Database className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-slate-900">JobbPiloten</span>
          </Link>
          <span className="text-sm text-slate-500">Integritetspolicy för tillägget</span>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-10 max-w-3xl">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <Section icon={Shield} title="Integritetspolicy — JobbPiloten Auto-Fill">
            <p>
              Detta är integritetspolicyn för Chrome-tillägget <strong>JobbPiloten
              Auto-Fill</strong> (tillägget), som är en del av tjänsten JobbPiloten
              från {LEGAL_COMPANY_NAME}. Den kompletterar vår allmänna{' '}
              <Link href="/privacy" className="text-indigo-600 hover:underline">
                integritetspolicy
              </Link>{' '}
              som beskriver hur webbplatsen jobbpiloten.se behandlar personuppgifter
              enligt GDPR.
            </p>
            <p>Senast uppdaterad: {updated}.</p>
          </Section>

          <Section icon={Eye} title="Vad tillägget läser">
            <p>Tillägget läser innehållet i jobbansökningsformulär på webbplatser du själv öppnar, till exempel:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Formulärfält (namn, e-post, telefon, adress, utbildning, arbetslivserfarenhet, fritextsvar).</li>
              <li>Sidans webbadress (URL) — enbart för att avgöra vilken typ av formulär det är och vilka fält som ska fyllas i.</li>
              <li>Din JobbPiloten-profil (endast den profil du själv har sparat på jobbpiloten.se).</li>
            </ul>
          </Section>

          <Section icon={Globe} title="Vart uppgifterna skickas">
            <p>
              Uppgifterna skickas <strong>endast</strong> till JobbPilotens server
              (jobbpiloten.se) och <strong>endast när du aktivt klickar</strong> på
              "Fyll i nu" eller när du begär ett AI-svar. Tillägget kommunicerar inte
              med någon annan tredje part.
            </p>
            <p>
              När du fyller i ett formulär skickas uppgifterna direkt till den
              webbplats du själv valt att ansöka hos — precis som om du skrivit in
              dem för hand.
            </p>
          </Section>

          <Section icon={Mail} title="AI-funktioner (svar och mejlutkast)">
            <p>
              När du ber om ett AI-svar skickas den aktuella frågan (t.ex.
              "Varför vill du jobba här?") tillsammans med relevanta delar av din
              profil till vår AI-leverantör för att generera svaret. Läs mer under
              "AI-behandling" i den allmänna{' '}
              <Link href="/privacy" className="text-indigo-600 hover:underline">
                integritetspolicyn
              </Link>.
            </p>
          </Section>

          <Section icon={Lock} title="Vad tillägget INTE samlar in">
            <ul className="list-disc pl-5 space-y-1">
              <li>Ingen spårning av dina surfvanor — vi läser inte webbplatser du inte öppnar en jobbansökan på.</li>
              <li>Inga lösenord, bankuppgifter eller kreditkortsnummer.</li>
              <li>Inga skärmbilder eller tangenttryckningar utanför formulärfält.</li>
              <li>Vi säljer aldrig din data och använder den inte för reklam.</li>
            </ul>
            <p>
              Tillägget sparar en krypterad anslutningsnyckel (token) i din webbläsares
              lokala lagring för att känna igen dig när du är inloggad på jobbpiloten.se.
              Du kan koppla från tillägget när som helst från inställningssidan, vilket
              omedelbart gör nyckeln ogiltig.
            </p>
          </Section>

          <Section icon={Trash2} title="Radering och dina rättigheter">
            <p>
              Du kan avinstallera tillägget när som helst — det lämnar inga spår i
              själva webbläsaren utöver den lokala nyckeln, som försvinner vid
              avinstallation. Uppgifter på våra servrar kan raderas via
              inställningssidan eller genom att kontakta {PRIVACY_EMAIL}. Dina
              GDPR-rättigheter (tillgång, rättelse, radering, begränsning,
              dataportabilitet) beskrivs i den allmänna{' '}
              <Link href="/privacy" className="text-indigo-600 hover:underline">
                integritetspolicyn
              </Link>.
            </p>
          </Section>

          <Section icon={FormInput} title="Kontakt">
            <p>
              Frågor om tilläggets integritet: {PRIVACY_EMAIL}. Fullständig
              integritetspolicy för webbplatsen:{' '}
              <Link href="/privacy" className="text-indigo-600 hover:underline">
                /privacy
              </Link>.
            </p>
          </Section>
        </div>
      </main>
    </div>
  )
}
