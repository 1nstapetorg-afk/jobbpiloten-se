# JobbPiloten

> **Låt AI förbereda jobbansökningarna åt dig — du skickar på 10 sekunder.**
> Svensk AI-driven SaaS som skriver personliga brev på svenska, hittar matchande AF-jobb, och genererar Aktivitetsrapport åt Arbetsförmedlingen.
> 🚧 Soft-launch (vänner & familj) — `Beta`-badge på landningssidan.

---

## 🛠 Tech Stack

- **Frontend:** Next.js 15 (App Router, JS), React 18, Tailwind CSS, shadcn/ui, lucide-react
- **Toasts:** [Sonner](https://sonner.emilkowal.ski/) via shadcn wrapper (`components/ui/sonner.jsx`), mounted in `app/providers.js`
- **Backend:** Next.js API routes (Node runtime), native MongoDB driver
- **Databas:** MongoDB 6+
- **AI / LLM:** [Groq](https://console.groq.com) `llama-3.3-70b-versatile` (OpenAI-kompatibelt SDK)
- **Auth:** Clerk 6 med Google OAuth + demo-fallback (om `pk_/sk_xxx` keys saknas)
- **Betalning:** Stripe test-läge — se `app/api/[[...path]]/route.js` och `app/api/webhooks/stripe/route.js`
- **PDF:** `pdf-lib` (server-side)
- **Push:** `web-push` + VAPID, egen service worker i `public/service-worker.js`

---

## 🚀 Köra lokalt

```bash
# 1. Installera beroenden
yarn install

# 2. Skapa .env (eller kopiera från .env.example)
cp .env.example .env

# 3. Starta MongoDB (docker eller lokal)
docker run -d --name mongo -p 27017:27017 mongo:6

# 4. Generera VAPID-nycklar för push
npx web-push generate-vapid-keys

# 5. Kör dev-servern
yarn dev
```

Öppna [http://localhost:3000](http://localhost:3000). Lämna Clerk-keys tomma för demo-läge.

### Produktionsbygge

```bash
yarn build
yarn start
```

För Vercel: lägg till cron schedule via `vercel.json` (redan inkluderad — kör daglig push kl. 09:00 Stockholm-tid).

---

## 🔐 Miljövariabler

Se `.env.example` för fullständig lista. Sammanfattning:

| Variabel | Syfte | Krävs? |
|---|---|---|
| `MONGO_URL` + `DB_NAME` | Databas | ✅ |
| `NEXT_PUBLIC_BASE_URL` | Bas-URL för absoluta paths | ✅ |
| `GROQ_API_KEY` | AI-brev (Groq) | ✅ för AI |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | Clerk auth | Valfritt (demo-läge utan) |
| `STRIPE_SECRET_KEY` | Stripe API | ✅ för köp |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook-signatur | ✅ för webhooks |
| `STRIPE_PRICE_*` (6 st) | Stripe price IDs per tier × intervall | ✅ för köp |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | Web-push VAPID | ✅ för push |
| `VAPID_SUBJECT` | Webbplatsens e-post (mailto:...) | Valfritt |
| `CRON_SECRET` | Hemlig sträng för cron-trigger | Valfritt (annars publik i dev) |

> **Alla hemligheter måste vara i test-läge.** Inga `sk_live_` / `pk_live_` keys.

---

## 📂 Fler resurser

- **Fullständig översikt:** [`PROJECT_SUMMARY.md`](./PROJECT_SUMMARY.md) — features, schema, endpoints, filstruktur
- **Projektstatus:** [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) — vad som är klart, vad som återstår
- **Legal:** live på `/privacy` och `/terms` (eller [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md))
