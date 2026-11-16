#!/usr/bin/env bash
# Explicit, Chief-gated restore of the demo database from one backup.sh directory (LT-575).
# Replaces only the nb_demo database contents. Usage: sudo restore-backup.sh <backup-dir> --confirm-nb-demo-restore
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
require_root
SRC=${1:?backup directory}
[ "${2:-}" = "--confirm-nb-demo-restore" ] || { echo "Add --confirm-nb-demo-restore to replace nb_demo contents." >&2; exit 1; }
case "$(realpath "$SRC")" in "$NB_DEMO_BACKUPS"/*) ;; *) echo "Backup must be under $NB_DEMO_BACKUPS" >&2; exit 1;; esac
(cd "$SRC" && sha256sum --quiet -c SHA256SUMS)
PG_BIN=$(pg_bin)
SAFETY=$("$HERE/backup.sh")
echo "Safety backup before restore: $SAFETY"
systemctl stop nb-demo.service
status=0
runuser -u "$NB_DEMO_DB_USER" -- "$PG_BIN/pg_restore" -h "$NB_DEMO_DATA/sockets" -p "$NB_DEMO_PG_PORT" \
  -d nb_demo --clean --if-exists --no-owner --role=nb_demo --single-transaction < "$SRC/nb_demo.dump" || status=$?
# The single transaction rolled back any partial restore, so bring the app back either way.
systemctl start nb-demo.service || echo "nb-demo.service did not start." >&2
if [ "$status" -ne 0 ]; then echo "Restore failed (pg_restore exit $status); nb_demo is unchanged." >&2; exit "$status"; fi
"$HERE/health.sh"
