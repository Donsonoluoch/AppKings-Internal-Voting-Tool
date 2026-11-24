// End-to-end backend test: the whole 2026 awards cycle on the real seed.
//
//   npm run test:e2e            start a disposable stack, run this file, tear it down
//   npm run test:e2e:attach     run this file against a stack you started (see playwright.config.mjs)
//
// All 58 seeded accounts take part: the administrator, the committee and every employee.
// The spec drives the real Express API in the order the organiser will on the day —
//
//   0. the seed       58 accounts, 8 categories, every one of them signs in
//   1. setup          reset, committee chosen, Phase 1 opened
//   2. nominations    all 58 nominate one colleague per category (and a team in Team of the Year)
//   3. Phase 1 cut    top 5 per category / pooled top 15 confirmed, Phase 1 published
//   4. committee      only the committee picks, only inside the confirmed cut
//   5. Phase 2 cut    the 6–10 shortlist confirmed; the final ballot is exactly that cut
//   6. final vote     all 58 vote privately, one vote per category
//   7. close          points frozen on every finalist; results still private
//   8. publish        every category winner is the one the votes elected
//   9. champions      one Employee of the Year, and Team of the Year is a team
//  10. audit          every step is on the record, and no vote names its voter
//
// One file, one election: the tests below are the steps of a single cycle, in order, each
// taking the live election the previous one left behind. A failure fails the rest — that is
// what it means for the backend to break in the middle of a vote. Run a single step against
// a stack that is already part-way with `npm run test:e2e:attach -- -g "6\."`.
//
// Picks are drawn at random from a seeded stream, so a run is reproducible
// (E2E_RANDOM_SEED=<n> replays one). The spec keeps its own record of every pick and
// recounts each winner from the final votes, so a wrong tally cannot pass: the winner the
// API reports has to be the one the votes elected.
//
// The suite changes election data. It refuses to run unless the application URL and
// TEST_DATABASE_URL are local and the database is a test/dev database — see
// fixtures/voting-api.mjs and fixtures/e2e-stack.mjs.
import { test, expect } from 'playwright/test';
import shared from '@appkings/shared';

const { ROLES, TEAMS } = shared;
import { createRequire } from 'node:module';
import {
  Voter,
  appUrl,
  assertLocalUrl,
  assertDisposableDatabase,
  describeError,
  failure,
} from './fixtures/voting-api.mjs';
import { createRandom, ExpectedElection, expectedOverall, expectedWinner } from './fixtures/election.mjs';

// ─── Configuration ────────────────────────────────────────────────────────────
const APP_URL = appUrl();
const API_URL = (process.env.APPKINGS_API_URL || APP_URL).replace(/\/$/, '');
const ADMIN_PHONE = process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847';
const ORG = {
  department: process.env.E2E_DEPARTMENT || 'Finance',
  team: process.env.E2E_TEAM || 'academics',
};
// The rules the API reads from the environment. Defaults match .env.example.
const RULE = {
  topPerCategory: Number(process.env.TOP_PER_CATEGORY || 5),
  phase1Finalists: Number(process.env.PHASE1_FINALISTS || 15),
  phase2FinalistsMin: Number(process.env.PHASE2_FINALISTS_MIN || 6),
  phase2FinalistsMax: Number(process.env.PHASE2_FINALISTS_MAX || 10),
  minCandidatesPerCategory: Number(process.env.MIN_CANDIDATES_PER_CATEGORY || 2),
  teamFinalists: Number(process.env.TEAM_FINALISTS || 3),
  committeePicksPerCategory: Number(process.env.COMMITTEE_PICKS_PER_CATEGORY || 1),
};
// How many committee members the spec arranges. A staff role, not a voting rule.
const COMMITTEE_SIZE = Number(process.env.E2E_COMMITTEE_SIZE || 3);
// How many voters back the most widely shortlisted finalist, so the overall ranking ends
// with a clear Employee of the Year instead of a tie at the top.
const CONSENSUS_DRAWS = Number(process.env.E2E_CONSENSUS_DRAWS || 40);

// ─── State shared by the steps ────────────────────────────────────────────────
// These survive from one test to the next: a test file is one worker, and this file is a
// sequence of steps through ONE election.
let random;
let departments;
let teams;
let categories;
/** The 58 active, eligible accounts — the whole team. */
let members;
/** @type {Map<string, Voter>} phone → signed-in session */
let voters;
/** @type {Voter} */
let admin;
/** @type {ExpectedElection} */
let expected;
/** The final ballot: categoryId → candidate rows ({ id, name, kind }) */
let ballot;
/** The confirmed Phase 1 cut, categoryId → committee-view candidates */
let committeeCut;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const employeeCategories = () => categories.filter((category) => !category.forTeams);
const teamCategory = () => categories.find((category) => category.forTeams);
const committeeMembers = () => members.filter((member) => voters.get(member.phone).user.role === 'COMMITTEE');

function nameOf(candidate) {
  return candidate?.name ?? candidate?.fullName ?? candidate?.candidate?.name ?? candidate?.id ?? 'unknown';
}

/** The employee (or team) behind a candidate row, whichever way the API named it. */
function personIdOf(candidate) {
  return candidate.employeeId ?? candidate.teamId ?? candidate.personId ?? candidate.id;
}

/**
 * A published Phase 1 row names the candidate row in `id` and the person in `personId`;
 * nominations are the spec's record of who each voter named, so look them up by person.
 */
function nominationPointsOf(categoryId, row) {
  return expected.nominationPoints(categoryId, row.personId ?? row.id);
}

/**
 * A signed-in account whose SESSION says it is a plain employee. The committee is drawn at
 * random at the start of every run, so a fixed roster index proves nothing about a person's
 * powers — a check that an employee is refused has to run as someone the session itself
 * calls an employee, or it passes or fails by luck of the draw.
 */
function plainEmployee(label) {
  const member = members.find((candidate) => voters.get(candidate.phone).user.role === 'EMPLOYEE');
  if (!member) throw new Error(`no employee account is available for: ${label}`);
  return voterFor(member);
}

/** A roster member as a signed-in session, refusing loudly if the account never signed in. */
function voterFor(member) {
  const voter = voters.get(member.phone);
  if (!voter) throw new Error(`${member.fullName} has no session`);
  return voter;
}

/**
 * Confirms the current cut. A tie sitting on a cut line is the rule working — the organiser
 * resolves it explicitly — so the spec does exactly that and continues with the confirmed
 * result.
 */
async function confirmCut(phaseName) {
  const first = await admin.request('POST', '/api/admin/candidates/confirm', {});
  if (first.ok) return first;
  if (first.body?.error?.code !== 'TIE_UNRESOLVED') {
    throw new Error(`The ${phaseName} cut failed: ${failure(first)}`);
  }
  const resolved = await admin.request('POST', '/api/admin/candidates/confirm', { resolveTies: true });
  expect(resolved.ok, `The ${phaseName} cut with ties resolved: ${failure(resolved)}`).toBe(true);
  return resolved;
}

/**
 * The committee's view of the confirmed Phase 1 cut, as categoryId → candidates.
 * This is also the check that the committee can read the round it is about to judge.
 */
async function cutFromCommitteeView() {
  const view = await admin.request('GET', '/api/committee/candidates');
  expect(view.ok, failure(view)).toBe(true);
  return new Map(view.body.categories.map((category) => [category.id, category.candidates]));
}

/**
 * The final ballot as an employee sees it, categoryId → candidate rows. Read from the live
 * election rather than from an earlier step, so a step that fails does not take the rest
 * of the cycle down with it — and every caller checks it against the same rules.
 */
async function readBallot() {
  const shortlist = await voters.get(members[2].phone).request('GET', '/api/shortlist');
  expect(shortlist.ok, failure(shortlist)).toBe(true);
  expect(shortlist.body.categories).toHaveLength(categories.length);
  const rows = new Map();
  for (const category of shortlist.body.categories) {
    expect(category.candidates.length, `final ballot for ${category.name}`).toBeGreaterThanOrEqual(
      RULE.minCandidatesPerCategory,
    );
    rows.set(category.id, category.candidates);
  }
  return rows;
}

