#!/usr/bin/env bash
# Local health on the host: units active, loopback-only listeners, database ready, API check (LT-575).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
for unit in $NB_DEMO_UNITS; do systemctl is-active --quiet "$unit" || { echo "FAIL $unit not active" >&2; exit 1; }; done
if ss -ltn | awk -v a=":$NB_DEMO_PORT" -v b=":$NB_DEMO_PG_PORT" '($4 ~ a"$" || $4 ~ b"$") && $4 !~ /^127\.0\.0\.1:/ {f=1} END {exit !f}'; then
  echo "FAIL a demo port listens beyond 127.0.0.1" >&2; exit 1
fi
"$(pg_bin)/pg_isready" -q -h 127.0.0.1 -p "$NB_DEMO_PG_PORT"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$NB_DEMO_PORT/api/check" | grep -q '"status":"OK"'; then
    echo "OK nb-demo healthy"; exit 0
  fi
  sleep 2
done
echo "FAIL /api/check did not answer" >&2; exit 1
