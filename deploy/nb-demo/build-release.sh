#!/usr/bin/env bash
# Build an immutable native NB demo release on a workstation (LT-575).
# Usage: build-release.sh <public-origin> <client-repo> <output-dir> [client-sha]
# The server is this repository's committed HEAD (the tree must be clean). The client is the
# given commit of the paired client repository, read with git archive; neither checkout is modified.
set -euo pipefail

ORIGIN=${1:?public origin, e.g. https://nb.libretexts.dev}
CLIENT_REPO=${2:?client repository path}
OUTPUT=${3:?output directory}
CLIENT_SHA=${4:-f26b5f7b836c76f2f1196f67c1f733910343b394}
BOOK_STAGE=${5:-}
SERVER_REPO=$(cd "$(dirname "$0")/../.." && pwd)

node -e 'require(process.argv[1]).parseOrigin(process.argv[2])' "$SERVER_REPO/scripts/demo-config.cjs" "$ORIGIN"
if [ -n "$(git -C "$SERVER_REPO" status --porcelain)" ]; then
  echo "Server tree has uncommitted changes; build only committed sources." >&2
  exit 1
fi
SERVER_SHA=$(git -C "$SERVER_REPO" rev-parse HEAD)
CLIENT_SHA=$(git -C "$CLIENT_REPO" rev-parse --verify "$CLIENT_SHA^{commit}")
HOST=$(node -e 'console.log(new URL(process.argv[1]).host.replace(/[^A-Za-z0-9.-]/g, "-"))' "$ORIGIN")
BOOK_DIGEST=''
BOOK_SUFFIX=''
if [ -n "$BOOK_STAGE" ]; then
  BOOK_DIGEST=$(python3 "$SERVER_REPO/scripts/textbook-package.py" --identity "$BOOK_STAGE")
  BOOK_SUFFIX="-book-${BOOK_DIGEST:0:12}"
fi
ID="nb-demo-${SERVER_SHA:0:12}-${CLIENT_SHA:0:12}-${HOST}${BOOK_SUFFIX}"
mkdir -p "$OUTPUT"
OUTPUT=$(cd "$OUTPUT" && pwd)
if [ -e "$OUTPUT/$ID" ] || [ -e "$OUTPUT/$ID.tar.gz" ]; then
  echo "Release $ID already exists in $OUTPUT; releases are immutable." >&2
  exit 1
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/nb-demo-build.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/server" "$WORK/client" "$WORK/release/$ID"
git -C "$SERVER_REPO" archive "$SERVER_SHA" | tar -x -C "$WORK/server"
git -C "$CLIENT_REPO" archive "$CLIENT_SHA" | tar -x -C "$WORK/client"

(cd "$WORK/server" && npm ci --ignore-scripts --no-audit --no-fund && npm run build)
(cd "$WORK/client" && npm ci --ignore-scripts --no-audit --no-fund && npm run build)

R="$WORK/release/$ID"
git -C "$SERVER_REPO" archive "$SERVER_SHA" | tar -x -C "$R"
# Original public development keys are source history, never runnable demo credentials.
rm -rf "$R/dev_ssl_cert"
cp -R "$WORK/server/dist" "$R/dist"
mkdir -p "$R/client/js"
cp -R "$WORK/client/public/style" "$WORK/client/public/emoji" "$R/client/"
node -e '
const fs = require("fs");
const { rewriteClientBundle } = require(process.argv[1]);
fs.writeFileSync(process.argv[4], rewriteClientBundle(fs.readFileSync(process.argv[3], "utf8"), process.argv[2]));
' "$SERVER_REPO/scripts/demo-config.cjs" "$ORIGIN" "$WORK/client/public/js/bundle.js" "$R/client/js/bundle.js"
cp "$R/deploy/nb-demo/reading.html" "$R/client/reading.html"
# models/index.js requires config.js before it reads DATABASE_URL.
printf 'module.exports = { db: {} };\n' > "$R/config.js"

if [ -n "$BOOK_STAGE" ]; then
  python3 "$SERVER_REPO/scripts/textbook-package.py" "$BOOK_STAGE" "$R/textbook"
fi
mkdir "$R/uploads"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
node -e '
const [id, origin, serverSha, clientSha, serverLock, clientLock, built, rewritten, dist, bookDigest] = process.argv.slice(1);
console.log(JSON.stringify({ id, origin, serverSha, clientSha, bookPublicationSha256: bookDigest || null,
  sha256: { serverPackageLock: serverLock, clientPackageLock: clientLock, clientBundleBuilt: built, clientBundleRewritten: rewritten, serverDistIndex: dist },
  buildRuntime: { node: process.version, npm: require("child_process").execSync("npm -v").toString().trim(), platform: process.platform + "-" + process.arch },
  hostInstall: "npm ci --ignore-scripts from serverPackageLock (runtime modules are listed as devDependencies upstream)" }, null, 2));
' "$ID" "$ORIGIN" "$SERVER_SHA" "$CLIENT_SHA" "$(sha "$R/package-lock.json")" "$(sha "$WORK/client/package-lock.json")" \
  "$(sha "$WORK/client/public/js/bundle.js")" "$(sha "$R/client/js/bundle.js")" "$(sha "$R/dist/index.html")" "$BOOK_DIGEST" > "$R/RELEASE.json"
(cd "$R" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256) > "$WORK/MANIFEST.sha256"
mv "$WORK/MANIFEST.sha256" "$R/MANIFEST.sha256"

COPYFILE_DISABLE=1 tar -C "$WORK/release" -czf "$OUTPUT/$ID.tar.gz" "$ID"
(cd "$OUTPUT" && shasum -a 256 "$ID.tar.gz" > "$ID.tar.gz.sha256")
cp "$R/RELEASE.json" "$OUTPUT/$ID.RELEASE.json"
echo "$OUTPUT/$ID.tar.gz"