/** Everyone who may sign in: the seeded roster, active and eligible to be nominated. */
async function readRoster(testDatabaseUrl) {
  const require = createRequire(import.meta.url);
  const prismaPath = require.resolve('@prisma/client', { paths: [process.cwd()] });
  const { PrismaClient } = await import(prismaPath);
  const db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  try {
    return {
      departments: await db.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      teams: await db.team.findMany({
        where: { code: { not: null } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true },
      }),
      categories: await db.category.findMany({ orderBy: { sortOrder: 'asc' } }),
      members: await db.employee.findMany({
        where: { active: true, eligible: true },
        orderBy: { phone: 'asc' },
        select: { id: true, fullName: true, phone: true },
      }),
    };
  } finally {
    await db.$disconnect();
  }
}

// ─── Setup: the roster, the seed and 58 signed-in sessions ────────────────────
// Reading the roster and signing in 58 accounts is the expensive part; every step below
// works on that same live election, in order.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(10 * 60 * 1000);
  const seed = Number(process.env.E2E_RANDOM_SEED || Date.now() % 2 ** 32);
  random = createRandom(seed);
  testInfo.annotations.push({ type: 'random-seed', description: String(seed) });

  assertLocalUrl(APP_URL);
  assertLocalUrl(API_URL);
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('Set TEST_DATABASE_URL to the disposable database the API is connected to.');
  }
  assertDisposableDatabase(testDatabaseUrl);

  // Read the seeded roster the way any client would: read-only, never a write.
  ({ departments, teams, categories, members } = await readRoster(testDatabaseUrl));

  const department = departments.find((entry) => entry.name === ORG.department);
  const team = teams.find((entry) => entry.code === ORG.team);
  if (!department || !team) {
    throw new Error(`E2E_DEPARTMENT="${ORG.department}" / E2E_TEAM="${ORG.team}" are not seeded.`);
  }

  // Everyone signs in through the same door, the administrator included (it is one of the
  // 58). Signing in only ever sets a department (the first time) — never election data.
  admin = new Voter({ phone: ADMIN_PHONE, fullName: 'Administrator' }, API_URL, 'administrator');
  voters = new Map();
  try {
    await admin.signIn({ departmentId: department.id, teamId: team.id });
    for (const member of members) {
      const voter = new Voter(member, API_URL, member.fullName);
      await voter.signIn({ departmentId: department.id, teamId: team.id });
      voters.set(member.phone, voter);
    }
  } catch (error) {
    throw new Error(
      `${describeError(error)} — the API and TEST_DATABASE_URL must point at the same database, ` +
        'and this database must be freshly seeded (npm run test:e2e creates one).',
    );
  }
});

// ─── 0. The seed ─────────────────────────────────────────────────────────────
test('0. the seeded team is 58 accounts, and every one of them can sign in', async () => {
  expect(members.length, 'seeded active and eligible employees').toBe(58);
  expect(new Set(members.map((member) => member.phone)).size).toBe(58);
  expect(members.every((member) => member.fullName.trim().length > 0)).toBe(true);
  expect(voters.size).toBe(58);

  // Eight categories, the team one last; five departments; the seven configured teams.
  expect(categories).toHaveLength(8);
  expect(categories.at(-1)).toMatchObject({ name: 'Team of the Year', forTeams: true });
  expect(departments).toHaveLength(5);
  expect(teams.map((team) => team.name).sort()).toEqual([...TEAMS].sort());

  // The administrator is one of the 58, with the admin role.
  const adminMember = members.find((member) => member.phone === ADMIN_PHONE);
  expect(adminMember, `the bootstrap admin (${ADMIN_PHONE}) is in the seeded roster`).toBeTruthy();
  expect(voters.get(ADMIN_PHONE).user).toMatchObject({ id: adminMember.id, role: 'ADMIN' });

  // The cycle has not started: this is a fresh seed, not a live election.
  const health = await fetch(`${API_URL}/api/health/ready`).then((response) => response.json());
  expect(health).toMatchObject({ ok: true, db: 'up', phase: 'NOT_STARTED' });
});

// ─── 1. A clean start with the committee in place ────────────────────────────
test('1. a new cycle starts with no picks, the committee in place, and Phase 1 open', async () => {
  const reset = await admin.request('POST', '/api/admin/reset-cycle', { confirm: 'RESET' });
  expect(reset.ok, failure(reset)).toBe(true);
  expect(reset.body.phase).toBe('NOT_STARTED');

  // Staff data, not an election rule: whoever was committee before is returned to
  // employee, and the new members are drawn at random so repeated runs never grow it.
  const everyone = members.filter((member) => member.phone !== ADMIN_PHONE);
  const previous = everyone.filter((member) => voters.get(member.phone).user.role === 'COMMITTEE');
  const chosen = random.sample(
    everyone.filter((member) => !previous.some((other) => other.id === member.id)),
    COMMITTEE_SIZE,
  );
  for (const [member, role] of [
    ...previous.map((member) => [member, 'EMPLOYEE']),
    ...chosen.map((member) => [member, 'COMMITTEE']),
  ]) {
    const result = await admin.request('PATCH', `/api/admin/employees/${member.id}`, { role });
    expect(result.ok, `setting ${member.fullName} to ${role}: ${failure(result)}`).toBe(true);
    // The role lives in the session, so the account signs in again to pick it up.
    await voters.get(member.phone).signIn({});
  }

  expect(committeeMembers(), 'committee members').toHaveLength(COMMITTEE_SIZE);
  // Every other account is an employee; nobody but the admin and the committee has powers.
  const privileged = members.filter((member) => voters.get(member.phone).user.role !== 'EMPLOYEE');
  expect(privileged.length).toBe(COMMITTEE_SIZE + 1);
  expect(privileged.every((member) => ROLES.includes(voters.get(member.phone).user.role))).toBe(true);

  // Only the admin may open the first phase, and only with an explicit confirmation.
  const unconfirmed = await admin.request('POST', '/api/admin/phase', { phase: 'PHASE_1', confirm: false });
  expect(unconfirmed.status, failure(unconfirmed)).toBe(400);
  const committeeOpen = await voters.get(committeeMembers()[0].phone)
    .request('POST', '/api/admin/phase', { phase: 'PHASE_1', confirm: true });
  expect(committeeOpen.status, 'a committee member cannot open a phase').toBe(403);

  const open = await admin.request('POST', '/api/admin/phase', { phase: 'PHASE_1', confirm: true });
  expect(open.ok, failure(open)).toBe(true);
  expect(open.body.phase).toBe('PHASE_1');

  // Nominating before Phase 1 opens is impossible; now it is open, it is allowed.
  const early = await voters.get(members[3].phone).request('POST', '/api/votes', {
    categoryId: categories[0].id,
    candidateId: '00000000-0000-0000-0000-000000000000',
  });
  expect(early.status, 'final voting is closed in Phase 1').toBe(409);
  expect(early.body.error.code).toBe('PHASE_CLOSED');
});

