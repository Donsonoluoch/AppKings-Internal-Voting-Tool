# Architecture

## Shape

```
┌───────────────────┐       ┌───────────────────────────────┐
│ web container     │       │ api container                 │
│ Next.js :3000 ────┼─/api─▶│ Express :4000 + PostgreSQL    │
└───────────────────┘       └──────────────────┬────────────┘
                                               │
                                  persistent Docker volume
```

- **Exactly two containers.** `Dockerfile` builds the Next.js runtime and an API image
  that also runs PostgreSQL. The database files live in a named Docker volume.
- **One public port.** Only the web app is exposed. Its same-origin `/api/*` proxy reaches
  Express over the private Compose network, so the session cookie remains first-party.
- **Shared Docker network.** The web container points `API_INTERNAL_URL` at `api:4000`.
- **Local database socket.** PostgreSQL listens only on `127.0.0.1` inside the API
  container; it is not published to the host or reachable from the web container.

## Workspaces

| Workspace | Package | Role |
|-----------|---------|------|
| `backend` | `@appkings/backend` | Express API, Prisma, business rules |
| `frontend` | `@appkings/frontend` | Next.js App Router UI, Tailwind |
| `packages/shared` | `@appkings/shared` | Constants, phases, pure scoring math (CommonJS, no build step) |

The shared package is the single place where a rule that both apps need is written down:
category list, phase metadata, `rankWithTies`, `pooledTotals`, `compareByTieBreak`,
`rankCategory`.

## Backend layout

```
src/
├─ index.js            boot: listen, then check the database and say so
├─ app.js              helmet, CORS, cookies, /api/health[/ready], routing, error handler
├─ config.js           every env-driven rule in one object (config.rules)
├─ middleware/
│  ├─ auth.js          loadUser (DB-checked session), requireAuth
│  ├─ role.js          requireRole — roles are additive (ADMIN ≥ COMMITTEE ≥ EMPLOYEE)
│  ├─ phase.js         attachPhase (on every request), requirePhase('PHASE_1', …)
│  ├─ audit.js         clientIp, auditAction
│  ├─ validate.js      zod → req.validated
│  └─ asyncHandler.js  Express 4 async wrapper
├─ routes/
│  ├─ auth.js          login with device binding, logout, me
│  ├─ employee.js      categories, colleagues, nominations, shortlist, votes, results
│  ├─ committee.js     nominations view, candidates, picks, conflicts
│  └─ admin.js         employees, departments, phases, tally, confirm cut, audit, publish
└─ lib/
   ├─ prisma.js        one client
   ├─ scoring.js       results + /results/me, assembled from the DB
   ├─ tally.js         the cuts (§5): compute, check, save
   ├─ session.js       JWT + device token hash + cookie options
   ├─ phone.js         +2547XXXXXXXX normalisation
   ├─ csv.js           small RFC-4180-ish parser (no dependency)
   ├─ settings.js      the single Settings row (holds the phase)
   ├─ audit.js         audit() never throws; VOTE_CAST carries no candidate
   └─ errors.js        ApiError + the error codes in docs/api.md
```

### Request lifecycle

```
request ─▶ helmet ─▶ CORS ─▶ json ─▶ cookieParser
        ─▶ attachPhase  (Settings.phase on req.phase)
        ─▶ loadUser     (JWT cookie → Employee row; inactive users are anonymous)
        ─▶ route        (requireAuth / requireRole / requirePhase / validate)
        ─▶ handler      (Prisma; audit() after every write)
        ─▶ error handler → { error: { code, message, details } }
```

### Where the rules live

| Rule (context §11) | Enforced in |
|--------------------|-------------|
| Phase gating | `requirePhase` on every write route |
| Role gating | `requireRole` on the committee and admin routers |
| Self-nomination limit | `routes/employee.js`, inside the same transaction as the upsert |
| One nomination per category | DB unique `(categoryId, nominatorId)` + upsert |
| Eligible nominee only | `routes/employee.js` nomination handler |
| Justification ≥ 20 characters | `config.rules.minJustification` |
| Cut sizes, ties, minimum candidates | `lib/tally.js` (`cutProblems`, `applyCut`) |
| Phase move requires a confirmed cut | `routes/admin.js` `/phase` |
| Committee pick limit and conflicts | `routes/committee.js` `/picks` |
| One vote per category | `VoteReceipt` unique + single transaction |
| Confidential votes | `Vote.voterId` stays null; audit records category only |
| Results hidden until published | `routes/employee.js` `/results`, `/results/me` |
| Every write audited | `audit()` calls in every mutating handler |

## Data flow: one cut

```
Nominations ──groupBy──▶ per-category points ──top 5──▶ finalists
                                                          │
                                      pooledTotals ◀──────┘  (people only, teams excluded)
                                            │
                                 rankWithTies(limit 15)
                                            │
              admin confirms ── applyCut ──▶ Candidate rows:
                                             nominationPoints, inPhase2=true for pooled cut
```

The pooled limit is advanced, plus candidates from each category's top five as needed to
preserve the minimum category coverage. Phase 2 repeats the pool with `CommitteeVote`
points and flags `inPhase3`;
closing Phase 3 writes `finalPoints` from `Vote` counts. Once saved, a row's points never
move again.

## Frontend layout

```
app/
├─ login/                phone + Continue
├─ employee/             dashboard, nominate, vote, results (+ "your points")
├─ committee/            candidate review, candidate detail, picks
├─ admin/                phase control, employees, tally, audit, results
└─ api/[...path]/route.js  same-origin proxy → Express
components/              AppShell, Nav, PhaseBanner, ResultsTable, ConfirmDialog, Alert, …
lib/                     api.js (fetch + device token), auth-context.js (session, role gate)
```

`useRequireRole` is a convenience gate only; the server re-checks every rule.

## Security posture

- Session: JWT (12 h) in an httpOnly, SameSite=Lax cookie; `Secure` behind HTTPS.
- Device token: 32 random bytes, only its SHA-256 stored; timing-safe comparison; one
  admin reset per employee.
- Input: zod on every body; errors never echo stack traces.
- Headers: helmet on the API; `next.config.mjs` adds nosniff, frame-deny, referrer policy.
- Privacy: `/colleagues` never returns phones; `Vote` has no voter link; admin results show
  totals only.
