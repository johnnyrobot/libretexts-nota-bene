#!/usr/bin/env bash
# Stage an immutable release under /opt/nb-demo/releases (LT-575). Does not switch, restart or
# touch the database. Usage: sudo install-release.sh <release.tar.gz> <expected-sha256>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
require_root
TARBALL=${1:?release tarball}
EXPECTED=${2:?expected sha256 of the tarball}
ACTUAL=$(sha256sum "$TARBALL" | cut -d' ' -f1)
[ "$ACTUAL" = "$EXPECTED" ] || { echo "Checksum mismatch: $ACTUAL" >&2; exit 1; }
ID=$(basename "$TARBALL" .tar.gz)
[[ "$ID" =~ ^nb-demo-[0-9a-f]{12}-[0-9a-f]{12}-[A-Za-z0-9.-]+$ ]] || { echo "Unexpected release name $ID" >&2; exit 1; }
FINAL="$NB_DEMO_ROOT/releases/$ID"
[ ! -e "$FINAL" ] || { echo "$FINAL already exists; releases are immutable." >&2; exit 1; }
STAGE=$(mktemp -d "$NB_DEMO_ROOT/releases/.stage.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$TARBALL" -C "$STAGE" --no-same-owner
[ "$(ls -A "$STAGE")" = "$ID" ] || { echo "Tarball must contain exactly $ID/" >&2; exit 1; }
(cd "$STAGE/$ID" && sha256sum --quiet -c MANIFEST.sha256)
ORIGIN=$(sed -n 's/^NB_DEMO_ORIGIN=//p' "$NB_DEMO_ETC/nb-demo.env")
node -e 'const r=require(process.argv[1]); if (r.origin!==process.argv[2]) { console.error(`Release origin ${r.origin} differs from ${process.argv[2]}`); process.exit(1) }' \
  "$STAGE/$ID/RELEASE.json" "$ORIGIN"
(cd "$STAGE/$ID" && HOME="$STAGE" npm_config_cache="$STAGE/.npm" npm ci --ignore-scripts --no-audit --no-fund)
rm -rf "$STAGE/.npm"
chown -R root:root "$STAGE/$ID"
chmod -R u=rwX,go=rX "$STAGE/$ID"
chmod -R a-w "$STAGE/$ID"
mv "$STAGE/$ID" "$FINAL"
echo "Staged $FINAL (read-only, not active)."