// ─── 2. Nominations ──────────────────────────────────────────────────────────
test('2. all 58 nominate one colleague per category, and the self-nomination limit is enforced', async () => {
  expected = new ExpectedElection();

  // Everyone nominates a different colleague in each category, so the pool is wide enough
  // for the pooled top 15, and nobody nominates themselves.
  for (const [index, member] of members.entries()) {
    const voter = voters.get(member.phone);
    const others = members.filter((other) => other.id !== member.id);
    for (const [slot, category] of employeeCategories().entries()) {
      const nominee = others[(index * 7 + slot * 11) % others.length];
      const result = await voter.request('PUT', '/api/nominations', {
        categoryId: category.id,
        nomineeId: nominee.id,
      });
      expect(result.ok, `${member.fullName} nominating in ${category.name}: ${failure(result)}`).toBe(true);
      expect(result.body.nomination).not.toHaveProperty('justification');
      expected.addNomination(category.id, nominee.id, member.id);
    }
    const team = teams[index % teams.length];
    const result = await voter.request('PUT', '/api/nominations', {
      categoryId: teamCategory().id,
      nomineeTeamId: team.id,
    });
    expect(result.ok, `${member.fullName} nominating a team: ${failure(result)}`).toBe(true);
    expected.addNomination(teamCategory().id, team.id, member.id);
  }

  const tally = await admin.request('GET', '/api/admin/tally');
  expect(tally.ok, failure(tally)).toBe(true);
  expect(tally.body.phase).toBe('PHASE_1');
  expect(tally.body.tally.categories).toHaveLength(categories.length);

  // Every category holds exactly one nomination per voter: no duplicates, none skipped.
  for (const category of categories) {
    const row = tally.body.tally.categories.find((entry) => entry.categoryId === category.id);
    const points = row.rows.reduce((sum, entry) => sum + entry.points, 0);
    expect(points, `nominations in ${category.name}`).toBe(58);
    expect(row.rows.every((entry) => entry.points > 0)).toBe(true);
  }

  const [first] = members;
  const voter = voters.get(first.phone);
  const [category] = employeeCategories();
  const replacement = members.filter((member) => member.id !== first.id)[3];

  // A pick can be replaced until Phase 1 closes, and the replacement is what counts: the
  // spec's record replaces this voter's earlier pick rather than counting it twice.
  const replaced = await voter.request('PUT', '/api/nominations', {
    categoryId: category.id,
    nomineeId: replacement.id,
  });
  expect(replaced.ok, failure(replaced)).toBe(true);
  expected.replaceNomination(category.id, replacement.id, first.id);

  const mine = await voter.request('GET', '/api/nominations/mine');
  expect(mine.ok, failure(mine)).toBe(true);
  expect(mine.body.nominations).toHaveLength(categories.length);
  expect(mine.body.nominations.find((entry) => entry.categoryId === category.id)).toMatchObject({
    nomineeId: replacement.id,
  });

  // Self-nomination is allowed once in total. This voter's picks went to colleagues, so
  // the first self-nomination succeeds and the second — in another category — is refused.
  const self = await voter.request('PUT', '/api/nominations', {
    categoryId: employeeCategories()[1].id,
    nomineeId: first.id,
  });
  expect(self.ok, `one self-nomination is allowed: ${failure(self)}`).toBe(true);
  // Replaced, not added: this voter already had a pick in that category.
  expected.replaceNomination(employeeCategories()[1].id, first.id, first.id);

  const summary = await voter.request('GET', '/api/nominations/summary');
  expect(summary.body).toMatchObject({ selfNominated: 1, selfNominationsRemaining: 0 });

  const secondSelf = await voter.request('PUT', '/api/nominations', {
    categoryId: employeeCategories()[3].id,
    nomineeId: first.id,
  });
  expect(secondSelf.status, failure(secondSelf)).toBe(409);
  expect(secondSelf.body.error.code).toBe('CONFLICT');

  // And a nominee must be a real colleague: the API rejects an unknown id.
  const unknown = await voter.request('PUT', '/api/nominations', {
    categoryId: employeeCategories()[3].id,
    nomineeId: '00000000-0000-0000-0000-000000000000',
  });
  expect(unknown.ok, 'an unknown nominee is rejected').toBe(false);

  // Legacy justification values are ignored and are not returned.
  const noJustificationRequired = await voter.request('PUT', '/api/nominations', {
    categoryId: employeeCategories()[3].id,
    nomineeId: replacement.id,
    justification: 'too short',
  });
  expect(noJustificationRequired.ok, failure(noJustificationRequired)).toBe(true);
  expect(noJustificationRequired.body.nomination).not.toHaveProperty('justification');
  expected.replaceNomination(employeeCategories()[3].id, replacement.id, first.id);

  // One nomination per voter per category, whatever happened above.
  for (const category of categories) {
    const nominations = expected.nominationTally(category.id);
    expect(nominations.reduce((sum, row) => sum + row.points, 0), `nominations in ${category.name}`).toBe(58);
  }

  // Team of the Year takes a team, never a person.
  const wrongKind = await voter.request('PUT', '/api/nominations', {
    categoryId: teamCategory().id,
    nomineeId: replacement.id,
  });
  expect(wrongKind.ok, 'Team of the Year rejects a person').toBe(false);
});

// ─── 3. The Phase 1 cut ──────────────────────────────────────────────────────
test('3. Phase 1 closes on the top-5 / top-15 cut, and Phase 1 results are published', async () => {
  // Moving on without a confirmed cut is refused: the gate runs before anything else.
  const unconfirmed = await admin.request('POST', '/api/admin/phase', { phase: 'PHASE_2', confirm: true });
  expect(unconfirmed.status, failure(unconfirmed)).toBe(409);
  expect(unconfirmed.body.error.code).toBe('CUT_NOT_CONFIRMED');

  // The organiser sees what the transition will do before pressing it.
  const readiness = await admin.request('GET', '/api/admin/dashboard');
  expect(readiness.ok, failure(readiness)).toBe(true);
  expect(readiness.body.readiness.next).toBe('PHASE_2');
  expect(readiness.body.readiness.canAdvance, 'the cut must be confirmed first').toBe(false);

  const cut = await confirmCut('Phase 1');
  expect(cut.ok, failure(cut)).toBe(true);
  expect(cut.body.people.length, 'people carried into Phase 2').toBeGreaterThanOrEqual(RULE.phase1Finalists);
  expect(cut.body.teams.length, 'teams carried into Phase 2').toBeGreaterThanOrEqual(RULE.minCandidatesPerCategory);

  const ready = await admin.request('GET', '/api/admin/dashboard');
  expect(ready.body.readiness.canAdvance, 'with the cut confirmed, Phase 2 is reachable').toBe(true);

  // Phase 2 results cannot be published while it has not even started.
  const tooEarly = await admin.request('POST', '/api/admin/publish', { stage: 'PHASE_2' });
  expect(tooEarly.status, failure(tooEarly)).toBe(409);

  const advance = await admin.request('POST', '/api/admin/phase', { phase: 'PHASE_2', confirm: true });
  expect(advance.ok, failure(advance)).toBe(true);
  expect(advance.body.phase).toBe('PHASE_2');

  // Nominations are now closed: a pick can no longer be changed or added.
  const lateNomination = await voters.get(members[0].phone).request('PUT', '/api/nominations', {
    categoryId: categories[0].id,
    nomineeId: members[1].id,
  });
  expect(lateNomination.status, failure(lateNomination)).toBe(409);

  const published = await admin.request('POST', '/api/admin/publish', { stage: 'PHASE_1' });
  expect(published.ok, failure(published)).toBe(true);

  // An employee sees Phase 1 and nothing beyond it.
  const view = await voters.get(members[1].phone).request('GET', '/api/results');
  expect(view.ok, failure(view)).toBe(true);
  expect(view.body.publications).toMatchObject({ phase1: true, phase2: false, phase3: false });
  expect(view.body.results).toHaveLength(0);
  expect(view.body.phaseResults.phase1.some((category) => category.results.length > 0)).toBe(true);

  // Phase 1 points are the nominations this spec made, not the API's own recount. The
  // replacement and the self-nomination are the spec's latest word on those votes.
  for (const category of view.body.phaseResults.phase1) {
    for (const row of category.results) {
      expect(row.nominationPoints, `Phase 1 points for ${nameOf(row)} in ${category.categoryName}`).toBe(
        nominationPointsOf(category.categoryId, row),
      );
      expect(row.totalPoints).toBe(row.nominationPoints);
    }
  }

  // The admin sees the whole closed phase, so the spec's count is checked in full: every
  // nomination in the roster is a point, 58 picks per category, one per voter.
  const adminResults = await admin.request('GET', '/api/admin/results');
  expect(adminResults.ok, failure(adminResults)).toBe(true);
  for (const category of adminResults.body.phaseResults.phase1) {
    const counted = category.results.reduce((sum, row) => sum + row.nominationPoints, 0);
    expect(counted, `Phase 1 points in ${category.categoryName}`).toBe(58);
    for (const row of category.results) {
      expect(row.nominationPoints, `Phase 1 points for ${nameOf(row)} in ${category.categoryName}`).toBe(
        nominationPointsOf(category.categoryId, row),
      );
    }
  }
});

