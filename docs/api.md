# API reference

Base URL: `/api` on the web origin (the Next.js proxy forwards to Express). The session is
an httpOnly cookie; the browser sends it automatically.

Error shape, always:

```json
{ "error": { "code": "PHASE_CLOSED", "message": "This action is only available in PHASE_1. The current phase is PHASE_2.", "details": [] } }
```

| Code | Status | When |
|------|--------|------|
| `UNAUTHENTICATED` | 401 | No or expired session |
| `FORBIDDEN` | 403 | Role not allowed |
| `ACCOUNT_INACTIVE` | 403 | Employee switched off |
| `VALIDATION_ERROR` | 400 | zod rejected the body |
| `NOT_FOUND` | 404 | Unknown id |
| `PHASE_CLOSED` | 409 | Action not allowed in the current phase |
| `TIE_UNRESOLVED` | 409 | A tie sits on a cut line |
| `CUT_NOT_CONFIRMED` | 409 | The cut was not confirmed before moving on |
| `CONFLICT` | 409 | Duplicate vote or other state conflict |
| `RATE_LIMITED` | 429 | Too many failed logins |

---

## Health

| Method | Route | Response |
|--------|-------|----------|
| GET | `/health` | `{ ok: true, env }` — liveness |
| GET | `/health/ready` | `{ ok: true, db: "up", phase }` or 503 — readiness |

## Auth

### `POST /auth/login`
```json
{ "phone": "0712345678", "departmentId": "…optional…" }
```
For an employee without a department, the first request returns
`{ requiresDepartment: true, departments: [{ id, name }] }` without creating a session.
Submit again with the selected `departmentId` to save it and sign in.
`200` → `{ user: { id, fullName, phone, role, department }, phase }`. Subsequent sign-ins
require only the phone number. Rate limited to `LOGIN_RATE_LIMIT` (default 10) failed
attempts per 15 minutes per IP. Phone-only login does not verify control of the phone number.

### `POST /auth/logout` → `{ ok: true }` (clears the cookie)
### `GET /auth/me` → `{ user, phase, phaseMeta, resultsPublic, rules }`
`rules` is `config.rules`: `selfNominationLimit`, `minJustification`, `topPerCategory`,
`phase1Finalists`, `phase2FinalistsMin/Max`, `minCandidatesPerCategory`, `teamFinalists`,
`committeePicksPerCategory`.

---

## Employee

### `GET /categories` → `{ categories: [{ id, name, criteria, forTeams, sortOrder }] }`

### `GET /colleagues`
→ `{ colleagues: [{ id, fullName, department, isSelf }], teams: [{ id, name }] }`
No phone numbers, ever.

### `GET /nominations/summary`
→ `{ total, selfNominated, selfNominationsRemaining, selfNominationLimit, byCategory }`

### `PUT /nominations` — Phase 1 only
```json
{ "categoryId": "…", "nomineeId": "…", "justification": "at least 20 characters" }
```
Team of the Year takes `nomineeDeptId` instead of `nomineeId`. Replaces this employee's
previous nomination in that category. `200` → `{ nomination }`.
`409 CONFLICT` when the one allowed self-nomination is already used in another category.

### `GET /nominations/mine`
→ `{ nominations: [{ id, categoryId, categoryName, nomineeId, nomineeDeptId, nominee, justification, isSelf, createdAt }] }`

### `GET /shortlist` — Phase 3 onwards
→ `{ categories: [{ ...category, hasVoted, candidates: [{ id, name, kind: "employee"|"team", department }] }] }`

### `POST /votes` — Phase 3 only
```json
{ "categoryId": "…", "candidateId": "…" }
```
`201` → `{ ok: true, categoryId }`. `409 CONFLICT` on a second vote in the category. The
vote row carries no voter id; a `VoteReceipt` records that this employee has voted.

### `GET /votes/status` → `{ voted: [{ categoryId, createdAt }] }`

### `GET /results` — results released to employees
→ `{ published, publications: { phase1, phase2, phase3 }, phaseResults: { phase1, phase2 }, results, overall }`

The publication flags and three phase slots are available to every signed-in user so the
shared results page can show publication status for the full election. Scores are returned
only for phases the admin has published. Phase 1 can be released after moving to Phase 2,
Phase 2 after moving to Phase 3, and Phase 3 after closing the final vote. `published`
indicates whether the final phase is public; `results` and `overall` are empty until then.
Admins may also preview unpublished results.

