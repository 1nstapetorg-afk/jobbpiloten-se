#!/usr/bin/env bash
# Round-79 hermetic regression for middleware.js Clerk-failure path.
#
# We can't unit-test middleware.js with plain `node --test` because
#   1. The `@/lib/...` import alias only resolves inside Next.js's webpack.
#   2. Module._cache mocking does NOT intercept `await import('@clerk/...')`
#      (Node's ESM loader uses a separate, read-only cache).
# Instead, we boot the real dev server with the JOBBPILOTEN_FORCE_CLERK_ERROR=1
# env var so middleware.js deterministically throws inside its try block
# regardless of whether the user's real Clerk keys are currently broken
# or valid. Then we assert via curl that:
#   - /dashboard → 307 redirect to /sign-in (NOT 500)
#   - /, /sign-in → 200 (NOT 500)
#   - No route returns 5xx
#
# Usage: bash scripts/test-middleware-clerk-failure.sh
# Requires: yarn dev to start within 25 seconds (cold-start budget).
# Exits 0 on PASS, non-zero on FAIL.

set -uo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"

cleanup() {
  pkill -9 -f 'next dev' 2>/dev/null || true
}
trap cleanup EXIT

echo "=== KILL_ANY_EXISTING_DEV ==="
pkill -9 -f 'next dev' 2>/dev/null || true
sleep 3

echo "=== START_DEV_WITH_FORCE_FLAG ==="
export JOBBPILOTEN_FORCE_CLERK_ERROR=1
( PORT="$PORT" timeout 90 yarn dev > /tmp/dev-mw-repro.log 2>&1 & )

echo "=== WAIT_FOR_READY ==="
ready=""
for i in $(seq 1 25); do
  sleep 1
  rc=$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$BASE/" 2>/dev/null || echo "000")
  if [[ "$rc" == "200" ]] || [[ "$rc" == "307" ]]; then
    ready="yes"
    echo "ready after ${i}s (rc=$rc)"
    break
  fi
done
[[ -n "$ready" ]] || { echo "FAIL: dev server never became ready"; tail -50 /tmp/dev-mw-repro.log; exit 1; }

echo "=== ASSERT_PROTECTED_DASHBOARD_REDIRECTS_TO_SIGNIN ==="
out=$(curl -sS --max-time 8 -o /tmp/d.html -w '%{http_code}|%{redirect_url}' "$BASE/dashboard")
code="${out%%|*}"
loc="${out#*|}"
echo "  /dashboard => $code  Location: $loc"
[[ "$code" == "307" || "$code" == "302" ]] || { echo "FAIL: /dashboard must be 30x, got $code"; exit 1; }
[[ "$loc" == *sign-in* ]] || { echo "FAIL: /dashboard must redirect to /sign-in, got $loc"; exit 1; }
echo "  OK: /dashboard redirected to /sign-in (Round-79 catch path works)"

echo "=== ASSERT_PUBLIC_ROUTES_PASS ==="
for path in / /sign-in; do
  c=$(curl -sS --max-time 8 -o /tmp/p.html -w '%{http_code}' "$BASE$path")
  echo "  $path => $c"
  [[ "$c" == "200" ]] || { echo "FAIL: $path should be 200, got $c"; exit 1; }
done

echo "=== ASSERT_NO_5XX_ANYWHERE ==="
for path in / /dashboard /sign-in /onboarding /settings /api/health; do
  c=$(curl -sS --max-time 8 -o /tmp/x.html -w '%{http_code}' "$BASE$path")
  echo "  $path => $c"
  if [[ "$c" =~ ^5 ]]; then
    echo "FAIL: $path returned $c (server error)"
    exit 1
  fi
done

echo "=== PASS ==="
echo "All assertions green. middleware.js correctly:"
echo "  - Catches Clerk failure (no 500 on any route)"
echo "  - Redirects protected routes to /sign-in"
echo "  - Passes public routes through unchanged"
exit 0
