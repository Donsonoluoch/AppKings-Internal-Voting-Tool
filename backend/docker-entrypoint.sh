#!/bin/sh
# Applies migrations, optionally seeds, then starts whatever CMD was passed.
#
# Used by both images:
#   * API-only image  (docker build --target backend) — starts `node src/index.js`
#   * All-in-one image (default)                      — starts supervisord, which runs the
#     API and/or the web app according to APP_ROLE.
#
# APP_ROLE=all | api | web ; DB_WAIT_SECONDS=60 ; RUN_SEED=true|false
set -e

ROLE="${APP_ROLE:-api}"
EMBEDDED_POSTGRES="${EMBEDDED_POSTGRES:-false}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
PG_BIN="${PG_BIN:-/usr/libexec/postgresql16}"

stop_embedded_postgres() {
  if su-exec postgres "$PG_BIN/pg_ctl" --pgdata="$PGDATA" status >/dev/null 2>&1; then
    if ! su-exec postgres "$PG_BIN/pg_ctl" --pgdata="$PGDATA" --mode=fast --wait stop; then
      echo "[entrypoint] failed to stop embedded PostgreSQL cleanly" >&2
    fi
  fi
}

if [ "$EMBEDDED_POSTGRES" = "true" ]; then
  if [ "$ROLE" != "api" ]; then
    echo "[entrypoint] embedded PostgreSQL is supported only with APP_ROLE=api" >&2
    exit 1
  fi
  if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_PASSWORD:-}" ]; then
    echo "[entrypoint] POSTGRES_USER, POSTGRES_DB and POSTGRES_PASSWORD are required for embedded PostgreSQL" >&2
    exit 1
  fi
  if [ "${NODE_ENV:-development}" = "production" ] && [ "${#POSTGRES_PASSWORD}" -lt 32 ]; then
    echo "[entrypoint] production requires a PostgreSQL password of at least 32 characters" >&2
    exit 1
  fi
  case "$POSTGRES_USER$POSTGRES_DB" in
    *[!a-zA-Z0-9_]*)
      echo "[entrypoint] POSTGRES_USER and POSTGRES_DB may contain only letters, numbers and underscores" >&2
      exit 1
      ;;
  esac

  mkdir -p /run/postgresql
  chown postgres:postgres /run/postgresql
  mkdir -p "$PGDATA"
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    chown postgres:postgres "$PGDATA"
    password_file=$(mktemp)
    printf '%s\n' "$POSTGRES_PASSWORD" > "$password_file"
    chown postgres:postgres "$password_file"
    chmod 600 "$password_file"
    if ! su-exec postgres "$PG_BIN/initdb" \
      --pgdata="$PGDATA" \
      --username="$POSTGRES_USER" \
      --auth-local=trust \
      --auth-host=scram-sha-256 \
      --pwfile="$password_file"; then
      rm -f "$password_file"
      exit 1
    fi
    rm -f "$password_file"
  fi

  echo "[entrypoint] starting embedded PostgreSQL"
  su-exec postgres "$PG_BIN/pg_ctl" \
    --pgdata="$PGDATA" \
    --options="-h 127.0.0.1 -p 5432" \
    --wait start
  trap stop_embedded_postgres EXIT

  escaped_password=$(printf '%s' "$POSTGRES_PASSWORD" | sed "s/'/''/g")
  su-exec postgres "$PG_BIN/psql" --username="$POSTGRES_USER" --dbname=postgres \
    --set=ON_ERROR_STOP=1 \
    --command="ALTER ROLE \"$POSTGRES_USER\" WITH PASSWORD '$escaped_password'"

  database_exists=$(su-exec postgres "$PG_BIN/psql" --username="$POSTGRES_USER" --dbname=postgres \
    --tuples-only --no-align \
    --command="SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")
  if [ "$database_exists" != "1" ]; then
    su-exec postgres "$PG_BIN/createdb" --username="$POSTGRES_USER" --owner="$POSTGRES_USER" "$POSTGRES_DB"
  fi

  export DATABASE_URL
  DATABASE_URL=$(node -e 'process.stdout.write(`postgresql://${encodeURIComponent(process.env.POSTGRES_USER)}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@127.0.0.1:5432/${encodeURIComponent(process.env.POSTGRES_DB)}?schema=public`)')
