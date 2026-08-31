// tests/unit/round88-extension-connect-fix.test.mjs
//
// Round-88 — locks the "Anslut till profil" connection fix for
// Clerk-configured non-production environments.
//
// Background (2026-08-06, tester report "clicking Anslut till profil
// fails to connect"): the /extension-auth bridge page rendered ONLY the
// Clerk SignIn widget when Clerk keys were configured — the demo
// "Logga in som demo-användare" button was hidden, useUser() ignored
// localStorage.demoUser in Clerk mode, and signInDemo never set the
// demoUserId cookie (DemoAuthProvider's cookie re-bootstrap only runs
// when Clerk keys are absent). A tester without a Clerk account was
// stuck at SIGN_IN forever. Round-85 already made the SERVER accept
// the demo identity in non-production even with Clerk configured
// (lib/auth.js demo fallback + middleware pass-through); this round
// closes the client-side half of that model:
//   • /extension-auth SignInBlock offers the demo button in any
//     non-production env (production stays strict Clerk-only).
//   • signInDemo() writes the demoUserId cookie + the
//     jobbpiloten_forceDemo localStorage flag.
//   • hooks/useAuth.js useUser() honors the force-demo flag when
//     Clerk yields NO session (a real Clerk session always wins).
//   • Background/content/popup log each hop of the handshake for
//     future debugging.
//
// Static-source-grep tests, mirroring the project-wide idiom
// (popup-handshake.test.mjs). The behavioural E2E coverage lives in
// tests/e2e/extension-auth-handshake.spec.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const EXT_AUTH = fs.readFileSync(path.join(ROOT, 'app', 'extension-auth', 'page.js'), 'utf8')
const USE_AUTH = fs.readFileSync(path.join(ROOT, 'hooks', 'useAuth.js'), 'utf8')
const POPUP = fs.readFileSync(path.join(ROOT, 'extension', 'popup.js'), 'utf8')
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'extension', 'background.js'), 'utf8')
const CONTENT = fs.readFileSync(path.join(ROOT, 'extension', 'content.js'), 'utf8')

// =============================================================================
// 1. /extension-auth — demo button available in non-production Clerk mode
// =============================================================================

test('Round-88: SignInBlock offers the demo button in non-production Clerk mode', () => {
  assert.ok(
    EXT_AUTH.includes("process.env.NODE_ENV !== 'production'"),
    'SignInBlock must gate the demo button on non-production (production stays strict Clerk-only)',
  )
  assert.ok(
    /const showDemo = !isClerkConfigured\(\) \|\| process\.env\.NODE_ENV !== 'production'/.test(EXT_AUTH),
    'showDemo must be true when Clerk is NOT configured OR when running outside production',
  )
})

test('Round-88: Clerk-mode branch renders the demo button when showDemo', () => {
  // The Clerk-mode <div data-testid="ea-signin"> branch must contain
  // the demo button element guarded by {showDemo && (…)} so a
  // Clerk-keyed dev/staging env is not widget-only.
  assert.ok(
    EXT_AUTH.includes('{showDemo && ('),
    'Clerk-mode branch must conditionally render the demo button',
  )
  assert.ok(
    EXT_AUTH.includes('data-testid="ea-demo-signin-btn"'),
    'demo button testid must remain present',
  )
})

// =============================================================================
// 2. signInDemo — writes the demo cookie + force-demo flag
// =============================================================================

test('Round-88: signInDemo sets the demoUserId cookie via setDemoSessionCookie', () => {
  assert.ok(
    EXT_AUTH.includes("import { setDemoSessionCookie } from '@/lib/auth-cookie'"),
    'extension-auth must import the shared cookie helper (single source of truth for TTL/SameSite)',
  )
  assert.ok(
    EXT_AUTH.includes('setDemoSessionCookie(demoUser.id)'),
    'signInDemo must write the demo cookie so POST /api/extension/token can authenticate server-side',
  )
})

test('Round-88: signInDemo sets the jobbpiloten_forceDemo flag', () => {
  assert.ok(
    EXT_AUTH.includes("localStorage.setItem('jobbpiloten_forceDemo', '1')"),
    'signInDemo must set the force-demo flag consumed by hooks/useAuth.js',
  )
})

// =============================================================================
// 3. hooks/useAuth.js — force-demo fallback (non-production only, Clerk wins)
// =============================================================================

test('Round-88: useAuth.js declares the FORCE_DEMO_KEY constant', () => {
  assert.ok(
    USE_AUTH.includes("const FORCE_DEMO_KEY = 'jobbpiloten_forceDemo'"),
    'useAuth.js must centralise the force-demo localStorage key',
  )
})

test('Round-88: useUser returns the demo user only when Clerk yields no session', () => {
  const clerkWins = USE_AUTH.indexOf('if (clerkUser.user) return clerkUser;')
  const forceDemo = USE_AUTH.indexOf('if (forceDemoUser) return')
  assert.ok(clerkWins > -1, 'a real Clerk session must always win')
  assert.ok(forceDemo > -1, 'force-demo fallback must exist')
  assert.ok(
    forceDemo > clerkWins,
    'Clerk session check must come BEFORE the force-demo fallback (stale demo flag must never shadow a signed-in Clerk user)',
  )
})

test('Round-88: useUser force-demo path is production-gated', () => {
  assert.ok(
    USE_AUTH.includes("if (process.env.NODE_ENV === 'production') return null;"),
    'the force-demo initialiser must be a no-op in production',
  )
})

// =============================================================================
// 4. Handshake observability (popup → background → content)
// =============================================================================

test('Round-88: background.js logs the auth-sync broadcast', () => {
  assert.ok(
    BACKGROUND.includes("console.info('[jobbpiloten bg] broadcast auth-sync'"),
    'background must log the dashboard→content broadcast (counts only, never the token)',
  )
  assert.ok(
    BACKGROUND.includes('delivered'),
    'broadcast log must include the delivered-tab count for the connect-flow trace',
  )
})

test('Round-88: content.js logs auth-sync receipt without leaking the token', () => {
  assert.ok(
    CONTENT.includes("console.info('[JobbPiloten ext] received auth-sync'"),
    'content script must log the auth-sync receipt (devtools trace)',
  )
  assert.ok(
    CONTENT.includes('hasToken: !!payload.token'),
    'the log must only record token PRESENCE, never the token itself',
  )
})

test('Round-88: popup.js logs handshake receiver mount + receipt', () => {
  assert.ok(
    POPUP.includes('auth-handshake receiver mounted (Round-88 trace)'),
    'popup must log that the handshake listener is mounted (proves the popup is listening)',
  )
  assert.ok(
    POPUP.includes("console.info('[jobbpiloten popup] handshake received'"),
    'popup must log handshake receipt with origin + ok flag',
  )
})
