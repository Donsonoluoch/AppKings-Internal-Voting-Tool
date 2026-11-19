# Deploying

Production Compose starts exactly two containers: Next.js frontend, and a backend container
that runs Express and PostgreSQL. Next.js proxies `/api/*` to the private API service; only
port 3000 is published, so the session cookie stays first-party. PostgreSQL data is kept in
the named `appkings-voting_db_data` volume.

```
Browser ──▶ :3000 Next.js ──/api/*──▶ api:4000 Express ──▶ 127.0.0.1:5432 PostgreSQL
              (web container)          (API + DB container)
```

## 0. Prerequisites

- Docker with Compose v2.
- A root `.env` copied from `.env.example` with a unique `JWT_SECRET` and a strong,
  URL-safe `POSTGRES_PASSWORD` (at least 32 characters). Generate independent values
  for the JWT and database password with:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- `POSTGRES_PASSWORD` must not be the development placeholder. The same persistent
  database volume is mounted into the API container across rebuilds.
- Set `COOKIE_SECURE=true` and put the app behind HTTPS. Production refuses to start
  with an insecure session cookie or a default/short JWT secret.
- `BOOTSTRAP_ADMIN_PHONE` set to the person who will be the first admin. There is no default
  account: sign-in is by registered phone number only.

## 0b. Choosing the database

| Shape | `.env` | Behaviour |
|-------|--------|-----------|
| **External PostgreSQL** (managed/served; recommended for go-live) | `DATABASE_URL=postgresql://…` and no `POSTGRES_PASSWORD` | The API starts no database of its own, runs `prisma migrate deploy` against that URL, and leaves the `db_data` volume unused. |
| **Embedded PostgreSQL** (default, single host) | leave `DATABASE_URL=` empty and set `POSTGRES_PASSWORD` | The API runs PostgreSQL 16 inside its own container, backed by the `appkings-voting_db_data` volume. |

Migrations run at container start, so run exactly one API container per database. A new,
empty external database needs nothing in advance: `prisma migrate deploy` creates every table
on first start.

## 1. Run the two app containers

Set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` in `.env`. Start from the
repository root so Compose loads the root `.env`:

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
# → exactly two containers: web on http://localhost:3000 and private api + database
```

or the npm alias: `npm run docker:up`.

Production does not seed on container start. The one-time seed imports only names and phone
numbers from the roster workbook, creates the 8 categories, the 5 departments and the 7 teams
from `packages/shared/constants.js`, and sets Steve Martin at `BOOTSTRAP_ADMIN_PHONE` as the
Finance admin. Every other account starts with no department and chooses one at first sign-in.
The workbook is excluded from Docker images, so the seed copies it into the running API
container itself:

```bash
npm run db:golive              # copies the workbook in, seeds, then verifies
npm run db:golive -- --dry-run # what would happen; changes nothing
```

`db:golive` refuses to run against a database that already has employees (use
`/admin` → *Reset voting progress* to restart an existing cycle), then checks the result:
roster count, exactly one admin in Finance, 8 categories, departments and teams exactly as
defined in the shared constants, cycle at `NOT_STARTED`, and only the admin with a department.
Set `EMPLOYEE_ROSTER_FILE` if the workbook is not at the repository root.

The workbook contains 58 data rows; the seed skips the duplicate phone and uses the
configured admin profile for Steve's matching roster number, resulting in 57 accounts.
Steve can assign committee and additional admin roles through the employee tools. Re-running
the seed refreshes roster names but preserves existing employee roles, departments and
active/eligibility settings. Do not mount or bake the workbook into an image.

### Docker Desktop

Open `infra/docker-compose.yml` in Docker Desktop and choose the root `.env` as its Compose
environment file before starting. The project creates only `api` and `web`; PostgreSQL
runs privately inside `api`. Wait until both services are healthy, then run the one-time
seed command above from a terminal in the repository root. The logo and app icon are
included in the frontend image; no separate asset mount is needed.

What happens on start:

1. `api` starts PostgreSQL, runs `prisma migrate deploy`, then starts Express.
2. The API healthcheck waits for `/api/health/ready`, which checks the database and API.
3. `web` starts after the API is healthy and proxies its `/api/*` requests.

Useful commands:

```bash
npm run docker:logs     # frontend and backend logs
npm run docker:ps       # state + health
npm run docker:shell    # sh inside the API container
npm run docker:down     # stop both containers; the named database volume is retained
```

