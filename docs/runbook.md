# Runbook — running the 2026 Awards

For the admin on duty. Everything here is done from the admin portal unless marked
otherwise. Phase mechanics are in `docs/context.md` §5, the go-live sequence in
`docs/roadmap.md` phase 3.

## Before Phase 1

- [ ] `.env` has a real `JWT_SECRET`; `COOKIE_SECURE=true` if it is served over HTTPS.
- [ ] Production login identity has been verified out of band. Phone number + device
      binding does not prove that the first person entering a number owns it; SMS/OTP is
      not implemented yet.
- [ ] `RUN_SEED=false` and `SEED_DEMO=false`; no demo account is present in the live DB.
- [ ] The 60 employees are imported (`npm run db:import -- ./employees.csv --apply`).
- [ ] `/admin/employees` shows 60 active people, the right roles and departments.
- [ ] Every committee member has role `COMMITTEE`; at least two admins exist.
- [ ] Database backup taken and the file name recorded below.
- [ ] Tested on two real phones: device binding works, the second device is refused, one
      reset re-registers it (context §7).
- [ ] `/admin` shows **Start Phase 1 — Nominations**. Use it to begin the first round.

After results are published, `/admin` offers **Start a new voting session**. It clears the
previous session's votes, nominations, cuts and result publications, but retains employee
accounts and their device locks. Type `RESET` in the confirmation dialog.

**Go-live log**

| When | What | By |
|------|------|----|
| | Backup before import: `backup-….dump` | |
| | Import applied: __ created / __ updated / __ skipped | |
| | Backup before opening Phase 1: `backup-….dump` | |
| | Phase 1 opened | |

## During Phase 1 — nominations

Every employee nominates one colleague per category, with a justification.

- Progress: `/admin` → active employees, device registration, nominations per category.
- New phone or a wrong role: `/admin/employees` → edit, or re-run the CSV import.
- Locked out of a new phone: `/admin/employees` → **Reset** on that employee. **Once per
  employee** — the second attempt is refused by design.
- Somebody complains they cannot vote: check `/admin/audit` filtered by `LOGIN_FAILED`
  (unknown number, inactive account, wrong device).
- The tally stays hidden while the phase is open. Do not share nomination counts.

## Closing Phase 1 → opening Phase 2

1. Tell the team nominations are closed, then `/admin` → *Move to Phase 2* is **blocked**
   until the cut is confirmed — that is expected.
2. `/admin/tally` → review the per-category rankings, protected category coverage and pooled "top 15 people".
3. Yellow items mean a tie sits on a cut line or a category has fewer than 2 candidates.
   Decide, in writing if possible, who advances.
4. *Confirm this cut* — this saves the points on each candidate row and flags the protected category candidates plus the remaining pooled places.
5. `/admin` → *Move to Phase 2*. The API re-checks the counts and refuses if anything is
   unresolved.
6. `/admin/results` → review and optionally *Publish PHASE 1*. Employees can then see
   nomination totals while Phase 2 is running.

## During Phase 2 — committee

- The committee opens `/committee` to read the justifications and `/committee/vote` to pick.
- A member with a personal or financial relationship declares a conflict on the candidate
  page; the system then blocks their pick for that candidate.
- Picks can be changed until the phase closes. Members never see each other's picks or the
  running tally.
- With a small committee ties are likely: if the same category keeps tying, set
  `COMMITTEE_PICKS_PER_CATEGORY=2` (or 3) and restart the stack.

## Closing Phase 2 → opening Phase 3

Same as Phase 1: `/admin/tally` → review the pooled 6–10 people and the top 3 teams →
*Confirm this cut* → `/admin` → *Move to Phase 3*.

A category with fewer than 2 candidates blocks the move; the admin adds from that
category's top 5 first (context §5, safety check).
After advancing, `/admin/results` can publish Phase 2 committee-pick totals to employees.

## During Phase 3 — final vote

- Votes are final. There is no delete or edit, by design.
- Voting is confidential: the `Vote` table has no voter id. Never try to match a vote to a
  person, and never ask the team to tell you how they voted.
- `/admin/audit` shows `VOTE_CAST` entries with the category only — that is correct.
- Turnout: `/admin` → `voted` per category.
- No campaigning: the policy is shown on the voting page; repeat it if needed.

## Closing and publishing

1. `/admin` → *Move to CLOSED*. This freezes the Phase 3 points on each candidate row.
2. `/admin/results` → check the points per category. Anything marked as tied needs your
   decision (context §1 #4: Phase 3 points, then Phase 2, then Phase 1, then you).
3. *Publish Phase 3* → employees can see the final results and `/results/me`. Earlier
   phase releases remain available on the same results page.
4. Take a final backup and keep it with the awards pack.

## Incident quick reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| "This number is registered to another device" | New phone or cleared browser data | Admin reset (once) |
| Everyone behind the office IP gets 429 | Too many *failed* logins from that IP | Wait 15 min; check `/admin/audit` for the real cause |
| API 500s after a deploy | Migration not applied or DB unreachable | `docker compose logs api web`; check `/api/health/ready` |
| Phase will not move | Cut not confirmed, tie unresolved, or a category has < 2 candidates | `/admin/tally`, resolve, confirm |
| A committee member cannot pick someone | They declared a conflict | Expected; another member can pick |
| Wrong data in a phase that already moved | Phases only move forward | Fix at the database level, restore from backup if needed, and record it in `AuditLog` |
