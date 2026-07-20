# TESTING.md — Manuell testchecklista för JobbPiloten Auto-Fill

> Det här dokumentet är för testare (vänner & familj + framtida
> CWS-recensenter) som vill verifiera att `JobbPiloten Auto-Fill`
> fungerar korrekt på **riktiga** jobbsajter — inte bara på
> [`/test-form`](/test-form).
>
> Följ stegen i ordning. Varje test avslutas med en
> **Förväntat resultat**-rad som talar om vad du ska se om allt
> fungerar. Avvikelser rapporteras till `hej@jobbpiloten.se`.

---

## Förutsättningar (gör en gång)

1. **Installera tillägget** — se [`/extension-install`](/extension-install)
   eller kör `yarn package:extension` och ladda mappen via
   `chrome://extensions → Utvecklarläge → Load unpacked`. ✈-ikonen
   ska synas i Chrome-verktygsfältet.
2. **Logga in på JobbPiloten** — öppna
   [`/dashboard`](/dashboard). Du behöver ett konto och en ifylld
   profil (se [`/onboarding`](/onboarding)).
3. **Anslut tillägget** — klicka *Anslut din profil* i
   tilläggs-kortet på dashboarden. En grön checkmark
   bekräftar att din profil + bearer token är synkade till
   `chrome.storage.local`.
4. **Verifiera** — besök [`/test-form`](/test-form). Den orange
   ✈-ikonen ska dyka upp nere till höger inom 1 sekund. Klickar
   du den fylls alla 7 fält med din profildata.
5. **Slå på AI-hjälp** (valfritt) — i
   [`/settings → AI-hjälp i ansökningsformulär`](/settings)
   står reglaget på *På* som default. Det gör att okända
   motivationsfrågor får AI-genererade svar (blå streckad kontur).

---

## Färgkodning (snabbreferens)

| Konturfärg | Betydelse |
|---|---|
| 🟢 Grön heldragen | Fältet är ifyllt från din profil. |
| 🟡 Gul heldragen | Fältet matchar en etikett, men din profil saknar värde. |
| 🔵 Blå streckad | AI-genererat svar — **granska innan du skickar**. |
| 🔴 Röd streckad | REVIEW_NEEDED — webbplatsens `onchange`-handler avvisade mutationen. |

---

## Testfall 1 — Volvo Cars Careers

> **URL:** <https://www.volvocars.com/se/careers.html>
> **ATS:** Egen Volvo-karriärsida (custom React-formulär).

### Steg

1. Gå till <https://www.volvocars.com/se/careers.html>.
2. Klicka på en ledig tjänst (t.ex. *Software Engineer*).
3. Klicka *Apply now* — formuläret öppnas i en ny flik eller
   modal.
4. Vänta 1 sekund efter att formuläret syns.

### Förväntat resultat

- ✈-ikonen dyker upp nere till höger.
- Ikonen är **icke klickbar** förrän 3+ fält matchar — om Volvo
  använder Workday eller Greenhouse under huven kan fälten laddas
  först efter en fördröjning.
- När du klickar ikonen fylls **minst 4 fält**:
  - **Förnamn** / **Efternamn** (eller kombinerat *Namn*-fält)
  - **E-post**
  - **Telefon**
- LinkedIn-URL fylls om det finns ett motsvarande fält
  (Volvo brukar ha *LinkedIn profile*).
- **Personligt brev**-textarea fylls med din senaste AI-genererade
  cover letter (eller ett tomt fält om du inte har någon).
- Toast-meddelandet visar antal fält som fylldes:
  *`N fält ifyllda, M saknar data`*.

### Specifikt att kontrollera

| Fält | Förväntat |
|---|---|
| E-post | `din.email@example.se` (från profilen) |
| Telefon | `070-123 45 67` (från profilen) |
| Förnamn | Förnamnet från din profil |
| Efternamn | Efternamnet från din profil |
| LinkedIn | Hela din LinkedIn-URL |

### Kända begränsningar

- Volvos karriärsida kan vara A/B-testad; om du ser en *legacy*
  version kan fältnamnen skilja och ✈-ikonen kan utebli.
- Volvos CV-upload-fält är `<input type="file">` — tillägget
  visar en orange *Välj CV-fil med JobbPiloten*-knapp som öppnar
  webbläsarens vanliga filväljare (vi kan inte läsa filer från
  disk av säkerhetsskäl).

