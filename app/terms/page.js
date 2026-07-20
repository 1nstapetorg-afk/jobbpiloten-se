import Link from 'next/link'
import { Plane, CheckCircle2, AlertTriangle, FileText, CreditCard, Ban, ShieldCheck, Mail, Gavel, Clock, Bell, Zap } from 'lucide-react'
import Section from '@/components/legal/Section'
import { SUPPORT_EMAIL } from '@/lib/siteConfig'

export const metadata = {
  title: 'Användarvillkor — JobbPiloten',
  description: 'Villkor för att använda JobbPiloten — prenumerationer, AI-innehåll och ansvarsbegränsning.',
}

/**
 * Användarvillkor för JobbPiloten.
 *
 * Skrivna på klarspråk (svenska) för att vara begripliga. Vi tar upp:
 *   - Vilken tjänst som levereras (och inte)
 *   - Användarens ansvar
 *   - Prenumeration, fakturering, uppsägning, ångerrätt (distansavtalslagen)
 *   - AI-genererat innehåll (transparens, äganderätt)
 *   - Ansvarsbegränsning
 *   - Tillämplig lag och tvistlösning (svensk rätt)
 *
 * Round-34 expansion (Part 9 — Trust & Compliance: Legal Text Expansion):
 *  - Section 5 ("Förnyelse") — 7-dagars påminnelse via e-post innan
 *    automatisk förnyelse, så att användaren hinner säga upp i tid.
 *  - Section 9 ("Force majeure") — uttryckligt undantag för händelser
 *    utanför vår kontroll (AF-API driftstopp, groq, stripe, force
 *    majeure enligt svensk rätt).
 *  - Section 8 ("Ansvarsbegränsning") uppdaterad med en explicit
 *    cookie-policy-länk.
 */
