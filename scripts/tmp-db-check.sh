#!/bin/sh
# Temporary helper: report row counts in the production database volume using the API image's
# own PostgreSQL build (so the on-disk format matches exactly).
set -e
PG=/usr/libexec/postgresql16
mkdir -p /tmp/pgsock
chown postgres:postgres /tmp/pgsock
su-exec postgres "$PG/pg_ctl" --pgdata=/var/lib/postgresql/data \
  --options="-h 127.0.0.1 -p 5499 -k /tmp/pgsock" --wait start
sleep 2
su-exec postgres "$PG/psql" -h 127.0.0.1 -p 5499 -U appkings -d appkings_voting \
  -c 'select count(*) as employees from "Employee";' \
  -c 'select count(*) as votes from "Vote";' \
  -c 'select count(*) as nominations from "Nomination";'
su-exec postgres "$PG/pg_ctl" --pgdata=/var/lib/postgresql/data --mode=fast --wait stop
