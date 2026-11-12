# Roadmap — three phases

The project ships in three phases. Each one ends in a working state that can be demoed,
tested and rolled back, and each has a clear exit check. `docs/context.md` is the spec;
this file is the sequence and the definition of done.

| Phase | Name | The system in one line | Exit check |
|-------|------|------------------------|------------|
| 1 | **Scaffold** | Every page, route, rule and container exists; test data proves the flows | `npm run test`, `npm run lint`, `npm run smoke` all pass |
| 2 | **Completion** | Nothing is cut; UX, audit, exports and go-live tooling are finished | Team run-through on phones with test users, no blocking bugs |
| 3 | **Seeding & go-live** | Real roster loaded, phone sign-in and department onboarding proven, Phase 1 opened | Admin has opened Phase 1 and taken a database backup |

---

## Phase 1 — Scaffold (done)

**Goal:** the whole system is wired end to end so the team can see and test the real
behaviour, with a test dataset standing in for the staff.

Included:

- Monorepo (`backend`, `frontend`, `packages/shared`) and the points-only scoring model.
- Prisma schema + migration for every model in context §8 (nominations, candidates with
  saved points, committee picks, conflicts, confidential votes + receipts, audit log and
  settings).
- All API routes in context §10, with phase gating, role gating and the §11 rules enforced
  server-side.
- All pages in context §12, including `/admin/tally` and `/results/me`.
- Registered phone login, first-login department assignment and audit writes.
- Two production containers (`web` and `api` + PostgreSQL), with the database persisted
  in a named volume (`Dockerfile`, `infra/docker-compose.yml`).
- Seed categories, company departments and roster names/phones; Steve Martin is the
  initial Finance admin.
- Tests: shared scoring unit tests, backend unit tests, `npm run smoke` for the full phase
  flow.

**Not included at this stage:** production employees, polished empty states, exports,
backup automation — they land in phase 2 and 3.

**Local run:** seed from the workbook, run `npm run dev`, then sign in using the configured
admin phone. Use a disposable database for cycle tests.

---

## Phase 2 — Completion

**Goal:** everything in context.md is finished, nothing is on the cut list, and the team
has walked the full cycle on real phones.

Work items:

1. **Audit log UI** — filter by action, actor and date; CSV export for the committee
   (context §3, §15 cut list).
2. **Conflict-of-interest UI** — a dedicated screen for committee members to declare and
   review conflicts, rather than only from the candidate page.
3. **Admin imports** — keep the CSV paste and add file upload with a dry-run preview
   (`POST /admin/employees/import` already supports `dryRun: true`).
4. **Results polish** — winner cards, "your points" summary for candidates, and a print
   view for the awards night.
5. **Error and empty states** across all pages; loading states on every fetch.
6. **Mobile pass** — every page usable on a 360 px screen, tap targets, safe areas.
7. **Load check** — 60 simulated logins and votes in 15 minutes; confirm rate limiting
   (failed attempts only) behaves behind one office IP.
8. **Accuracy review** — recompute one category by hand and compare with `/admin/results`.
9. **Handover pack** — short guides for staff, committee members,
   and the admin on duty.
10. **Real linting** — add ESLint (`eslint-config-next`) and replace `next lint` in
    `frontend/package.json`; `npm run lint` currently type-checks by building the app.

Exit check: the full Wednesday → Monday checklist in context §16 is ticked by a second
person, not the person who built it.

---

## Phase 3 — Seeding employee data and go-live

**Goal:** real people, department onboarding, Phase 1 open. No local demo accounts remain.

Order matters — do these in sequence:

1. **Back up** the current database: see `docs/deploy.md` → *Backups*.
2. **Seed from the approved workbook** using the one-time procedure in `docs/deploy.md`.
   Only names and phone numbers are imported. The later duplicate phone is skipped; Steve
   Martin is assigned the matching admin number and Finance department.
3. **Verify the roster** — `/admin/employees` shows 57 accounts: Steve as ADMIN, all other
   accounts as EMPLOYEE, and no roster phone duplicated.
4. **Assign roles** — Steve updates the committee members and any additional admins from
   `/admin/employees`.
5. **Verify onboarding** on a disposable account without a department. The first login
   requests a department; after saving, the next login asks only for the phone number.
6. **Take the go-live backup** and note the file name in the runbook
   (`docs/runbook.md` → *Go-live log*).
7. **Open Phase 1** — `/admin` → *Move to Phase 1 — Nominations*, with the typed
   confirmation. Tell staff that phone-only sign-in is trust-based and does not verify
   phone ownership.
8. **Watch the first hour** — `npm run docker:logs`, `/admin/audit` for failed logins,
   `/admin` for employees who still need to choose a department.

Exit check: Phase 1 is open, all 57 accounts are active, the first nominations have landed,
and a backup taken after the import exists.

---

## Rollback

| Situation | What to do |
|-----------|------------|
| Import looked wrong | Re-run with a corrected CSV — it updates by phone. Nothing else is touched. |
| Incorrect roster seed in a real database | Restore the backup from step 1 (`docs/deploy.md` → *Restore*). |
| A phase was opened by mistake | Phases only move forward by design. Fix at the database level and record it in the audit log (context §11). |