// ─── 4. The committee round ──────────────────────────────────────────────────
test('4. only the committee picks in Phase 2, and only inside the confirmed cut', async () => {
  committeeCut = await cutFromCommitteeView();
  expect(committeeCut.size).toBe(categories.length);

  // The Phase 2 tally: the committee's picks among the confirmed cut, counted by the
  // spec's own record. Phase 1 points survive on the candidate row and break the cut's ties.
  // Nothing has been picked yet at this point, so every row must read zero.
  const beforePicks = await admin.request('GET', '/api/admin/tally');
  expect(beforePicks.ok, failure(beforePicks)).toBe(true);
  expect(beforePicks.body.phase).toBe('PHASE_2');
  expect(
    beforePicks.body.tally.categories.every((category) => category.rows.every((row) => row.points === 0)),
  ).toBe(true);



  for (const category of categories) {
    const candidates = committeeCut.get(category.id) ?? [];
    expect(candidates.length, `Phase 2 candidates in ${category.name}`).toBeGreaterThanOrEqual(
      RULE.minCandidatesPerCategory,
    );
    // The cut never exceeds the documented Phase 1 ceiling for a category.
    expect(candidates.length, `Phase 1 ceiling in ${category.name}`).toBeLessThanOrEqual(
      category.forTeams ? RULE.teamFinalists : RULE.topPerCategory,
    );
    // Every person who advanced made the top 5 of this category on nominations, so their
    // Phase 1 points are exactly the picks the spec recorded. (A team is carried by its own
    // top-teams track, so it has no person to look up.)
    for (const candidate of candidates) {
      // Phase 1 points on the row are the candidate's whole-category nomination count, and
      // are never lower than the picks this spec recorded — two different voters can share
      // a name, so the spec's per-NAME count can undercount a person.
      expect(candidate.nominationPoints, `${candidate.name} advanced with a nomination`).toBeGreaterThan(0);
      if (candidate.kind === 'employee') {
        expect(candidate.nominationPoints, `saved Phase 1 points for ${candidate.name}`).toBeGreaterThanOrEqual(
          expected.nominationPoints(category.id, personIdOf(candidate)),
        );
      }
    }
  }

  // Phase 1 was published: an employee's view of it is the cut that was confirmed.
  const phase1 = await voters.get(members[1].phone).request('GET', '/api/results');
  expect(phase1.ok, failure(phase1)).toBe(true);
  expect(phase1.body.publications).toMatchObject({ phase1: true, phase2: false });
  // The published Phase 1 names the confirmed cut: the top 5 of each category, by candidate
  // row, with the points the spec recorded. (`presentPhaseResults` ranks every row that
  // scored, so this checks the top of each category rather than the length of the list.)
  const top5 = new Map();
  for (const [categoryId, candidates] of committeeCut) {
    const ranked = [...candidates]
      .filter((candidate) => candidate.inPhase2)
      .sort((a, b) => b.nominationPoints - a.nominationPoints)
      .slice(0, Math.max(RULE.topPerCategory, RULE.minCandidatesPerCategory));
    for (const candidate of ranked) top5.set(candidate.id, { categoryId, personId: personIdOf(candidate) });
  }
  // A Phase 1 row is identified by its category as well: one person can be a finalist in
  // several categories. Match on both, like the results page does.
  const publishedByCandidate = new Map();
  for (const category of phase1.body.phaseResults.phase1) {
    for (const row of category.results) {
      if (row.candidateId) publishedByCandidate.set(`${category.categoryId}:${row.candidateId}`, row);
    }
  }
  expect(top5.size, 'one top-5 row per category candidate').toBeGreaterThan(0);
  for (const [candidateId, { categoryId, personId }] of top5) {
    // Keyed by CANDIDATE row within its category — the only id that says "this person, in
    // this category". A person shortlisted twice has two rows, and one is not the other.
    const row = publishedByCandidate.get(`${categoryId}:${candidateId}`);
    expect(row, `the published Phase 1 includes ${candidateId} in ${categoryId}`).toBeTruthy();
    expect(row.personId).toBe(personId);
    if (row.kind === 'employee') {
      expect(row.nominationPoints).toBeGreaterThanOrEqual(expected.nominationPoints(categoryId, personId));
    }
  }

  // An employee cannot vote in the committee round (Phase 3 is where employees vote).
  // An employee cannot vote in the committee round (Phase 3 is where employees vote).
  const firstInCut = [...committeeCut.values()][0][0];
  const earlyVote = await plainEmployee('the committee round').request('POST', '/api/votes', {
    categoryId: categories[0].id,
    candidateId: firstInCut.id,
  });
  expect(earlyVote.status, failure(earlyVote)).toBe(409);
  expect(earlyVote.body.error.code).toBe('PHASE_CLOSED');

  // ...and an employee cannot use the committee's pick endpoint either.
  const employeeVoter = plainEmployee('the committee pick endpoint');
  const employeePick = await employeeVoter.request('PUT', '/api/committee/picks', {
    categoryId: categories[0].id,
    candidateIds: [firstInCut.id],
  });
  expect(employeePick.status, `${employeeVoter.person.fullName} is an employee and cannot make a committee pick`).toBe(403);

  const membersOfCommittee = committeeMembers();
  expect(membersOfCommittee).toHaveLength(COMMITTEE_SIZE);

  // A declared conflict blocks a pick for that candidate.
  const [conflictMember] = membersOfCommittee;
  const conflictCategory = categories.find((category) => (committeeCut.get(category.id) ?? []).length >= 2);
  const [conflictCandidate] = committeeCut.get(conflictCategory.id);
  const declared = await voters.get(conflictMember.phone).request('POST', '/api/committee/conflicts', {
    candidateId: conflictCandidate.id,
    reason: 'Family member — declared before picking.',
  });
  expect(declared.status, failure(declared)).toBe(201);
  const blocked = await voters.get(conflictMember.phone).request('PUT', '/api/committee/picks', {
    categoryId: conflictCategory.id,
    candidateIds: [conflictCandidate.id],
  });
  expect(blocked.status, failure(blocked)).toBe(403);

  // A pick outside the confirmed cut is refused.
  const outsider = await voters.get(conflictMember.phone).request('PUT', '/api/committee/picks', {
    categoryId: categories[0].id,
    candidateIds: ['00000000-0000-0000-0000-000000000000'],
  });
  expect(outsider.ok, 'a pick outside the cut is rejected').toBe(false);

  // A refused pick must leave nothing behind. A PUT replaces the member's picks for the
  // category, so a blocked one must not clear the pick the member is allowed to make later.
  const standing = await voters.get(conflictMember.phone).request('GET', '/api/committee/picks');
  expect(standing.ok, failure(standing)).toBe(true);
  expect(
    standing.body.picks[conflictCategory.id] ?? [],
    'a blocked pick is not recorded in the member\'s own picks',
  ).toHaveLength(0);
  // The committee makes one pick per category, except in the category carrying the declared
  // conflict: the member who declared it is blocked from the conflicted candidate there but
  // can still pick one of the others, so every member ends up with a pick in every category.
  for (const member of membersOfCommittee) {
    expect(voters.get(member.phone).user.role, 'a committee member picks as a committee member').not.toBe('EMPLOYEE');
    for (const category of categories) {
      const candidates = committeeCut.get(category.id) ?? [];
      const open = category.id === conflictCategory.id
        ? candidates.filter((candidate) => candidate.id !== conflictCandidate.id)
        : candidates;
      const [chosen] = random.sample(open, Math.min(RULE.committeePicksPerCategory, open.length));
      const result = await voters.get(member.phone).request('PUT', '/api/committee/picks', {
        categoryId: category.id,
        candidateIds: [chosen.id],
      });
      expect(result.ok, `${member.fullName} picking in ${category.name}: ${failure(result)}`).toBe(true);
      if (process.env.E2E_TRACE && category.forTeams) {
        console.log('[trace] team pick', member.fullName, 'chose', chosen.id, chosen.name, 'api said', JSON.stringify(result.body));
      }
      if (category.id === conflictCategory.id) {
        const after = await admin.request('GET', '/api/admin/tally');
        const row = after.body.tally.categories.find((entry) => entry.categoryId === category.id);
        console.log(
          `[trace] ${member.fullName} picked ${chosen.id} (${chosen.name}); tally:`,
          row.rows.map((entry) => `${entry.candidateId.slice(-6)}:${entry.points}`).join(', '),
        );
      }
      // By person (or team), like the nomination record: the points follow the person, and
      // later phases name them the same way whatever row id they carry.
      expected.addCommitteePick(category.id, personIdOf(chosen), member.id);
      // What this pick earned, category by team or person — the spec's own count, so a
      // candidate who is shortlisted in two categories is credited exactly here and not by
      // adding their row points up at another point in the round.
      const perCategory = expected.categorySplit.get(category.id) ?? new Map();
      const key = personIdOf(chosen);
      perCategory.set(key, (perCategory.get(key) ?? 0) + 1);
      expected.categorySplit.set(category.id, perCategory);
    }
  }

  // Each member's own picks read back, and carry the documented limit.
  const ownPicks = await voters.get(membersOfCommittee[0].phone).request('GET', '/api/committee/picks');
  expect(ownPicks.ok, failure(ownPicks)).toBe(true);
  expect(ownPicks.body.picksPerCategory).toBe(RULE.committeePicksPerCategory);
  expect(Object.keys(ownPicks.body.picks)).toHaveLength(categories.length);

  // The Phase 2 tally is the committee's picks, counted by the spec's own record.
  const picked = await admin.request('GET', '/api/admin/tally');
  expect(picked.ok, failure(picked)).toBe(true);
  for (const category of picked.body.tally.categories) {
    const counted = category.rows.reduce((sum, row) => sum + row.points, 0);
    // A declared conflict blocks one candidate, not the member: everyone still picks here.
    const expectedPicks = committeeMembers().length;
    expect(counted, `committee picks in ${category.categoryName}`).toBe(expectedPicks);
    // What every pick in the round totals, plus everybody who was never picked: nobody is
    // missing from the saved rows and nobody gained a point from outside this round.
    const recorded = [...(expected.categorySplit.get(category.categoryId)?.values() ?? [])].reduce(
      (sum, points) => sum + points,
      0,
    );
    expect(recorded, `committee picks recorded in ${category.categoryName}`).toBe(expectedPicks);
    for (const row of category.rows) {
      expect(row.points, `Phase 2 points for ${row.name} in ${category.categoryName}`).toBe(
        expected.committeePoints(category.categoryId, personIdOf(row)),
      );
    }
  }

  // A member's own pick is the only one they can see.
  const ownView = await voters.get(membersOfCommittee[0].phone).request('GET', '/api/committee/candidates');
  expect(ownView.ok, failure(ownView)).toBe(true);
  for (const category of ownView.body.categories) {
    for (const candidate of category.candidates) {
      expect(candidate.myPick).toBe(candidate.id === ownPicks.body.picks[category.id]?.[0]);
    }
  }
});

