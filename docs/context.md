# AppKings Solutions – 2026 Employee Awards Voting System

> Internal recognition and voting portal. Three phases: **Nominate → Shortlist → Final Vote**.
> Build target: **Wednesday → Monday**, small team, minimal complexity, reliable.
>
> This is the source of truth for behaviour. When code and this document disagree, this
> document wins — or this document is updated in the same commit as the code.

---

## 1. Decisions and assumptions

**Settled**
- Scoring is **points only**. Nothing is converted to a percentage, and `MAX_SCORE` is removed.
- All three phases work the same way: each voter makes **one pick per category**, and each pick is worth **1 point**.
- Self-nomination: each employee may nominate themselves **once in total** across all categories, and only in Phase 1 (`SELF_NOMINATION_LIMIT=1`).
- Phase 1 is a tally. The committee judges merit in Phase 2, and the whole team decides in Phase 3.

**Assumptions to confirm** (each one lives in config or a single function, so it is cheap to change)

| # | Question | Assumption used in this doc |
|---|----------|------------------------------|
| 1 | What exactly is the "top 15"? | After Phase 1 the **top 5 per category** are finalists. Each person's points are summed across those categories, and the **top 15 people overall** advance; category finalists are added where needed to preserve the minimum (§5). |
| 2 | How does the committee pick in Phase 2? | One pick per category from the Phase 2 candidates, 1 point each (`COMMITTEE_PICKS_PER_CATEGORY=1`, can be raised). The top **6–10 people overall** advance; category finalists are added where needed to preserve the minimum. |
| 3 | What if a category runs short after the pooled cut? | Every category must keep at least 2 candidates (`MIN_CANDIDATES_PER_CATEGORY=2`). The cut automatically protects the highest-ranked candidates from that category's top 5, in addition to the pooled people. |
| 4 | How is a category winner decided? | Most Phase 3 points in that category. Ties are broken by Phase 2 points, then Phase 1 points, then the admin decides. |
| 5 | Is Employee of the Year its own category, or the person with the highest overall total? | Its own category, voted like the others. Each person's overall total is shown as information. **Confirm.** |
| 6 | Team of the Year: the nominee is a team, not a person. | It runs as its own track. Top 5 teams after Phase 1, top 3 after Phase 2 (`TEAM_FINALISTS=3`), then the final vote. Teams are not part of the pooled people ranking. Departments exist in this design **only** for this category, so see the note under §8. |
| 7 | Do committee members also take part in Phases 1 and 3? | Yes. They are employees too (the committee role is additional). |
| 8 | Can a committee member pick someone they declared a conflict with? | No. A declared conflict blocks that member from picking that candidate. |

---

## 2. Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js (JavaScript, App Router) + Tailwind CSS |
| Backend | Express.js (JavaScript) |
| ORM | Prisma |
| Database | PostgreSQL |
| Auth | Phone number, session via signed JWT in an httpOnly cookie; department on first login |
| Hosting (suggested) | One VPS, or Render/Railway for the API and DB, Vercel for the frontend |

The repo is a monorepo with three workspaces (`backend`, `frontend`, `packages/shared`).
Production Compose runs exactly two containers (frontend, and API + PostgreSQL) — see
`docs/deploy.md`.

```
appkings-voting/
├─ Dockerfile                 frontend runtime image and --target backend API image
├─ infra/
│  ├─ docker-compose.yml      exactly two containers: web; api + PostgreSQL
│  ├─ docker-compose.dev.yml  local development stack, with hot reload
│  └─ supervisord(.dev).conf  local combined-process development runner
├─ backend/
│  ├─ prisma/schema.prisma
│  ├─ prisma/seed.js          categories, departments, workbook names/phones, Steve Martin admin
│  ├─ prisma/import-employees.js   Phase 3 real employee import
│  ├─ src/
│  │  ├─ index.js
│  │  ├─ middleware/ (auth.js, role.js, phase.js, audit.js, validate.js)
│  │  ├─ routes/ (auth, employee, committee, admin)
│  │  └─ lib/ (prisma.js, scoring.js, tally.js, phone.js, csv.js, session.js, audit.js)
│  └─ .env
├─ frontend/
│  ├─ app/ (login, employee, committee, admin, results)
│  ├─ components/
│  └─ lib/api.js
├─ packages/shared/           constants, phases, scoring math used by both apps
└─ docs/                      this file + architecture, api, deploy, runbook, roadmap
```

