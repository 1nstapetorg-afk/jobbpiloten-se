#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.." 
PORT="${PORT:-3000}"
BASE="http://localhost:$PORT"
echo "=== KILL_DEV ==="
pkill -9 -f 'next dev' 2>/dev/null || true
sleep 3
echo "=== START_DEV ==="
( timeout 60 yarn dev > /tmp/dev-repro.log 2>&1 & ) 
sleep 20
for path in / /sign-in; do c=$(curl -sS --max-time 8 -o /tmp/r.html -w '%{http_code}' "$BASE$path"); echo "$path => $c"; done
echo "=== CURL_DASHBOARD ==="
code=$(curl -sS --max-time 8 -o /tmp/d.html -w '%{http_code}|%{redirect_url}' "$BASE/dashboard")
echo "dashboard => $code"
echo "=== CURL_5XX_SCAN ==="
for path in / /dashboard /sign-in /onboarding /settings; do c=$(curl -sS --max-time 8 -o /tmp/x.html -w '%{http_code}' "$BASE$path"); echo "$path => $c"; done
echo "=== KILL_DEV_AFTER ==="
pkill -9 -f 'next dev' 2>/dev/null || true