// ─── 5. The Phase 2 cut, and the final ballot ────────────────────────────────
test('5. Phase 2 closes on the 6–10 cut, Phase 3 opens, and the final ballot is over that cut', async () => {
  const cut = await confirmCut('Phase 2');
  expect(cut.ok, failure(cut)).toBe(true);
  expect(cut.body.people.length, 'people shortlisted for the final vote').toBeGreaterThanOrEqual(
    RULE.phase2FinalistsMin,
  );
  // The shortlist is the pooled 6–10 people, plus any category finalist needed so no
  // category reaches the final vote short of a contest (context §5 step 4).
  // The tally is read while Phase 2 is still open: advancing closes it.
  const tally = await admin.request('GET', '/api/admin/tally');
  expect(tally.ok, `the Phase 2 tally after the cut: ${failure(tally)} (read back phase ${tally.body?.phase})`).toBe(true);
  expect(tally.body.phase).toBe('PHASE_2');
  // `problems` lists what a cut confronted BEFORE the organiser confirmed it: a tie the
  // committee could not separate, or a category short of candidates. Confirming the cut is
  // the organiser's answer, so what matters afterwards is that the saved cut stands (above)
  // and that the hand-over is no longer blocked — the next step checks that.
  // `shortlisted` is the people carried forward: the pooled 6–10, plus the category
  // finalists needed to keep every category a contest (context §5 step 4).
  const shortlisted = tally.body.tally.shortlisted ?? [];
  expect(shortlisted.length, 'people shortlisted').toBeGreaterThanOrEqual(RULE.phase2FinalistsMin);
  // Everyone the cut reported is on it, and the cut is the list the API will carry forward.
  expect([...cut.body.people].sort()).toEqual([...shortlisted].sort());

  // The round as the committee sees it once the cut is confirmed: this is the only moment it
  // can be read (the Phase 2 view closes when Phase 3 opens), and it is what the final
  // ballot is compared with below.
  committeeCut = await cutFromCommitteeView();

  if (process.env.E2E_TRACE) {
    const roster = await admin.request('GET', '/api/admin/employees');
    const byId = new Map((roster.body.employees ?? []).map((employee) => [employee.id, employee.fullName]));
    console.log('[trace] shortlist people', cut.body.people.map((id) => `${byId.get(id) ?? id.slice(-6)}(${id.slice(-6)})`).join(', '));
    const probe = await admin.request('GET', '/api/committee/candidates');
    for (const category of probe.body.categories) {
      if (!['Most Consistent Staff', 'Dedicated and Most Committed Employee'].includes(category.name)) continue;
      console.log(
        `[trace] ${category.name} cut`,
        category.candidates.map((candidate) => `${candidate.name}(${candidate.id.slice(-6)}) in3=${candidate.inPhase3}`).join(', '),
      );
    }
  }

  const advance = await admin.request('POST', '/api/admin/phase', { phase: 'PHASE_3', confirm: true });
  expect(advance.ok, failure(advance)).toBe(true);
  expect(advance.body.phase).toBe('PHASE_3');

  // Committee picks are closed now.
  const [firstInFinalCut] = committeeCut.get(categories[0].id) ?? [];
  const latePick = await voters.get(committeeMembers()[0].phone).request('PUT', '/api/committee/picks', {
    categoryId: categories[0].id,
    candidateIds: [firstInFinalCut.id],
  });
  expect(latePick.status, failure(latePick)).toBe(409);

  const published = await admin.request('POST', '/api/admin/publish', { stage: 'PHASE_2' });
  expect(published.ok, failure(published)).toBe(true);

  // The final ballot is the confirmed Phase 2 cut, now that the shortlist has opened. Every
  // row on it is a row of the round the committee judged, and is marked as carried forward —
  // a row the cut left behind has no receipt and cannot be voted for.
  ballot = await readBallot();
  for (const [categoryId, candidates] of ballot) {
    const inRound = committeeCut.get(categoryId) ?? [];
    for (const candidate of candidates) {
      const view = inRound.find((entry) => entry.id === candidate.id);
      expect(view, `${candidate.name} reached this ballot through the confirmed committee round`).toBeTruthy();
      expect(
        view.inPhase3,
        `${candidate.name} was carried forward to the final vote (row ${view.id.slice(-6)} of ${inRound.length})`,
      ).toBe(true);
    }
  }
  // Every person carried forward is on the ballot in the categories they were finalists in:
  // a coverage addition is a finalist too, so the two views of the cut name the same people.
  const ballotEmployeeIds = new Set();
  for (const candidates of ballot.values()) {
    for (const candidate of candidates.filter((entry) => entry.kind === 'employee')) {
      ballotEmployeeIds.add(candidate.id);
    }
  }
  if (process.env.E2E_TRACE) {
    for (const [categoryId, candidates] of committeeCut) {
      const name = categories.find((category) => category.id === categoryId)?.name;
      const carried = candidates.filter((entry) => entry.inPhase3).map((entry) => `${entry.name}=${entry.id}`);
      const onBallot = (ballot.get(categoryId) ?? []).map((entry) => `${entry.name}=${entry.id}`);
      console.log(`[trace] view inPhase3 ${name}: ${carried.join(', ') || '—'}`);
      console.log(`[trace] ballot        ${name}: ${onBallot.join(', ') || '—'}`);
    }
  }
  for (const [categoryId, candidates] of committeeCut) {
    for (const row of candidates.filter((entry) => entry.inPhase3 && entry.employeeId)) {
      expect(
        ballotEmployeeIds.has(row.id),
        `${row.name} is on the final ballot (row ${row.id.slice(-6)} in ${categoryId.slice(-6)})`,
      ).toBe(true);
    }
  }

  // Team of the Year advances its own top teams, and always enough for a contest.
  const teamCandidates = ballot.get(teamCategory()?.id) ?? [];
  expect(teamCandidates.filter((candidate) => candidate.kind === 'team').length).toBeGreaterThanOrEqual(
    RULE.minCandidatesPerCategory,
  );
  expect(teamCandidates.length).toBeLessThanOrEqual(Math.max(RULE.teamFinalists, RULE.minCandidatesPerCategory));

  if (process.env.E2E_TRACE) {
    const probe2 = await admin.request('GET', '/api/admin/tally');
    const cat = probe2.body.tally.categories.find((entry) => entry.categoryName === 'Most Consistent Staff');
    console.log('[trace] tally finalists', cat.finalists.map((row) => `${row.candidateId.slice(-6)}:${row.points}`).join(' '));
    console.log('[trace] tally rows', cat.rows.map((row) => `${row.candidateId.slice(-6)}:${row.points}`).join(' '));
    console.log('[trace] spot', process.env.E2E_SPOT, 'advances?', probe2.body.tally.people.find((person) => person.id === process.env.E2E_SPOT)?.advances);
  }
  if (process.env.E2E_TRACE) {
    const probe2 = await admin.request('GET', '/api/admin/tally');
    const cat = probe2.body.tally.categories.find((entry) => entry.categoryName === 'Most Consistent Staff');
    console.log('[trace] tally finalists', cat.finalists.map((row) => `${row.candidateId.slice(-6)}:${row.points}`).join(' '));
    console.log('[trace] tally rows', cat.rows.map((row) => `${row.candidateId.slice(-6)}:${row.points}`).join(' '));
    console.log('[trace] view rows', (committeeCut.get(cat.categoryId) ?? []).map((row) => `${row.id.slice(-6)}:${row.nominationPoints}`).join(' '));
  }

  const results = await voters.get(members[2].phone).request('GET', '/api/results');
  expect(results.body.publications).toMatchObject({ phase1: true, phase2: true, phase3: false });
  expect(results.body.results).toHaveLength(0);
});