### `GET /results/me` — final results published only
→ `{ published, categories: [{ categoryId, categoryName, nominationPoints, committeePoints, finalPoints, totalPoints, inPhase2, inPhase3 }], totals }`

---

## Committee (`COMMITTEE` or `ADMIN`)

### `GET /committee/nominations` — Phase 1 or 2
→ `{ categories: [{ ...category, nominees: [{ nomineeId, nomineeDeptId, name, department, nominationCount, nominators, justifications, isCandidate }] }] }`

### `GET /committee/candidates` — Phase 2
→ `{ categories: [{ ...category, candidates: [{ id, name, kind, department, eligible, nominationPoints, inPhase2, inPhase3, myPick, hasConflict, conflictReason }] }], picksPerCategory }`
Only the caller's own pick is ever included.

### `GET /committee/candidates/:id` — Phase 2
→ `{ candidate, justifications: [{ nominator, justification, isSelf, createdAt }] }`

### `PUT /committee/picks` — Phase 2
```json
{ "categoryId": "…", "candidateIds": ["…"] }
```
At most `COMMITTEE_PICKS_PER_CATEGORY` ids, no duplicates, same category, Phase 2
candidates only, none of them conflict-declared by the caller. Replaces the caller's picks
in that category. `403 FORBIDDEN` on a conflict.

### `POST /committee/conflicts` — Phase 2
```json
{ "candidateId": "…", "reason": "optional" }
```
`201` → `{ ok: true }`. Removes any pick the member already made for that candidate.

### `GET /committee/picks` — Phase 2
→ `{ picks: { [categoryId]: [candidateId] }, picksPerCategory }`

---

## Admin (`ADMIN`)

### Employees
- `GET /admin/employees?search=` → `{ employees: [...] }` (includes phone — admin only)
- `POST /admin/employees/import` `{ csv, dryRun? }` → `{ created, updated, skipped: [{ line, reason }], departmentsCreated }`
- `PATCH /admin/employees/:id` `{ fullName?, role?, eligible?, active?, departmentId? }`
- `GET /admin/departments` / `POST /admin/departments` `{ name }`

### Phases and cuts
- `POST /admin/phase` `{ phase, confirm: true }` → `{ phase, phaseMeta }`. Forward only.
  Gate checks: `409 CUT_NOT_CONFIRMED` / `409 TIE_UNRESOLVED` / `409 CONFLICT`.
- `POST /admin/reset-cycle` `{ confirm: "RESET" }` → `{ ok, phase: "NOT_STARTED", deleted }`.
  Available from any phase to admins only. This clears nominations, candidates,
  committee picks, conflicts, votes, vote receipts and publications while preserving employee
  accounts, roles, departments and the audit log. The action returns the cycle to
  `NOT_STARTED` and is recorded as `CYCLE_RESET`.
- `GET /admin/tally` → `{ phase, tally, problems }`
  - `tally.categories[]`: `{ categoryId, categoryName, forTeams, rows, finalists, tiedAtCutoff, shortOfMinimum }`
  - `tally.people[]`: pooled ranking with `rank`, `points`, `advances`
  - `tally.teams[]`: Team of the Year track (Phase 2)
- `POST /admin/candidates/confirm` `{ resolveTies?: boolean }` → `{ people, teams, resolvedTies }`
  Returns `409 TIE_UNRESOLVED` with the problems listed unless `resolveTies` is true.
- `POST /admin/candidates/:id/remove` → `{ ok: true }`

### Audit and results
- `GET /admin/audit?page=&pageSize=&action=` → `{ page, pageSize, total, entries }`
- `GET /admin/results` → `{ phase, published, publications, phaseResults, results, rules }`
- `POST /admin/publish` `{ stage: "PHASE_1" | "PHASE_2" | "PHASE_3", acknowledgeTies?: true }`
  → `{ ok: true, stage, phase, publications }`. Stage defaults to `PHASE_3` for existing
  callers. Phase 1/2 publishing requires that phase to be closed by advancing; Phase 3
  publishing requires CLOSED and moves the cycle to PUBLISHED.

### Audit actions
`LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `DEPARTMENT_ASSIGNED`, `PHASE_CHANGE`, `NOMINATE`,
`COMMITTEE_PICK`, `CONFLICT_DECLARED`, `CUT_CONFIRMED`, `CANDIDATE_REMOVED`, `VOTE_CAST`
(category only), `RESULTS_PUBLISHED`, `EMPLOYEE_IMPORTED`, `EMPLOYEE_UPDATED`,
`DEPARTMENT_CREATED`, `CYCLE_RESET`.
