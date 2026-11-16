# shellcheck shell=bash disable=SC2034
# Shared host constants for the native NB demo scripts (LT-575). Sourced, not executed.
NB_DEMO_USER=nbdemo
# The database cluster runs under a separate account so the app cannot read pgdata or use peer superuser access.
NB_DEMO_DB_USER=nbdemo-pg
NB_DEMO_PORT=3475
NB_DEMO_PG_PORT=55475
NB_DEMO_ROOT=/opt/nb-demo
NB_DEMO_ETC=/etc/nb-demo
NB_DEMO_DATA=/var/lib/nb-demo
NB_DEMO_OPERATOR=/var/lib/nb-demo-operator
NB_DEMO_BACKUPS=/var/backups/nb-demo
NB_DEMO_UNITS="nb-demo.service nb-demo-postgres.service"

require_root() {
  if [ "$(id -u)" != 0 ]; then echo "Run as root (sudo); this script changes only nb-demo paths." >&2; exit 1; fi
}

pg_bin() {
  # shellcheck disable=SC1091
  . "$NB_DEMO_ETC/postgres.env"
  printf '%s' "$NB_DEMO_PG_BIN"
}