## 2. Rebuild

The deployment is always the same two services — there is no third container to start or
stop. To rebuild the images and recreate the containers (the database volume is kept):

```bash
npm run docker:rebuild
# or, in full:
docker compose --env-file .env -f infra/docker-compose.yml up -d --build --force-recreate
```

| Service | Port | Image target | Notes |
|---------|------|--------------|-------|
| `web`   | 3000 | `runtime` | Public frontend; proxies `/api` to the API service |
| `api`   | private 4000 | `backend` | Runs Express and private PostgreSQL; data is volume-backed |

Each service publishes a healthcheck on `/api/health/ready`, so `web` only starts once
`api` (and its embedded database) is ready, and `docker compose ps` shows both as healthy.

## 3. Development stack (hot reload)

```bash
npm run dev:stack          # db + app (supervisord: node --watch + next dev)
npm run dev:split:bg       # db + api + web separately (development only)
npm run dev:stack:down
npm run dev:stack:reset    # also deletes the database volume
```

The development Compose stack can include a local PostgreSQL container; it is separate
from the production topology above. Migrations run on every start. The roster is seeded
only when the development database is empty, and is not recreated on restart.

## 4. Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `JWT_SECRET` | required in production | Unique session signing key, at least 32 characters |
| `DATABASE_URL` | empty = embedded PostgreSQL | External database. When set, the embedded database is skipped; leave `POSTGRES_PASSWORD` empty. |
| `POSTGRES_USER` | `appkings` | PostgreSQL account inside the API container (embedded only) |
| `POSTGRES_PASSWORD` | required for embedded | Strong, URL-safe PostgreSQL password (not needed with `DATABASE_URL`) |
| `POSTGRES_DB` | `appkings_voting` | Database created in the API container (embedded only) |
| `WEB_PORT` | 3000 | Published web port |
| `API_INTERNAL_URL` | `http://api:4000/api` | Where the web app proxies `/api/*` |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed CORS origin |
| `COOKIE_SECURE` | `true` | Required for production HTTPS |
| `RUN_SEED` | `false` | Production does not seed on container start; use `npm run db:golive` |
| `BOOTSTRAP_ADMIN_PHONE` | `+254706831847` | Phone number for the initial admin (Steve Martin) |
| `BOOTSTRAP_ADMIN_NAME` | `Steve Martin` | Name for the initial admin |
| `EMPLOYEE_ROSTER_FILE` | workbook path | Path to the roster workbook when running the seed |
| `DB_PORT` | `5432` | Optional development Compose database port |
| `SELF_NOMINATION_LIMIT`, `NOMINATION_MIN_JUSTIFICATION`, `TOP_PER_CATEGORY`, `PHASE1_FINALISTS`, `PHASE2_FINALISTS_MIN`, `PHASE2_FINALISTS_MAX`, `MIN_CANDIDATES_PER_CATEGORY`, `TEAM_FINALISTS`, `COMMITTEE_PICKS_PER_CATEGORY` | see `.env.example` | Every rule from context §1 |

## 5. Backups

Back up the database from the API container. The embedded database is not published to the
host; with an external `DATABASE_URL`, use your provider's snapshot tooling and this command
for a portable copy (it reads the connection string the container already has).

**Take one:**

```bash
docker compose --env-file .env -f infra/docker-compose.yml exec -T api \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > "backup-$(date +%Y%m%d-%H%M).dump"
```

During the voting window, take one every morning and one just before each phase change.

**Restore:**

```bash
docker compose --env-file .env -f infra/docker-compose.yml exec -T api \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < backup-20260110-0900.dump
```

**Check a backup is readable** (do this once, before you ever need it):

```bash
pg_restore --list backup-20260110-0900.dump | head
```

## 6. Upgrade

Code changes with no schema change:

```bash
git pull && docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

With a schema change, take a backup first — the API entrypoint runs `prisma migrate deploy`
automatically. Rebuilding/recreating the API container does not delete the named database
volume; do not run `docker compose down -v` unless you intend to delete the database.

## 7. Health and logs

```bash
curl -s localhost:3000/api/health        # {"ok":true,"env":"production"}
curl -s localhost:3000/api/health/ready  # {"ok":true,"db":"up","phase":"PHASE_1"}
docker compose --env-file .env -f infra/docker-compose.yml logs -f api web
```

`docker compose ps` shows both containers as healthy once `/api/health/ready` answers,
which means the web app, API and embedded database are ready.