fi

run_with_embedded_postgres() {
  "$@" &
  app_pid=$!

  stop_app() {
    kill -TERM "$app_pid" 2>/dev/null || true
  }
  trap stop_app TERM INT

  set +e
  wait "$app_pid"
  status=$?
  set -e

  trap - TERM INT
  return "$status"
}

# The API-only image (--target backend) is handed this script as ENTRYPOINT with
# `node src/index.js` as CMD. It has no supervisord and no web tree, so keep it to
# migrations + seed and exec the command.
# Stack traces in the migration output are noise: it is the retry loop that matters.
if [ ! -f /etc/supervisor/conf.d/appkings.conf ]; then
  npx prisma migrate deploy
  if [ "${RUN_SEED:-false}" = "true" ]; then node prisma/seed.js; fi
  if [ "$EMBEDDED_POSTGRES" = "true" ]; then
    run_with_embedded_postgres "$@"
    exit $?
  fi
  exec "$@"
fi

WAIT="${DB_WAIT_SECONDS:-60}"
SEED="${RUN_SEED:-false}"

if [ -n "$DATABASE_URL" ]; then
  # Retry `migrate deploy` itself: it fails while Postgres is still starting and succeeds
  # once it is up. (`migrate status` exits non-zero whenever migrations are pending, so it
  # cannot be used as a readiness probe.)
  echo "[entrypoint] waiting up to ${WAIT}s for the database, then applying migrations"
  i=0
  until npx prisma migrate deploy; do
    i=$((i + 2))
    if [ "$i" -ge "$WAIT" ]; then
      if [ "$EMBEDDED_POSTGRES" = "true" ]; then
        echo "[entrypoint] migrations failed against embedded PostgreSQL after ${WAIT}s; refusing to start the API" >&2
        exit 1
      fi
      echo "[entrypoint] database still unreachable after ${WAIT}s; starting anyway (the API reports it at boot)" >&2
      break
    fi
    echo "[entrypoint] retrying in 2s (${i}s of ${WAIT}s)"
    sleep 2
  done

  if [ "$SEED" = "true" ]; then
    echo "[entrypoint] seeding categories, departments and roster accounts"
    node prisma/seed.js
  fi
else
  echo "[entrypoint] DATABASE_URL is empty; skipping migrations"
fi

# Translate APP_ROLE into supervisord autostart flags, then hand over.
CONF=/etc/supervisor/conf.d/appkings.conf
enable() {
  # Turn one program's autostart on: the sed range stops at the next INI section.
  sed -i "/\[program:$1\]/,/^\[/ s/^autostart=false/autostart=true/" "$CONF"
}

case "$ROLE" in
  api)
    # One image, API only: expose it on the container network instead of loopback only.
    enable api
    API_HOST=0.0.0.0
    ;;
  web)
    # One image, web only: the API is somewhere else, so require a real address instead of
    # silently guessing a container name. The compose `web` service sets it to the `api`
    # service; the documented default points at an API on the host.
    enable web
    if [ "$API_INTERNAL_URL" = "http://127.0.0.1:4000/api" ]; then
      API_INTERNAL_URL=http://host.docker.internal:4000/api
    fi
    ;;
  all)
    # supervisord starts the API on API_PORT, then the web app, which proxies to it.
    enable api
    enable web
    ;;
  *)
    echo "[entrypoint] unknown APP_ROLE='$ROLE' (expected all|api|web)" >&2
    exit 1
    ;;
esac

# supervisord reads %(ENV_*) at start-up, so these must be exported — not just set.
export API_HOST API_INTERNAL_URL

echo "[entrypoint] APP_ROLE=${ROLE}; starting: $*"
if [ "$EMBEDDED_POSTGRES" = "true" ]; then
  run_with_embedded_postgres "$@"
  exit $?
fi
exec "$@"
