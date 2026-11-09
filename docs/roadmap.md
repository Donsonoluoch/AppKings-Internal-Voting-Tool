# Roadmap — three phases

The project ships in three phases. Each one ends in a working state that can be demoed,
tested and rolled back, and each has a clear exit check. `docs/context.md` is the spec;
this file is the sequence and the definition of done.

| Phase | Name | The system in one line | Exit check |
|-------|------|------------------------|------------|
| 1 | **Scaffold** | Every page, route, rule and container exists; demo data proves the flows | `npm run test`, `npm run lint`, `npm run smoke` all pass |
| 2 | **Completion** | Nothing is cut; UX, audit, exports and go-live tooling are finished | Team run-through on phones with test users, no blocking bugs |
| 3 | **Seeding & go-live** | Real 60 employees loaded, device binding proven, Phase 1 opened | Admin has opened Phase 1 and taken a database backup |

---

## Phase 1 — Scaffold (done)

**Goal:** the whole system is wired end to end so the team can see and test the real
behaviour, with demo people standing in for the staff.

Included:

- Monorepo (`backend`, `frontend`, `packages/shared`) and the points-only scoring model.
- Prisma schema + migration for every model in context §8 (nominations, candidates with
  saved points, committee picks, conflicts, confidential votes + receipts, audit log,
  settings, device binding).
- All API routes in context §10, with phase gating, role gating and the §11 rules enforced
  server-side.
- All pages in context §12, including `/admin/tally` and `/results/me`.
- Login with device binding, single device reset, audit writes.
- Two production containers (`web` and `api` + PostgreSQL), with the database persisted
  in a named volume (`Dockerfile`, `infra/docker-compose.yml`).
- Seed with the 8 categories, 5 departments and 25 demo people (enough to exercise the
  top-5 / top-15 cuts).
- Tests: shared scoring unit tests, backend unit tests, `npm run smoke` for the full phase
  flow.

**Not included at this stage:** production employees, polished empty states, exports,
backup automation — they land in phase 2 and 3.

**Demo:** `npm run db:reset && npm run dev`, log in as `+254700000001`, move the phase
through to `PUBLISHED` using demo nominations.

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
9. **Handover pack** — short guides for staff (one device, no incognito), committee members,
   and the admin on duty.
10. **Real linting** — add ESLint (`eslint-config-next`) and replace `next lint` in
    `frontend/package.json`; `npm run lint` currently type-checks by building the app.

Exit check: the full Wednesday → Monday checklist in context §16 is ticked by a second
person, not the person who built it.

---

## Phase 3 — Seeding employee data and go-live

**Goal:** real people, real devices, Phase 1 open. No demo data left.

Order matters — do these in sequence:

1. **Back up** the current database: see `docs/deploy.md` → *Backups*.
2. **Prepare `employees.csv`** with the 60 staff:

   ```csv
   fullName,phone,department,role
   Grace Wanjiru,0712345678,Operations,ADMIN
   Peter Otieno,0723456789,Engineering,COMMITTEE
   Brian Kamau,0734567890,Engineering,EMPLOYEE
   ```

   - `role` is `EMPLOYEE` (default), `COMMITTEE` or `ADMIN`.
   - Phones can be `07…`, `2547…` or `+2547…`; they are normalised to `+2547XXXXXXXX`.
   - At least one `ADMIN` and the committee members must be in the file.
   - Departments are created on the fly; they only matter for Team of the Year.

3. **Dry run the import** (writes nothing):

   ```bash
   npm run db:import -- ./employees.csv
   ```

   Check the counts, the skipped rows and the "would create / would update" numbers.

4. **Apply it** (safe to re-run; employees are matched by phone):

   ```bash
   npm run db:import -- ./employees.csv --apply
   ```

   Add `--deactivate-missing` to switch off anyone who left the company and is not in the
   file.

5. **Remove the demo accounts** (optional but recommended). They all live on
   `+2547000000XX` and nobody else does, so switching them off is one statement — run it
   with `docker compose exec api psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`:

   ```sql
   UPDATE "Employee" SET active = false WHERE phone LIKE '+2547000000%';
   ```

   The 8 categories, the departments used by the real staff and the `Settings` row are kept.
   Production starts with `SEED_DEMO=false`, so no demo accounts should exist when this
   step begins.

6. **Verify the data** — `/admin/employees` shows 60 active people with the right roles,
   and `/admin` shows 60 active employees and the correct number of devices pending.
   If the count is off, the dry run in step 3 lists every skipped CSV row and why.

7. **Prove device binding on two real phones** with the same test number:

   - Phone A logs in → succeeds, device registered.
   - Phone B, same number → "This number is registered to another device."
   - Admin resets the device once → Phone B can now register.
   - A second reset is refused.

8. **Take the go-live backup** and note the file name in the runbook
   (`docs/runbook.md` → *Go-live log*).

9. **Open Phase 1** — `/admin` → *Move to Phase 1 — Nominations*, with the typed
   confirmation. Tell staff which browser to use and that incognito mode will lock them out.

10. **Watch the first hour** — `npm run docker:logs`, `/admin/audit` for failed logins,
    `/admin/dashboard` for pending devices.

Exit check: Phase 1 is open, 60 employees are active, the first nominations have landed,
and a backup taken after the import exists.

---

## Rollback

| Situation | What to do |
|-----------|------------|
| Import looked wrong | Re-run with a corrected CSV — it updates by phone. Nothing else is touched. |
| Bad demo data in a real database | Restore the backup from step 1 (`docs/deploy.md` → *Restore*). |
| A phase was opened by mistake | Phases only move forward by design. Fix at the database level and record it in the audit log (context §11). |
| Someone lost their device twice | Second reset is refused on purpose; escalate to a second admin and fix manually with an audit note. |
