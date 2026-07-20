# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: env-aware-dashboard-url.spec.js >> Dashboard: env-aware URL persistence on connect >> connect posts JOBBPILOTEN_SET_DASHBOARD_URL with window.location.origin + companion AUTH_SYNC
- Location: tests\e2e\env-aware-dashboard-url.spec.js:38:7

# Error details

```
Error: dashboard.connectExtension should fire BOTH JOBBPILOTEN_SET_DASHBOARD_URL AND JOBBPILOTEN_AUTH_SYNC

dashboard.connectExtension should fire BOTH JOBBPILOTEN_SET_DASHBOARD_URL AND JOBBPILOTEN_AUTH_SYNC

expect(received).toEqual(expected) // deep equality

- Expected  - 2
+ Received  + 2

  Object {
-   "auth": 1,
+   "auth": 2,
    "total": Any<Number>,
-   "url": 1,
+   "url": 2,
  }

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - region "Notifications alt+T"
  - generic [ref=e3]:
    - generic [ref=e4]:
      - img [ref=e5]
      - generic [ref=e7]:
        - strong [ref=e8]: 🔧 Demo-läge
        - text: — Clerk-nycklar saknas eller är ogiltiga. Applikationen körs i demonstrationsläge.
        - link "Logga in som demo-användare" [ref=e9] [cursor=pointer]:
          - /url: /sign-in
        - text: eller konfigurera Clerk-nycklar i
        - code [ref=e10]: .env
        - text: för riktig autentisering.
    - button "Stäng" [ref=e11] [cursor=pointer]:
      - img [ref=e12]
  - button "Open Next.js Dev Tools" [ref=e20] [cursor=pointer]:
    - img [ref=e21]
  - alert [ref=e24]
  - generic [ref=e25]:
    - navigation [ref=e26]:
      - generic [ref=e27]:
        - link "JobbPiloten Professional" [ref=e28] [cursor=pointer]:
          - /url: /
          - img [ref=e30]
          - generic [ref=e32]: JobbPiloten
          - generic [ref=e33]: Professional
        - generic [ref=e34]:
          - link "Öppna inställningar" [ref=e35] [cursor=pointer]:
            - /url: /settings
            - img [ref=e36]
          - generic [ref=e39]:
            - img "Profilbild" [ref=e40]:
              - img [ref=e41]
            - generic [ref=e43]: Hej Demo!
    - generic [ref=e44]:
      - status [ref=e45]:
        - img [ref=e46]
        - generic [ref=e49]: "Nästa uppdatering:"
        - generic [ref=e50]: om 17 h 9 min
        - generic [ref=e51]: AI letar nya matchande jobb varje morgon.
      - generic [ref=e55]:
        - generic [ref=e56]:
          - generic [ref=e57]: Din AI-assistent
          - heading "Redo för nästa ansökan" [level=1] [ref=e58]
          - paragraph [ref=e59]: Klicka nedan för att låta AI:n förbereda ett personligt brev — klart att skicka på 10 sekunder.
          - generic "Saknar 1 fält för AF — fyll i dem i /settings." [ref=e60]: 1 fält kvar för AF
        - button "Kör AI-assistenten nu" [ref=e61] [cursor=pointer]:
          - img
          - text: Kör AI-assistenten nu
      - generic [ref=e62]:
        - generic [ref=e63]:
          - generic [ref=e64]:
            - img [ref=e65]
            - text: Automatisk AI-assistent (Cron)
          - generic [ref=e67]: Körs varje dag kl. 09:00 CET — letar fram matchande jobb och förbereder ansökningar för aktiva prenumeranter
        - generic [ref=e68]:
          - generic [ref=e69]:
            - button "Kör Cron Nu (test)" [ref=e70] [cursor=pointer]:
              - img
              - text: Kör Cron Nu (test)
            - generic [ref=e71]: Manuell trigger
          - generic [ref=e72]:
            - generic [ref=e73]: Senaste cron-loggar
            - generic [ref=e77]: 2026-07-17
      - generic [ref=e78]:
        - generic [ref=e80]:
          - generic [ref=e81]:
            - generic [ref=e82]:
              - generic [ref=e83]: "0"
              - generic "oförändrat" [ref=e84]:
                - img [ref=e85]
                - text: oförändrat
            - generic [ref=e86]: Sparade jobb denna period
          - img [ref=e88]
        - generic [ref=e91]:
          - generic [ref=e92]:
            - generic [ref=e93]:
              - generic [ref=e94]: "0"
              - generic "oförändrat" [ref=e95]:
                - img [ref=e96]
                - text: oförändrat
            - generic [ref=e97]: Ansökningar juli
          - img [ref=e99]
        - generic [ref=e103]:
          - generic [ref=e104]:
            - generic [ref=e106]: "12"
            - generic [ref=e107]: Totalt antal
          - img [ref=e109]
        - generic [ref=e113]:
          - generic [ref=e114]:
            - generic [ref=e115]:
              - generic [ref=e116]: "0"
              - generic "oförändrat" [ref=e117]:
                - img [ref=e118]
                - text: oförändrat
            - generic [ref=e119]: Bekräftade av AF denna period
          - img [ref=e121]
      - generic [ref=e123]:
        - generic [ref=e124]:
          - generic [ref=e125]:
            - img [ref=e126]
            - text: Push-notiser
          - generic [ref=e129]: Få notiser när AI hittar ett matchande jobb
        - generic [ref=e131]:
          - generic [ref=e134]: Inaktiva
          - button "Aktivera push-notiser" [ref=e135] [cursor=pointer]:
            - img
            - text: Aktivera push-notiser
      - generic [ref=e136]:
        - generic [ref=e137]:
          - generic [ref=e138]: Aktivitetsrapport — juli 2026
          - generic [ref=e139]: Färdig att skicka till Arbetsförmedlingen
        - generic [ref=e141]:
          - generic [ref=e142]:
            - generic [ref=e143]:
              - img [ref=e144]
              - generic [ref=e147]: 0 ansökningar denna period
              - generic [ref=e148]: Du ligger efter takten
            - button "Ladda ner PDF" [ref=e149] [cursor=pointer]:
              - img
              - text: Ladda ner PDF
          - 'progressbar "AF compliance: 0 av 14 ansökningar" [ref=e150]'
          - paragraph [ref=e152]:
            - text: 0 av 14 ansökningar — pace kräver 9 vid dag 20. Skicka fler för att hinna ikapp. Detta är AF:s
            - strong [ref=e153]: standardmål på 14 ansökningar/månad
            - text: — du ansvarar själv för att din individuella handlingsplan uppfylls. Kontrollera alltid mot AF:s aktuella krav.
      - generic [ref=e154]:
        - generic [ref=e155]:
          - generic [ref=e156]:
            - generic [ref=e157]: ✈
            - text: JobbPiloten Auto-Fill
          - generic [ref=e158]: Tilägget är installerat — anslut din JobbPiloten-profil en gång så fyller den i formulär automatiskt.
        - generic [ref=e159]:
          - generic [ref=e160]:
            - button "⚠ Koppla från (Pausad)" [ref=e161] [cursor=pointer]
            - generic [ref=e162]: En bekräftelse på Chrome Web Store-ikonen följer snart.
          - status [ref=e163]: Tillägget är anslutet — profil synkad.
          - paragraph [ref=e164]: Anslutningen är lokal — token sparas krypterad i Chrome:s lagring, data lämnar aldrig din webbläsare utan din knapp.
      - generic [ref=e165]:
        - generic [ref=e166]:
          - generic [ref=e167]:
            - img [ref=e168]
            - text: Lediga jobb för dig
          - generic [ref=e171]: Matchade mot din profil från Arbetsförmedlingen — AI förbereder ansökan, du skickar
        - generic [ref=e173]:
          - status [ref=e174]: Filtrerar på Stockholm
          - generic [ref=e176]:
            - generic [ref=e177]:
              - img [ref=e178]
              - text: Dagens jobb
            - generic [ref=e180]:
              - generic [ref=e181]:
                - 'generic "Matchning: roll 100%, ort 100%, erfarenhet 47%, anställningstyp 100%" [ref=e182]': 82% match
                - generic [ref=e184]:
                  - generic [ref=e185]: H
                  - generic [ref=e186]:
                    - generic [ref=e187]: Frontend Developer Hotmat.se
                    - generic [ref=e188]: Hotmat.se Sverige AB
                - generic [ref=e189]:
                  - generic [ref=e190]:
                    - img [ref=e191]
                    - text: Upplands Väsby, Stockholms län, Sverige
                  - generic "Matchning baserad på din ort-preferens" [ref=e194]:
                    - generic [ref=e195]: ✓
                    - text: Matchar din ort
                  - generic [ref=e196]:
                    - img [ref=e197]
                    - text: Arbetsförmedlingen
                - generic [ref=e201]:
                  - button "Förbered" [ref=e202] [cursor=pointer]:
                    - img
                    - text: Förbered
                  - img [ref=e203]
                - generic [ref=e206]: Topp
                - button "Spara till JobbPiloten" [ref=e207] [cursor=pointer]:
                  - img
                  - text: Spara till JobbPiloten
              - generic [ref=e208]:
                - 'generic "Matchning: roll 100%, ort 100%, erfarenhet 47%, anställningstyp 100%" [ref=e209]': 82% match
                - generic [ref=e211]:
                  - generic [ref=e212]: A
                  - generic [ref=e213]:
                    - generic [ref=e214]: Frontend Developer – Planning
                    - generic [ref=e215]: Aira Group AB
                - generic [ref=e216]:
                  - generic [ref=e217]:
                    - img [ref=e218]
                    - text: Stockholm, Stockholms län, Sverige
                  - generic "Matchning baserad på din ort-preferens" [ref=e221]:
                    - generic [ref=e222]: ✓
                    - text: Matchar din ort
                  - generic [ref=e223]:
                    - img [ref=e224]
                    - text: Arbetsförmedlingen
                - generic [ref=e228]:
                  - button "Förbered" [ref=e229] [cursor=pointer]:
                    - img
                    - text: Förbered
                  - img [ref=e230]
                - button "Spara till JobbPiloten" [ref=e233] [cursor=pointer]:
                  - img
                  - text: Spara till JobbPiloten
              - generic [ref=e234]:
                - 'generic "Matchning: roll 100%, ort 100%, erfarenhet 47%, anställningstyp 100%" [ref=e235]': 82% match
                - generic [ref=e237]:
                  - generic [ref=e238]: S
                  - generic [ref=e239]:
                    - generic [ref=e240]: Frontend Developer till Synsam Group
                    - generic [ref=e241]: Synsam Group Sweden AB
                - generic [ref=e242]:
                  - generic [ref=e243]:
                    - img [ref=e244]
                    - text: Stockholm, Stockholms län, Sverige
                  - generic "Matchning baserad på din ort-preferens" [ref=e247]:
                    - generic [ref=e248]: ✓
                    - text: Matchar din ort
                  - generic [ref=e249]:
                    - img [ref=e250]
                    - text: Arbetsförmedlingen
                - generic [ref=e254]:
                  - button "Förbered" [ref=e255] [cursor=pointer]:
                    - img
                    - text: Förbered
                  - img [ref=e256]
                - button "Spara till JobbPiloten" [ref=e259] [cursor=pointer]:
                  - img
                  - text: Spara till JobbPiloten
          - generic [ref=e260]:
            - generic [ref=e261]: Fler matchningar
            - generic [ref=e263]:
              - generic [ref=e264]:
                - generic [ref=e265]: I
                - generic [ref=e266]:
                  - generic [ref=e267]: Frontend Fullstack Developer
                  - generic [ref=e268]:
                    - generic [ref=e269]: Innosights Consulting Service AB
                    - generic [ref=e270]: ·
                    - generic [ref=e271]:
                      - img [ref=e272]
                      - text: Solna, Stockholms län, Sverige
                    - generic [ref=e275]: · ✓ matchar din ort
              - button "Gå till ansökan" [ref=e276] [cursor=pointer]:
                - img
                - text: Gå till ansökan
          - paragraph [ref=e278]: Visar 4 jobb just nu — alla hämtade
      - generic [ref=e279]:
        - generic [ref=e280]:
          - generic [ref=e281]:
            - img [ref=e282]
            - text: Letar du bredare?
          - generic [ref=e285]: "Vi matchar mot Arbetsförmedlingen ovan. För fler jobb, sök även på andra plattformar:"
        - generic [ref=e286]:
          - generic [ref=e287]:
            - link "Sök på Blocket jobb.blocket.se" [ref=e288] [cursor=pointer]:
              - /url: https://jobb.blocket.se/lediga-jobb/q-frontend-developer/l-stockholm/
              - img [ref=e289]
              - text: Sök på Blocket
              - generic [ref=e293]: jobb.blocket.se
            - link "Sök på Jobbsafari jobbsafari.se" [ref=e294] [cursor=pointer]:
              - /url: https://jobbsafari.se/jobb?q=Frontend+Developer&l=Stockholm
              - img [ref=e295]
              - text: Sök på Jobbsafari
              - generic [ref=e299]: jobbsafari.se
          - paragraph [ref=e300]: Båda sidor öppnas i din webbläsare. JobbPiloten skrapar eller lagrar inte Blocket / Jobbsafari-listan — vi använder bara AF:s öppna API.
      - generic [ref=e301]:
        - generic [ref=e303]:
          - generic [ref=e304]:
            - generic [ref=e305]: Ansökningar
            - generic [ref=e306]: Ansökningshistorik
          - tablist "Filtrera ansökningar" [ref=e307]:
            - tab "Alla· 12" [selected] [ref=e308] [cursor=pointer]:
              - text: Alla
              - generic [ref=e309]: · 12
            - tab "Ej ansökta· 12" [ref=e310] [cursor=pointer]:
              - text: Ej ansökta
              - generic [ref=e311]: · 12
            - tab "Ansökta· 0" [ref=e312] [cursor=pointer]:
              - text: Ansökta
              - generic [ref=e313]: · 0
            - tab "Sparade· 0" [ref=e314] [cursor=pointer]:
              - text: Sparade
              - generic [ref=e315]: · 0
            - tab "E-post· 0" [ref=e316] [cursor=pointer]:
              - text: E-post
              - generic [ref=e317]: · 0
        - generic [ref=e319]:
          - generic [ref=e320]:
            - generic [ref=e321]:
              - generic [ref=e322]: T
              - generic [ref=e323]:
                - generic [ref=e324]: Android-utvecklare
                - generic [ref=e325]: Truecaller
                - generic [ref=e326]: 2026-07-19
              - button "Spara ansökan" [ref=e327] [cursor=pointer]:
                - img [ref=e328]
            - generic [ref=e330]:
              - generic [ref=e331]:
                - img [ref=e332]
                - text: Stockholm
              - generic [ref=e335]:
                - img [ref=e336]
                - text: LinkedIn
              - generic [ref=e340]: Förberedd
            - generic [ref=e342]:
              - button "Markera som ansökt" [ref=e343] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e344] [cursor=pointer]:
                - img [ref=e345]
                - text: Visa brev
          - generic [ref=e347]:
            - generic [ref=e348]:
              - generic [ref=e349]: "N"
              - generic [ref=e350]:
                - generic [ref=e351]: Project Manager
                - generic [ref=e352]: Northvolt
                - generic [ref=e353]: 2026-07-18
              - button "Spara ansökan" [ref=e354] [cursor=pointer]:
                - img [ref=e355]
            - generic [ref=e357]:
              - generic [ref=e358]:
                - img [ref=e359]
                - text: Skellefteå
              - generic [ref=e362]:
                - img [ref=e363]
                - text: Arbetsförmedlingen
              - generic [ref=e367]: Förberedd
            - generic [ref=e369]:
              - button "Markera som ansökt" [ref=e370] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e371] [cursor=pointer]:
                - img [ref=e372]
                - text: Visa brev
          - generic [ref=e374]:
            - generic [ref=e375]:
              - generic [ref=e376]: I
              - generic [ref=e377]:
                - generic [ref=e378]: Sales Development Representative
                - generic [ref=e379]: iZettle (PayPal)
                - generic [ref=e380]: 2026-07-17
              - button "Spara ansökan" [ref=e381] [cursor=pointer]:
                - img [ref=e382]
            - generic [ref=e384]:
              - generic [ref=e385]:
                - img [ref=e386]
                - text: Stockholm
              - generic [ref=e389]:
                - img [ref=e390]
                - text: Indeed.se
              - generic [ref=e394]: Förberedd
            - generic [ref=e396]:
              - button "Markera som ansökt" [ref=e397] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e398] [cursor=pointer]:
                - img [ref=e399]
                - text: Visa brev
          - generic [ref=e401]:
            - generic [ref=e402]:
              - generic [ref=e403]: I
              - generic [ref=e404]:
                - generic [ref=e405]: Data Analyst
                - generic [ref=e406]: IKEA
                - generic [ref=e407]: 2026-07-16
              - button "Spara ansökan" [ref=e408] [cursor=pointer]:
                - img [ref=e409]
            - generic [ref=e411]:
              - generic [ref=e412]:
                - img [ref=e413]
                - text: Malmö
              - generic [ref=e416]:
                - img [ref=e417]
                - text: Indeed.se
              - generic [ref=e421]: Förberedd
            - generic [ref=e423]:
              - button "Markera som ansökt" [ref=e424] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e425] [cursor=pointer]:
                - img [ref=e426]
                - text: Visa brev
          - generic [ref=e428]:
            - generic [ref=e429]:
              - generic [ref=e430]: F
              - generic [ref=e431]:
                - generic [ref=e432]: Kundsupport-specialist
                - generic [ref=e433]: Fortnox
                - generic [ref=e434]: 2026-07-15
              - button "Spara ansökan" [ref=e435] [cursor=pointer]:
                - img [ref=e436]
            - generic [ref=e438]:
              - generic [ref=e439]:
                - img [ref=e440]
                - text: Växjö
              - generic [ref=e443]:
                - img [ref=e444]
                - text: Arbetsförmedlingen
              - generic [ref=e448]: Förberedd
            - generic [ref=e450]:
              - button "Markera som ansökt" [ref=e451] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e452] [cursor=pointer]:
                - img [ref=e453]
                - text: Visa brev
          - generic [ref=e455]:
            - generic [ref=e456]:
              - generic [ref=e457]: S
              - generic [ref=e458]:
                - generic [ref=e459]: Content Marketing Specialist
                - generic [ref=e460]: Storytel
                - generic [ref=e461]: 2026-07-14
              - button "Spara ansökan" [ref=e462] [cursor=pointer]:
                - img [ref=e463]
            - generic [ref=e465]:
              - generic [ref=e466]:
                - img [ref=e467]
                - text: Stockholm
              - generic [ref=e470]:
                - img [ref=e471]
                - text: LinkedIn
              - generic [ref=e475]: Förberedd
            - generic [ref=e477]:
              - button "Markera som ansökt" [ref=e478] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e479] [cursor=pointer]:
                - img [ref=e480]
                - text: Visa brev
          - generic [ref=e482]:
            - generic [ref=e483]:
              - generic [ref=e484]: B
              - generic [ref=e485]:
                - generic [ref=e486]: Customer Success Manager
                - generic [ref=e487]: Bolt
                - generic [ref=e488]: 2026-07-13
              - button "Spara ansökan" [ref=e489] [cursor=pointer]:
                - img [ref=e490]
            - generic [ref=e492]:
              - generic [ref=e493]:
                - img [ref=e494]
                - text: Göteborg
              - generic [ref=e497]:
                - img [ref=e498]
                - text: Metrojobb
              - generic [ref=e502]: Förberedd
            - generic [ref=e504]:
              - button "Markera som ansökt" [ref=e505] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e506] [cursor=pointer]:
                - img [ref=e507]
                - text: Visa brev
          - generic [ref=e509]:
            - generic [ref=e510]:
              - generic [ref=e511]: M
              - generic [ref=e512]:
                - generic [ref=e513]: PR & Communications
                - generic [ref=e514]: Mynewsdesk
                - generic [ref=e515]: 2026-07-12
              - button "Spara ansökan" [ref=e516] [cursor=pointer]:
                - img [ref=e517]
            - generic [ref=e519]:
              - generic [ref=e520]:
                - img [ref=e521]
                - text: Stockholm
              - generic [ref=e524]:
                - img [ref=e525]
                - text: Blocket Jobb
              - generic [ref=e529]: Förberedd
            - generic [ref=e531]:
              - button "Markera som ansökt" [ref=e532] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e533] [cursor=pointer]:
                - img [ref=e534]
                - text: Visa brev
          - generic [ref=e536]:
            - generic [ref=e537]:
              - generic [ref=e538]: E
              - generic [ref=e539]:
                - generic [ref=e540]: DevOps Engineer
                - generic [ref=e541]: Ericsson
                - generic [ref=e542]: 2026-07-11
              - button "Spara ansökan" [ref=e543] [cursor=pointer]:
                - img [ref=e544]
            - generic [ref=e546]:
              - generic [ref=e547]:
                - img [ref=e548]
                - text: Kista
              - generic [ref=e551]:
                - img [ref=e552]
                - text: Arbetsförmedlingen
              - generic [ref=e556]: Förberedd
            - generic [ref=e558]:
              - button "Markera som ansökt" [ref=e559] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e560] [cursor=pointer]:
                - img [ref=e561]
                - text: Visa brev
          - generic [ref=e563]:
            - generic [ref=e564]:
              - generic [ref=e565]: V
              - generic [ref=e566]:
                - generic [ref=e567]: Frontend-utvecklare
                - generic [ref=e568]: Volvo Cars
                - generic [ref=e569]: 2026-07-10
              - button "Spara ansökan" [ref=e570] [cursor=pointer]:
                - img [ref=e571]
            - generic [ref=e573]:
              - generic [ref=e574]:
                - img [ref=e575]
                - text: Göteborg
              - generic [ref=e578]:
                - img [ref=e579]
                - text: LinkedIn
              - generic [ref=e583]: Förberedd
            - generic [ref=e585]:
              - button "Markera som ansökt" [ref=e586] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e587] [cursor=pointer]:
                - img [ref=e588]
                - text: Visa brev
          - generic [ref=e590]:
            - generic [ref=e591]:
              - generic [ref=e592]: T
              - generic [ref=e593]:
                - generic [ref=e594]: QA Engineer
                - generic [ref=e595]: Tink
                - generic [ref=e596]: 2026-07-09
              - button "Spara ansökan" [ref=e597] [cursor=pointer]:
                - img [ref=e598]
            - generic [ref=e600]:
              - generic [ref=e601]:
                - img [ref=e602]
                - text: Stockholm
              - generic [ref=e605]:
                - img [ref=e606]
                - text: Blocket Jobb
              - generic [ref=e610]: Förberedd
            - generic [ref=e612]:
              - button "Markera som ansökt" [ref=e613] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e614] [cursor=pointer]:
                - img [ref=e615]
                - text: Visa brev
          - generic [ref=e617]:
            - generic [ref=e618]:
              - generic [ref=e619]: "Y"
              - generic [ref=e620]:
                - generic [ref=e621]: Security Engineer
                - generic [ref=e622]: Yubico
                - generic [ref=e623]: 2026-07-08
              - button "Spara ansökan" [ref=e624] [cursor=pointer]:
                - img [ref=e625]
            - generic [ref=e627]:
              - generic [ref=e628]:
                - img [ref=e629]
                - text: Stockholm
              - generic [ref=e632]:
                - img [ref=e633]
                - text: LinkedIn
              - generic [ref=e637]: Förberedd
            - generic [ref=e639]:
              - button "Markera som ansökt" [ref=e640] [cursor=pointer]:
                - img
                - text: Markera som ansökt
              - button "Visa brev" [ref=e641] [cursor=pointer]:
                - img [ref=e642]
                - text: Visa brev
    - contentinfo [ref=e644]:
      - generic [ref=e645]:
        - generic [ref=e646]: © 2026 JobbPiloten
        - navigation "Juridiskt" [ref=e647]:
          - link "Integritetspolicy" [ref=e648] [cursor=pointer]:
            - /url: /privacy
          - link "Användarvillkor" [ref=e649] [cursor=pointer]:
            - /url: /terms
          - link "Kontakt" [ref=e650] [cursor=pointer]:
            - /url: mailto:hej@jobbpiloten.se
  - region "Vi använder cookies" [ref=e651]:
    - generic [ref=e653]:
      - img [ref=e655]
      - generic [ref=e657]:
        - generic [ref=e658]: Vi använder cookies
        - paragraph [ref=e659]:
          - text: Vi använder cookies för att du ska kunna logga in och för att förbättra din upplevelse. Vi delar inte din data med tredje part.
          - link "Läs mer i vår integritetspolicy" [ref=e660] [cursor=pointer]:
            - /url: /privacy
          - text: .
        - generic [ref=e661]:
          - button "Endast nödvändiga" [ref=e662] [cursor=pointer]
          - button "Acceptera alla" [ref=e663] [cursor=pointer]
          - button "Stäng" [ref=e664] [cursor=pointer]:
            - img [ref=e665]
        - paragraph [ref=e668]: Endast nödvändiga = sessionscookie för inloggning. Acceptera alla = samma + anonymiserad statistik i framtiden.
```