**Authentication limitation:** sign-in accepts a registered phone number without verifying
control of it. There is no device lock or SMS/OTP challenge, so this is a trust-based
internal login and does not prove identity.

---

## 3. Roles and portals

A user has one `role`: `EMPLOYEE`, `COMMITTEE` or `ADMIN`. Committee and Admin can also access the Employee portal features.

### Employee portal
- Sign in with a registered phone number; choose a department on first sign-in if needed
- Submit nominations (Phase 1 only)
- View shortlisted nominees (Phase 2 results and Phase 3)
- Vote (Phase 3 only)
- Open the shared Published results page at any time; only phases the admin has published are shown, with personal points available after final publication

### Committee portal
- View submitted nominations
- Review candidate details, justifications and evidence
- Pick the strongest candidate per category (one pick per category, 1 point each)
- Declare conflicts of interest
- Open the shared Published results page

### Administrator portal
- Import the real roster (seed reads only names and phone numbers)
- Manage departments and employee eligibility
- Open and close each phase (and move to the next one)
- Review tallies and confirm the cuts (top 5 per category, minimum category coverage, and pooled limits after Phases 1 and 2), resolving ties
- Assign roles and departments
- View audit logs
- Publish results for each closed phase
- Open the shared Published results page separately from the publishing controls
- Open the shared Published results page separately from the publishing controls

---

## 4. Awards categories

1. Most Consistent Staff
2. Customer Satisfaction Champion
3. Dedicated and Most Committed Employee
4. Extra Milestone Achiever
5. Innovator of the Year
6. Outstanding Leadership
7. Employee of the Year 2026
8. Team of the Year (nominees are departments or teams)

Seed these 8 categories at setup. Each has a short `criteria` text shown to committee members when scoring.
They live in `packages/shared/constants.js` and are upserted by `backend/prisma/seed.js`.

---

## 5. Phases

All three phases use the same mechanism: **point accumulation**. Each voter makes **one pick per category**, each pick is **1 point**, and points are simply added up. There are no percentages.

| Phase | Who takes part | Action | Outcome |
|-------|----------------|--------|---------|
| 1 | All 57 roster accounts | One nomination per category, with a justification | Top 5 per category; pooled **top 15 people** plus category-coverage candidates as needed |
| 2 | Committee members | One pick per category among Phase 2 candidates | Pooled **top 6–10 people** plus category-coverage candidates as needed |
| 3 | All 57 roster accounts | One vote per category among the shortlist | Most points in a category wins |

```
NOT_STARTED → PHASE_1 (nominations) → PHASE_2 (committee) → PHASE_3 (final vote) → CLOSED → PUBLISHED
```

### How a cut works (after Phase 1 and after Phase 2)
1. **Tally per category.** Add up the points each candidate received in each category.
2. **Category finalists.** Take the top 5 per category (Phase 1 only).
3. **Pooled ranking.** Each person's total is the sum of their points across the categories where they made the top 5. Rank people by that total.
4. **Advance.** The top 15 people advance after Phase 1, and the top 6–10 after Phase 2. The highest-ranked candidates needed to keep every category represented by at least 2 people are also advanced, even when that makes the total shortlist larger than the pooled limit. A person who advances stays a candidate in every category where they were a finalist.
5. **Ties.** A tie across a cut line is flagged. After Phase 2 it is broken by Phase 1 points first, and if still tied the admin decides. After Phase 1 the admin decides.
6. **Safety check.** Every category must keep at least 2 candidates. The cut protects the highest-ranked people from each category's top 5 in addition to the pooled limit.
7. **Save.** Points are stored on each `Candidate` row when the cut is confirmed, so results can't change later.

Tallies are visible to the admin only while a phase is open. After the admin closes a
phase by advancing, they can publish that phase's results to all employees. Unpublished
phase results remain admin-only.

**Example:** Ayan gets 9 nominations in Innovator and 6 in Customer Satisfaction, and is in the top 5 of both. Her pooled total is 15. Brian gets 12 nominations in Consistent Staff only, so his total is 12. Ayan ranks above Brian in the pooled list.

