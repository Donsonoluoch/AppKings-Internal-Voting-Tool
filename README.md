# AppKings Internal Voting Tool

2026 Employee Awards — internal recognition and voting portal.
Three phases: **Nominate → Shortlist → Final Vote**.

Scoring is **points only**: each voter makes one pick per category, each pick is worth
1 point, and points are added up. Nothing is converted to a percentage.

- **Spec:** [`docs/context.md`](docs/context.md) — the source of truth for every rule.
- **Plan:** [`docs/roadmap.md`](docs/roadmap.md) — scaffold → completion → seeding & go-live.
- **How it is put together:** [`docs/architecture.md`](docs/architecture.md)
- **Deploying:** [`docs/deploy.md`](docs/deploy.md) · **On the day:** [`docs/runbook.md`](docs/runbook.md)
- **Endpoints:** [`docs/api.md`](docs/api.md)

## Stack

| Layer    | Choice                                                  |
| -------- | ------------------------------------------------------- |
| Frontend | Next.js (JavaScript, App Router) + Tailwind CSS         |
| Backend  | Express.js (JavaScript)                                 |
| ORM / DB | Prisma + PostgreSQL                                     |
| Auth     | Phone number, JWT in an httpOnly cookie; department chosen on first sign-in |

Three workspaces (`backend`, `frontend`, `packages/shared`). Production Docker runs
exactly two containers: a frontend, and a backend container that runs both Express and
PostgreSQL. The database is stored in the persistent `appkings-voting_db_data` volume.

## Quick start (local, no Docker)

Requires a local PostgreSQL database. For native development, change the sample
`host.docker.internal` database host to `localhost`. Set `DATABASE_URL` and `JWT_SECRET`
in `.env`. Seeding reads only names and phone numbers from `AppKings Team Data.xlsx` (or
the path configured with `EMPLOYEE_ROSTER_FILE`).

```bash
cp .env.example .env           # set DATABASE_URL, JWT_SECRET and BOOTSTRAP_ADMIN_PHONE
npm install
npm run prisma:generate
npm run prisma:migrate         # create/apply migrations
npm run db:seed                # categories + real roster + Steve Martin admin
npm run dev                    # API on :4000, web on :3000
```

## Quick start (Docker)

```bash
cp .env.example .env           # set a unique JWT_SECRET and strong POSTGRES_PASSWORD first
npm run docker:up              # web on :3000; API + PostgreSQL in the second container
npm run docker:logs
npm run docker:down
```

Production Docker defaults do not seed automatically. Set `BOOTSTRAP_ADMIN_PHONE` in
`.env`, start the stack, then run the one-time workbook seed from [docs/deploy.md](docs/deploy.md).
The database volume survives container rebuilds and `docker compose down`; do not use
`docker compose down -v` unless you intend to delete all voting data.

**Authentication limitation:** sign-in accepts a registered phone number without verifying
control of it. There is no device lock or SMS/OTP challenge, so this is a trust-based internal
login and does not prove identity. Use an approved identity-verification flow if that risk is
not acceptable.

## Commands

### Development

| Command | What it does |
|---------|--------------|
| `npm run dev` | API + web in one terminal |
| `npm run dev:api` | API only (`:4000`) |
| `npm run dev:web` | Web only (`:3000`) |
| `npm run dev:all` | Both under supervisord (used by the single dev container) |
| `npm run build` | Build shared, backend, frontend |
| `npm run test` | Unit tests (`test:shared`, `test:api`) |
| `npm run lint` | API syntax check + a full frontend production build (`lint:api`, `lint:web`) |

### Database

| Command | What it does |
|---------|--------------|
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:migrate` | Create/apply a migration locally |
| `npm run db:deploy` | Apply migrations (deploy) |
| `npm run db:seed` | Categories, departments, roster names/phones, Steve Martin admin (idempotent) |
| `npm run db:import -- <file.csv> [--apply]` | Phase 3 employee import; dry run unless `--apply` |
| `npm run db:reset` | Drop, migrate and re-seed |
| `npm run db:status` | Migration status |

### Docker — production shape (`infra/docker-compose.yml`)

| Command | What it does |
|---------|--------------|
| `npm run docker:build` | Build the two images (`web`, `api`) |
| `npm run docker:up` / `docker:down` | Frontend + backend containers on `WEB_PORT` |
| `npm run docker:rebuild` | Rebuild and force-recreate both containers |
| `npm run docker:logs` / `docker:ps` / `docker:shell` | Inspect the running stack |

`stack:up`, `stack:down`, `stack:logs`, `stack:ps` are aliases of the
`docker:*` commands.

### Docker — development (hot reload, `infra/docker-compose.dev.yml`)

| Command | What it does |
|---------|--------------|
| `npm run dev:stack` / `dev:stack:bg` | db + app (supervisord: `node --watch` + `next dev`) |
| `npm run dev:split` | db + api + web separately (development only) |
| `npm run dev:stack:down` / `dev:stack:reset` | Stop (keep data) / stop and wipe the DB |

### Checks

| Command | What it does |
|---------|--------------|
| `npm run smoke` | End-to-end phase flow against a local test stack (changes election data) |

## Initial accounts

The seed reads only `FIRSTNAME`, `LASTNAME` and `PHONE` from the workbook, skips later
duplicate phone rows, and creates the first admin as Steve Martin in Finance using
`BOOTSTRAP_ADMIN_PHONE` (default `+254706831847`). Other roster accounts start as employees;
Steve can assign committee and additional admin roles in the admin console. Employees choose
their department at first sign-in. The workbook is not copied into Docker images.

## Voting flow tests

```bash
npm run test:five-browsers     # five isolated browser contexts; exercises multi-browser sign-in
npm run test:cycle             # drives the API from Phase 1 through published results
```

All browser, cycle and smoke tests require `TEST_DATABASE_URL` to point to a local
disposable database whose name contains `test` or `dev`, or to the development stack on
port `5434`. The cycle and smoke tests modify election data; never point them at a live
election database.

## How the phases work

```
NOT_STARTED → PHASE_1 (nominations) → PHASE_2 (committee) → PHASE_3 (final vote) → CLOSED → PUBLISHED
```

1. **Phase 1** — every employee nominates one colleague per category (justification, min 20
   characters). Picks can be replaced until the phase closes; one self-nomination in total.
   The admin confirms the cut: **top 5 per category**, the pooled **top 15 people**, plus
   any category finalists needed to keep every category represented.
2. **Phase 2** — the committee makes one pick per category among Phase 2 candidates
   (1 point each), blocked on declared conflicts. The admin confirms the pooled **top 6–10
   people overall** plus any category finalists needed to keep every category represented.
   Team of the Year advances its top 5 teams, then the top 3.
3. **Phase 3** — every employee casts one confidential, final vote per category. The
   candidate with the most points wins; ties go to Phase 2 points, then Phase 1 points, then
   the admin.

Tallies are admin-only and only while a phase is being closed. Points are saved on each
`Candidate` row when a cut is confirmed, so results cannot change afterwards.

## Repository layout

```
backend/          Express API, Prisma schema, seed, employee importer
frontend/         Next.js app (login, employee, committee, admin)
packages/shared/  constants, phase metadata, scoring math
infra/            compose files (prod-shaped + dev), supervisord configs
docs/             context, roadmap, architecture, api, deploy, runbook
scripts/          dev runner, end-to-end smoke test
Dockerfile        frontend runtime plus --target backend API image
```
