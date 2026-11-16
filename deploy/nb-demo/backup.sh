#!/usr/bin/env bash
# Consistent logical backup of the demo database plus protected settings (LT-575).
# Usage: sudo backup.sh   -> prints the backup directory
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
require_root
PG_BIN=$(pg_bin)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$NB_DEMO_BACKUPS/$STAMP"
umask 077
mkdir "$DEST"
runuser -u "$NB_DEMO_DB_USER" -- "$PG_BIN/pg_dump" -h "$NB_DEMO_DATA/sockets" -p "$NB_DEMO_PG_PORT" -Fc nb_demo > "$DEST/nb_demo.dump"
"$PG_BIN/pg_restore" --list "$DEST/nb_demo.dump" > /dev/null
tar -C / -czf "$DEST/protected-settings.tar.gz" "${NB_DEMO_ETC#/}" "${NB_DEMO_OPERATOR#/}"
readlink "$NB_DEMO_ROOT/current" > "$DEST/active-release" 2>/dev/null || echo none > "$DEST/active-release"
(cd "$DEST" && sha256sum nb_demo.dump protected-settings.tar.gz active-release > SHA256SUMS)
echo "$DEST"
