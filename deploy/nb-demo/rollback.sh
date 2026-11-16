#!/usr/bin/env bash
# Switch back to the previously active immutable release (LT-575). Code only: the database is
# kept as is (NB schema sync is additive). Data restore is a separate explicit step (restore-backup.sh).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
require_root
PREVIOUS=$(cat "$NB_DEMO_ROOT/previous" 2>/dev/null || true)
[ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/RELEASE.json" ] || { echo "No previous release recorded." >&2; exit 1; }
CURRENT=$(readlink "$NB_DEMO_ROOT/current")
# Separate commands: under set -e a failure inside an && list would not stop the script.
ln -sfn "$PREVIOUS" "$NB_DEMO_ROOT/current.next"
mv -T "$NB_DEMO_ROOT/current.next" "$NB_DEMO_ROOT/current"
printf '%s\n' "$CURRENT" > "$NB_DEMO_ROOT/previous"
systemctl restart nb-demo.service
"$HERE/health.sh"
echo "Rolled back to $PREVIOUS"