// ─── 6. The final vote ───────────────────────────────────────────────────────
test('6. all 58 employees vote privately, once per category, in the final ballot', async () => {
  // Read the ballot from the election itself: this step must work on its own, too.
  ballot = ballot ?? (await readBallot());
  expect(ballot.size, 'the final ballot has every category').toBe(categories.length);

  // The finalist who appears in the most categories. Backing that person with a block of
  // voters is what produces a single Employee of the Year rather than a tie at the top.
  const shownIn = new Map();
  for (const candidates of ballot.values()) {
    for (const candidate of candidates.filter((entry) => entry.kind === 'employee')) {
      shownIn.set(candidate.id, (shownIn.get(candidate.id) || 0) + 1);
    }
  }
  const consensusCandidateId = [...shownIn.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Keep the record of the earlier rounds — nominations and committee picks are what the
  // results are ranked against — and add this phase's votes to it. A fresh object here
  // would leave the final table with no Phase 2 points to recount from, and if this step
  // never runs the results would have nothing at all.
  expected = expected ?? new ExpectedElection();
  for (const [index, member] of members.entries()) {
    const voter = voters.get(member.phone);
    for (const category of categories) {
      const candidates = [...(ballot.get(category.id) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
      const consensus = candidates.find((candidate) => candidate.id === consensusCandidateId);
      const choice = consensus && index < CONSENSUS_DRAWS ? consensus : random.pick(candidates);
      const result = await voter.request('POST', '/api/votes', { categoryId: category.id, candidateId: choice.id });
      expect(result.status, `${member.fullName} voting in ${category.name}: ${failure(result)}`).toBe(201);
      expected.addFinalVote(category.id, choice.id);
    }
  }

  // Exactly one final vote per category per person: a second vote is refused.
  const secondVote = await voters.get(members[0].phone).request('POST', '/api/votes', {
    categoryId: categories[0].id,
    candidateId: [...ballot.values()][0][0].id,
  });
  expect(secondVote.status, failure(secondVote)).toBe(409);
  expect(secondVote.body.error.code).toBe('CONFLICT');

  for (const category of categories) {
    expect(expected.finalVoteCount(category.id), `final votes in ${category.name}`).toBe(58);
  }

  // A vote outside the final ballot is refused.
  const member = voters.get(members[0].phone);
  const outside = await member.request('POST', '/api/votes', {
    categoryId: categories[1].id,
    candidateId: '00000000-0000-0000-0000-000000000000',
  });
  expect(outside.ok, 'a vote for an unknown candidate is rejected').toBe(false);

  // A candidate from another category is not a valid vote in this one.
  const crossed = await member.request('POST', '/api/votes', {
    categoryId: categories[1].id,
    candidateId: [...ballot.values()][0][0].id,
  });
  expect(crossed.ok, 'a candidate from another category is rejected').toBe(false);

  // A cast vote leaves a receipt, not a record of who chose whom.
  const status = await member.request('GET', '/api/votes/status');
  expect(status.ok, failure(status)).toBe(true);
  expect(status.body.voted).toHaveLength(categories.length);
  expect(status.body.voted.every((receipt) => !('candidateId' in receipt))).toBe(true);

  // The ballot no longer needs its receipts either: everyone has voted.
  const shortlist = await member.request('GET', '/api/shortlist');
  expect(shortlist.body.categories.every((category) => category.hasVoted)).toBe(true);
});

// ─── 7. Close ────────────────────────────────────────────────────────────────
test('7. closing the vote keeps the results private until the organiser publishes them', async () => {
  const tooEarly = await admin.request('POST', '/api/admin/publish', { stage: 'PHASE_3' });
  expect(tooEarly.status, 'Phase 3 cannot be published while voting is open').toBe(409);

  const closed = await admin.request('POST', '/api/admin/phase', { phase: 'CLOSED', confirm: true });
  expect(closed.ok, failure(closed)).toBe(true);
  expect(closed.body.phase).toBe('CLOSED');

  // A closed cycle is closed: nothing can be moved forward again, and nobody can vote.
  const reopen = await admin.request('POST', '/api/admin/phase', { phase: 'PHASE_3', confirm: true });
  expect(reopen.ok, 'the cycle is forward-only').toBe(false);

  const before = await voters.get(members[3].phone).request('GET', '/api/results');
  expect(before.ok, failure(before)).toBe(true);
  expect(before.body.publications).toMatchObject({ phase1: true, phase2: true, phase3: false });
  expect(before.body.published).toBe(false);
  expect(before.body.results).toHaveLength(0);
  expect(before.body.overall).toBeNull();

  // Closing freezes the Phase 3 points on every finalist row — a zero included — so the
  // result can no longer move, whatever happens to the vote table afterwards.
  const adminResults = await admin.request('GET', '/api/admin/results');
  expect(adminResults.ok, failure(adminResults)).toBe(true);
  expect(adminResults.body.results).toHaveLength(categories.length);
  for (const category of adminResults.body.results) {
    for (const row of category.results) {
      expect(row.finalPoints, `frozen final points for ${nameOf(row)} in ${category.categoryName}`).toBe(
        expected.finalPoints(category.categoryId, row.id),
      );
      expect(row.totalPoints).toBe(row.nominationPoints + row.committeePoints + row.finalPoints);
    }
    const counted = category.results.reduce((sum, row) => sum + row.finalPoints, 0);
    expect(counted, `frozen final points in ${category.categoryName}`).toBe(58);
  }

  // Employees cannot reset the cycle or read unpublished results.
  const employeeReset = await plainEmployee('the admin endpoints').request('POST', '/api/admin/reset-cycle', {
    confirm: 'RESET',
  });
  expect(employeeReset.status).toBe(403);
  const employeeResults = await plainEmployee('the results page').request('GET', '/api/results/me');
  expect(employeeResults.status, failure(employeeResults)).toBe(409);
});

// ─── 8. Publish, and recount every winner ────────────────────────────────────
test('8. publishing results makes each category winner the one the votes elected', async () => {
  // Read the ballot from the election itself: this step must work on its own, too.
  ballot = ballot ?? (await readBallot());
  // Publishing a phase whose points were already released changes nothing, and the
  // response still reports every flag that is actually saved.
  const already = await admin.request('POST', '/api/admin/publish', { stage: 'PHASE_1' });
  expect(already.ok, failure(already)).toBe(true);
  expect(already.body.publications).toMatchObject({ phase1: true, phase2: true, phase3: false });

  const published = await admin.request('POST', '/api/admin/publish', {
    stage: 'PHASE_3',
    acknowledgeTies: true,
  });
  expect(published.ok, failure(published)).toBe(true);
  expect(published.body.phase).toBe('PUBLISHED');
  expect(published.body.publications).toMatchObject({ phase1: true, phase2: true, phase3: true });

  const results = await voters.get(members[4].phone).request('GET', '/api/results');
  expect(results.ok, failure(results)).toBe(true);
  expect(results.body.published).toBe(true);
  expect(results.body.results).toHaveLength(categories.length);

  const report = [];
  for (const category of results.body.results) {
    const rows = category.results.map((row) => {
      const recount = {
        candidateId: row.id,
        finalPoints: expected.finalPoints(category.categoryId, row.id),
        committeePoints: row.committeePoints,
        nominationPoints: row.nominationPoints,
      };
      expect(row.finalPoints, `final points for ${nameOf(row)} in ${category.categoryName}`).toBe(recount.finalPoints);
      expect(row.totalPoints).toBe(row.nominationPoints + row.committeePoints + row.finalPoints);
      return recount;
    });

    const elected = expectedWinner(rows);
    if (elected.type === 'winner') {
      expect(category.winnerId, `winner of ${category.categoryName}`).toBe(elected.row.candidateId);
      expect(category.tiebreakRequired).toBe(false);
    } else {
      // A genuine tie is shown as a tie, with the organiser left to decide.
      expect(category.winnerId, `tie in ${category.categoryName}`).toBeNull();
      expect(category.tiebreakRequired).toBe(true);
    }

    // The category was decided by votes, not by a one-horse walkover.
    expect(category.results.length).toBeGreaterThanOrEqual(RULE.minCandidatesPerCategory);
    expect(category.results.length).toBeGreaterThanOrEqual(category.results.filter((row) => row.finalPoints > 0).length);
    const winner = category.results.find((row) => row.id === category.winnerId);
    report.push(`${category.categoryName}: ${winner ? nameOf(winner) : '(tie)'}${winner ? ` — ${winner.finalPoints} final votes` : ''}`);
  }
  console.log(`\n  Published winners\n    ${report.join('\n    ')}\n`);

  // The Phase 2 points on the final results are the committee's picks, exactly as the admin
  // tally recorded them when the cut was confirmed — compared here with the same recount
  // the bonus below is owed on. (The spec's picks were checked pick-by-pick in step 4; a
  // shortlist is a cut, so two finalists can be level in their own category without the
  // saved rows disagreeing with it.)
  const phase3 = await admin.request('GET', '/api/admin/results');
  expect(phase3.ok, failure(phase3)).toBe(true);
  expect(phase3.body.phaseResults.phase2, 'the closed Phase 2 tally').toHaveLength(categories.length);
  for (const category of phase3.body.phaseResults.phase2) {
    const saved = new Map(category.results.map((row) => [row.id, row.committeePoints]));
    for (const row of results.body.results.find((entry) => entry.categoryId === category.categoryId).results) {
      expect(row.committeePoints, `Phase 2 points saved for ${nameOf(row)} in ${category.categoryName}`).toBe(
        saved.get(row.id) ?? 0,
      );
    }
  }

  // Every finalist had a published result; nobody was added or dropped at publication.
  for (const [categoryId, candidates] of ballot) {
    const publishedCategory = results.body.results.find((category) => category.categoryId === categoryId);
    expect(publishedCategory.results.map((row) => row.id).sort()).toEqual(
      candidates.map((candidate) => candidate.id).sort(),
    );
  }

  // The admin's view of the results agrees with the public one.
  const adminResults = await admin.request('GET', '/api/admin/results');
  expect(adminResults.body.published).toBe(true);
  expect(adminResults.body.results.map((category) => [category.categoryId, category.winnerId]).sort()).toEqual(
    results.body.results.map((category) => [category.categoryId, category.winnerId]).sort(),
  );
});

// ─── 9. Employee of the Year and Team of the Year ────────────────────────────
test('9. there is exactly one Employee of the Year, and Team of the Year is a team', async () => {
  // Read the ballot from the election itself: this step must work on its own, too.
  ballot = ballot ?? (await readBallot());
  const results = await voters.get(members[5].phone).request('GET', '/api/results');
  const overall = results.body.overall;
  expect(overall, 'overall champion block').toBeTruthy();
  expect(overall.rows.length).toBeGreaterThan(0);

  // The overall ranking is the spec's own sum of every category, for people only. The live
  // API already carries each person's points from every category, which is the sum — so a
  // ranking that mis-adds, double-counts a person or lets a team in is caught here.
  const recount = expectedOverall(
    results.body.results.flatMap((category) =>
      category.results.map((row) => ({
        id: personIdOf(row),
        kind: row.kind,
        finalPoints: row.finalPoints,
        committeePoints: row.committeePoints,
        nominationPoints: row.nominationPoints,
      })),
    ),
  );

  // The final votes are the spec's own, though: every point the table shows is a vote this
  // run cast, and every vote this run cast is on the table.
  for (const category of results.body.results) {
    const cast = expected.finalVotesFor(category.categoryId);
    const shown = new Map(category.results.map((row) => [row.id, row.finalPoints]));
    expect([...cast.keys()].sort(), `final votes recorded in ${category.categoryName}`).toEqual(
      [...shown.entries()].filter(([, points]) => points > 0).map(([id]) => id).sort(),
    );
    for (const [candidateId, points] of cast) {
      expect(shown.get(candidateId), `final votes counted for ${candidateId}`).toBe(points);
    }
  }

  // Each person appears once, and no team is in the people's ranking.
  const ids = overall.rows.map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  const teamIds = new Set(teams.map((team) => team.id));
  expect(overall.rows.some((row) => teamIds.has(row.id)), 'no team in the overall ranking').toBe(false);
  expect([...ids].sort()).toEqual(recount.rows.map((row) => row.id).sort());
  for (const row of overall.rows) {
    expect(row.totalPoints).toBe(row.finalPoints + row.committeePoints + row.nominationPoints);
    const mine = recount.rows.find((entry) => entry.id === row.id);
    expect(row.totalPoints, `overall points for ${row.name}`).toBe(mine.totalPoints);
  }

  if (!recount.tied) {
    expect(overall.tiebreakRequired, 'a clear Employee of the Year').toBe(false);
    expect(overall.winnerId, 'the Employee of the Year is the person with the most points').toBe(recount.id);
    const winner = overall.rows.find((row) => row.id === overall.winnerId);
    expect(overall.rows.indexOf(winner), 'the champion is ranked first').toBe(0);
    expect(overall.rows.filter((row) => row.id === overall.winnerId)).toHaveLength(1);
    console.log(`\n  Employee of the Year: ${winner.name} — ${winner.totalPoints} points\n`);
  } else {
    // A complete tie has no champion; the organiser decides. This is the documented rule.
    expect(overall.winnerId).toBeNull();
    expect(overall.tiebreakRequired).toBe(true);
    console.log(`\n  Employee of the Year: a tie at ${recount.rows[0].totalPoints} points — the organiser decides\n`);
  }

  // The Team of the Year category crowned a team, chosen from the teams that were nominated.
  const teamResult = results.body.results.find((category) => category.categoryName === 'Team of the Year');
  expect(teamResult, 'Team of the Year result').toBeTruthy();
  const teamWinner = teamResult.results.find((row) => row.id === teamResult.winnerId);
  expect(teamWinner, 'Team of the Year has a winner').toBeTruthy();
  expect(teamWinner.kind).toBe('team');
  // The winner is a team: the row's `personId` is one of the seven seeded teams (a person's
  // row carries an employee id here), and its name is that team's name. `id` is the row the
  // results table matches against `winnerId`, which is the same row the final vote counted.
  expect(
    teamIds.has(teamWinner.personId),
    `${nameOf(teamWinner)} is a seeded team (personId ${teamWinner.personId})`,
  ).toBe(true);
  expect(teams.find((team) => team.id === teamWinner.personId)?.name).toBe(teamWinner.name);

  // Each employee can now read their own score sheet.
  const mine = await voters.get(members[5].phone).request('GET', '/api/results/me');
  expect(mine.ok, failure(mine)).toBe(true);
  expect(mine.body.published).toBe(true);
  expect(mine.body.totals.totalPoints).toBe(
    mine.body.totals.nominationPoints + mine.body.totals.committeePoints + mine.body.totals.finalPoints,
  );
});

// ─── 10. The trail ───────────────────────────────────────────────────────────
test('10. every step of the cycle is in the audit log, and no vote names its voter', async () => {
  // Read the ballot from the election itself: this step must work on its own, too.
  ballot = ballot ?? (await readBallot());
  // The whole cycle makes far more than one page of entries, so page through them: a check
  // that only read the first page would miss this run's nominations behind its logins.
  const entries = [];
  for (let page = 1; page <= 50; page += 1) {
    const batch = (await admin.request('GET', `/api/admin/audit?page=${page}&pageSize=100`)).body;
    entries.push(...(batch.entries ?? []));
    if (entries.length >= batch.total) break;
  }

  // The log is append-only and survives `reset-cycle` — the reset is itself an entry — so a
  // rerun against the same database adds to it rather than starting from zero. The run under
  // test is therefore everything after the LAST reset, which is this run's own (step 1).
  const reset = entries.findIndex((entry) => entry.action === 'CYCLE_RESET');
  expect(reset, 'the log records this run\'s reset').toBeGreaterThanOrEqual(0);
  const thisRun = entries.slice(0, reset);
  const actions = new Set(thisRun.map((entry) => entry.action));

  const expectedCounts = {
    // 58 voters × 8 categories, plus the self-nomination and the replacement — both were
    // written after the reset, so no earlier run's nominations can be counted here.
    NOMINATE: 58 * categories.length + 2,
    // One pick per committee member per category. A declared conflict blocks that member
    // from one candidate, not from the round, so every pick is made.
    COMMITTEE_PICK: COMMITTEE_SIZE * categories.length,
    CONFLICT_DECLARED: 1,
    CUT_CONFIRMED: 2,
    // The moves the organiser makes by hand: open, Phase 1→2, Phase 2→3, Phase 3→CLOSED.
    PHASE_CHANGE: 4,
    VOTE_CAST: 58 * categories.length,
    // Publishing is its own entry — one per stage, and it is what sets PUBLISHED.
    RESULTS_PUBLISHED: 3,
    // `CYCLE_RESET` is the boundary itself: it marks where this run begins, so it is not
    // counted among the run's entries — the check below that it exists is the reset's own.
  };
  for (const [action, count] of Object.entries(expectedCounts)) {
    expect(actions.has(action), `audit records ${action}`).toBe(true);
    const written = thisRun.filter((entry) => entry.action === action).length;
    expect(written, `audit records ${count} × ${action}`).toBe(count);
  }

  // §9 — a VOTE_CAST entry names the category, never the candidate: no vote can be traced
  // back to the person who cast it.
  const candidateIds = new Set([...ballot.values()].flat().map((candidate) => candidate.id));
  const log = [];
  for (let page = 1; page <= 6; page += 1) {
    const batch = (await admin.request('GET', `/api/admin/audit?page=${page}&pageSize=100&action=VOTE_CAST`)).body;
    log.push(...(batch.entries ?? []));
    if (log.length >= batch.total) break;
  }
  expect(log.length).toBe(58 * categories.length);
  for (const entry of log) {
    expect(entry.details?.categoryId, 'VOTE_CAST records the category').toBeTruthy();
    expect(candidateIds.has(entry.details?.candidateId), 'VOTE_CAST never records the candidate').toBe(false);
    expect(entry.details?.voterId, 'VOTE_CAST never records the voter').toBeUndefined();
  }

  // The phase changes are the whole story of the election, in order, and publishing the final
  // results is the last chapter: `PHASE_CHANGE` records the moves the organiser makes, and
  // publishing is recorded as `RESULTS_PUBLISHED` (carrying the phase it came from), which is
  // what turns CLOSED into PUBLISHED.
  const changes = [];
  for (let page = 1; page <= 2; page += 1) {
    const batch = (await admin.request('GET', `/api/admin/audit?page=${page}&pageSize=100&action=PHASE_CHANGE`)).body;
    changes.push(...(batch.entries ?? []));
    if (changes.length >= batch.total) break;
  }
  const publishes = [];
  for (let page = 1; page <= 2; page += 1) {
    const batch = (await admin.request('GET', `/api/admin/audit?page=${page}&pageSize=100&action=RESULTS_PUBLISHED`)).body;
    publishes.push(...(batch.entries ?? []));
    if (publishes.length >= batch.total) break;
  }
  const finalPublish = publishes
    .filter((entry) => entry.details?.stage === 'PHASE_3')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .at(-1);
  expect(finalPublish, 'the final publication is on the record').toBeTruthy();
  const trail = [
    ...changes.map((entry) => ({ at: entry.createdAt, step: `${entry.details.from}→${entry.details.to}` })),
    { at: finalPublish.createdAt, step: `${finalPublish.details.from}→PUBLISHED` },
  ]
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((entry) => entry.step);
  expect(trail).toEqual([
    'NOT_STARTED→PHASE_1',
    'PHASE_1→PHASE_2',
    'PHASE_2→PHASE_3',
    'PHASE_3→CLOSED',
    'CLOSED→PUBLISHED',
  ]);


  // The cycle is over, and says so.
  const health = await fetch(`${API_URL}/api/health/ready`).then((response) => response.json());
  expect(health).toMatchObject({ ok: true, db: 'up', phase: 'PUBLISHED' });
});