---

## Testfall 2 — IKEA Jobs (Sverige)

> **URL:** <https://jobs.ikea.com/sv/search-jobs>
> **ATS:** Workday (custom-tematiserad).

### Steg

1. Gå till <https://jobs.ikea.com/sv/search-jobs>.
2. Sök på *Frontend* eller liknande.
3. Klicka på en ledig tjänst → *Apply now*.
4. Workday-formuläret laddas — notera att det kan ta 2-3
   sekunder för SPA:n att montera alla `<input>`-noder.
5. Vänta tills ✈-ikonen dyker upp nere till höger.

### Förväntat resultat

- ✈-ikonen dyker upp **inom 3 sekunder** efter att Workday har
  mountat alla fält (vår `MutationObserver` triggar en
  omsökning vid DOM-förändringar).
- Klick på ikonen fyller:
  - **First Name** / **Last Name** (Workday använder engelska
    fältnamn — vår regex matchar `first name` / `last name`)
  - **Email**
  - **Phone** (formaterat med `+46` om din profil lagrar `070-…`,
    oförändrat annars)
  - **LinkedIn Profile** (Workday-fältet heter *My LinkedIn
    Profile* — regex matchar `linkedin`)
- **Resume/CV upload** — Workday använder `<input type="file">`,
  tillägget visar en orange *Välj CV-fil med JobbPiloten*-knapp
  bredvid fältet. Klicka den → filväljaren öppnas → du väljer
  din CV-fil manuellt.

### Specifikt att kontrollera

| Fält | Förväntat |
|---|---|
| First Name | Förnamn från din profil |
| Last Name | Efternamn från din profil |
| Email | E-post från din profil |
| Phone | Telefon från din profil |
| LinkedIn Profile | Hela din LinkedIn-URL |

### Kända begränsningar

- Workday laddar fält i flera steg (en "step" i taget). Om du
  är på *Steg 1 av 3* ser du bara de första fälten. Gå vidare
  med *Next* så mountas fler fält och ✈-ikonen kan fylla dem
  stegvis.
- Vissa Workday-instanser använder `data-automation-id` istället
  för `name`/`id` — vår regex läser båda (se
  `FIELD_PATTERNS` i `extension/content.js`).

---

## Testfall 3 — Spotify Jobs

> **URL:** <https://www.lifeatspotify.com/jobs>
> **ATS:** Workday (anpassad för Spotify).

### Steg

1. Gå till <https://www.lifeatspotify.com/jobs>.
2. Sök på *Backend* eller *Data* — Spotify har många
   tech-relaterade tjänster.
3. Klicka *Apply now* → Workday-formuläret öppnas.
4. Logga in eller skapa ett Workday-konto om det behövs
   (Spotify kräver det för att kunna spåra din ansökan).

### Förväntat resultat

- Samma beteende som IKEA (Workday under huven) — alla
  namn/e-post/telefon/LinkedIn-fält fylls automatiskt.
- Spotifys formulär har ofta ett *How did you hear about
  this role?*-fält — tillägget lämnar detta fält ifyllt
  med din profil eller tomt (regex har ingen matchning för
  frågan).
- Spotifys CV-upload är obligatoriskt — använd den orange
  *Välj CV-fil med JobbPiloten*-knappen som visas bredvid
  fältet.

### Specifikt att kontrollera

- E-postfältet — Spotifys Workday har ibland en separat
  *Primary Email* + *Alternate Email* — vi fyller båda om de
  finns.
- Telefonformatering — Workday förväntar sig ofta
  `+46 70 123 45 67`. Om din profil lagrar `070-123 45 67`
  blir det oförändrat (regex matchar inte formatet, vi skickar
  värdet rakt igenom).

### Kända begränsningar

- Spotifys Workday-instans kräver konto-inloggning innan
  formuläret syns — om du inte har ett Workday-konto kan du
  inte testa.
- Vissa roller kräver svarsfält på engelska (*Why do you want
  to work at Spotify?*) — AI-hjälpen svarar på dessa om du
  har den påslagen.

---

## Testfall 4 — Slumpmässig Platsbanken-arbetsgivare

> **URL:** <https://arbetsformedlingen.se/platsbanken/annonser/<id>*
> **ATS:** Platsbanken / eget formulär.

### Steg

