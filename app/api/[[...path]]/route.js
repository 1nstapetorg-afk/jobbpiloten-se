import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { generateCoverLetter } from '@/lib/groq';
import Stripe from 'stripe';
import { generateAktivitetsrapport } from '@/lib/pdf-report';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
// Round-46 / Followup 3 (2026-07-20 Monday audit): central profile-
// completeness predicate kept here so the catch-all route file
// shares the SAME 404 message + helper as the per-route endpoints
// (/api/email-preview, /api/extension/{token,profile,email-body,
// answer,ai-answers}, /api/cv-pdf, /api/email-draft, and now
// /api/[[...path]]/route.js's `apply-now` branch). See
// lib/profile-check.js for the canonical contract definition.
import { requireCompleteProfile } from '@/lib/profile-check';
import { searchJobs, multiSourceSearchJobs, getJobById, buildBlocketSearchUrl } from '@/lib/jobScraper';
import { buildJobMatchPayload, broadcastPush, sendPushToUser } from '@/lib/push';
import { PROFILE_PICTURE_AVATARS } from '@/lib/avatar-keys';
import { locationsToLänCodes, isRemoteFriendlyText, doesJobMatchUserLocation } from '@/lib/swedishLocations';
import { truncate } from '@/lib/utils';
import { STYLE_PRESETS } from '@/lib/style-presets.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Round-35 (Part 3 — Answer Diversity): the validator set for the
// `stylePreference` field. Derived ONCE at module load from
// `STYLE_PRESETS` (the canonical source in `lib/style-presets.mjs`)
// so adding a 6th style is a single-file edit there — both the
// `profile` POST handler (first-POST seed default) and the
// `profile-update` POST handler (partial-update guard) automatically
// pick it up. HOISTED TO MODULE SCOPE because `const` declared inside
// a function is function-scoped only — the `profile` POST handler
// and the `profile-update` POST handler are SEPARATE functions in
// this module, and a per-handler declaration would ReferenceError
// when the other handler tried to read it.
const ALLOWED_STYLE_IDS = new Set(STYLE_PRESETS.map((p) => p.id))

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-06-30.basil' });

// Price ID mapping (tier + billing interval)
const PRICE_MAP = {
  'Basic:month': process.env.STRIPE_PRICE_BASIC_MONTHLY,
  'Basic:year': process.env.STRIPE_PRICE_BASIC_YEARLY,
  'Professional:month': process.env.STRIPE_PRICE_PRO_MONTHLY,
  'Professional:year': process.env.STRIPE_PRICE_PRO_YEARLY,
  'Elite:month': process.env.STRIPE_PRICE_ELITE_MONTHLY,
  'Elite:year': process.env.STRIPE_PRICE_ELITE_YEARLY,
};

function tierFromPriceId(priceId) {
  for (const [key, id] of Object.entries(PRICE_MAP)) {
    if (id === priceId) {
      const [tier, interval] = key.split(':');
      return { tier, interval };
    }
  }
  return { tier: 'Unknown', interval: null };
}

