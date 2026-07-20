import Link from 'next/link'
import { Plane, Database, Eye, Shield, Mail, Clock, Bot, Users, Lock, IdCard, Cookie } from 'lucide-react'
import Section from '@/components/legal/Section'
import { LEGAL_COMPANY_NAME, PRIVACY_EMAIL } from '@/lib/siteConfig'

export const metadata = {
  title: 'Integritetspolicy — JobbPiloten',
  description: 'Hur JobbPiloten samlar in, använder och skyddar dina personuppgifter enligt GDPR.',
}

/**
 * Integritetspolicy för JobbPiloten.
 *
 * GDPR-aware: tydlig information om personuppgiftsansvarig, kategorier av
 * uppgifter, ändamål, laglig grund, mottagare, lagringstid och rättigheter.
 *
 * Innehållet är kort och konkret istället för juridiskt tungt — syftet är
 * att användaren faktiskt ska kunna läsa och förstå vad som händer med
 * hens uppgifter. Brödtext skrivs på klarspråk (svenska).
 *
 * Round-34 expansion: 4 new sections added on top of the pre-existing 10
 * to align with the Part 9 spec ("Trust & Compliance: Legal Text Expansion")
 * — AI-behandling (Groq mention + no-training + US-region disclaimer + SCC/DPF), Personnummer
 * (AF-only + encrypted-at-rest), Underleverantörer (5 listed data
 * processors with DPA links), Datalagring (12-mån rule after
 * subscription ends). Numbering re-aligned so the reading order is
 * data-collected → AI-behandling → personnummer → ändamål → laglig grund
 * → underleverantörer → delning → lagring → rättigheter → cookies →
 * säkerhet → klagomål. The Cookies section now also links out to the
 * dedicated /legal/cookies page.
 */
