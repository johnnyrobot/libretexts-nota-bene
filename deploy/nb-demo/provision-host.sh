#!/usr/bin/env bash
# Protected one-time host provisioning for the native NB demo (LT-575). Chief-gated: run only
# after the read-only preflight is accepted. Creates a dedicated unprivileged user, an isolated
# loopback PostgreSQL cluster/role/database, generated secrets and synthetic account settings,
# and installs (but does not enable or start) the two systemd units. Touches no other site,
# database, Caddy configuration or service. Refuses to run over any existing nb-demo state.
# Usage: sudo provision-host.sh <public-origin> <postgres-bin-dir> <release-dir-with-units>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/common.sh"
require_root
ORIGIN=${1:?public origin, e.g. https://nb.libretexts.dev}
PG_BIN=${2:?PostgreSQL bin directory, e.g. /usr/lib/postgresql/16/bin}
UNITS=${3:-$HERE}

[[ "$ORIGIN" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo "Origin must be https://<hostname> with no port or path." >&2; exit 1; }
for tool in initdb pg_ctl psql createdb pg_dump pg_restore pg_isready; do [ -x "$PG_BIN/$tool" ] || { echo "Missing $PG_BIN/$tool" >&2; exit 1; }; done
command -v openssl >/dev/null
for u in "$NB_DEMO_USER" "$NB_DEMO_DB_USER"; do
  if id "$u" >/dev/null 2>&1; then echo "User $u already exists; preserve it." >&2; exit 1; fi
done
for p in "$NB_DEMO_ROOT" "$NB_DEMO_ETC" "$NB_DEMO_DATA" "$NB_DEMO_OPERATOR" "$NB_DEMO_BACKUPS" \
  /etc/systemd/system/nb-demo.service /etc/systemd/system/nb-demo-postgres.service; do
  if [ -e "$p" ]; then echo "$p already exists; preserve it and stop." >&2; exit 1; fi
done
if ss -ltn | awk -v a=":$NB_DEMO_PORT" -v b=":$NB_DEMO_PG_PORT" '$4 ~ a"$" || $4 ~ b"$" {f=1} END {exit !f}'; then
  echo "Port $NB_DEMO_PORT or $NB_DEMO_PG_PORT is in use." >&2; exit 1
fi

umask 077
useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$NB_DEMO_USER"
useradd --system --user-group --no-create-home --home-dir "$NB_DEMO_DATA" --shell /usr/sbin/nologin "$NB_DEMO_DB_USER"
install -d -m 0700 -o "$NB_DEMO_DB_USER" -g "$NB_DEMO_DB_USER" "$NB_DEMO_DATA" "$NB_DEMO_DATA/sockets"
install -d -m 0755 -o root -g root "$NB_DEMO_ROOT" "$NB_DEMO_ROOT/releases"
install -d -m 0751 -o root -g root "$NB_DEMO_ETC"
install -d -m 0700 -o root -g root "$NB_DEMO_OPERATOR" "$NB_DEMO_BACKUPS"

PG_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
as_demo() { runuser -u "$NB_DEMO_DB_USER" -- "$@"; }
as_demo "$PG_BIN/initdb" -D "$NB_DEMO_DATA/pgdata" -U "$NB_DEMO_DB_USER" --auth-local=peer --auth-host=scram-sha-256 \
  --encoding=UTF8 --locale=C.UTF-8 >/dev/null
as_demo "$PG_BIN/pg_ctl" -D "$NB_DEMO_DATA/pgdata" -l "$NB_DEMO_DATA/postgres.log" \
  -o "-h 127.0.0.1 -p $NB_DEMO_PG_PORT -k $NB_DEMO_DATA/sockets" -w start >/dev/null
trap 'as_demo "$PG_BIN/pg_ctl" -D "$NB_DEMO_DATA/pgdata" -m fast -w stop >/dev/null || true' EXIT
printf "CREATE ROLE nb_demo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '%s';\n" "$PG_PASSWORD" \
  | as_demo "$PG_BIN/psql" -q -v ON_ERROR_STOP=1 -h "$NB_DEMO_DATA/sockets" -p "$NB_DEMO_PG_PORT" -d postgres
as_demo "$PG_BIN/createdb" -h "$NB_DEMO_DATA/sockets" -p "$NB_DEMO_PG_PORT" -O nb_demo nb_demo
as_demo "$PG_BIN/psql" -q -v ON_ERROR_STOP=1 -h "$NB_DEMO_DATA/sockets" -p "$NB_DEMO_PG_PORT" -d nb_demo \
  -c 'REVOKE ALL ON DATABASE nb_demo FROM PUBLIC; GRANT CONNECT ON DATABASE nb_demo TO nb_demo;'

printf 'NB_DEMO_PG_BIN=%s\n' "$PG_BIN" > "$NB_DEMO_ETC/postgres.env"
cat > "$NB_DEMO_ETC/nb-demo.env" <<ENV
NB_DEMO_ORIGIN=$ORIGIN
NB_DEMO_PORT=$NB_DEMO_PORT
NB_DEMO_CLIENT_DIR=$NB_DEMO_ROOT/current/client
DATABASE_URL=postgres://nb_demo:$PG_PASSWORD@127.0.0.1:$NB_DEMO_PG_PORT/nb_demo
JWT_SECRET=$JWT_SECRET
ENV
chown root:"$NB_DEMO_DB_USER" "$NB_DEMO_ETC/postgres.env"
chown root:"$NB_DEMO_USER" "$NB_DEMO_ETC/nb-demo.env"
chmod 0640 "$NB_DEMO_ETC/postgres.env" "$NB_DEMO_ETC/nb-demo.env"

account() { printf '{"username":"demo_%s","first":"%s","last":"Demo","email":"%s@demo.invalid","password":"%s"}' "$1" "$2" "$1" "$(openssl rand -hex 16)"; }
printf '{"users":[%s,%s]}\n' "$(account alice Alice)" "$(account bob Bob)" > "$NB_DEMO_OPERATOR/settings.json"
chmod 0600 "$NB_DEMO_OPERATOR/settings.json"

install -m 0644 -o root -g root "$UNITS/nb-demo-postgres.service" "$UNITS/nb-demo.service" /etc/systemd/system/
systemctl daemon-reload
echo "Provisioned isolated nb-demo users, database, secrets and units. Nothing enabled or started; no Caddy change."