**Implementation:** `backend/src/lib/tally.js` (`computePhase1Tally`, `computePhase2Tally`, `cutProblems`, `applyCut`) and the pure math in `packages/shared/scoring.js` (`rankWithTies`, `pooledTotals`).

### Phase 1: Employee nominations
- All 57 roster accounts nominate **one colleague per category** (up to 8 nominations). Skipping a category is allowed.
- Each nomination requires a **justification** (min. 20 characters).
- Employees can change their nomination in a category until Phase 1 closes (`PUT /api/nominations` replaces it — unique on `(categoryId, nominatorId)`).
- Self-nomination is allowed **once in total** across all categories. It counts as 1 point like any other nomination.
- Team of the Year nominates a team (department) instead of a person.
- Result: the pooled top 15 plus category finalists needed to preserve minimum coverage (see the cut above).

### Phase 2: Committee review and shortlisting
- The committee reviews the pooled finalists and any category-coverage candidates, their justifications and the evidence, and checks eligibility. The admin can remove an ineligible candidate before the cut.
- In each category, every committee member makes **one pick** among the candidates in that category. Each pick is 1 point. Picks can be changed until the phase closes.
- A member who declares a conflict of interest cannot pick that candidate.
- Result: the pooled top 6–10 people overall advance, plus category finalists needed to preserve minimum coverage. Team of the Year advances its top 3 teams.
- With a small committee, ties are likely. If that happens, raise `COMMITTEE_PICKS_PER_CATEGORY` to 2 or 3.

### Phase 3: Final employee voting
- Every employee, committee members included, sees the shortlisted candidates per category.
- Each employee casts **one vote per category**, worth 1 point. Votes are final once submitted.
- Voting is **confidential** (see §9).
- No campaigning, lobbying or vote solicitation. This policy is shown on the voting page.
- The candidate with the **most points** in a category wins. Ties follow the rule in §1 #4.
- The admin closes voting, reviews the results, then **publishes**.
- The admin can publish Phase 1 after advancing to Phase 2 and Phase 2 after advancing to Phase 3.
- The admin closes final voting and publishes Phase 3 results. Employees can see each released
  phase; each candidate can see their own points per phase, per category and overall (`/results/me`)
  after final publication.

---

## 6. Scoring

Points only. Nothing is converted to a percentage.

```js
// packages/shared/scoring.js
// rows: [{ id, points }]. Returns the ranking and whether a tie spills over the cut limit.
function rankWithTies(rows, limit) {
  const sorted = [...rows].sort((a, b) => b.points - a.points);
  const tiedAtCutoff =
    sorted.length > limit && sorted[limit].points === sorted[limit - 1].points;
  return { sorted, tiedAtCutoff };
}

// slots: [{ personId, points }], one per category where the person is a finalist.
// Returns each person's pooled total, highest first.
function pooledTotals(slots) {
  const totals = new Map();
  for (const s of slots) {
    totals.set(s.personId, (totals.get(s.personId) || 0) + s.points);
  }
  return [...totals]
    .map(([id, points]) => ({ id, points }))
    .sort((a, b) => b.points - a.points);
}
```

Tie-break chain for a pooled cut or a category winner: this phase's points, then the earlier phases' points (Phase 2, then Phase 1), then the admin decides. Never auto-resolve the final tie (`compareByTieBreak`, `rankCategory`).

---

## 7. Login and department onboarding

The login accepts a registered phone number. It does not verify control of that number;
this is an intentional trust-based company workflow, not identity verification.

**UI:** enter a phone number → if the employee has no department, choose one from the
preseeded company departments → save and sign in. The application welcomes the employee
by name after authentication. Later logins need only the phone number and work from any
browser.

**Rules**
1. Normalize numbers to `+2547XXXXXXXX` before storing or comparing.
2. Unknown or inactive accounts cannot sign in.
3. If an active employee has no department, the login endpoint returns the department
   options without issuing a session. The employee selects one; the server saves it,
   records `DEPARTMENT_ASSIGNED`, and then issues the session.
4. A department already assigned to an employee cannot be changed through login; an
   administrator can update it from the employee console.
5. Login attempts are rate limited (default 10 failed attempts per 15 minutes per IP).
   Only failed attempts count, so staff behind one office IP do not lock each other out.