# Test source

```ts
  11  | //
  12  | // The SET_DASHBOARD_URL message is the env-aware handshake —
  13  | // payload.url = window.location.origin is what the content script
  14  | // persists to chrome.storage.sync.jobbpiloten_dashboardUrl,
  15  | // which the popup's Tier-1 resolver reads first (see
  16  | // tests/unit/popup-resolver.test.mjs for the popup side).
  17  | //
  18  | // What this catches:
  19  | //   - Missed `JOBBPILOTEN_SET_DASHBOARD_URL` postMessage.
  20  | //   - Wrong payload URL (wrong origin, trailing slash, full URL
  21  | //     with pathname or query string).
  22  | //   - Wrong targetOrigin arg (postMessage's second arg MUST equal
  23  | //     the same window.location.origin so the content-script
  24  | //     listener accepts the message).
  25  | //   - Dropped companion `JOBBPILOTEN_AUTH_SYNC` — the two are
  26  | //     separate messages so a regression that drops one would
  27  | //     half-break the connect.
  28  | //
  29  | // What this does NOT cover:
  30  | //   - The actual chrome.storage.sync.set (extension side — requires
  31  | //     a real Chrome install). Covered manually in TESTING.md.
  32  | //   - The popup's Tier-1 reading/storage of dashboardUrl. Covered
  33  | //     by tests/unit/popup-resolver.test.mjs.
  34  | 
  35  | import { test, expect } from './_fixtures/auth'
  36  | 
  37  | test.describe('Dashboard: env-aware URL persistence on connect', () => {
  38  |   test('connect posts JOBBPILOTEN_SET_DASHBOARD_URL with window.location.origin + companion AUTH_SYNC', async ({ page }) => {
  39  |     // 1. Capture EVERY postMessage the page fires. addInitScript runs
  40  |     //    BEFORE any page script (extending past the first navigation),
  41  |     //    so the wrapper is in place by the time React's onClick handler
  42  |     //    is mounted and ready to fire.
  43  |     //
  44  |     //    We use addInitScript (not page.evaluate) so the wrapper also
  45  |     //    works across Next.js client-side transitions inside the test.
  46  |     await page.addInitScript(() => {
  47  |       /** @type {Array<{type: string|null, payload: any, targetOrigin: string}>} */
  48  |       window.__capturedPostMessages = []
  49  |       const original = window.postMessage.bind(window)
  50  |       // Marker so we can introspect that the wrapper actually installed.
  51  |       window.__postMessageWrapperInstalled = true
  52  |       window.postMessage = function patchedPostMessage(...args) {
  53  |         try {
  54  |           const message = args[0]
  55  |           window.__capturedPostMessages.push({
  56  |             type: (message && typeof message === 'object') ? message.type : null,
  57  |             payload: (message && typeof message === 'object') ? message.payload : null,
  58  |             targetOrigin: args[1],
  59  |           })
  60  |         } catch (_) {
  61  |           // Capture is best-effort; a false capture must NOT crash
  62  |           // the page. Fall-through happens below.
  63  |         }
  64  |         return original(...args)
  65  |       }
  66  |     })
  67  | 
  68  |     // 2. Navigate + simulate the extension being installed. The
  69  |     //    dashboard polls documentElement every 1s; dispatching a
  70  |     //    `focus` event short-circuits the wait, so we don't have
  71  |     //    to sleep blindly.
  72  |     await page.goto('/dashboard')
  73  |     await page.evaluate(() => {
  74  |       document.documentElement.setAttribute('data-jobbpiloten-ext', '1')
  75  |       window.dispatchEvent(new Event('focus'))
  76  |     })
  77  | 
  78  |     // 3. Wait for the connect button to appear once the
  79  |     //    "installed" state settles.
  80  |     const connectButton = page.locator('[data-testid="extension-connect-button"]')
  81  |     await expect(connectButton).toBeVisible({ timeout: 15_000 })
  82  | 
  83  |     // 4. Click connect. The handler awaits POST /api/extension/token
  84  |     //    (the demo-cookie Mongo lookup is the bottleneck in dev — the
  85  |     //    Next.js first compile of the route adds ~1-2s on top).
  86  |     await connectButton.click()
  87  | 
  88  |     // 5. Poll the captured list until BOTH JobbPiloten messages
  89  |     //    have landed. We poll rather than waitForTimeout because
  90  |     //    the postMessage calls happen inside the fetch's then-chain
  91  |     //    — sleeping a constant 5s would either be flaky (too short)
  92  |     //    or slow (too long). expect.poll was added in
  93  |     //    @playwright/test 1.30, which our ^1.61.1 dep satisfies.
  94  |     const expectedOrigin = new URL(page.url()).origin
  95  |     await expect
  96  |       .poll(
  97  |         async () => {
  98  |           const msgs = await page.evaluate(() => window.__capturedPostMessages || [])
  99  |           return {
  100 |             total: msgs.length,
  101 |             url: msgs.filter((m) => m.type === 'JOBBPILOTEN_SET_DASHBOARD_URL').length,
  102 |             auth: msgs.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC').length,
  103 |           }
  104 |         },
  105 |         {
  106 |           timeout: 15_000,
  107 |           intervals: [100, 250, 500],
  108 |           message: 'dashboard.connectExtension should fire BOTH JOBBPILOTEN_SET_DASHBOARD_URL AND JOBBPILOTEN_AUTH_SYNC',
  109 |         },
  110 |       )
> 111 |       .toEqual({ total: expect.any(Number), url: 1, auth: 1 })
      |        ^ Error: dashboard.connectExtension should fire BOTH JOBBPILOTEN_SET_DASHBOARD_URL AND JOBBPILOTEN_AUTH_SYNC
  112 | 
  113 |     // 6. Snapshot the captured messages now that both have fired.
  114 |     const messages = await page.evaluate(() => window.__capturedPostMessages || [])
  115 |     const urlMessages  = messages.filter((m) => m.type === 'JOBBPILOTEN_SET_DASHBOARD_URL')
  116 |     const authMessages = messages.filter((m) => m.type === 'JOBBPILOTEN_AUTH_SYNC')
  117 | 
  118 |     // 7. SET_DASHBOARD_URL asserts:
  119 |     //   • exactly one fire (idempotent — no double-click here)
  120 |     //   • payload.url is a non-empty string equal to window.location.origin
  121 |     //   • targetOrigin (postMessage's 2nd arg) is the same origin
  122 |     //     — the content-script listener accepts only same-origin posts,
  123 |     //     so passing anything else would silently swallow the message.
  124 |     expect(urlMessages).toHaveLength(1)
  125 |     const setUrlMsg = urlMessages[0]
  126 |     expect(setUrlMsg.payload).toBeTruthy()
  127 |     expect(typeof setUrlMsg.payload.url).toBe('string')
  128 |     expect(setUrlMsg.payload.url.length).toBeGreaterThan(0)
  129 |     expect(setUrlMsg.payload.url).toBe(expectedOrigin)
  130 |     expect(setUrlMsg.targetOrigin).toBe(expectedOrigin)
  131 | 
  132 |     // 8. AUTH_SYNC asserts (companion contract):
  133 |     //   • exactly one fire
  134 |     //   • payload carries token + profile
  135 |     //   • payload.baseUrl + payload.allowedOrigins are populated so
  136 |     //     the popup's fetch() can resolve without Tier-3 build-config.
  137 |     expect(authMessages).toHaveLength(1)
  138 |     const authMsg = authMessages[0]
  139 |     expect(authMsg.payload).toBeTruthy()
  140 |     expect(typeof authMsg.payload.token).toBe('string')
  141 |     expect(authMsg.payload.token.length).toBeGreaterThan(0)
  142 |     expect(authMsg.payload.profile).toBeTruthy()
  143 |     expect(typeof authMsg.payload.baseUrl).toBe('string')
  144 |     expect(authMsg.payload.baseUrl).toBe(expectedOrigin)
  145 |     expect(Array.isArray(authMsg.payload.allowedOrigins)).toBe(true)
  146 |     expect(authMsg.payload.allowedOrigins).toContain(expectedOrigin)
  147 |   })
  148 | })
  149 | 
```