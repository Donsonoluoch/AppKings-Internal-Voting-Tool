#!/bin/sh
# Temporary helper: safe backup of the production database volume before recreating the stack.
# Usage: /check.sh <output-file-inside-container>
set -e
PG=/usr/libexec/postgresql16
mkdir -p /tmp/pgsock
chown postgres:postgres /tmp/pgsock
su-exec postgres "$PG/pg_ctl" --pgdata=/var/lib/postgresql/data \
  --options="-h 127.0.0.1 -p 5499 -k /tmp/pgsock" --wait start
sleep 2
su-exec postgres "$PG/pg_dump" -h 127.0.0.1 -p 5499 -U appkings -d appkings_voting -Fc -f "$1"
su-exec postgres "$PG/pg_dump" -h 127.0.0.1 -p 5499 -U appkings -d appkings_voting > "${1%.dump}.sql"
su-exec postgres "$PG/pg_ctl" --pgdata=/var/lib/postgresql/data --mode=fast --wait stop
ls -la "$1" "${1%.dump}.sql"