```
POST /api/auth/login { phone }
  → if department is missing: { requiresDepartment: true, departments: [...] }
POST /api/auth/login { phone, departmentId }
  → save department, issue session, return employee name and role
```

---

## 8. Data model (Prisma)

> Departments are used for Team of the Year and as employee profile data; the first-login
> onboarding lets staff assign the missing department from the preseeded list.

See `backend/prisma/schema.prisma` for the authoritative version. The models:

- `Department` — company departments and Team of the Year nominees.
- `Employee` — name, phone, role, `eligible`, `active` and department.
- `Category` — 8 seeded categories, `criteria`, `forTeams`, `sortOrder`.
- `Nomination` — `categoryId`, `nominatorId`, `nomineeId` **or** `nomineeDeptId`, `justification`, `isSelf`; `@@unique([categoryId, nominatorId])` (one per category, replaceable until Phase 1 closes).
- `Candidate` — one row per category slot: `nominationPoints`, `committeePoints`, `finalPoints`, `inPhase2`, `inPhase3`.
- `CommitteeVote` — `candidateId`, `memberId`, `categoryId`; `@@unique([candidateId, memberId])` (max `COMMITTEE_PICKS_PER_CATEGORY` per member per category is enforced in code).
- `Conflict` — `candidateId`, `memberId`, `reason`.
- `Vote` — `categoryId`, `candidateId`, `voterId` (always `null`, see §9).
- `VoteReceipt` — `voterId`, `categoryId`, `@@unique([voterId, categoryId])` (who has voted, not for whom).
- `Settings` — one row: `phase`, per-phase publication flags, and `resultsPublic` for Phase 3.
- `AuditLog` — `actorId`, `action`, `details`, `ip`.

> **Note on `Vote.voterId`:** to keep voting confidential, leave `voterId` **unused** (always `null`). Use `VoteReceipt` for "has this person voted already?" See §9.

---

## 9. Confidential voting

- `Vote` stores category and candidate only, with **no voter id**.
- `VoteReceipt(voterId, categoryId)` has a unique constraint. It stops double voting, and it only shows *who* has voted, not *for whom*.
- Both inserts run in a **single Prisma transaction**. If either fails, neither is saved.
- Audit log entry for a vote records `VOTE_CAST` with category only, never the candidate.
- Admin results view shows totals only.

---

## 10. API (Express)

All routes are prefixed with `/api`. Auth is a cookie session. Middleware: `requireAuth`, `requireRole(...)`, `requirePhase(...)`.
Full request/response reference: `docs/api.md`.

### Auth
| Method | Route | Notes |
|--------|-------|-------|
| POST | `/auth/login` | Phone login; first login can assign a department |
| POST | `/auth/logout` | Clears the cookie |
| GET | `/auth/me` | Current user, current phase and the rules the UI renders |
| GET | `/health`, `/health/ready` | Liveness / readiness (database check) |

### Employee
| Method | Route | Phase | Notes |
|--------|-------|-------|-------|
| GET | `/categories` | any | Categories and criteria |
| GET | `/colleagues` | any | List of eligible nominees (includes self, flagged `isSelf`). No phone numbers. |
| PUT | `/nominations` | PHASE_1 | `{ categoryId, nomineeId or nomineeDeptId, justification }`: one per category, replaces the earlier choice until Phase 1 closes |
| GET | `/nominations/mine` | any | Own submitted nominations |
| GET | `/nominations/summary` | any | Counts + self-nomination budget |
| GET | `/shortlist` | PHASE_3+ | Shortlisted candidates per category |
| POST | `/votes` | PHASE_3 | `{ categoryId, candidateId }`, one per category |
| GET | `/votes/status` | PHASE_3 | Which categories this user has voted in |
| GET | `/results` | Any published phase | Released phase totals; final totals only after Phase 3 publication |
| GET | `/results/me` | Phase 3 published | The caller's own points per phase, per category and overall |

