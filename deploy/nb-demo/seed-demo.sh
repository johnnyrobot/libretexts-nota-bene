#!/usr/bin/env bash
# One-time creation of the two synthetic demo accounts, course and reading through native NB APIs
# on the loopback listener (LT-575). Refuses to run twice. Usage: sudo seed-demo.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
require_root
ORIGIN=$(sed -n 's/^NB_DEMO_ORIGIN=//p' "$NB_DEMO_ETC/nb-demo.env")
NB_DEMO_OPERATOR_DIR="$NB_DEMO_OPERATOR" NB_DEMO_ORIGIN="$ORIGIN" NB_DEMO_PORT="$NB_DEMO_PORT" \
  node "$NB_DEMO_ROOT/current/scripts/demo-seed.cjs"