1. Gå till <https://arbetsformedlingen.se/platsbanken>.
2. Sök på valfri yrkeskategori (t.ex. *Systemvetare*).
3. Klicka på en valfri annons — t.ex. den första i listan.
4. Klicka *Ansök* uppe till höger.
5. Om arbetsgivaren använder Platsbankens egna ansökningsformulär
   öppnas det i samma flik. Om arbetsgivaren använder extern
   ATS (Workday, Teamtailor, etc.) omdirigeras du dit.

### Förväntat resultat

- ✈-ikonen dyker upp på Platsbankens eget ansökningsformulär.
- Fält som fylls:
  - **Förnamn** / **Efternamn**
  - **E-post**
  - **Telefon**
  - **Personligt brev** (Platsbanken har en stor textarea med
    denna etikett)
  - **LinkedIn** (om fältet finns)

### Specifikt att kontrollera

| Scenario | Förväntat |
|---|---|
| Platsbanken eget formulär | Alla standardfält fylls på en gång. |
| Extern ATS (Workday/Teamtailor) | Se Testfall 1/2 — beter sig som en generisk Workday-instans. |
| Företag med eget formulär (HTML på egen domän) | Fältnamn kan variera — om matchar ≥ 3 fält visas ✈-ikonen. |

### Kända begränsningar

- Företag med mycket custom-formulär kan ha etiketter som inte
  matchar regex-tabellen (t.ex. *Vad heter du?* istället för
  *Namn*). Fälten lämnas tomma — fyll i manuellt.
- Vissa företag använder PDF-ansökan (ladda ner, fyll i,
  ladda upp) — detta stöds inte av extensionen.

---

## Vanliga fel och hur du rapporterar dem

| Symptom | Vanligaste orsaken | Åtgärd |
|---|---|---|
| ✈-ikonen syns inte alls | Företaget använder PDF-ansökan, eller fälten laddas efter en lång fördröjning. | Vänta 5-10 sekunder. Om fortfarande ingen ikon, ladda om sidan (Ctrl/Cmd+R). |
| Fält fylls med gammal data | Du har inte klickat *Uppdatera data* i popupen efter en profiländring. | Öppna popupen → *Uppdatera data*. |
| Toast "För många AI-svar" | 20 AI-svar / timme / token har överskridits. | Vänta en timme eller fyll i fältet manuellt. |
| Toast "Token har gått ut" | Bearer token ogiltig (30 dagars inaktivitet eller utloggad). | Öppna `/dashboard` → *Anslut din profil* igen. |
| Fältet får röd streckad kontur | Webbplatsens `onchange`-handler avvisar mutationen. | Fyll i manuellt — vi kan inte kringgå webbplatsens egna valideringar. |
| Popupen visar "Kunde inte läsa status" | `chrome.storage.local` är blockerat (ovanligt — bara på hanterade Chrome-enheter). | Kontakta din IT-avdelning. |

---

## Rapportera ett fel

Skicka ett mejl till **<hej@jobbpiloten.se>** med:

1. **URL** där felet uppstod.
2. **Skärmbild** av ✈-ikonen (eller var den borde vara).
3. **Skärmbild** av devtools-konsolen (F12 → *Console*). Leta
   efter rader som börjar med `JOBBPILOTEN` eller
   `[multiSource]`.
4. **Vad du förväntade dig** vs. **vad som hände**.
5. **Din profilens `tier`** (Basic / Professional / Elite) — vi
   behöver det för att utesluta rate-limit-problem.

Vid AI-fel: bifoga gärna det **tomma svaret** (eller svaret som
returnerades) så vi kan förbättra prompten.

---

## Regressionstester att köra varje release

Innan vi publicerar en ny version av tillägget kör vi alltid
följande automatiska tester (se `tests/e2e/`):

- `extension-banner.spec.js` — Dashboard-bannérens detektering
- `settings-employment-type.spec.js` — Multi-select Anställningstyp
- `dashboard-infinite-scroll.spec.js` — *Visa fler jobb*-knappen
- `dashboard-ansokningsdatum.spec.js` — PDF-datumkolumnen
- `cv-magic-bytes.spec.js` — CV-upload med magic-bytes-validering
- `ai-hjalp-toggle.spec.js` — AI-hjälp-reglaget
- `settings-cv-upload.spec.js` — CV-upload lyckad / misslyckad väg

Kör alla: `yarn test:e2e`.