### Committee
| Method | Route | Phase | Notes |
|--------|-------|-------|-------|
| GET | `/committee/nominations` | PHASE_1, PHASE_2 | Nominations and justifications grouped by nominee |
| GET | `/committee/candidates` | PHASE_2 | The pooled Phase 2 candidates plus any per-category coverage candidates, shown per category |
| GET | `/committee/candidates/:id` | PHASE_2 | One candidate with every justification and evidence |
| PUT | `/committee/picks` | PHASE_2 | `{ categoryId, candidateIds[] }`, max `COMMITTEE_PICKS_PER_CATEGORY`, 1 point each. Replaces the member's previous picks (blocked on conflict) |
| POST | `/committee/conflicts` | PHASE_2 | `{ candidateId, reason }` |
| GET | `/committee/picks` | PHASE_2 | The member's own picks only (never other members' picks or tallies) |

### Admin
| Method | Route | Notes |
|--------|-------|-------|
| POST | `/admin/employees/import` | CSV upload: `fullName, phone, department, role` |
| GET/PATCH | `/admin/employees` | List, edit eligibility/active/role/department |
| GET/POST | `/admin/departments` | Manage teams |
| POST | `/admin/phase` | `{ phase }`, move forward only (with confirmation) |
| GET | `/admin/tally` | Per-category ranking, the pooled people ranking and tie flags for the closed phase |
| POST | `/admin/candidates/confirm` | Confirms the cut (resolves ties) |
| POST | `/admin/candidates/:id/remove` | Remove an ineligible candidate before the cut |
| GET | `/admin/audit` | Paginated audit log |
| GET | `/admin/results` | All phase tallies and overall totals (admin view) |
| POST | `/admin/publish` | Publishes one closed phase to everyone |

---

## 11. Business rules (enforce on the server, not just the UI)

- Phase gating: every write route uses `requirePhase`. A closed phase returns `409 PHASE_CLOSED`.
- Self-nomination: allowed only in Phase 1, and only if the employee has **0** existing self-nominations in *other* categories (`SELF_NOMINATION_LIMIT=1`). Checked inside the same transaction as the write.
- Only `eligible = true` employees can be nominated.
- One nomination per employee per category.
- Justification is required (min. 20 characters).
- Phase 2 → 3 is blocked unless 6–10 people are shortlisted overall, no tie is unresolved, and every category still has at least 2 candidates.
- Phase 1 → 2 is blocked until the top 15 is confirmed, no tie is unresolved, every category keeps at least `MIN_CANDIDATES_PER_CATEGORY` (2) candidates, and the required coverage fits within the configured limit.
- Committee: up to `COMMITTEE_PICKS_PER_CATEGORY` (default 1) pick per category, 1 point each, no duplicate picks. Picks can be changed until Phase 2 closes.
- Tallies are admin-only while a phase is open; an admin can publish them to everyone after
  that phase closes.
- A tie across the cut line blocks the phase change until the admin resolves it.
- A committee member with a declared conflict can't pick that candidate.
- One vote per employee per category. Votes can't be changed or deleted.
- Phases only move forward. To undo a mistake, use a database-level fix and record it in the audit log.
- Non-admins can see only the phases the admin has published; `/results/me` remains final-publication only.
- Every write action is recorded in `AuditLog`.

---

## 12. Frontend pages (Next.js, App Router)

```
/login                    Phone login (+254 7XX XXX XXX, Continue)
/employee                 Dashboard: current phase banner + what to do now
/employee/nominate        Phase 1: pick category, colleague, justification
/employee/vote            Phase 3: one card group per category, confirm dialog
/employee/results         Shared published phase results for every signed-in role; "Your points" after final publication
/committee                Category tabs → candidate list
/committee/candidate/[id] Details, justifications, conflict declaration
/committee/vote           Pick one candidate per category
/admin                    Phase control + progress stats
/admin/employees          Import roster, edit roles, departments and access
/admin/audit              Audit log
/admin/tally              Rankings, ties and cut confirmation
/admin/results            Phase results, overall totals and per-phase publish controls
```

UI guidance (keep it light):
- A **phase banner** at the top of every page shows the current phase and what's allowed.
- Redirect by role after login (employee, committee, admin).
- Tailwind only. No component library needed.
- Confirmation dialog before final vote submission ("This cannot be changed").
- Mobile-first: most staff will vote from their phones.

---

## 13. Security checklist (minimum for reliability)

