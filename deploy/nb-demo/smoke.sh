#!/usr/bin/env bash
# Public smoke for the native NB demo through the reverse proxy (LT-575). Read-only: it signs in
# but creates no records. Usage: smoke.sh <public-origin> [operator-dir-with-settings-and-fixture]
# NB_SMOKE_CACERT=<pem> trusts a staging CA; production uses the system trust store.
set -euo pipefail
ORIGIN=${1:?public origin}
OPERATOR=${2:-}
CURL=(curl -sS --max-time 15 --proto "=https")
[ -n "${NB_SMOKE_CACERT:-}" ] && CURL+=(--cacert "$NB_SMOKE_CACERT")
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

code=$("${CURL[@]}" -o "$WORK/check" -D "$WORK/h" -w '%{http_code}' "$ORIGIN/api/check")
[ "$code" = 200 ] && grep -q '"status":"OK"' "$WORK/check" && pass "api check" || fail "api check ($code)"
grep -qi "^content-security-policy: default-src 'self'; script-src 'self' 'unsafe-eval'; " "$WORK/h" && pass "CSP header" || fail "CSP header"
grep -qi '^strict-transport-security:' "$WORK/h" && pass "HSTS header" || fail "HSTS header"
! grep -qi '^x-powered-by:' "$WORK/h" && pass "no x-powered-by" || fail "x-powered-by present"

code=$("${CURL[@]}" -o "$WORK/reading" -w '%{http_code}' "$ORIGIN/client/reading.html")
[ "$code" = 200 ] && grep -q 'src="/client/js/bundle.js"' "$WORK/reading" && pass "demo reading" || fail "demo reading ($code)"
"${CURL[@]}" -f -o "$WORK/bundle" "$ORIGIN/client/js/bundle.js"
grep -q "\"$ORIGIN\"" "$WORK/bundle" && grep -q "\"$ORIGIN/client\"" "$WORK/bundle" && ! grep -q '127\.0\.0\.1:300' "$WORK/bundle" \
  && pass "client bundle targets $ORIGIN" || fail "client bundle origin"
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$ORIGIN/")
[ "$code" = 200 ] && pass "native NB app shell" || fail "app shell ($code)"

closed() {
  local method=$1 path=$2 code location
  code=$("${CURL[@]}" -X "$method" -o /dev/null -D "$WORK/ch" -w '%{http_code}' -H 'content-type: application/json' --data-raw '{}' "$ORIGIN$path")
  location=$(grep -i '^location:' "$WORK/ch" || true)
  [ "$code" = 404 ] && [ -z "$location" ] && pass "closed $method $path" || fail "closed $method $path ($code $location)"
}
closed POST /api/users/register
closed POST /api/users/forgotpassword
closed POST /api/users/getuser
closed GET /api/users/user/00000000-0000-0000-0000-000000000000
closed GET /api/users/all
closed GET /api/admin/users
closed POST /api/email/class
closed GET /embed_NB.js
closed GET /c/1
# Express routes are not strict, so a trailing slash reaches the same handler (LT-575 review).
closed POST /api/users/register/
closed POST /api/users/forgotpassword/
closed POST /api/users/getuser/
closed GET /api/users/all/
closed GET /api/admin/
closed POST /api/email/
closed GET /embed_NB.js/
closed GET /pdf4/rpc/
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -H 'Accept: application/json' "$ORIGIN/api/annotations/myClasses?url=x")
[ "$code" = 401 ] && pass "annotations require sign-in" || fail "unauthenticated annotations ($code)"

if [ -n "$OPERATOR" ]; then
  node - "$OPERATOR" > "$WORK/login.json" <<'NODE'
const fs = require('fs'); const path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'settings.json'), 'utf8'));
const u = s.users[1];
process.stdout.write(JSON.stringify({ username: u.username, password: u.password }));
NODE
  "${CURL[@]}" -f -o "$WORK/token" -H 'content-type: application/json' --data-binary "@$WORK/login.json" "$ORIGIN/api/users/login"
  rm -f "$WORK/login.json"
  TOKEN=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token)' "$WORK/token")
  URL=$(node -e 'process.stdout.write(encodeURIComponent(require(process.argv[1]).url))' "$OPERATOR/fixture.json")
  COURSE=$(node -e 'process.stdout.write(require(process.argv[1]).courseId)' "$OPERATOR/fixture.json")
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" > "$WORK/auth"
  "${CURL[@]}" -f -K "$WORK/auth" -H 'Accept: application/json' -o "$WORK/classes" "$ORIGIN/api/annotations/myClasses?url=$URL"
  grep -q "\"$COURSE\"" "$WORK/classes" && pass "second synthetic account signs in and sees the demo course" || fail "authenticated course access"
fi
echo "Smoke passed for $ORIGIN"