// ---- Mongo singleton ----
let clientPromise;
if (!global._mongoClientPromise) {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017/jobbpiloten');
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

async function getDb() {
  const client = await clientPromise;
  return client.db(process.env.DB_NAME);
}

// ---- Sample Swedish jobs pool for demo ----
const SAMPLE_JOBS = [
  { company: 'Volvo Cars', title: 'Frontend-utvecklare', location: 'Göteborg', source: 'LinkedIn', description: 'Vi söker en engagerad frontend-utvecklare för vårt digital-team. Du kommer att arbeta med React, TypeScript och moderna designsystem för att bygga nästa generations bilupplevelse.' },
  { company: 'Spotify', title: 'Backend Engineer', location: 'Stockholm', source: 'Arbetsförmedlingen', description: 'Join our platform team building scalable services in Java and Python. Erfarenhet av mikroservicearkitektur och event-driven design meriterande.' },
  { company: 'Klarna', title: 'Product Designer', location: 'Stockholm', source: 'LinkedIn', description: 'Vi letar efter en product designer som brinner för fintech och användarupplevelser. Du kommer arbeta i tvärfunktionella team och driva design från idé till lansering.' },
  { company: 'IKEA', title: 'Data Analyst', location: 'Malmö', source: 'Indeed.se', description: 'Bli en del av IKEAs data-team. Analysera kunddata, bygg dashboards i Looker/PowerBI och stöd affärsbeslut med insikter.' },
  { company: 'H&M Group', title: 'Fullstack-utvecklare', location: 'Stockholm', source: 'Monster.se', description: 'Vi bygger nästa generations e-handelsplattform. Node.js, React, GraphQL. Söker någon med 3+ års erfarenhet.' },
  { company: 'Ericsson', title: 'DevOps Engineer', location: 'Kista', source: 'Arbetsförmedlingen', description: 'Kubernetes, AWS, Terraform. Automatisera CI/CD-flöden för globala telekom-produkter.' },
  { company: 'Truecaller', title: 'Android-utvecklare', location: 'Stockholm', source: 'LinkedIn', description: 'Kotlin, Jetpack Compose, MVVM. Bygg funktioner för hundratals miljoner användare världen över.' },
  { company: 'Northvolt', title: 'Project Manager', location: 'Skellefteå', source: 'Arbetsförmedlingen', description: 'Led tvärfunktionella projekt inom battericellsproduktion. Erfarenhet av tillverkningsindustri och Agile.' },
  { company: 'Tink', title: 'QA Engineer', location: 'Stockholm', source: 'Blocket Jobb', description: 'Automatisera testning av vår open banking-plattform. Playwright, Cypress, Postman.' },
  { company: 'Epidemic Sound', title: 'UX Researcher', location: 'Stockholm', source: 'LinkedIn', description: 'Genomför användarstudier, prototyptester och kvalitativ forskning för att forma produktbeslut.' },
  { company: 'Kinnevik', title: 'Business Analyst', location: 'Stockholm', source: 'Monster.se', description: 'Stödja investeringsbeslut och portföljanalys. Excel, SQL och stark affärsmässig förståelse.' },
  { company: 'Bolt', title: 'Customer Success Manager', location: 'Göteborg', source: 'Metrojobb', description: 'Ansvara för nyckelkunders framgång, onboarding och retention. Flytande svenska och engelska.' },
  { company: 'Storytel', title: 'Content Marketing Specialist', location: 'Stockholm', source: 'LinkedIn', description: 'Skapa engagerande innehåll för nordiska marknaden. SEO, sociala medier och redaktionell planering.' },
  { company: 'Voi Technology', title: 'Operations Coordinator', location: 'Malmö', source: 'Arbetsförmedlingen', description: 'Koordinera daglig drift av vår mikromobilitet-flotta. Logistik och stakeholder-hantering.' },
  { company: 'iZettle (PayPal)', title: 'Sales Development Representative', location: 'Stockholm', source: 'Indeed.se', description: 'Prospektera och kvalificera leads för vårt SME-segment. B2B-försäljning, HubSpot.' },
  { company: 'Fortnox', title: 'Kundsupport-specialist', location: 'Växjö', source: 'Arbetsförmedlingen', description: 'Hjälp svenska småföretag med bokförings- och lönefrågor via telefon och chatt.' },
  { company: 'Mynewsdesk', title: 'PR & Communications', location: 'Stockholm', source: 'Blocket Jobb', description: 'Driv PR-strategier för nordiska kunder. Mediarelationer och content-produktion.' },
  { company: 'Yubico', title: 'Security Engineer', location: 'Stockholm', source: 'LinkedIn', description: 'Bygg och underhåll säkerhetsinfrastruktur för vår YubiKey-plattform.' },
  { company: 'Doktor.se', title: 'Legitimerad Sjuksköterska', location: 'Distansarbete', source: 'Arbetsförmedlingen', description: 'Digital vård via videosamtal. Flexibla arbetstider och konkurrenskraftig lön.' },
  { company: 'Trustly', title: 'Compliance Officer', location: 'Stockholm', source: 'Monster.se', description: 'AML/KYC-arbete inom betalningstjänster. Erfarenhet av finansiell reglering.' }
];

function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

// ================================================================
// GET handler
// ================================================================
export async function GET(req, ctx) {
  const params = await ctx.params;
  const p = params?.path || [];
  const path = p.join('/');
  const db = await getDb();

  try {
    // Public endpoints
    if (path === '' || path === 'health') {
      return NextResponse.json({ ok: true, service: 'JobbPiloten API' });
    }

    // Round-74 fix: this branch was previously inlined AFTER the
    // auth gate below — a structural oversight from Round-34 that
    // left unauth callers with a 401 on the landing-page widget.
    // Moved here so the fetch from app/page.js renders without
    // Clerk cookies. `db` is hoisted to the top of the GET handler
    // and reused here (no second getDb() round-trip). Also fixes
    // a wrong-param typo from the Round-34 draft. The Round-74
    // structural tests in tests/unit/public-stats.test.mjs lock
    // the new position and the param name.
    if (path === 'public/stats' && req.method === 'GET') {
      try {
        const [totalApplications, totalInterviews] = await Promise.all([
          db.collection('applications').countDocuments({}),
          db.collection('applications').countDocuments({ status: 'Intervju bokad' }),
        ]);
        // Display strings hardened against tiny-N privacy: exact
        // counts when the platform reaches ≥ MIN_VISIBLE_COUNT,
        // rounded otherwise, so a brand-new sign-up can't infer
        // peer activity from a +1 increment.
        const MIN_VISIBLE_COUNT = 100;
        const appsCount = totalApplications;
        // Swedish thousands separator (1 247, 12 500). Round-34 inlined
        // here so a missing-helper would not surface as a runtime 500
        // on the first public hit.
        const formatSwedishThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
        const appsCountDisplayText = appsCount >= MIN_VISIBLE_COUNT
          ? `${formatSwedishThousands(appsCount)} personliga brev skrivna`
          : `personliga brev skrivna`;
        // Interview rate — exact percent when both numerator AND
        // denominator meet minimums. Otherwise surface a placeholder
        // ("—") so a low-N cohort doesn't broadcast a fabricated %.
        const interviewRate = totalApplications > 0
          ? Math.round((totalInterviews / totalApplications) * 100)
          : null;
        const interviewRateDisplayText = (totalInterviews >= 30 && totalApplications >= MIN_VISIBLE_COUNT)
          ? `${interviewRate}%`
          : '—';
        return NextResponse.json({
          appsCount,
          appsCountDisplayText,
          interviewRate,
          interviewRateDisplayText,
          // Hardcoded cities — populated from lib/swedishLocations.js
          // effort when the geo-IP integration lands in Round-35.
          cities: ['Stockholm', 'Göteborg', 'Malmö'],
        });
      } catch (e) {
        // Fail soft — never return 500 from the landing-page widget.
        // The frontend falls back to placeholder copy if it gets a
        // non-2xx response, so a Mongo blip during launch week
        // surfaces as "— brev skrivna" rather than a broken hero.
        return NextResponse.json({
          appsCount: 0,
          appsCountDisplayText: 'personliga brev skrivna',
          interviewRate: null,
          interviewRateDisplayText: '—',
          cities: ['Stockholm', 'Göteborg', 'Malmö'],
        });
      }
    }

    // Protected endpoints below
    const authRes = await requireAuth(req);
    if (authRes.error) return authRes.error;
    const clerkId = authRes.userId;

    if (path === 'profile') {
      // Round-46 / Followup 3 (2026-07-20 audit): profile may be
      // null on a first-time user who hasn't completed /onboarding
      // yet (load() in app/dashboard/page.js redirects them
      // upstream, but the API surface itself is intentionally
      // permissive — returning `{ profile: null }` so a
      // future caller can distinguish "no profile yet" from "auth
      // failure"). NOT migrated to requireCompleteProfile() —
      // that helper would 404, which would break the dashboard's
      // pre-redirect fetch.
      const profile = await db.collection('profiles').findOne({ clerkId });
      if (!profile) return NextResponse.json({ profile: null });
      const { _id, ...clean } = profile;
      return NextResponse.json({ profile: clean });
    }

    if (path === 'applications') {
      const apps = await db.collection('applications')
        .find({ clerkId })
        .sort({ appliedAt: -1 })
        .limit(100)
        .toArray();
      const clean = apps.map(({ _id, ...rest }) => rest);
      return NextResponse.json({ applications: clean });
    }

    if (path === 'subscription') {
      // Round-46 / Followup 3 (2026-07-20 audit): subscription is
      // read alongside the profile; both may be null on a free-
      // tier first-time user. NOT migrated to requireCompleteProfile()
      // — the helper would 404, but the dashboard's /settings page
      // fetches this on mount regardless of tier and renders the
      // "Inget abonnemang" empty-state copy.
      const profile = await db.collection('profiles').findOne({ clerkId });
      return NextResponse.json({
        subscription: profile ? {
          tier: profile.tier || 'Basic',
          status: profile.subscriptionStatus || 'inactive',
          billingInterval: profile.billingInterval || null,
          currentPeriodEnd: profile.currentPeriodEnd || null,
          cancelAtPeriodEnd: !!profile.cancelAtPeriodEnd,
          hasStripeCustomer: !!profile.stripeCustomerId,
        } : null
      });
    }

    if (path === 'stats') {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const total = await db.collection('applications').countDocuments({ clerkId });
      const thisMonth = await db.collection('applications').countDocuments({ clerkId, appliedAt: { $gte: monthStart } });
      const interviews = await db.collection('applications').countDocuments({ clerkId, status: 'Intervju bokad' });
      const apps = await db.collection('applications').find({ clerkId }).sort({ appliedAt: -1 }).limit(60).toArray();
      // Round-41 (Followup 1): defensive date parsing. Legacy rows or
      // bad seed data can carry `appliedAt` as null / undefined / a
      // non-Date string. Pre-fix, `new Date(null).toISOString()`
      // throws "Invalid time value" (the RangeError that was visible
      // in the dev server log during Round-40 setup), and the
      // catch-all's outer try/catch returned a generic 500 — breaking
      // the dashboard's stat tiles.
      // Fix: extract the parse to a helper that returns null on any
      // invalid input, then filter before building the dayKeys Set.
      // (Round-41.1 review note: the /api/report branch below does
      // NOT need the same pattern — it queries MongoDB with
      // `appliedAt: { $gte: monthStart }` which is type-safe and
      // never stringifies dates in JS, so the original
      // `apps.map(...).toISOString()` bug class is impossible there.
      // The /api/stats branch was the only call site with the bug.)
      const safeDayKey = (a) => {
        if (!a) return null
        const d = new Date(a.appliedAt)
        if (isNaN(d.getTime())) return null
        return d.toISOString().slice(0, 10)
      }
      const dayKeys = new Set(apps.map(safeDayKey).filter(Boolean));
      let streak = 0;
      let cursor = new Date();
      while (dayKeys.has(cursor.toISOString().slice(0, 10))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }
      const nextReport = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return NextResponse.json({ total, thisMonth, interviews, streak, nextReport });
    }

    if (path === 'report') {
      // Round-46 / Followup 3 (2026-07-20 audit): profile is read
      // for the PDF header (lib/pdf-report.js pulls fullName +
      // tier). A missing profile is NOT a 404 here — generateAktivitetsrapport
      // throws downstream and the route falls back to a generic 500,
      // which is the project's existing pre-helper behavior. NOT
      // migrated to requireCompleteProfile() because the dashboard
      // pre-checks profile presence via /api/profile before
      // requesting the PDF.
      const profile = await db.collection('profiles').findOne({ clerkId });
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const apps = await db.collection('applications')
        .find({ clerkId, appliedAt: { $gte: monthStart } })
        .sort({ appliedAt: 1 })
        .toArray();

      const pdfBytes = await generateAktivitetsrapport(profile, apps, now);
      return new NextResponse(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Aktivitetsrapport-${now.toISOString().slice(0,7)}.pdf"`,
        },
      });
    }

    if (path === 'push-status') {
      const sub = await db.collection('push_subscriptions').findOne({ clerkId, active: true });
      return NextResponse.json({ active: !!sub, endpoint: sub?.endpoint ? sub.endpoint.slice(0, 40) + '...' : null });
    }

    if (path === 'jobs-available') {
      // Round-46 / Followup 3 (2026-07-20 audit): profile is
      // OPTIONAL here — the search runs as an anonymous AF API
      // query and only uses profile.jobTitles / profile.locations
      // for query-string shaping. A missing profile yields a
      // nationwide-pending-search, which the dashboard surfaces
      // as "Lediga jobb (alla)" in the empty-preferences state.
      // NOT migrated to requireCompleteProfile() — the route MUST
      // work for first-time users who haven't completed /onboarding
      // yet.
      const { searchParams } = new URL(req.url);
      // Round-18 deep-link short-circuit: a push-notification click
      // arrives at /dashboard?jobId=X and the dashboard reads it
      // via /api/jobs-available?jobId=X. The heavy multi-source
      // waterfall below is wasted here — we want a single AF fetch.
      // The profile lookup is also skipped: a single-job deep-link
      // doesn't need the user's profile-preference filter because
      // the job payload IS the request. requireAuth has already
      // verified the caller upstream.
      // 404 (not 200 with empty jobs[]) so the dashboard can
      // distinguish "this AF ad is gone" from "no AF jobs matched
      // your profile".
      const jobIdParam = searchParams.get('jobId');
      if (jobIdParam) {
        const job = await getJobById(jobIdParam);
        if (!job) {
          return NextResponse.json(
            { jobs: [], hasMore: false, error: 'not_found' },
            { status: 404 },
          );
        }
        return NextResponse.json({ jobs: [job], hasMore: false });
      }
      const profile = await db.collection('profiles').findOne({ clerkId });
      const query = searchParams.get('query') || '';
      const location = searchParams.get('location') || '';
      // Issue 3 (2026-07-10): pagination. `page` is 0-indexed and
      // multiplies against PAGE_SIZE (10) for the offset passed
      // to the waterfall. The dashboard's "Visa fler jobb" button
      // appends the next page's results to its in-memory list
      // rather than replacing — the response includes `hasMore`
      // so the button hides itself when the server has signalled
      // the end of the result set.
      const page = Math.max(0, Math.min(parseInt(searchParams.get('page') || '0', 10) || 0, 100))
      // Lock the page size behind a query-param cap so a single
      // request can't pull thousands of jobs at once (defence in
      // depth against the upstream AF rate limit). 50 is generous —
      // the dashboard always asks without a pageSize and gets the
      // default 10, but the contract is honoured for any caller.
      const rawPageSize = parseInt(searchParams.get('pageSize') || '10', 10) || 10
      const PAGE_SIZE = Math.max(1, Math.min(rawPageSize, 50))
      // `allSweden=1` is the user-toggle override (the dashboard's
      // fallback banner exposes a button that flips this on). When set
      // we skip the strict Län-filter pass and go straight to the
      // nationwide pass so the user can see what's out there at-a-glance.
      const forceAllSweden = searchParams.get('allSweden') === '1';

      // Sanitize the profile's `locations` array: drop falsy entries and
      // split out any "remote-friendly" sentinels ("Distansarbete", etc.)
      // so they don't constrain the region filter.
      const userLocationsRaw = Array.isArray(profile?.locations)
        ? profile.locations.filter(Boolean)
        : [];
      const userLocations = userLocationsRaw.filter((l) => !isRemoteFriendlyText(l));
      const regionCodes = locationsToLänCodes(userLocations);

      const searchQuery = query || (profile?.jobTitles || []).slice(0, 2).join(' ');
      const searchLocation = location || (userLocations.slice(0, 2).join(', '));

      // Issue 2 (2026-07-10): normalize the profile's
      // `employmentType` field to an array. Legacy documents store
      // a single string (e.g. `'heltid'`) — we wrap into a
      // single-item array here so the downstream call site can
      // unconditionally use `Array.isArray`. An empty string or
      // null turns into an empty array = "no filter", which is
      // the correct semantic for a brand-new user.
      const profileEmploymentTypes = Array.isArray(profile?.employmentType)
        ? profile.employmentType
        : (profile?.employmentType ? [profile.employmentType] : [])

      // Used-keys dedupe shared across all four passes so we never
      // surface a job the user has already applied for, even if AF
      // returns it again under a different filter.
      const already = await db.collection('applications')
        .find({ clerkId })
        .project({ company: 1, title: 1 })
        .toArray();
      const usedKeys = new Set(already.map((a) => `${a.company}|${a.title}`));

      // Four-pass waterfall — we ALWAYS walk in order and return the
      // first pass that yields at least one un-applied result:
      //   1. Strict Län-filter (if user has region codes)
      //   2. Text-only location filter (broader — matches "Stockholm"
      //      anywhere in the ad, not just the workplace_address field)
      //   3. Nationwide blank-slate (last-resort: "show me anything")
      //   4. Loose (no preferences at all — used when profile has no
      //      jobTitles AND no locations; same as Bug #2 loose fallback)
      // The chosen pass becomes `searchMode` (or `locationFilterMode`
      // for the two-tier model — strict län vs loose fallback).
      let available = [];
      let serverHasMore = false;
      let searchMode = 'strict';
      let locationFilterMode = 'strict';

      if (forceAllSweden) {
        // Explicit user override via the toggle button — skip directly
        // to a nationwide pass. We deliberately do NOT set `searchMode =
        // 'loose'` on the empty-result branch, even though that would
        // be the natural "I tried strict and fell back" default. The
        // user has explicitly opted into the nationwide view via the
        // toggle, so the amber "Visar alla jobb — justera preferenser"
        // banner would be misleading copy for that case. The blue
        // banner keyed on `locationFilterMode === 'fallback-nationwide'`
        // already renders the correct wording ("Inga jobb hittades i X
        // / Y. Visar jobb i hela Sverige istället.") for both empty
        // and populated result sets — the dashboard's per-card empty
        // state ("Inga lediga jobb hittades just nu.") covers the
        // truly-empty branch separately.
        //
        // Issue 4 (2026-07-10): call `multiSourceSearchJobs` so the
        // user sees the combined AF + Blocket pool when they opt out of
        // the strict Län filter.
        const { jobs: nationwide, hasMore: hm1 } = await multiSourceSearchJobs({ query: searchQuery, location: '', region: '', limit: PAGE_SIZE, offset: page * PAGE_SIZE, employmentTypes: profileEmploymentTypes });
        available = nationwide.filter((j) => !usedKeys.has(`${j.company}|${j.title}`));
        serverHasMore = hm1
        locationFilterMode = 'fallback-nationwide';
      } else if (regionCodes.length > 0) {
        // Strict Län-filter pass (region is AF-only; Blocket ignores it).
        const { jobs: strictJobs, hasMore: hm2 } = await multiSourceSearchJobs({ query: searchQuery, location: searchLocation, region: regionCodes.join(','), limit: PAGE_SIZE, offset: page * PAGE_SIZE, employmentTypes: profileEmploymentTypes });
        available = strictJobs.filter((j) => !usedKeys.has(`${j.company}|${j.title}`));
        serverHasMore = hm2
        if (available.length === 0) {
          // Loosen to text-only (some AF hits don't carry the matching
          // region_code but mention the city in the headline/description,
          // plus Blocket content is text-only by nature).
          // Bug fix (2026-07-11, "Visa fler jobb"): `multiSourceSearchJobs`
            // returns `{ jobs: [...], hasMore: false }`, NOT a bare array.
            // The naive `textJobs.filter(...)` here was crashing the
            // dashboard's pagination handler with `textJobs.filter is
            // not a function` whenever the API fell into this branch.
            // Hardening (parity with the other branches above): destructure
            // { jobs } and run Array.isArray() before any `.filter()`,
            // matching the defensive contract the dashboard's loadMoreJobs
            // already enforces. A regression returns an empty array so the
            // dashboard surfaces "no more results" rather than a 500.
            const textJobsResp = await multiSourceSearchJobs({ query: searchQuery, location: searchLocation, limit: 20 });
            // safeTextJobs (not `.filter()` on raw `{jobs,hasMore}` return) — multiSourceSearchJobs returns an object, not a bare array.
            const safeTextJobs = Array.isArray(textJobsResp?.jobs) ? textJobsResp.jobs : [];
            const textAvailable = safeTextJobs.filter((j) => j && !usedKeys.has(`${j.company}|${j.title}`));
          if (textAvailable.length > 0) {
            available = textAvailable;
            locationFilterMode = 'text-only';
          } else {
            // Nationwide fallback so we're never stuck on a literal
            // "Inga lediga jobb hittades just nu" empty state.
            const { jobs: nationwide, hasMore: hm3 } = await multiSourceSearchJobs({ query: searchQuery, location: '', region: '', limit: PAGE_SIZE, offset: page * PAGE_SIZE, employmentTypes: profileEmploymentTypes });
            const nationwideAvailable = nationwide.filter((j) => !usedKeys.has(`${j.company}|${j.title}`));
            if (nationwideAvailable.length > 0) {
              available = nationwideAvailable;
              serverHasMore = hm3
              searchMode = 'loose';
              locationFilterMode = 'fallback-nationwide';
            } else {
              // Try once more with no query at all (text + region both off)
              const { jobs: looseOnly, hasMore: hm4 } = await multiSourceSearchJobs({ query: '', location: '', limit: PAGE_SIZE, offset: page * PAGE_SIZE, employmentTypes: profileEmploymentTypes });
              available = looseOnly.filter((j) => !usedKeys.has(`${j.company}|${j.title}`));
              serverHasMore = hm4
              searchMode = 'loose';
            }
          }
        }
      } else {
        // No locations OR all are remote-friendly. Treat as search-only.
        const { jobs: keywordJobs, hasMore: hm5 } = await multiSourceSearchJobs({ query: searchQuery, location: searchLocation, limit: PAGE_SIZE, offset: page * PAGE_SIZE, employmentTypes: profileEmploymentTypes });
        available = keywordJobs.filter((j) => !usedKeys.has(`${j.company}|${j.title}`));
        serverHasMore = hm5
        // `locationFilterMode` is mirrored from the region-codes branch
        // so the API response is consistent regardless of branch — a
        // no-locations user gets `'text-only'` rather than the misleading
        // default `'strict'`, which would otherwise suggest a region
        // filter ran. The dashboard's `locationFilterMode === 'strict'`
        // banner is guarded by `userLocationList.length > 0` so it
        // won't render here, but downstream analytics (e.g. "which
        // branch did the user end up on") still want the right value.
        locationFilterMode = 'text-only';
        if (available.length === 0) {
          const { jobs: looseOnly, hasMore: hm6 } = await multiSourceSearchJobs({ query: '', location: '', limit: PAGE_SIZE, offset: page * PAGE_SIZE, employmentTypes: profileEmploymentTypes });
          available = looseOnly.filter((j) => !usedKeys.has(`${j.company}|${j.title}`));
          if (available.length > 0) {
            serverHasMore = hm6
            searchMode = 'loose';
            // Mirrors the region-codes branch: a nationwide pass with
            // empty query + empty location is the same shape as the
            // `forceAllSweden` path, so flag it identically.
            locationFilterMode = 'fallback-nationwide';
          }
        }
      }

      // Tag each job with the location-match badge so the dashboard can
      // render "✅ Matchar din ort [city]" next to cards that landed
      // because of the filter (cheap substring match — the fetch has
      // already filtered, this is for visual affordance only).
      const classifiedJobs = available.map((job) => ({
        ...job,
        matchesUserLocation: doesJobMatchUserLocation(job, userLocations),
      }));

      if (searchMode === 'loose' || locationFilterMode === 'fallback-nationwide') {
        console.log(`[jobs-available] searchMode=${searchMode} locationFilterMode=${locationFilterMode} hits=${available.length} (userLocations=${userLocations.length}, regionCodes=${regionCodes.length})`);
      }

      return NextResponse.json({
        jobs: classifiedJobs,
        total: classifiedJobs.length,
        // Issue 3 (2026-07-10): pagination metadata. `hasMore` is the
        // raw server signal (more pages exist beyond the current
        // offset+limit window). `page` mirrors the request so the
        // dashboard can track its own cursor without re-deriving it
        // from a stale closure. `pageSize` is duplicated for clarity
        // — clients can show "Visar 10 av 47" without a second
        // round-trip.
        hasMore: serverHasMore,
        page,
        pageSize: PAGE_SIZE,
        searchMode,
        locationFilterMode,
        userLocations,
      });
    }

    return NextResponse.json({ error: 'Not found', path }, { status: 404 });
  } catch (err) {
    console.error('GET error', path, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ================================================================
// POST handler
// ================================================================
export async function POST(req, ctx) {
  const params = await ctx.params;
  const p = params?.path || [];
  const path = p.join('/');
  const db = await getDb();

  try {
    const authRes = await requireAuth(req);
    if (authRes.error) return authRes.error;
    const clerkId = authRes.userId;

    if (path === 'profile') {
      const body = await req.json();
      // Fetch existing profile to preserve userId (internal UUID)
      const existing = await db.collection('profiles').findOne({ clerkId });
      const userId = existing?.userId || randomUUID();

      // Backward-compat aliases. The original onboarding form sent legacy
      // keys (`name` instead of `fullName`, `desiredTitles` instead of
      // `jobTitles`, …) which silently mapped to nothing on the stored
      // document — every downstream feature then ran with empty data. We
      // mirror any legacy value onto the canonical key so old clients
      // still work without code changes, and we also coerce a few values
      // (experience / employmentType) into the canonical Swedish enum
      // names. Mirrors the slug maps defined in app/onboarding/page.js so
      // the two paths stay aligned if either changes.
      const ALIASES = {
        name: 'fullName',
        linkedInUrl: 'linkedin',
        desiredTitles: 'jobTitles',
        experienceLevel: 'experience',
        avoidedIndustries: 'industriesToAvoid',
      }
      const source = { ...body }
      for (const [legacy, canonical] of Object.entries(ALIASES)) {
        if (source[legacy] != null && (source[canonical] == null || source[canonical] === '')) {
          source[canonical] = source[legacy]
        }
      }
      const EXPERIENCE_ENUM = { entry: 'Junior', mid: 'Medior', senior: 'Senior', Junior: 'Junior', Medior: 'Medior', Senior: 'Senior' }
      if (source.experience && EXPERIENCE_ENUM[source.experience]) {
        source.experience = EXPERIENCE_ENUM[source.experience]
      }
      const EMPLOYMENT_ENUM = {
        'full-time': 'heltid', 'part-time': 'deltid', contract: 'konsult',
        heltid: 'heltid', deltid: 'deltid', konsult: 'konsult',
        praktik: 'praktik', tillsvidare: 'tillsvidare', visstid: 'visstid',
      }
      if (Array.isArray(source.employmentType)) {
        // Issue 2 (2026-07-10): employmentType is now an array. Map
        // each entry through the enum (so legacy `'full-time'` etc.
        // still work), drop empties, and de-dupe so a repeated
        // submission doesn't bloat the profile document.
        const mapped = source.employmentType
          .map((t) => EMPLOYMENT_ENUM[t] || t)
          .filter(Boolean)
        source.employmentType = Array.from(new Set(mapped))
      } else if (source.employmentType && EMPLOYMENT_ENUM[source.employmentType]) {
        source.employmentType = EMPLOYMENT_ENUM[source.employmentType]
      } else if (source.employmentType === '') {
        source.employmentType = []
      }

      const doc = {
        clerkId,
        userId,
        fullName: source.fullName || '',
        email: source.email || '',
        phone: source.phone || '',
        personalNumber: source.personalNumber || '',
        address: source.address || '',
        linkedin: source.linkedin || '',
        jobTitles: source.jobTitles || [],
        locations: source.locations || [],
        salaryMin: source.salaryMin || null,
        experience: source.experience || 'Medior',
        workPreference: source.workPreference || 'hybrid',
        employmentType: source.employmentType || 'heltid',
        industriesToAvoid: source.industriesToAvoid || [],
        cvSummary: source.cvSummary || '',
        tier: source.tier || 'Professional',
        subscriptionStatus: source.subscriptionStatus || 'inactive',
        // Round-35 (Part 3 — Answer Diversity): persist the user's
        // chosen AI-writing voice on the first POST. Default to
        // 'lagom' (the canonical Swedish workplace-standard voice)
        // so a brand-new profile benefits from style-aware generation
        // immediately. The validator set is derived from
        // `STYLE_PRESETS` (imported above) so adding a 6th style
        // automatically extends the accept-list here.
        stylePreference: ALLOWED_STYLE_IDS.has(source.stylePreference)
          ? source.stylePreference
          : 'lagom',
        updatedAt: new Date(),
      };
      // Round-30: conditionally merge CV upload fields IF the payload
      // carries them. This MUST be conditional (NOT `cvText: source.cvText || ''`)
      // — onboarding forms POST to /api/profile without cvText in their
      // payload, and an unconditional `|| ''` would write an empty string
      // over a previously uploaded CV when the user re-completes onboarding.
      // The conditional merge preserves any existing CV doc when the field
      // is absent from the payload. The /api/profile-update partial-update
      // endpoint (line ~600) already explicitly ALLOW-lists these four
      // fields for /settings, so this symmetric addition closes the Round-
      // 29.4 race-window between POST /api/profile and POST /api/profile-
      // update in the seedDemoUser() helper — the seed now writes everything
      // in a single atomic POST.
      for (const cvField of ['cvText', 'cvFileName', 'cvFileSize', 'cvUploadedAt']) {
        if (Object.prototype.hasOwnProperty.call(source, cvField)) {
          doc[cvField] = source[cvField];
        }
      }
      await db.collection('profiles').updateOne(
        { clerkId },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
      // Seed historical applications if profile is brand new
      const existingApps = await db.collection('applications').countDocuments({ clerkId });
      if (existingApps === 0) {
        await seedApplications(db, clerkId);
      }
      return NextResponse.json({ ok: true });
    }

    if (path === 'profile-update') {
      // Partial update — used by /settings. Only writes the fields the UI
      // sends, and an explicit allow-list prevents accidentally clobbering
      // billing/stripe/subscription fields if the form ever leaks one.
      // The body is { field: value, ... }; we map each onto `$set`.
      const body = await req.json().catch(() => ({}));
      const ALLOWED = [
        'fullName', 'email', 'phone', 'personalNumber', 'address', 'linkedin', 'afCaseNumber',
        'jobTitles', 'locations', 'salaryMin', 'experience',
        'workPreference', 'employmentType', 'industriesToAvoid', 'cvSummary',
        // CV upload feature — the server-side route POST /api/upload-cv
        // writes cvText + cvFileName from a parsed PDF/DOCX file, but the
        // settings page can ALSO clear them through this partial update
        // (by sending `{ cvText: '', cvFileName: '' }` when the user
        // clicks the “Ta bort fil” button — no separate DELETE endpoint).
        'cvText', 'cvFileName', 'cvFileSize', 'cvUploadedAt',
        // AI-answer preference — set by /settings on the AI toggle card
        // (default true). Read by /api/extension/ai-answers so the user
        // can opt out of Groq-generated answers on unmatched form
        // fields without breaking the local extension fill loop.
        'aiFallbackEnabled',
        // Profile picture — stored as `{ type: 'upload' | 'avatar', value }`.
        // `value` for `upload` is a `data:image/...;base64,...` URL (capped
        // at 2 MB on the client, then re-validated server-side below).
        // For `avatar` it's one of the slugs in components/avatars.jsx
        // (e.g. "piloten", "navigatören"). `null` clears the picture so
        // the default JobbPiloten plane circle reappears everywhere.
        // 8 KB is a generous upper bound — actual serialized payloads
        // max out around 2.7 MB after base64 of a 2 MB JPG.
        'profilePicture',
        // Persisted collection progress. The settings page sends the
        // full sorted array of avatar slugs the user has unlocked. We
        // validate each id against PROFILE_PICTURE_AVATARS below so the
        // server can't be tricked into storing junk ids. An empty array
        // is a valid value (clears any prior collection state).
        'collectedAvatars',
        // Round-35 (Part 3 — Answer Diversity): the user's chosen
        // AI-writing voice. The /settings page's radio button card
        // writes one of 5 canonical values: 'lagom' (default),
        // 'strukturerad', 'berattande', 'direkt', 'engagerad'. Stored
        // as a string, never an array, because the user only has ONE
        // default style — per-question override is an extension
        // concern (deferred to Part 6). Unknown values are silently
        // dropped via a separate guard below (the Groq prompt
        // builder falls back to the 'lagom' default for any value
        // outside the canonical set, so a stale client cannot break
        // AI generation).
        'stylePreference',
        // Round-73 / BUG F — nuvarande arbete split keys
        'currentJobTitle',
        'currentOrganization',
        // Round-12 — Auto-fill extension fields. Must be in ALLOWED to
        // reach $set, otherwise the per-field validators below are dead
        // code (they only run on keys already in $set).
        'hasDriversLicense', 'isEuCitizen', 'hasWorkPermit',
        'hasHighSchoolDiploma', 'hasForkliftLicense', 'hasSecurityClearance',
        'hasLeadershipExperience', 'isBilingual', 'hasTechnicalEducation',
        'hasCustomerExperience', 'autoConsent',
        'yearsExperience',
        'dateOfBirth', 'gender', 'nationality', 'phoneCountryCode',
        'skills',
      ];

      // Build `$set` BEFORE any guard so the guards can reference it
      // without tripping the const temporal-dead-zone. (Earlier versions
      // of this handler declared `$set` AFTER the profilePicture guard,
      // which threw `ReferenceError: Cannot access '$set' before
      // initialization` and surfaced as a 500 — this is the root cause
      // for the E2E `clearProfilePicture` / `clearCv` fixtures calling
      // `expect([200, 404]).toContain(res.status())` and seeing 500.)
      const $set = { updatedAt: new Date() };
      for (const key of ALLOWED) {
        // Only overwrite fields that the client actually sent. This lets the
        // user skip fields they don't want to change without us persisting
        // empty strings / falsy defaults over their real values.
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          $set[key] = body[key];
        }
      }
      // Normalize legacy English enum values to the canonical Swedish
      // slugs. Mirrors the same maps the `profile` POST handler uses so
      // a partial update from /settings also accepts `'full-time' →
      // 'heltid'`, `'entry' → 'Junior'`, etc. Today the settings form
      // only emits canonical values, but a legacy client (or a
      // hand-rolled curl) could still send English — without this pass
      // the value would land in MongoDB verbatim and break the
      // multi-select UI on the next render. The maps are kept
      // PROFILE_UPDATE_-prefixed so the two handlers can stay in sync
      // by a future refactor (extract to module scope) without
      // shadowing collisions.
      const PROFILE_UPDATE_EXPERIENCE_ENUM = { entry: 'Junior', mid: 'Medior', senior: 'Senior', Junior: 'Junior', Medior: 'Medior', Senior: 'Senior' }
      const PROFILE_UPDATE_EMPLOYMENT_ENUM = {
        'full-time': 'heltid', 'part-time': 'deltid', contract: 'konsult',
        heltid: 'heltid', deltid: 'deltid', konsult: 'konsult',
        praktik: 'praktik', tillsvidare: 'tillsvidare', visstid: 'visstid',
      }
      if (Object.prototype.hasOwnProperty.call($set, 'experience') && $set.experience && PROFILE_UPDATE_EXPERIENCE_ENUM[$set.experience]) {
        $set.experience = PROFILE_UPDATE_EXPERIENCE_ENUM[$set.experience]
      }
      if (Object.prototype.hasOwnProperty.call($set, 'employmentType')) {
        const emp = $set.employmentType
        if (Array.isArray(emp)) {
          $set.employmentType = Array.from(new Set(emp.map((t) => PROFILE_UPDATE_EMPLOYMENT_ENUM[t] || t).filter(Boolean)))
        } else if (emp && PROFILE_UPDATE_EMPLOYMENT_ENUM[emp]) {
          $set.employmentType = PROFILE_UPDATE_EMPLOYMENT_ENUM[emp]
        } else if (emp === '') {
          $set.employmentType = []
        }
      }
      // AI-answer toggle — opts the user out of Groq-generated answers
      // on unmatched form fields. Defaults to `true` server-side so a
      // brand-new profile benefits from AI right away. The extension
      // server route /api/extension/ai-answers enforces this regardless
      // of what the extension's local view says, so a power user can't
      // bypass it by hand-editing chrome.storage.local.
      if (Object.prototype.hasOwnProperty.call($set, 'aiFallbackEnabled') && typeof $set.aiFallbackEnabled !== 'boolean') {
        console.warn('[profile-update] rejected non-boolean aiFallbackEnabled payload (clerkId=' + clerkId + ')')
        delete $set.aiFallbackEnabled
      }
      // Server-side guard for `profilePicture`. The client's settings
      // page already validates before submit (2 MB max, JPG/PNG/WebP only,
      // data:image/... prefix required), but a direct POST from a tool
      // like curl could send anything. We re-validate here so the only
      // shapes that ever land in MongoDB are:
      //   • `null`           — explicit clear, reverts to default
      //   • `{ type: 'avatar', value }` — value is one of the known slugs
      //   • `{ type: 'upload', value }` — value is a `data:image/`
      //                                   data URL under ~2.8 MB (gives
      //                                   ~5% headroom over a 2 MB binary)
      // Drop the offending key from `$set` so the OTHER fields in the
      // patch still go through (better UX than 400-ing the whole save).
      // The client picks up the unchanged profilePicture on next render.
      //
      // The slug list is imported (ESM) from `lib/avatar-keys.js` so the
      // validator and the client registry can't drift. Adding a new
      // avatar only requires touching the lib + components/avatars.jsx.
      const PROFILE_PICTURE_MAX_DATA_URL_CHARS = 2_800_000
      // Strict data-URL guard. `data:image/<subtype>;base64,…` payloads are
      // accepted ONLY when `<subtype>` is one of {jpeg, png, webp}. We
      // deliberately reject `data:image/svg+xml,…` because SVG can carry
      // active content (<script>, event handlers) that some consumers
      // inline as HTML. The client mirrors this allowlist via
      // `PICTURE_ACCEPTED_MIME` in app/settings/page.js; this server-side
      // guard keeps the contract symmetric so a direct curl POST can't
      // bypass the client-side check.
      const ALLOWED_UPLOAD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
      function isSafeDataImage(value) {
        const m = /^data:(image\/[a-z0-9.+-]+);/i.exec(String(value || ''))
        return !!m && ALLOWED_UPLOAD_MIME.has(m[1].toLowerCase())
      }
      if (Object.prototype.hasOwnProperty.call($set, 'profilePicture')) {
        const pp = $set.profilePicture
        let ok = false
        if (pp === null) {
          ok = true
        } else if (pp && typeof pp === 'object' && typeof pp.type === 'string' && typeof pp.value === 'string') {
          if (pp.type === 'avatar' && PROFILE_PICTURE_AVATARS.has(pp.value)) {
            ok = true
          } else if (
            pp.type === 'upload' &&
            pp.value.length <= PROFILE_PICTURE_MAX_DATA_URL_CHARS &&
            isSafeDataImage(pp.value)
          ) {
            ok = true
          }
        }
        if (!ok) {
          console.warn('[profile-update] rejected invalid profilePicture payload (clerkId=' + clerkId + ')')
          delete $set.profilePicture
        }
      }
      if (Object.keys($set).length === 1) {
        // only `updatedAt` ended up in the set — nothing to update.
        return NextResponse.json({ ok: true, updated: 0 });
      }
      // Server-side guard for `collectedAvatars`. Mirror the spirit of
      // the `profilePicture` guard: validate at the edge so accidental
      // POSTs (or a stale client carrying an old format) cannot write
      // garbage to Mongo. Drop the key from `$set` so the OTHER fields
      // still go through (better UX than 400-ing the whole save).
      if (Object.prototype.hasOwnProperty.call($set, 'collectedAvatars')) {
        const ca = $set.collectedAvatars
        if (Array.isArray(ca)) {
          // Forward-compatible with avatar deprecations. If an avatar
          // is later removed from `lib/avatar-keys.js` (art redesign,
          // copyright issue, etc.) a user who collected it must still
          // be able to save their other settings — so we filter out
          // unknown ids and log a warn-line with the count. Operators
          // can grep for the warning to spot a mass deprecation event.
          const filtered = ca.filter((id) => typeof id === 'string' && PROFILE_PICTURE_AVATARS.has(id))
          const dropped = ca.length - filtered.length
          if (dropped > 0) {
            console.warn('[profile-update] dropped ' + dropped + ' unknown collectedAvatars id(s) (clerkId=' + clerkId + ')')
          }
          $set.collectedAvatars = filtered
        } else {
          console.warn('[profile-update] rejected non-array collectedAvatars payload (clerkId=' + clerkId + ')')
          delete $set.collectedAvatars
        }
      }
      // ---- 2026-07-16 (Round-12) — Auto-fill extension field validators ----
      // The settings page UI sends these fields when the user toggles
      // any of the 10 boolean credentials, types a number/date/string,
      // picks a gender/nationality, or modifies the skills chips.
      // Per-field guards mirror the existing `aiFallbackEnabled` /
      // `stylePreference` pattern: validate the type, drop the key
      // on failure, log a console warning so server-side drift is
      // visible in Vercel logs. ALL sanitisation runs BEFORE
      // updateOne so a malformed payload never reaches MongoDB.
      const ROUND12_BOOLEAN_KEYS = [
        'hasDriversLicense', 'isEuCitizen', 'hasWorkPermit', 'hasHighSchoolDiploma',
        'hasForkliftLicense', 'hasSecurityClearance', 'hasLeadershipExperience',
        'isBilingual', 'hasTechnicalEducation', 'hasCustomerExperience', 'autoConsent',
      ]
      for (const k of ROUND12_BOOLEAN_KEYS) {
        if (Object.prototype.hasOwnProperty.call($set, k)) {
          if (typeof $set[k] !== 'boolean') {
            console.warn('[profile-update] rejected non-boolean ' + k + ' payload (clerkId=' + clerkId + ')')
            delete $set[k]
          }
        }
      }
      if (Object.prototype.hasOwnProperty.call($set, 'yearsExperience')) {
        // Number coerce + range guard. We accept strings like "5" (a
        // user might submit a form-encoded value) and reject NaN /
        // negatives / implausibly large numbers. Years > 100 is a
        // clearly hostile or buggy payload — log + drop.
        const n = Number($set.yearsExperience)
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          console.warn('[profile-update] rejected invalid yearsExperience payload (clerkId=' + clerkId + ', value=' + JSON.stringify($set.yearsExperience) + ')')
          delete $set.yearsExperience
        } else {
          // Floor to an integer so "3.5" round-trips as 3, not 3.5.
          $set.yearsExperience = Math.floor(n)
        }
      }
      const ROUND12_STRING_KEYS = ['dateOfBirth', 'gender', 'nationality', 'phoneCountryCode']
      for (const k of ROUND12_STRING_KEYS) {
        if (Object.prototype.hasOwnProperty.call($set, k)) {
          // Type guard + length cap. Strings > 200 chars are rejected
          // outright — none of these fields should ever approach that
          // length (a phone country code is at most 8 chars), so a
          // 200+ payload is unambiguously a hostile or buggy client.
          if (typeof $set[k] !== 'string' || $set[k].length > 200) {
            console.warn('[profile-update] rejected invalid ' + k + ' payload (clerkId=' + clerkId + ')')
            delete $set[k]
          }
        }
      }
      if (Object.prototype.hasOwnProperty.call($set, 'skills')) {
        // Skills must be an array of short strings. Cap each item at
        // 100 chars (no real skill label is longer than that) and
        // drop duplicates + empty strings before persisting so the
        // stored array stays clean for the extension's word-boundary
        // matcher. Cap the array itself at 50 entries (the UI exposes
        // 10 chips + the multi-select grid; 50 is a generous hostile-
        // payload ceiling) so a malicious client can't bloat the
        // Mongo doc with an unbounded array.
        if (!Array.isArray($set.skills) || $set.skills.length > 50 || !$set.skills.every((s) => typeof s === 'string' && s.length <= 100)) {
          console.warn('[profile-update] rejected invalid skills payload (clerkId=' + clerkId + ', length=' + (Array.isArray($set.skills) ? $set.skills.length : 'NaN') + ')')
          delete $set.skills
        } else {
          $set.skills = Array.from(new Set($set.skills.filter((s) => s && s.length > 0))).sort()
        }
      }
      // Bug 1 fix (2026-07-20): upsert:true so the FIRST save by a
      // brand-new user (e.g. tester onboarding → /settings → save
      // → expects AI email preview to find a profile) actually
      // CREATES the doc rather than silently updating zero rows.
      // The two existing upsert:true sites (lines 616, 1064) are
      // full-profile write paths; line 878 is the partial-update
      // path that ships from /settings after Round-12 expansion,
      // and it must upsert to be safe as the FIRST save ever for a
      // brand-new Clerk/demo user.
      const res = await db.collection('profiles').updateOne(
        { clerkId },
        {
          $set,
          // Round-46 / Followup 1 (2026-07-20 Monday): defensive
          // defaults for brand-new users whose first save comes
          // through this partial-update handler. Without these,
          // an insert via upsert yields a doc with only the
          // partial fields the form sent — missing fields
          // downstream consumers (lib/pdf-report.js,
          // lib/ai-usage.js, app/api/cover-letter/*,
          // app/api/email-preview/route.js) assume always exist.
          // $setOnInsert fires ONLY on INSERT (brand-new doc),
          // never on subsequent updates — so existing users are
          // not touched. Same construction as line ~615's insert
          // path so both write entry points produce an
          // equivalent-shaped doc.
          $setOnInsert: {
            createdAt: new Date(),
            tier: 'Basic',
            aiEmailBodyEnabled: true,
            aiFallbackEnabled: true,
            aiAnswersEnabled: true,
            stylePreference: 'lagom',
            onboardingCompleted: true,
            // jobTitles / locations deliberately OMITTED from
            // $setOnInsert (Round-46 review-flag #B from the 2026-
            // 07-20 Monday test pass): writing `[]` here flips any
            // downstream `'jobTitles' in profile` /
            // `profile.jobTitles !== undefined` check for first-
            // time-save users from "absent" -> "empty", which
            // silently breaks the "no preferences yet" UX window.
            // Both fields are populated by /settings and
            // /onboarding afterward with real values -- no
            // defensive defaults needed in $setOnInsert.
          },
        },
        { upsert: true },
      );
      // Round-35 (Part 3 — Answer Diversity): validate the
      // stylePreference against the canonical 5-value set.
      // `ALLOWED_STYLE_IDS` is hoisted to module scope (above the
      // handlers) so both this profile-update path AND the
      // first-POST `profile` seed-default path share a single
      // derivation from `STYLE_PRESETS`. Unknown values are dropped
      // (better UX than 400-ing the whole save).
      if (Object.prototype.hasOwnProperty.call($set, 'stylePreference')) {
        const sp = $set.stylePreference
        if (typeof sp === 'string' && ALLOWED_STYLE_IDS.has(sp)) {
          // ok — keep
        } else {
          console.warn('[profile-update] rejected invalid stylePreference payload (clerkId=' + clerkId + ', value=' + JSON.stringify(sp) + ')')
          delete $set.stylePreference
        }
      }
      if (res.matchedCount === 0) {
        return NextResponse.json({ error: 'Profil finns inte' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, updated: Object.keys($set).length - 1 });
    }

    if (path === 'account-export') {
      // GDPR art. 20 — dataportability. Returns a JSON snapshot of every
      // record we hold for the current user (profile, applications, push
      // subscription, all cron logs, push-dismissals). Strip ObjectId
      // wrappers so the JSON round-trips cleanly into other tools. We do
      // not page or cap — a complete copy is required for the export.
      const [profile, applications, push, logs, dismissals] = await Promise.all([
        db.collection('profiles').findOne({ clerkId }),
        db.collection('applications').find({ clerkId }).sort({ appliedAt: -1 }).toArray(),
        db.collection('push_subscriptions').findOne({ clerkId }),
        db.collection('cron_logs').find({ clerkId }).sort({ startedAt: -1 }).toArray(),
        db.collection('push_dismissals').find({ clerkId }).toArray(),
      ]);
      const strip = (d) => {
        if (!d) return d;
        // Optimize for the common single-doc case; handle arrays separately.
        if (Array.isArray(d)) return d.map(strip);
        const { _id, ...rest } = d;
        return rest;
      };
      const payload = {
        exportedAt: new Date().toISOString(),
        schemaVersion: 1,
        profile: strip(profile),
        applications: strip(applications),
        pushSubscription: strip(push),
        cronLogs: strip(logs),
        pushDismissals: strip(dismissals),
      };
      const today = new Date().toISOString().slice(0, 10);
      return new NextResponse(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="jobbpiloten-data-${today}.json"`,
        },
      });
    }

    if (path === 'account-delete') {
      // Round-46 / Followup 3 (2026-07-20 audit): account-delete
      // is idempotent by design (Round-19 GDPR-DSA contract) —
      // deleting an already-empty account returns
      // `{ ok: true, deleted: { profile: 0 } }`. NOT migrated
      // to requireCompleteProfile() because the action is the
      // OPPOSITE of "is the profile complete"; an incomplete
      // profile is still deletable.
      // GDPR art. 17 — rätten att bli glömd. Removes every record we own
      // for this user. Does NOT touch Stripe — active subscriptions continue
      // billing per Stripe ToS until the user cancels them in the billing
      // portal. This avoids creating accidental billing churn when the
      // deletion was intended to only exercise the privacy right (testing,
      // accidental click, demo exploration). The user explicitly cancels
      // via /api/portal before deletion if they want immediate effect.
      const body = await req.json().catch(() => ({}));
      // Confirm phrase gate to prevent fat-finger deletes from the UI.
      // We require the literal Swedish phrase "RADERA MITT KONTO" to be
      // typed into the dedicated input (see /settings UI). Any mismatch is
      // rejected with 400 — enforced BEFORE the no-profile short circuit so
      // the contract is "confirm-required even for already-empty accounts".
      if (body.confirm !== 'RADERA MITT KONTO') {
        return NextResponse.json(
          { error: 'Skriv exakt "RADERA MITT KONTO" för att bekräfta raderingen.' },
          { status: 400 },
        );
      }
      const profile = await db.collection('profiles').findOne({ clerkId });
      if (!profile) {
        // Idempotent: deleting an already-empty account is a no-op success.
        return NextResponse.json({ ok: true, deleted: { profile: 0 } });
      }
      const [apps, push, dismissals, logs] = await Promise.all([
        db.collection('applications').deleteMany({ clerkId }),
        db.collection('push_subscriptions').deleteMany({ clerkId }),
        db.collection('push_dismissals').deleteMany({ clerkId }),
        db.collection('cron_logs').deleteMany({ clerkId }),
      ]);
      await db.collection('profiles').deleteOne({ clerkId });
      // Audit trail: a tombstone record (no PII, only clerkId + timestamp)
      // so we can spot suspicious mass-deletion patterns later. Created
      // here in case account_deletions doesn't exist yet — Mongo creates
      // collections lazily on first write.
      await db.collection('account_deletions').insertOne({
        clerkId,
        deletedAt: new Date(),
        hadActiveSubscription:
          profile.subscriptionStatus === 'active' || profile.subscriptionStatus === 'trialing',
        hadStripeCustomer: !!profile.stripeCustomerId,
      });
      return NextResponse.json({
        ok: true,
        deleted: {
          profile: 1,
          applications: apps.deletedCount,
          pushSubscriptions: push.deletedCount,
          pushDismissals: dismissals.deletedCount,
          cronLogs: logs.deletedCount,
        },
      });
    }


    if (path === 'checkout') {
      const body = await req.json();
      const { tier, interval } = body; // tier: 'Basic'|'Professional'|'Elite', interval: 'month'|'year'
      const priceId = PRICE_MAP[`${tier}:${interval}`];
      if (!priceId) return NextResponse.json({ error: 'Invalid tier/interval' }, { status: 400 });

      // Look up existing customer if any
      const profile = await db.collection('profiles').findOne({ clerkId });
      const origin = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;

      const sessionParams = {
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?checkout=cancelled#priser`,
        client_reference_id: clerkId,
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { clerkId, tier },
          trial_period_days: (tier !== 'Basic') ? 14 : undefined,
        },
        metadata: { clerkId, tier },
      };
      if (profile?.stripeCustomerId) {
        sessionParams.customer = profile.stripeCustomerId;
      } else if (profile?.email) {
        sessionParams.customer_email = profile.email;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      return NextResponse.json({ url: session.url });
    }

    if (path === 'portal') {
      const profile = await db.collection('profiles').findOne({ clerkId });
      if (!profile?.stripeCustomerId) {
        return NextResponse.json({ error: 'Ingen aktiv prenumeration' }, { status: 400 });
      }
      const origin = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripeCustomerId,
        return_url: `${origin}/dashboard`,
      });
      return NextResponse.json({ url: session.url });
    }

    if (path === 'push-subscribe') {
      const body = await req.json();
      const { subscription } = body;
      if (!subscription || !subscription.endpoint) {
        return NextResponse.json({ error: 'No subscription provided' }, { status: 400 });
      }
      await db.collection('push_subscriptions').updateOne(
        { clerkId },
        {
          $set: {
            clerkId,
            subscription,
            endpoint: subscription.endpoint,
            active: true,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
      return NextResponse.json({ ok: true, active: true });
    }

    if (path === 'push-unsubscribe') {
      await db.collection('push_subscriptions').updateOne(
        { clerkId },
        { $set: { active: false, updatedAt: new Date() } }
      );
      return NextResponse.json({ ok: true, active: false });
    }

    if (path === 'push-dismiss') {
      const body = await req.json().catch(() => ({}));
      await db.collection('push_dismissals').insertOne({
        clerkId,
        jobId: body.jobId || null,
        dismissedAt: new Date(),
      });
      return NextResponse.json({ ok: true });
    }

    if (path === 'notify') {
      const body = await req.json();
      const { jobId, company, title } = body;
      const payload = buildJobMatchPayload({ jobId, company, title });
      const result = await broadcastPush(db, payload);
      if (result.skipped) {
        return NextResponse.json({ ok: true, sent: 0, total: 0, skipped: result.skipped });
      }
      return NextResponse.json({ ok: true, sent: result.sent, total: result.total, deactivated: result.deactivated });
    }

    if (path === 'toggle-saved') {
      // Toggle the `saved` boolean on an application. Used by the Ansökningar
      // table star icon. If `saved` is provided, set explicitly; otherwise flip.
      const body = await req.json().catch(() => ({}));
      const { applicationId, saved } = body;
      if (!applicationId) {
        return NextResponse.json({ error: 'applicationId required' }, { status: 400 });
      }

      // Round-46 / Followup 3 (2026-07-20 audit): the 404 below
      // is for the APPLICATION row, NOT the profile. The profile
      // is fetched separately downstream via requireCompleteProfile()
      // once the application is confirmed to exist + belong to
      // the caller. NOT migrated to the helper here — the lookup
      // is by applicationId+clerkId (composite), not clerkId.
      const existing = await db.collection('applications').findOne({ id: applicationId, clerkId });
      if (!existing) {
        return NextResponse.json({ error: 'Application not found' }, { status: 404 });
      }

      const nextSaved = typeof saved === 'boolean' ? saved : !existing.saved;
      await db.collection('applications').updateOne(
        { id: applicationId, clerkId },
        { $set: { saved: nextSaved, savedAt: nextSaved ? new Date() : null } },
      );

      return NextResponse.json({ ok: true, saved: nextSaved });
    }

    if (path === 'mark-applied') {
      const body = await req.json();
      const { applicationId } = body;
      if (!applicationId) return NextResponse.json({ error: 'applicationId required' }, { status: 400 });
      // Persist the user's "I actually applied to this" signal as status='applied'.
      // The dashboard "Ansökta" filter treats 'applied' (and the legacy
      // 'user-sent' / 'confirmed' values) as the same bucket for back-compat.
      // `appliedAt` is the canonical "Ansökningsdatum" used by the
      // Aktivitetsrapport PDF column (see generateAktivitetsrapport); we
      // also keep the legacy `userSentAt` write so any older client that
      // still reads it continues to work. New code should prefer
      // `appliedAt` — it is the contract going forward.
      const result = await db.collection('applications').updateOne(
        { id: applicationId, clerkId },
        { $set: { status: 'applied', appliedAt: new Date(), userSentAt: new Date() } }
      );
      if (result.matchedCount === 0) return NextResponse.json({ error: 'Application not found' }, { status: 404 });
      return NextResponse.json({ ok: true, status: 'applied' });
    }

    if (path === 'regenerate-cover-letter') {
      // Re-runs the Groq cover-letter generator for an existing application
      // and persists the new letter back to MongoDB. The dashboard modal
      // uses this when the user wants a different AI-generated letter.
      const body = await req.json().catch(() => ({}));
      const { applicationId } = body;
      if (!applicationId) {
        return NextResponse.json({ error: 'applicationId required' }, { status: 400 });
      }

      const application = await db.collection('applications').findOne({ id: applicationId, clerkId });
      if (!application) {
        return NextResponse.json({ error: 'Application not found' }, { status: 404 });
      }

  // Round-46 / Followup 3 (2026-07-20 audit): the literal
  // "Profile missing" 404 above diverged from the canonical
  // requireCompleteProfile() helper used by the other 6+ endpoints
  // (email-preview, extension/token, extension/email-body,
  // extension/answer, extension/ai-answers, cv-pdf, email-draft).
  // Migrated so the dashboard sees the same Swedish error string
  // ("Profil hittades inte – slutför /onboarding först. (Saknade
  // fullständigt namn och e-post.)") and the empty-but-saved
  // profile (only `_id` + `clerkId`) is treated as incomplete
  // via isProfileComplete rather than silently accepting it.
  const lookedUp = await requireCompleteProfile(db, clerkId);
  if (lookedUp.error) return lookedUp.error;
  const profile = lookedUp.profile;

      const coverLetter = await generateCoverLetter({
        jobTitle: application.title,
        company: application.company,
        profile,
      });

      await db.collection('applications').updateOne(
        { id: applicationId, clerkId },
        { $set: { coverLetter, coverLetterUpdatedAt: new Date() } }
      );

      return NextResponse.json({ ok: true, coverLetter });
    }

    if (path === 'mark-confirmed') {
      const body = await req.json();
      const { applicationId, employerResponse } = body;
      if (!applicationId) return NextResponse.json({ error: 'applicationId required' }, { status: 400 });
      // Fetch the existing doc so we can preserve `appliedAt` (or fall
      // back to the legacy `userSentAt`) for the Aktivitetsrapport
      // "Ansökningsdatum" column when the user skips the intermediate
      // "applied" step (e.g. they got an answer before opening the
      // dashboard). `existing` may legitimately be null — Mongo just
      // returns null for a `findOne` miss — in which case we fall back
      // to `now` so the column is never blank.
      const existing = await db.collection('applications').findOne(
        { id: applicationId, clerkId },
        { projection: { appliedAt: 1, userSentAt: 1 } },
      )
      const appliedAt = existing?.appliedAt || existing?.userSentAt || new Date()
      const result = await db.collection('applications').updateOne(
        { id: applicationId, clerkId },
        { $set: { status: 'confirmed', employerResponse: employerResponse || '', confirmedAt: new Date(), appliedAt } }
      );
      if (result.matchedCount === 0) return NextResponse.json({ error: 'Application not found' }, { status: 404 });
      return NextResponse.json({ ok: true, status: 'confirmed' });
    }

    if (path === 'apply-now') {
      // Round-46 / Followup 3 (2026-07-20 Monday audit): the prior
      // literal `'Profil saknas'` diverged from the canonical
      // `requireCompleteProfile()` helper used by the other 7
      // endpoints in this file + the 5 sibling endpoints in
      // /api/extension/*. Migrated to the helper so the soft-launch
      // tester sees a consistent Swedish 404 message and the
      // empty-but-saved profile (only `_id` + `clerkId`) is treated
      // as "complete enough" via isProfileComplete() rather than
      // silently failing first-save UX.
      const lookup = await requireCompleteProfile(db, clerkId);
      if (lookup.error) return lookup.error;
      const profile = lookup.profile;

      const body = await req.json().catch(() => ({}));
      // Round-58 / Bug 2 followup — accept EITHER `jobUrl` (canonical,
      // matches the schema field on the application document) or `url`
      // (legacy, what the dashboard used to send before this round).
      // Canonical-key-first read order means the dashboard can rename
      // its field across deploys without a server-side coordinated
      // cutover. The same dual-read pattern is applied to `externalId`
      // (dashboard now sends it explicitly so Blocket / Ledigajobb
      // jobs don't have to fall through to the profile-based re-search).
      const { jobId, company, title, location, description, source } = body;
      const candidateUrl = body.jobUrl || body.url || null;
      const candidateExternalId = body.externalId != null ? String(body.externalId) : null;

      let job;

      // Round-58 / Bug 2 — the trusted-body branch. Whenever the
      // payload's jobId carries a known source prefix AND the body
      // has enough data to commit a 1:1 application record, write
      // it without touching the AF search waterfall. The PRE-Round-58
      // code unconditionally fell into the else branch for any
      // jobId that did NOT start with `af-` — Blocket (`blocket-…`)
      // and Ledigajobb (`ledigajobb-…`) entries silently overwrote
      // the user-clicked job with a re-searched AF job matching
      // the user's profile.jobTitles, and fell back to a
      // SAMPLE_JOBS row (no externalId / no jobUrl) which dropped
      // the modal into the Google-search Tier-3 fallback.
      //
      // The gate fires when (a) the jobId prefix is recognised, AND
      // (b) the body has a non-empty title AND either a jobUrl OR
      // an externalId. Missing-both is a "too thin to trust" signal
      // and falls through to the re-search + sample path so a future
      // scraper that ships a body without URL/identifier can't
      // silently lose the 1:1 contract.
      const isKnownSource = typeof jobId === 'string' && (
        jobId.startsWith('af-') ||
        jobId.startsWith('blocket-') ||
        jobId.startsWith('ledigajobb-')
      )
      if (isKnownSource) {
        // For `af-<id>` style ids, parse externalId from the prefix
        // when the body didn't send one (Blocket / Ledigajobb entries
        // fall into this with their own externalId). The body value
        // wins so a future scraper can override the prefix-derived
        // id without breaking the contract.
        const parsedExternalId = jobId.startsWith('af-')
          ? jobId.slice(3)
          : candidateExternalId
        const bodyUrl = candidateUrl || null
        const canTrustBody = (typeof title === 'string' && title.trim().length > 0)
          && (bodyUrl || parsedExternalId)
        if (canTrustBody) {
          job = {
            id: jobId,
            externalId: parsedExternalId,
            company: company || 'Okänd arbetsgivare',
            title: title || 'Okänd titel',
            location: location || 'Okänd ort',
            description: description || '',
            source: source || 'Arbetsförmedlingen',
            url: bodyUrl,
          }
        }
        // Fall-through: thin body → re-search branch below enriches it.
      }
      // Legacy `af-…` branch — only fires if the trusted-body branch
      // above didn't claim the request. The dual-write to application
      // schema (jobUrl + externalId) happens at the bottom of the
      // handler so this branch's behaviour is unchanged from before.
      if (!job && jobId && jobId.startsWith('af-')) {
        job = {
          id: jobId,
          externalId: jobId.slice(3),
          company: company || 'Okänd arbetsgivare',
          title: title || 'Okänd titel',
          location: location || 'Okänd ort',
          description: description || '',
          source: source || 'Arbetsförmedlingen',
          url: candidateUrl || null,
        };
      }
      if (!job) {
        // No specific jobId was sent (e.g. the dashboard hero CTA
        // "Kör AI-assistenten nu" without picking a card). Try to find a
        // REAL AF job matching the user's profile before reaching for a
        // sample — bug #1 was that the modal always opened with a
        // sample job, which has no real `url` or `externalId`, so the
        // job-link button silently fell back to Google search even when
        // Platsbanken would have been reachable for an AF job.
        const already = await db.collection('applications').find({ clerkId }).project({ company: 1, title: 1 }).toArray();
        const usedKeys = new Set(already.map(a => `${a.company}|${a.title}`));
        let realPicked = null;
        try {
          const query = (profile.jobTitles || []).slice(0, 2).join(' ');
          const locationqs = (profile.locations || []).slice(0, 1).join(', ');
          const realJobs = await searchJobs({ query, location: locationqs, limit: 5 });
          const candidates = (realJobs || []).filter(j => !usedKeys.has(`${j.company}|${j.title}`));
          if (candidates.length > 0) {
            realPicked = candidates[0];
          }
        } catch (e) {
          // Scrapers can fail on flaky network — keep the sample fallback
          // so the user always sees SOMETHING.
          console.warn('[apply-now] real AF scrape failed, falling back to sample:', e.message);
        }

        if (realPicked) {
          // Convert AF searchJobs format (already in our internal map shape)
          // into the `job` shape: keep `id` as the raw AF id so the modal
          // build path below prefixes it back via the upstream branch when
          // needed. Stash the `externalId` so the dashboard can build a
          // Platsbanken fallback even if AF returned no direct application
          // link. We deliberately do NOT prefix with `af-` here because
          // eval-time path (above) only triggers when the caller explicitly
          // passes a `jobId` starting with `af-` — preserving the real
          // searchJobs mapping keeps `externalId` intact.
          job = {
            id: realPicked.id,
            externalId: realPicked.externalId || null,
            company: realPicked.company,
            title: realPicked.title,
            location: realPicked.location,
            description: realPicked.description || '',
            source: realPicked.source || 'Arbetsförmedlingen',
            url: realPicked.url || null,
          };
        } else {
          // No real jobs match the profile (or AF was unreachable). Original
          // sample-pool behavior — preserved for the demo flow when
          // /api/jobs-available has nothing to show. Note that samples
          // intentionally do NOT carry `externalId` / `url`, so the modal
          // button will fall through to “Sök jobbet” (Google search). This
          // is the documented, expected behavior.
          const available = SAMPLE_JOBS.filter(j => !usedKeys.has(`${j.company}|${j.title}`));
          job = available.length > 0 ? pickRandom(available, 1)[0] : pickRandom(SAMPLE_JOBS, 1)[0];
        }
      }

      const coverLetter = await generateCoverLetter({ jobTitle: job.title, company: job.company, profile });

      // Round-58 / Followup 2 — when the resolved job has NEITHER a
      // direct URL NOR an externalId, the dashboard's
      // resolveApplicationUrl() 3-tier chain falls through to the
      // Tier-3 Google-search branch ("Sök jobbet → Google"). This
      // fires for:
      //   (a) SAMPLE_JOBS-derived rows (the "Kör AI-assistenten nu"
      //       hero CTA path with no real AF matches available)
      //   (b) Re-searched AF jobs that returned a hit without an
      //       application link (older AF payloads pre-mid-2025)
      // Instead of letting the dashboard Tier-3 fire, synthesize a
      // Blocket Jobb search URL from the user's profile.jobTitles[0]
      // + profile.locations[0] and attach it to job.url so Tier-1
      // (`app.jobUrl`) catches the destination directly. The user's
      // spec was "NEVER show generic Google search if we can use a
      // per-source search" — keeping sample jobs usable without
      // exposing Tier-3.
      //
      // Cost: a single buildBlocketSearchUrl() call (cheap string
      // build, no network). Profile preferences are user-controlled
      // so the search query stays inside the user's domain.
      if (!job.url && !job.externalId) {
        const profileFirstTitle = (profile.jobTitles || [])[0] || ''
        const profileFirstLocation = (profile.locations || [])[0] || ''
        if (profileFirstTitle || profileFirstLocation) {
          job.url = buildBlocketSearchUrl({
            query: profileFirstTitle,
            location: profileFirstLocation,
          })
        }
      }

      const application = {
        id: randomUUID(),
        clerkId,
        userId: profile.userId,
        company: job.company,
        title: job.title,
        location: job.location,
        source: job.source || 'Arbetsförmedlingen',
        description: job.description || '',
        coverLetter,
        jobUrl: job.url || null,
        // Preserve the raw AF job id so the dashboard can construct a
        // Platsbanken fallback URL (https://arbetsformedlingen.se/platsbanken/annonser/<id>)
        // when the scraper couldn't resolve a direct application link.
        externalId: job.externalId || null,
        status: 'prepared',
        appliedAt: new Date(),
        method: 'AI-assistent (förberedd)',
      };
      await db.collection('applications').insertOne(application);
      const { _id, ...clean } = application;
      return NextResponse.json({ ok: true, application: clean });
    }

    // ---------- Public landing stats (Round-34) ----------
    // Soft-launch stats — no auth required, aggregate across all
    // profiles + applications. Backed by `db.profiles.countDocuments({})`
    // Round-74 fix: this block was MOVED to the public endpoints
    // section at the top of the GET handler (it was previously
    // inlined here, after the auth gate, which made the landing-page
    // widget return 401 for unauth visitors). The Round-74
    // structural tests in tests/unit/public-stats.test.mjs lock the
    // new position so a future re-ordering regression fails loudly.

    // Round-38 hotfix: the `applications/email` POST endpoint was
    // previously inlined here but referenced three helpers
    // (`safeJsonBody`, `resolveUserId`, `stripInternal`) that are NOT
    // defined in this module. Next.js App Router file-based routing
    // prefers the more-specific literal route at
    // `app/api/applications/email/route.js`, so the inline branch
    // was never reachable in practice — but the dead code with
    // undefined function references was a footgun for future
    // maintainers (e.g. a routing-priority bump during a future refactor
    // would have produced a runtime ReferenceError). Removed entirely.
    //
    // CANONICAL POST HANDLER: app/api/applications/email/route.js
    // A grep for `'applications/email'` should lead readers there; if
    // you copy-paste the pattern back into the catch-all, the route
    // resolution will silently prefer this stub (returned below) and
    // the popup's POSTs will 404.

    return NextResponse.json({ error: 'Not found', path }, { status: 404 });
  } catch (err) {
    console.error('POST error', path, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ================================================================
// Helpers
// ================================================================

function fallbackCoverLetter(profile, job) {
  const titles = (profile.jobTitles || []).join(', ') || 'mitt område';
  const summary = profile.cvSummary ? profile.cvSummary.trim() : '';
  const name = profile.fullName || 'Kandidaten';

  const desc = (job.description || '').toLowerCase();
  const keywords = [];
  const keywordPool = ['react','typescript','node.js','python','java','kotlin','kubernetes','aws','ux','design','agile','scrum','sql','graphql','android','ios','sales','marketing','coaching','support','projektledning','säkerhet','data','analys'];
  for (const kw of keywordPool) {
    if (desc.includes(kw)) keywords.push(kw);
    if (keywords.length >= 2) break;
  }
  const keywordPhrase = keywords.length
    ? `Er beskrivning nämner ${keywords.join(' och ')}, vilket ligger nära min vardag.`
    : `Rollens fokus stämmer väl med min bakgrund och drivkrafter.`;

  const openings = [
    `Hej ${job.company}!\n\nDet var med stor entusiasm jag såg att ni söker en ${job.title} i ${job.location}.`,
    `Hej,\n\nJag såg er annons för ${job.title} hos ${job.company} och vill gärna presentera mig.`,
    `Hej ${job.company}-team,\n\nRollen som ${job.title} fångade genast mitt intresse — både företaget och uppdraget känns som en perfekt matchning.`,
  ];
  const middles = [
    `Med bakgrund som ${profile.experience} inom ${titles} har jag byggt en solid grund i just de områden ni efterfrågar. ${keywordPhrase}`,
    `Jag är ${profile.experience} inom ${titles} och trivs bäst där resultat och samarbete går hand i hand. ${keywordPhrase}`,
    `Som ${profile.experience} med inriktning mot ${titles} har jag arbetat i team som liknar ert. ${keywordPhrase}`,
  ];
  const summaryLine = summary ? `\n\nKort om mig: ${summary}` : '';
  const closings = [
    `Jag skulle uppskatta ett samtal för att berätta mer om hur jag kan bidra hos ${job.company}.`,
    `Jag ser fram emot att få höra mer om rollen och gärna berätta hur jag kan tillföra värde till ert team.`,
    `Låt oss gärna ta ett samtal — jag är övertygad om att vi har mycket att prata om.`,
  ];

  const pickIdx = (job.company.length + job.title.length) % 3;
  return `${openings[pickIdx]}\n\n${middles[pickIdx]}${summaryLine}\n\n${closings[pickIdx]}\n\nMed vänliga hälsningar,\n${name}`;
}

async function seedApplications(db, clerkId) {
  const profile = await db.collection('profiles').findOne({ clerkId });
  const userId = profile?.userId || randomUUID();
  const jobs = pickRandom(SAMPLE_JOBS, 12);
  const now = new Date();
  const docs = jobs.map((job, i) => {
    const daysAgo = i + 1;
    const appliedAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return {
      id: randomUUID(),
      clerkId,
      userId,
      company: job.company,
      title: job.title,
      location: job.location,
      source: job.source,
      description: job.description,
      coverLetter: fallbackCoverLetter(profile || { fullName: 'Kandidat', experience: 'Medior', jobTitles: [] }, job),
      // Seeded apps start at 'prepared' — user advances to 'applied' via /api/mark-applied
      // (or to 'confirmed' via /api/mark-confirmed). The previous STATUSES-array pattern was
      // removed because (a) all entries were identical so the random sampling had no effect
      // and (b) the `* 3` length made index 3 of the 4-element array unreachable.
      status: 'prepared',
      appliedAt,
      method: 'AI-automatisk ansökan',
    };
  });
  await db.collection('applications').insertMany(docs);
}
