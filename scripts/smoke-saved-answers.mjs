#!/usr/bin/env node
// scripts/smoke-saved-answers.mjs
//
// Round-38 / Part 2 — Memory-first extension flow smoke.
//
// Validates the Jaccard similarity retrieval end-to-end against a
// running dev server. The smoke:
//   1. Mints a fresh extension token via /api/extension/token
//      (sets the demoUserId cookie via the seeded demo flow).
//   2. POSTs a whyThisRole answer to /api/saved-answers.
//   3. POSTs the same question to /api/extension/answer.
//   4. Asserts the response carries `source: 'memory'` (not 'groq').
//   5. POSTs a totally-unrelated question; asserts the response
//      falls through to 'groq' (or 'fallback' if no key configured).
//   6. Cleans up — DELETE the saved answer.
//
// Usage:
//   PORT=3001 node scripts/smoke-saved-answers.mjs
//
// The script is fail-fast: any assertion failure exits with code 1
// and prints the failing step so a CI run can grep the log line.
// Output is a single line of JSON for the happy path so a future
// e2e can consume the result without parsing human prose.

const BASE = process.env.SMOKE_BASE_URL || `http://localhost:${process.env.PORT || 3000}`

const QUESTION = 'Varför vill du jobba som frontend-utvecklare på Spotify?'
const ANSWER = 'Jag har byggt webbapplikationer i sju år och trivs bäst där jag kan äga hela kedjan — från typografi till prestandaoptimering. Spotifys produktkultur matchar det.'

// Similar question that SHOULD trigger the memory match (Jaccard >= 0.7).
const SIMILAR_QUESTION = 'Varför vill du jobba som frontend-utvecklare på Spotify?'

// Unrelated question that MUST NOT match.
const UNRELATED_QUESTION = 'Vad är din största styrka som säljare?'

function log(stage, payload) {
  console.error(`[smoke-saved-answers] ${stage}:`, typeof payload === 'string' ? payload : JSON.stringify(payload))
}

async function fetchWithCookie(url, opts = {}) {
  return await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
}