export default function TermsPage() {
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
          <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full mb-4 border border-indigo-100">
            <FileText className="w-3 h-3" /> Användarvillkor
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 leading-tight">Användarvillkor</h1>
          <p className="text-slate-600 mt-3 text-lg">
            Det här gäller när du använder JobbPiloten. Kort, ärligt och på svenska.
          </p>
          <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Senast uppdaterad: {updated}
          </p>
        </header>

        <div className="rounded-2xl bg-white border border-slate-100 shadow-sm divide-y divide-slate-100">
          <Section icon={CheckCircle2} title="1. Vad JobbPiloten är — och inte är">
            <p><strong>Vad tjänsten gör:</strong></p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Söker lediga jobb från Arbetsförmedlingens öppna API baserat på din profil.</li>
              <li>Genererar personliga brev via AI som du kan granska, regenerera och kopiera.</li>
              <li>Genererar en PDF-Aktivitetsrapport du kan skicka till Arbetsförmedlingen.</li>
              <li>Skickar push-notiser när nya matchande jobb hittas (om du har aktiverat det).</li>
            </ul>
            <p className="mt-3">
              <strong>Vad tjänsten inte gör:</strong> JobbPiloten <em>skickar aldrig ansökningar åt dig</em>.
              Du granskar varje AI-genererat brev och skickar själv via arbetsgivarens egen kanal.
            </p>
          </Section>

          <Section icon={ShieldCheck} title="2. Ditt ansvar som användare">
            <ul className="list-disc pl-6 space-y-1">
              <li>Du ansvarar för att uppgifterna i din profil är korrekta och uppdaterade.</li>
              <li>Du ansvarar för att granska varje AI-genererat brev innan du skickar det.</li>
              <li>Du får inte använda tjänsten för massutskick, spam eller i strid med arbetsgivares villkor.</li>
              <li>Du ansvarar för att ditt konto och ditt lösenord inte delas med andra.</li>
            </ul>
          </Section>

          <Section icon={CreditCard} title="3. Prenumeration och betalning">
            <ul className="list-disc pl-6 space-y-1">
              <li>Vi erbjuder tre abonnemang: <strong>Basic</strong> (124 kr/mån), <strong>Professional</strong> (291 kr/mån) och <strong>Elite</strong> (666 kr/mån).</li>
              <li>Årsbetalning ger två månader rabatt.</li>
              <li>Professional och Elite inkluderar 14 dagars gratis provperiod — du kan avbryta innan provperioden löper ut utan att bli fakturerad.</li>
              <li>Betalning hanteras av <strong>Stripe</strong>. Vi ser aldrig ditt kortnummer.</li>
              <li>Faktura och kvitton skickas via e-post av Stripe.</li>
            </ul>
          </Section>

          <Section title="4. Uppsägning, paus och ångerrätt">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Du kan avsluta när som helst</strong> — ett klick räcker. Använd
                kundportalen (Stripe Billing Portal) från
                {' '}<Link href="/settings" className="text-indigo-600 hover:underline">Inställningar → Prenumeration</Link>,
                eller maila <a href={`mailto:${SUPPORT_EMAIL}`} className="text-indigo-600 hover:underline">{SUPPORT_EMAIL}</a>.
              </li>
              <li>
                Vid månadsbetalning löper abonnemanget ut vid periodens slut — <strong>ingen automatisk förlängning</strong> om du säger upp i tid.
              </li>
              <li>
                Vid årsbetalning kan du säga upp när som helst; redan betald period löper ut.
                <em> Vi återbetalar inte resterande månader</em> om du inte anger särskilda skäl (sjukdom, dubbelbetalning etc.).
              </li>
              <li>
                <strong>Ångerrätt (distansavtalslagen):</strong>Som konsument har du 14 dagars ångerrätt från det att avtalet ingicks.
                Om du vill utöva ångerrätten kontakta oss inom 14 dagar — vi återbetalar hela beloppet.
                Om du uttryckligen samtycker till att tjänsten levereras under ångerrättsperioden och avstår från ångerrätten,
                kan du inte ångra dig efter att tjänsten har levererats i mer än 14 dagar.
              </li>
            </ul>
          </Section>

          <Section icon={Bell} title="5. Förnyelse och påminnelser">
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>7 dagar innan varje förnyelse</strong> skickar vi en påminnelse via e-post till den
                adress som är kopplad till ditt konto. Mejlet innehåller abonnemang, pris, nästa
                fakturadatum och en direktlänk till kundportalen där du kan avbryta med ett klick.
              </li>
              <li>
                Påminnelsen är en <strong>service från oss</strong> — inte ett rättsligt krav. Även om
                mejlet av någon anledning inte levereras (full inbox, felaktig adress, spam-filter)
                förblir din uppsägningsrätt oförändrad.
              </li>
              <li>
                För abonnemang med <strong>gratis provperiod</strong> skickas påminnelsen dagen innan
                provperioden övergår i betalperiod, så att du hinner avbryta utan att bli fakturerad.
              </li>
              <li>
                Vill du avsluta <em>innan</em> påminnelsen? Logga in och gå till
                {' '}<Link href="/settings" className="text-indigo-600 hover:underline">Inställningar → Prenumeration</Link> —
                avbryt-knappen är tillgänglig dygnet runt.
              </li>
            </ul>
          </Section>

          <Section title="6. AI-genererat innehåll">
            <ul className="list-disc pl-6 space-y-1">
              <li>Personliga brev skapas av en språkmodell (Groq / OpenAI).</li>
              <li>Du äger det slutliga brevet. Du får använda, ändra och skicka det fritt.</li>
              <li>AI:n kan ibland hallucinera fakta. Du är alltid den sista granskningen innan ansökan skickas.</li>
              <li>Vi recommenderar att du alltid lägger till konkreta detaljer från din egen erfarenhet i brevet.</li>
            </ul>
          </Section>

          <Section title="7. Otillåten användning">
            <p>Du får inte:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Skicka massiva mängder förfrågningar som belastar våra system.</li>
              <li>Använda kontot för att utge dig för att vara någon annan.</li>
              <li>Försöka kringgå betalning eller ge otillbörlig tillgång till tjänsten.</li>
              <li>Skrapa, sälja vidare eller systematiskt kopiera data från tjänsten.</li>
            </ul>
            <p className="mt-3">Vid missbruk kan vi stänga av kontot utan återbetalning.</p>
          </Section>

          <Section title="8. Tillgänglighet och ändringar">
            <ul className="list-disc pl-6 space-y-1">
              <li>Vi strävar efter 99% tillgänglighet men kan inte garantera det (underhåll, driftstopp, tredje parts API).</li>
              <li>Vi kan uppdatera funktioner och priser. Vi meddelar minst 30 dagar innan en prishöjning via e-post.</li>
              <li>Vi kan komma att uppdatera dessa villkor. Den senaste versionen finns alltid på denna sida, och fortsatt användning innebär acceptans.</li>
              <li>För information om cookies, se vår <Link href="/legal/cookies" className="text-indigo-600 hover:underline" data-testid="terms-cookies-link">cookie-policy</Link>.</li>
            </ul>
          </Section>

          <Section icon={Zap} title="9. Force majeure">
            <p>
              Vi är befriade från ansvar för förseningar eller bristande leverans som beror på
              händelser utanför vår kontroll. Exempel på sådana händelser:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Driftstopp hos tredje part</strong> — Arbetsförmedlingens API, Stripe, Groq, Clerk, Vercel eller MongoDB Atlas.</li>
              <li><strong>Force majeure enligt svensk rätt</strong> — krig, naturkatastrof, pandemi, eldsvåda, myndighetsbeslut.</li>
              <li><strong>Strejk, lockout eller blockad</strong> som vi inte råder över.</li>
              <li><strong>Cyberattacker, DDoS eller säkerhetsincidenter</strong> hos underleverantörer.</li>
            </ul>
            <p className="mt-3">
              Om en force majeure-situation varar längre än 60 dagar har du rätt att säga upp
              abonnemanget utan uppsägnings­tid och få redan betald period återbetalad proportionellt.
            </p>
          </Section>

          <Section icon={AlertTriangle} title="10. Ansvarsbegränsning">
            <p>
              JobbPiloten tillhandahåller ett verktyg för att <em>underlätta</em> ditt jobbsökande.
              Vi ansvarar inte för:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Huruvida du faktiskt får jobb, intervjuer eller svar från arbetsgivare.</li>
              <li>Innehållet i AI-genererade brev (du granskar alltid innan du skickar).</li>
              <li>Driftstopp hos tredje part (Arbetsförmedlingen, Clerk, Stripe, Groq) — se avsnitt 9 ovan.</li>
              <li>Indirekta skador eller utebliven vinst.</li>
            </ul>
            <p className="mt-3">
              Vår maximala ersättningsskyldighet begränsas till det belopp du betalat för tjänsten de senaste 12 månaderna.
            </p>
          </Section>

          <Section icon={Gavel} title="11. Tillämplig lag och tvist">
            <p>
              Dessa villkor regleras av <strong>svensk rätt</strong>. Tvister ska i första hand lösas genom
              dialog med oss. Om vi inte kommer överens kan tvisten prövas av svensk allmän domstol,
              med Stockholms tingsrätt som första instans för konsumenttvister.
            </p>
            <p className="mt-2">
              Som konsument kan du också använda EU-kommissionens
              {' '}<a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">online-plattform för tvistlösning</a>.
            </p>
          </Section>

          <Section icon={Mail} title="12. Kontakt">
            <p>
              Frågor om villkoren? Maila <a href={`mailto:${SUPPORT_EMAIL}`} className="text-indigo-600 hover:underline">{SUPPORT_EMAIL}</a>.
            </p>
          </Section>
        </div>

        <p className="text-xs text-slate-400 mt-8 text-center">
          Läs också vår <Link href="/privacy" className="underline hover:text-slate-900">integritetspolicy</Link> för information om hur vi hanterar dina uppgifter.
        </p>
      </main>
    </div>
  )
}
