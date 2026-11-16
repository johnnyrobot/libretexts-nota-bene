#!/usr/bin/env bash
# Read-only host preflight for the native NB demo (LT-575). Writes nothing, starts nothing,
# changes no configuration. Safe to run as an unprivileged user; some lines say "(needs sudo)".
# Usage: preflight-readonly.sh [hostname]
set -u
HOST=${1:-nb.libretexts.dev}
NB_DEMO_PORT=3475
NB_DEMO_PG_PORT=55475
section() { printf '\n== %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

section "System"
uname -srm
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>/dev/null
have systemctl && systemctl --version | head -1
df -h / /opt /var 2>/dev/null
free -m 2>/dev/null | head -2

section "Node (demo requires v22.x; verified v22.23.4)"
if have node; then node -v; command -v node; else echo "node: MISSING"; fi
if have npm; then npm -v; else echo "npm: MISSING"; fi
# systemd and sudo resolve node/npm only on their restricted PATH (no nvm or per-user installs).
for bin in node npm; do
  found=no; for d in /usr/bin /usr/local/bin; do [ -x "$d/$bin" ] && found="$d/$bin"; done
  echo "$bin on service PATH: $found"
done

section "Host tools used by provisioning and scripts"
for tool in openssl runuser sha256sum curl ss tar getent; do have "$tool" && echo "$tool: ok" || echo "$tool: MISSING"; done

section "PostgreSQL binaries (demo needs initdb, pg_ctl, pg_dump, pg_restore, psql, pg_isready; verified 16)"
for dir in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin; do
  [ -x "$dir/initdb" ] && echo "$dir: $("$dir/initdb" --version)"
done

section "Caddy (snippet uses {args[0]}: requires v2.7 or later)"
if have caddy; then caddy version; command -v caddy; else echo "caddy: MISSING"; fi
have systemctl && systemctl is-active caddy 2>/dev/null
f=/etc/caddy/Caddyfile
if [ -r "$f" ]; then
  echo "$f readable; site blocks and imports:"; grep -nE "^[^#[:space:]].*\{|import " "$f"
  grep -n "$HOST" "$f" || echo "no existing $HOST block"
else
  echo "$f not readable (needs sudo) or absent"
fi
[ -e /etc/caddy/nb-demo.caddy ] && echo "WARNING /etc/caddy/nb-demo.caddy already exists"

section "Ports (must be free: $NB_DEMO_PORT app, $NB_DEMO_PG_PORT database)"
if have ss; then
  ss -ltn | awk -v a=":$NB_DEMO_PORT" -v b=":$NB_DEMO_PG_PORT" '$4 ~ a"$" || $4 ~ b"$" {print "IN USE:", $4; found=1} END {if (!found) print "both free"}'
  echo "public listeners (other sites to preserve):"
  ss -ltn | awk 'NR>1 && $4 !~ /^(127\.|\[::1\])/ {print "  " $4}'
fi

section "Existing nb-demo state (all must be absent before provisioning)"
for u in nbdemo nbdemo-pg; do id "$u" >/dev/null 2>&1 && echo "WARNING user $u exists" || echo "user $u absent"; done
for p in /opt/nb-demo /etc/nb-demo /var/lib/nb-demo /var/lib/nb-demo-operator /var/backups/nb-demo \
  /etc/systemd/system/nb-demo.service /etc/systemd/system/nb-demo-postgres.service; do
  [ -e "$p" ] && echo "WARNING exists: $p" || echo "absent: $p"
done

section "DNS for $HOST (must resolve to this host's public address before activation)"
getent ahosts "$HOST" 2>/dev/null | awk '{print $1}' | sort -u || echo "no DNS answer"
have ip && { echo "this host's global addresses:"; ip -o addr show scope global | awk '{print "  " $4}'; }

section "Outbound needed only during release setup (npm registry)"
have curl && curl -fsS -o /dev/null --max-time 8 -w 'registry.npmjs.org HTTP %{http_code}\n' https://registry.npmjs.org/ 2>/dev/null || echo "npm registry: unreachable"
echo "Preflight finished. No changes were made."