async function main() {
  // The demo-mode auth cookie is the SAME for every call in this
  // smoke (seed, cleanup, mint-token). The /api/extension/answer
  // match steps use the Bearer token (canonical for the extension
  // contract) but everything else is just the demo cookie.
  // The token response does NOT set a Set-Cookie header — it returns
  // the token in the JSON body — so the pre-Round-40.1 code that
  // read `set-cookie` from the token response always got an empty
  // string, which made the seed + cleanup calls 401. The literal
  // `demoUserId=demo-user-001` is the canonical demo clerkId used
  // everywhere (lib/auth.js → getDemoUser, tests/e2e/_helpers/
  // seedDemoUser.js DEMO_PROFILE_PAYLOAD, etc.).
  const DEMO_COOKIE = 'demoUserId=demo-user-001'

  // ---- 1. Mint a token via the demo-seeded endpoint ----
  // The route requires the demoUserId cookie (or Clerk) — see
  // lib/auth.js → getDemoUserId. We send the cookie (canonical path
  // used by the e2e fixture's context.addCookies). Sending both
  // cookie + header would be redundant since getDemoUserId checks
  // the header first and falls back to the cookie.
  const tokenRes = await fetchWithCookie(`${BASE}/api/extension/token`, {
    method: 'POST',
    headers: { Cookie: DEMO_COOKIE },
    body: JSON.stringify({}),
  })
  if (!tokenRes.ok) {
    log('mint-token', `HTTP ${tokenRes.status}`)
    process.exit(1)
  }
  const tokenJson = await tokenRes.json()
  const token = tokenJson?.token
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    log('mint-token', 'no 64-hex token in response')
    process.exit(1)
  }
  log('mint-token', 'ok')

  // ---- 2. Seed a saved answer for whyThisRole ----
  // Round-40 hardening (carryover #5): the seed step is wrapped in
  // an explicit try/catch so a network-level failure (ECONNREFUSED,
  // DNS, TLS handshake) aborts the smoke with a [FATAL] line that
  // CI can grep — instead of falling through into the silent
  // main().catch with a generic 'fatal' label that mixes with
  // every other failure mode. The pre-try/catch code did exit(1)
  // on a non-2xx HTTP status, but a thrown fetch (e.g. dev server
  // bound on a different port) would surface as the generic
  // catch — harder to triage in CI logs. The explicit
  // [FATAL] seed line lets a maintainer instantly know the seed
  // step (and not the match or cleanup) is the failure point.
  const seedId = 'smoke-whyRole-' + Date.now()
  let seedRes
  try {
    seedRes = await fetchWithCookie(`${BASE}/api/saved-answers`, {
      method: 'POST',
      headers: { Cookie: DEMO_COOKIE },
      body: JSON.stringify({
        id: seedId,
        field: 'whyThisRole',
        question: QUESTION,
        answer: ANSWER,
        quality: 5,
      }),
    })
  } catch (seedErr) {
    log('FATAL', `seed POST /api/saved-answers threw: ${seedErr?.message || String(seedErr)} — is yarn dev running on ${BASE}?`)
    process.exit(1)
  }
  if (!seedRes.ok) {
    const body = await seedRes.text().catch(() => '<no body>')
    log('FATAL', `seed POST /api/saved-answers returned HTTP ${seedRes.status} — ${body}`)
    process.exit(1)
  }
  log('seed', 'ok')

  // ---- 3. POST the similar question to /api/extension/answer ----
  const matchRes = await fetchWithCookie(`${BASE}/api/extension/answer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      question: SIMILAR_QUESTION,
      field: 'whyThisRole',
    }),
  })
  if (!matchRes.ok) {
    log('match', `HTTP ${matchRes.status} ${await matchRes.text()}`)
    process.exit(1)
  }
  const matchJson = await matchRes.json()
  log('match', matchJson)
  if (matchJson.source !== 'memory') {
    log('match-assertion', `expected source=memory, got source=${matchJson.source}`)
    process.exit(1)
  }
  if (matchJson.answer !== ANSWER) {
    log('match-answer-assertion', `expected answer to equal the seeded ANSWER, got a different value`)
    process.exit(1)
  }

  // ---- 4. POST an unrelated question — should fall through to groq/fallback ----
  const noMatchRes = await fetchWithCookie(`${BASE}/api/extension/answer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      question: UNRELATED_QUESTION,
      field: 'whyThisRole',
    }),
  })
  if (!noMatchRes.ok) {
    log('no-match', `HTTP ${noMatchRes.status} ${await noMatchRes.text()}`)
    process.exit(1)
  }
  const noMatchJson = await noMatchRes.json()
  log('no-match', noMatchJson)
  if (noMatchJson.source === 'memory') {
    log('no-match-assertion', 'expected source to be groq/fallback, got memory (false positive!)')
    process.exit(1)
  }

  // ---- 5. Cleanup ----
  const delRes = await fetchWithCookie(`${BASE}/api/saved-answers?id=${encodeURIComponent(seedId)}`, {
    method: 'DELETE',
    headers: { Cookie: DEMO_COOKIE },
  })
  if (!delRes.ok) {
    log('cleanup', `HTTP ${delRes.status} (non-fatal — orphan row, will be GC'd on next account-delete)`)
  } else {
    log('cleanup', 'ok')
  }

  // Final success line as JSON for downstream parsers.
  console.log(JSON.stringify({
    ok: true,
    matched: { question: SIMILAR_QUESTION, source: matchJson.source, score: matchJson.memoryScore },
    noMatch: { question: UNRELATED_QUESTION, source: noMatchJson.source },
  }))
}

main().catch((err) => {
  log('FATAL', err?.message || String(err))
  process.exit(1)
})
