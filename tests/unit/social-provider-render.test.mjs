// tests/unit/social-provider-render.test.mjs
//
// 2026-08-02 — locks the Clerk social-provider rendering contract
// (the "Google login missing" report). Root cause analysis:
//   1. The Clerk instance behind the publishable key in .env is
//      `national-swift-78.clerk.accounts.dev` (verified via the
//      Frontend API: `identification_strategies: ["oauth_google"]`,
//      `first_factors: ["oauth_google", "ticket"]` — Google is the
//      ONLY enabled sign-in strategy).
//   2. The app renders Clerk's stock <SignIn /> / <SignUp />
//      components with NO appearance/flag that could hide social
//      buttons (verified below).
//   3. middleware.js marks `/sign-in(.*)` and `/sign-up(.*)` as
//      public, so the OAuth callback is never blocked.
//   ⇒ The button renders whenever a real key is inlined (also
//     verified: the publishable key is present in the client chunks).
//   The historical breakage came from the blocklisted broken key
//   (`pk_test_ZXRlcm5hbC1waWthLTY0`, see lib/clerk-config.js) which
//   degraded the app to DEMO mode → the demo card replaced Clerk's
//   SignIn → no Google button.
//
// These structural locks prevent a future refactor from suppressing
// social providers or blocking the auth routes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SIGN_IN = readFileSync('app/sign-in/[[...sign-in]]/page.js', 'utf8')
const SIGN_UP = readFileSync('app/sign-up/[[...sign-up]]/page.js', 'utf8')
const PROVIDERS = readFileSync('app/providers.js', 'utf8')
const MIDDLEWARE = readFileSync('middleware.js', 'utf8')
const CLERK_CONFIG = readFileSync('lib/clerk-config.js', 'utf8')

test('sign-in page renders Clerk SignIn when configured (not only the demo card)', () => {
  assert.match(SIGN_IN, /setSignInComponent\(\(\)\s*=>\s*mod\.SignIn\)/, 'must lazy-load Clerk SignIn')
  assert.match(SIGN_IN, /<SignInComponent/, 'must render <SignInComponent />')
  // The demo card is a FALLBACK, gated behind the absence of Clerk.
  assert.match(
    SIGN_IN,
    /\?\s*\([\s\S]{0,300}?<SignInComponent[\s\S]{0,600}?\)\s*:\s*\([\s\S]{0,400}?Demo-inloggning/,
    'demo form must be the else-branch fallback only (Clerk SignIn is the primary branch)',
  )
})

test('sign-up page renders Clerk SignUp when configured', () => {
  assert.match(SIGN_UP, /setSignUpComponent\(\(\)\s*=>\s*mod\.SignUp\)/, 'must lazy-load Clerk SignUp')
  assert.match(SIGN_UP, /<SignUpComponent/, 'must render <SignUpComponent />')
})

test('no appearance/flag hides social provider buttons on sign-in/sign-up', () => {
  // Clerk hides social buttons only via explicit appearance flags
  // (e.g. `socialButtons: { show: false }`) or a custom layout. The
  // app passes only rootBox/card element styles — assert neither
  // page references any social-button suppression API.
  assert.doesNotMatch(SIGN_IN, /socialButtons/i, 'sign-in must not suppress social buttons')
  assert.doesNotMatch(SIGN_UP, /socialButtons/i, 'sign-up must not suppress social buttons')
})

test('ClerkProvider wires the standard signInUrl/signUpUrl (custom pages)', () => {
  assert.match(PROVIDERS, /signInUrl=/, 'ClerkProvider must set signInUrl')
  assert.match(PROVIDERS, /signUpUrl=/, 'ClerkProvider must set signUpUrl')
})

test('middleware keeps /sign-in and /sign-up (incl. OAuth callback) public', () => {
  assert.match(MIDDLEWARE, /'\/sign-in\(\.\*\)'/, 'sign-in routes must be public in the matcher')
  assert.match(MIDDLEWARE, /'\/sign-up\(\.\*\)'/, 'sign-up routes must be public in the matcher')
})

test('clerk-config still blocks the known-broken key that caused demo-mode fallback', () => {
  // This is the historical root cause: the broken `eternal-pika-64`
  // key was rejected → demo mode → no Google button. Lock the
  // blocklist entry so a stale .env can never silently re-degrade.
  assert.match(CLERK_CONFIG, /eternal-pika-64/, 'known-broken Clerk key prefix must stay blocklisted')
})
