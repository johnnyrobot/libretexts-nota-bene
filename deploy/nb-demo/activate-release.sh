#!/usr/bin/env bash
# Chief-gated activation of a staged release (LT-575): backup, atomic switch, restart, health.
# Restores the previous release automatically if the restart or health check fails. Never resets data.
# Usage: sudo activate-release.sh <release-id>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
require_root
ID=${1:?release id}
TARGET="$NB_DEMO_ROOT/releases/$ID"
[ -f "$TARGET/RELEASE.json" ] || { echo "Release $ID is not staged." >&2; exit 1; }
PREVIOUS=$(readlink "$NB_DEMO_ROOT/current" 2>/dev/null || true)
systemctl enable --now nb-demo-postgres.service
"$HERE/backup.sh"
switch() { ln -sfn "$1" "$NB_DEMO_ROOT/current.next" && mv -T "$NB_DEMO_ROOT/current.next" "$NB_DEMO_ROOT/current"; }
switch "$TARGET"
# A failed enable or restart takes the same recovery path as failed health (set -e would skip it).
if systemctl enable nb-demo.service && systemctl restart nb-demo.service && "$HERE/health.sh"; then
  # Record the rollback target only once the new release is healthy.
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TARGET" ]; then printf '%s\n' "$PREVIOUS" > "$NB_DEMO_ROOT/previous"; fi
  echo "Active: $ID"; exit 0
fi
echo "Health failed for $ID." >&2
if [ -n "$PREVIOUS" ]; then
  switch "$PREVIOUS"; systemctl restart nb-demo.service; "$HERE/health.sh" && echo "Restored $PREVIOUS" >&2
else
  # First activation failed: leave nothing pointing at the failed release.
  systemctl disable --now nb-demo.service
  rm -f "$NB_DEMO_ROOT/current"
fi
exit 1