export default function PrivacyPage() {
  const updated = '2026-07-12'
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
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1 rounded-full mb-4 border border-emerald-100">
            <Shield className="w-3 h-3" /> GDPR-säker
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 leading-tight">Integritetspolicy</h1>
          <p className="text-slate-600 mt-3 text-lg">
            Så här hanterar JobbPiloten dina personuppgifter — kort, tydligt och enligt GDPR.
          </p>
          <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Senast uppdaterad: {updated}
          </p>
        </header>

        <div className="rounded-2xl bg-white border border-slate-100 shadow-sm divide-y divide-slate-100">
          <Section icon={Eye} title="1. Vem är ansvarig för dina uppgifter?">
            <p>
              JobbPiloten drivs av {LEGAL_COMPANY_NAME} (organisationsnummer anges separat i företagsregistret).
              Vi är <strong>personuppgiftsansvarig</strong> för den data vi samlar in via vår tjänst.
            </p>
            <p className="mt-2">
              Har du frågor om datahantering, kontakta vårt dataskyddsombud via e-post:
              <a href={`mailto:${PRIVACY_EMAIL}`} className="text-indigo-600 hover:underline ml-1">{PRIVACY_EMAIL}</a>.
            </p>
          </Section>

          <Section icon={Database} title="2. Vilka uppgifter samlar vi in?">
            <p>Vi samlar bara in det som krävs för att tjänsten ska fungera:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Konto:</strong> namn, e-post, telefonnummer, personnummer (valfritt, för AF-rapporten), adress</li>
              <li><strong>Karriärprofil:</strong> önskade titlar, orter, erfarenhetsnivå, lönenivå, arbetstyp, branscher att undvika</li>
              <li><strong>CV:</strong> egen sammanfattning och (om du laddar upp) bifogad CV-fil</li>
              <li><strong>Ansökningshistorik:</strong> jobb du förberett, status (förberedd / skickad / bekräftad), personliga brev</li>
              <li><strong>Betalning:</strong> hanteras av Stripe — vi lagrar aldrig ditt kortnummer. Vi ser bara abonnemangets status</li>
              <li><strong>Teknik:</strong> IP-adress, webbläsartyp, enhet (för säkerhet och felsökning)</li>
              <li><strong>Push-notiser:</strong> en anonym prenumerationsnyckel om du slår på notiser (vi skickar inga reklam)</li>
            </ul>
          </Section>

          <Section icon={Bot} title="3. AI-behandling av personuppgifter">
            <p>
              För att skriva personliga brev använder vi språkmodeller hos <strong>Groq</strong> med
              modellen <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">llama-3.3-70b-versatile</code>.
              När du klickar <em>Fyll i med AI</em> skickar vi (jobbets titel + beskrivning + din
              profil­sammanfattning) till Groq, som returnerar ett färdigt brev.
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Dina uppgifter används inte för att träna AI-modeller.</strong> Groq:s API-avtal
                förbjuder användning av våra prompts för modellträning, och vi delar inte dina rådata
                med öppna träningskorpusar.</li>
              <li><strong>Behandlingen sker utanför EU/EES.</strong> Groq:s inference-endpoints som vi
                använder är lokaliserade utanför EU/EES. Vi har tecknat ett personuppgiftsbiträdesavtal
                (DPA) med Groq som inkluderar EU-standardklausuler (SCC) och anslutning till EU-US
                Data Privacy Framework, så överföringen är rättsligt säkrad.</li>
              <li><strong>Ingen människa läser dina brev.</strong> AI-utdata returneras automatiskt till
                din webbläsare; varken Groq eller JobbPiloten lagrar prompten eller svaret i
                träningssyfte.</li>
              <li><strong>Du kan när som helst stänga av AI-hjälpen</strong> under
                {' '}<Link href="/settings" className="text-indigo-600 hover:underline">Inställningar → AI-hjälp</Link>.</li>
            </ul>
          </Section>

          <Section icon={IdCard} title="4. Personnummer">
            <p>
              Personnummer (ÅÅMMDD-XXXX) är <strong>frivilligt</strong> och efterfrågas enbart om du
              vill använda Aktivitetsrapporten gentemot Arbetsförmedlingen — blanketterna kräver
              personnummret för att AF ska kunna koppla rapporten till ditt ärende.
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Krypteras i vila.</strong> Personnumret lagras krypterat i vår databas
                (AES-256 via MongoDB Atlas encryption-at-rest) och exponeras aldrig mot klienten
                om du inte uttryckligen öppnar en PDF som innehåller det.</li>
              <li><strong>Delas aldrig med tredje part.</strong> Varken Groq, Stripe, Clerk eller någon
                annan underleverantör får tillgång till ditt personnummer — det är strikt
                JobbPiloten-data.</li>
              <li><strong>Kan raderas när som helst</strong> från din profilsida eller via
                {' '}<em>Radera mitt konto</em>-flödet på <Link href="/settings" className="text-indigo-600 hover:underline">/settings</Link>.</li>
            </ul>
          </Section>

          <Section title="5. Vad använder vi uppgifterna till?">
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Matchning:</strong> vi jämför din profil mot lediga jobb från Arbetsförmedlingens öppna API.</li>
              <li><strong>AI-brev:</strong> vi skickar {`(jobb, din profil)`} till vår AI-partner (Groq) som returnerar ett personligt brev. Brevet sparas hos oss.</li>
              <li><strong>Aktivitetsrapport:</strong> vi genererar en PDF du kan skicka till Arbetsförmedlingen.</li>
              <li><strong>Abonnemang:</strong> vi skickar data till Stripe för att hantera din prenumeration och fakturor.</li>
              <li><strong>Push-notiser:</strong> vi skickar en notis när nya matchande jobb hittas (om du har aktiverat).</li>
              <li><strong>Säkerhet:</strong> vi loggar misstänkt aktivitet för att skydda ditt konto.</li>
            </ul>
          </Section>

          <Section title="6. Laglig grund (GDPR artikel 6)">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Avtal (art. 6.1.b):</strong> för att leverera tjänsten du har betalat för.</li>
              <li><strong>Berättigat intresse (art. 6.1.f):</strong> för att skydda tjänsten mot missbruk och bedrägeri.</li>
              <li><strong>Samtycke (art. 6.1.a):</strong> för push-notiser, nyhetsbrev och valfri CV-uppladdning.</li>
            </ul>
          </Section>

          <Section icon={Users} title="7. Underleverantörer (personuppgiftsbiträden)">
            <p>
              Vi använder följande personuppgiftsbiträden för att driva tjänsten. Alla är bundna av
              skriftliga <strong>Data Processing Agreements (DPA)</strong> enligt GDPR artikel 28.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="py-2 pr-3 font-semibold">Biträde</th>
                    <th className="py-2 pr-3 font-semibold">Syfte</th>
                    <th className="py-2 pr-3 font-semibold">Region</th>
                    <th className="py-2 font-semibold">DPA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr><td className="py-2 pr-3">Stripe</td><td className="py-2 pr-3">Betalning &amp; prenumeration</td><td className="py-2 pr-3">EU/US (DPF)</td><td className="py-2"><a href="https://stripe.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">stripe.com/legal/dpa</a></td></tr>
                  <tr><td className="py-2 pr-3">MongoDB Atlas</td><td className="py-2 pr-3">Databaslagring</td><td className="py-2 pr-3">EU (Frankfurt)</td><td className="py-2"><a href="https://www.mongodb.com/legal/data-processing-addendum" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">mongodb.com/legal/dpa</a></td></tr>
                  <tr><td className="py-2 pr-3">Vercel</td><td className="py-2 pr-3">Hosting &amp; edge</td><td className="py-2 pr-3">EU/US (DPF)</td><td className="py-2"><a href="https://vercel.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">vercel.com/legal/dpa</a></td></tr>
                  <tr><td className="py-2 pr-3">Groq</td><td className="py-2 pr-3">AI-brevgenerering</td><td className="py-2 pr-3">US (SCC + DPF)</td><td className="py-2"><a href="https://groq.com/legal/data-processing-addendum/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">groq.com/legal/dpa</a></td></tr>
                  <tr><td className="py-2 pr-3">Clerk</td><td className="py-2 pr-3">Autentisering</td><td className="py-2 pr-3">EU/US (DPF)</td><td className="py-2"><a href="https://clerk.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">clerk.com/legal/dpa</a></td></tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              <strong>DPF</strong> = EU-US Data Privacy Framework (EU-kommissionens beslut 2023/1795).
            </p>
          </Section>

          <Section title="8. Delar vi dina uppgifter?">
            <p>Vi säljer aldrig dina uppgifter. Vi delar bara det som krävs för att tjänsten ska fungera (se avsnitt 7 ovan för fullständig lista). De mottagare som listas är:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Clerk</strong> — autentisering och kontosäkerhet (USA, EU-US Data Privacy Framework).</li>
              <li><strong>Stripe</strong> — abonnemang och betalning.</li>
              <li><strong>Groq</strong> — AI-generering av personliga brev (skickar {`(jobb, profil)`}, lagrar inget).</li>
              <li><strong>Arbetsförmedlingen</strong> — vi läser deras öppna jobb-API. Vi skriver ingenting till dem.</li>
              <li><strong>MongoDB Atlas</strong> — lagring, hostad inom EU.</li>
              <li><strong>Vercel</strong> — hosting av webbappen.</li>
            </ul>
          </Section>

          <Section icon={Clock} title="9. Hur länge sparar vi uppgifterna?">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Konto och profil:</strong> så länge du är kund. CV och ansökningsdata sparas
                i <strong>12 månader efter avslutad prenumeration</strong>. Därefter anonymiseras eller
                raderas uppgifterna automatiskt — du får ett mejl 30 dagar innan raderingen.</li>
              <li><strong>Ansökningar:</strong> upp till 24 månader (för att kunna generera historiska Aktivitetsrapporter).</li>
              <li><strong>Betaldata:</strong> enligt bokföringslagen (7 år).</li>
              <li><strong>Säkerhetsloggar:</strong> 90 dagar.</li>
            </ul>
          </Section>

          <Section title="10. Dina rättigheter (GDPR kapitel III)">
            <p>Du har alltid rätt att:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Rätt till tillgång (art. 15)</strong> — få en kopia av alla uppgifter vi har om dig.</li>
              <li><strong>Rätt till rättelse (art. 16)</strong> — rätta felaktiga uppgifter.</li>
              <li><strong>Rätt till radering (art. 17)</strong> — &quot;rätten att bli glömd&quot;.</li>
              <li><strong>Rätt till begränsning (art. 18)</strong> — pausa behandlingen tillfälligt.</li>
              <li><strong>Dataportabilitet (art. 20)</strong> — få ut dina uppgifter i maskinläsbart format
                (JSON-export finns under <Link href="/settings" className="text-indigo-600 hover:underline">Inställningar → Data &amp; integritet</Link>).</li>
              <li><strong>Invändning (art. 21)</strong> — invända mot behandling som baseras på berättigat intresse.</li>
              <li><strong>Återkalla samtycke (art. 7.3)</strong> — när som helst, för push-notiser och nyhetsbrev.</li>
            </ul>
            <p className="mt-3">
              För att utöva dessa rättigheter, kontakta oss på <a href={`mailto:${PRIVACY_EMAIL}`} className="text-indigo-600 hover:underline">{PRIVACY_EMAIL}</a>.
              Vi svarar inom 30 dagar.
            </p>
          </Section>

          <Section icon={Cookie} title="11. Cookies">
            <p>
              Vi använder strikt nödvändiga cookies för att du ska kunna logga in och hålla din
              session. Vi använder <strong>inga tredjepartsanalys- eller reklam-cookies</strong>.
            </p>
            <p className="mt-2">
              För en fullständig förteckning över alla cookies vi använder (namn, syfte, livslängd
              och leverantör), se vår <Link href="/legal/cookies" className="text-indigo-600 hover:underline" data-testid="privacy-cookies-link">cookie-policy</Link>.
            </p>
          </Section>

          <Section icon={Shield} title="12. Säkerhet">
            <ul className="list-disc pl-6 space-y-1">
              <li>All trafik är krypterad (HTTPS/TLS).</li>
              <li>Lösenord hanteras av Clerk och lagras aldrig i klartext av oss.</li>
              <li>Databasen är krypterad i vila (AES-256 via MongoDB Atlas).</li>
              <li>Endast auktoriserad personal har åtkomst, och all åtkomst loggas.</li>
              <li>Vi följer <strong>OWASP Top 10</strong> och kör årlig penetrationstestning.</li>
            </ul>
          </Section>

          <Section icon={Mail} title="13. Klagomål">
            <p>
              Om du anser att vi hanterar dina uppgifter fel kan du klaga hos
              {' '}<a href="https://www.imy.se/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Integritetsskyddsmyndigheten (IMY)</a>.
            </p>
          </Section>
        </div>

        <p className="text-xs text-slate-400 mt-8 text-center">
          Vill du veta mer om hur JobbPiloten fungerar? Läs våra <Link href="/terms" className="underline hover:text-slate-900">användarvillkor</Link>.
        </p>
      </main>
    </div>
  )
}