- JWT in an **httpOnly, Secure, SameSite=Lax** cookie, with a 12-hour expiry.
- Phone-only sign-in is trust-based and does not prove phone ownership; use OTP if that assurance is required.
- Rate limit `/auth/login` (`express-rate-limit`).
- Validate all input with `zod`.
- CORS restricted to the frontend origin only, with credentials.
- `helmet` enabled.
- No secrets in the repo. Use `.env`.
- Daily Postgres backup during the voting window.
- Don't expose the employee phone list through any employee-facing endpoint. `/colleagues` returns names and departments only.

---

## 14. Environment variables

```
# backend/.env
DATABASE_URL=postgresql://user:pass@localhost:5432/appkings_voting
JWT_SECRET=change-me
FRONTEND_URL=http://localhost:3000
PORT=4000
SELF_NOMINATION_LIMIT=1
COMMITTEE_PICKS_PER_CATEGORY=1
TOP_PER_CATEGORY=5
PHASE1_FINALISTS=15
PHASE2_FINALISTS_MIN=6
PHASE2_FINALISTS_MAX=10
MIN_CANDIDATES_PER_CATEGORY=2
TEAM_FINALISTS=3

# frontend/.env.local
NEXT_PUBLIC_API_URL=/api      # same-origin; Next.js proxies /api/* to the API
```

---

## 15. Build plan: Wednesday → Monday

The delivery is split into three phases — see `docs/roadmap.md` for what "done" means in each.

| Day | Goal | Done when |
|-----|------|-----------|
| **Wed** | Repo, Prisma schema, migrations, roster seed, Express skeleton, phone login, role/phase middleware, audit helper | Registered users can sign in; missing departments can be assigned |
| **Thu** | Admin: employee list, role/department management, phase control. Employee: nomination page (one pick per category) and API | Roster loaded, nominations saved with rules enforced |
| **Fri** | Phase 1 tally: top 5 per category, protected minimum coverage and pooled top 15 (`pooledTotals`, `rankWithTies`), admin tally view and cut confirmation. Committee portal: candidate list, picks, conflicts. Phase 2 cut (6–10) | A full Phase 1 → 2 → 3 transition works with test data |
| **Sat** | Phase 3 voting (transaction, receipts), results from point totals, publish, results page and `/results/me` | A full end-to-end run with 5–10 test users |
| **Sun** | Audit log page, polish, mobile check, error messages, load test with ~60 logins | No blocking bugs, tested on real phones |
| **Mon** | Deploy, seed real employees, take a DB backup, **go live** | Phase 1 opened |

**Cut list if time is short** (in this order): audit log UI (keep the DB writes), conflict-of-interest UI, CSV import (use a seed script), results page styling.

**Must not be cut:** role/phase gating, vote transaction and receipt, the top 15 and 6–10 cut checks.

---

## 16. Testing checklist (do this Sunday)

- [ ] Same registered number can sign in from separate browser contexts.
- [ ] An employee without a department is asked to select one; later sign-ins need only the phone number.
- [ ] A nomination outside Phase 1 is rejected.
- [ ] First self-nomination in Phase 1 is accepted. A second self-nomination (any category) is rejected.
- [ ] Self-nomination is rejected outside Phase 1.
- [ ] A second nomination in the same category replaces the first (one per employee per category).
- [ ] Phase 1 tally: top 5 per category, protected minimum coverage, pooled totals and the top 15 match a manual calculation. A tie at a cut line blocks the phase change until the admin resolves it.
- [ ] A committee member can't exceed `COMMITTEE_PICKS_PER_CATEGORY` picks in a category, or pick the same candidate twice.
- [ ] Phase 2 → 3 is blocked if fewer than 6 or more than 10 people are shortlisted, or a category has fewer than 2 candidates.
- [ ] A committee member can't pick a candidate they declared a conflict with.
- [ ] A user can't vote twice in a category, even with two parallel requests.
- [ ] Vote table has no voter linkage.
- [ ] Results are invisible to employees until published.
- [ ] Points match a manual calculation for at least one category. No percentages are shown anywhere.
- [ ] `/results/me` shows an employee's own points per phase and category after publishing.
- [ ] Phase can't move backward.

`npm run smoke` automates most of this against a running stack.

---

## 17. Out of scope (v1)

SMS/OTP login, email notifications, real-time dashboards, vote editing, multi-year history, file uploads for evidence (use text/links in the justification for now).
