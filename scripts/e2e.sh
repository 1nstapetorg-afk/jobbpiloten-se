#!/usr/bin/env bash
# scripts/e2e.sh — Round-88 / Priority-2 #7: the E2E env contract.
#
# PROBLEM: the Playwright suite only runs green under a specific env
# shape, and `yarn test:e2e` alone silently hits the REAL Groq API:
#   • The demo-cookie / auth-contract specs require a DEMO-MODE app
#     (Clerk keys blanked) — a Clerk-keyed dev build renders Clerk's
#     own sign-in paths, which the demo suite is not written for.
#   • Without SKIP_LLM_E2E=true, every LLM-touching spec burns Groq
#     quota (Round-87: the mejlutkast 429 test fired 20 sequential
#     real /api/email-draft calls; with the TPD quota exhausted each
#     waited on the fail-fast, blowing the 60s timeout).
#
# This wrapper is the ONE sanctioned way to run the suite for CI /
# full-suite verification. It sets the contract env, then delegates
# to the same `playwright test --workers=1` command that
# `test:e2e:ci` always ran — so behaviour is identical to the
# documented single-worker CI mode, minus the footguns.
#
# HOW IT WORKS:
#   • SKIP_LLM_E2E=true  → lib/groq.js#isLlmMockMode() short-circuits
#     every LLM call to deterministic local mock text. playwright.config.js
#     forwards this var to the webServer subprocess env (Round-87),
#     so the NEXT_DEV server that the suite boots is also in mock mode.
#   • NODE_ENV=test      → runner-process non-production context
#     (belt-and-braces with the mock gate; `next dev` forces
#     development for the webServer itself, which is fine — the
#     SKIP_LLM_E2E flag is the operative mechanism).
#   • Clerk keys blanked → `export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=`
#     + `export CLERK_SECRET_KEY=`. Next.js env precedence: values
#     already in process.env WIN over .env files, so these empty
#     exports override a developer's real .env keys at runtime and
#     the app boots in demo mode (isClerkConfiguredServer() →
#     false → middleware + auth fall back to demo identity), exactly
#     like a fresh clone with no .env.
#
# USAGE
#   yarn test:e2e:ci        # the intended entrypoint
#   bash scripts/e2e.sh     # same thing, directly
#   PORT=3001 yarn test:e2e:ci   # PORT-aware like plain test:e2e

set -uo pipefail

cd "$(dirname "$0")/.."

export SKIP_LLM_E2E=true
export NODE_ENV=test
# Blank Clerk keys so the suite boots in demo mode regardless of the
# developer's local .env (see header comment for the precedence note).
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
export CLERK_SECRET_KEY=

echo "[e2e.sh] SKIP_LLM_E2E=true (LLM mocked), NODE_ENV=test, Clerk keys blanked (demo mode) — starting suite..."
exec yarn playwright test --workers=1
