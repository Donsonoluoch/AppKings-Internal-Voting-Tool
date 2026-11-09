// End-to-end cycle runner: Phase 1 → Phase 2 → Phase 3 → publish → winner.
//
//   npm run test:cycle
//
// Drives the REAL API in the order an organiser would: reset, open Phase 1,
// nominate, confirm the cut, advance, vote, cut again, advance, vote again,
// committee picks, close, publish. After each phase it checks the readiness
// preview agrees with what the transition endpoint then does — a preview that
// lies is worse than no preview.
//
// Five employees take part, each a distinct account, so the one-vote-per-account
// rule is exercised on every ballot.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.APPKINGS_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient();

const PEOPLE = [
  { phone: '+254700000001', role: 'ADMIN' },
  { phone: '+254700000002', role: 'COMMITTEE' },
  { phone: '+254700000003', role: 'COMMITTEE' },
  { phone: '+254700000004', role: 'EMPLOYEE' },
  { phone: '+254700000005', role: 'EMPLOYEE' },
];

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
  }
}

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function login(phone) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: phone.replace(/^\+254/, '') }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login ${phone}: ${res.status} ${JSON.stringify(body)}`);
  return { cookie, user: body.employee ?? body.user ?? body };
}

function client(cookie) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n\x1b[1mAppKings — full cycle, Phase 1 to winner\x1b[0m`);
  console.log(`  ${BASE}\n`);

  // This runner is only for a disposable database. Clear test device bindings
  // before sign-in; production cycle resets intentionally preserve device locks.
  await prisma.employee.updateMany({
    data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 },
  });

  const adminLogin = await login(PEOPLE[0].phone);
  const api = client(adminLogin.cookie);

  // ── Reset ─────────────────────────────────────────────────────────────────
  heading('0. Reset the cycle');
  const reset = await api('POST', '/api/admin/reset-cycle', { confirm: 'RESET' });
  check('the cycle resets to NOT_STARTED', reset.ok && reset.data.phase === 'NOT_STARTED', JSON.stringify(reset.data));
  const boundAfterReset = await prisma.employee.count({ where: { deviceHash: { not: null } } });
  check('a new session preserves device locks',
    boundAfterReset === 1 && reset.data.devicesRetained === boundAfterReset,
    `${boundAfterReset} device(s) remain registered`);

  // Reuse the pre-reset admin session and sign the other four test accounts in
  // once. Resetting a cycle preserves device locks, so a second login would fail.
  const sessions = new Map();
  for (const person of PEOPLE) {
    const session = person.phone === PEOPLE[0].phone
      ? adminLogin
      : await login(person.phone);
    sessions.set(person.phone, client(session.cookie));
  }
  check('all five employees are signed in', sessions.size === PEOPLE.length, `${sessions.size}`);

  // ── Phase 1 ───────────────────────────────────────────────────────────────
  heading('1. Phase 1 — nominations');
  const start = await api('POST', '/api/admin/phase', { phase: 'PHASE_1', confirm: true });
  check('the organiser opens Phase 1', start.ok && start.data.phase === 'PHASE_1', JSON.stringify(start.data));

  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  const candidates = await prisma.candidate.findMany({ orderBy: { createdAt: 'asc' } });
  // Nominations name an EMPLOYEE (or a department for team categories), not a
  // candidate row: the candidate is created by the nomination.
  const employees = await prisma.employee.findMany({
    where: { active: true, eligible: true },
    orderBy: { phone: 'asc' },
    select: { id: true, fullName: true, phone: true },
  });
  const byCategory = new Map();
  for (const candidate of candidates) {
    const list = byCategory.get(candidate.categoryId) ?? [];
    list.push(candidate);
    byCategory.set(candidate.categoryId, list);
  }
  check('there are categories and eligible nominators', categories.length > 0 && employees.length > 0,
    `${categories.length} categories / ${employees.length} eligible employees`);

  // Each employee nominates one colleague per category, rotating the pick so the
  // tally is not uniform and the cut has something to cut.
  const departments = await prisma.department.findMany({ orderBy: { name: 'asc' } });
  const ME = 'A consistent, visible contribution throughout the year.';

  // The Phase 1 cut needs 15 people in the POOLED ranking, and the pool is built
  // from people who made a top-5 in some category. Five nominators cannot
  // produce that, so every eligible employee nominates — which is also what a
  // real cycle looks like. The five demo accounts are the ones we then vote as.
  const nominators = [];
  for (const employee of employees) {
    const phone = employee.phone;
    if (sessions.has(phone)) {
      nominators.push({ phone, employeeId: employee.id, voter: sessions.get(phone) });
      continue;
    }
    try {
      nominators.push({ phone, employeeId: employee.id, voter: client((await login(phone)).cookie) });
    } catch {
      // A phone that cannot sign in is simply not a nominator.
    }
  }
  console.log(`  ${nominators.length} nominators`);

  for (const [i, person] of nominators.entries()) {
    const voter = person.voter;
    let nominations = 0;
    for (const [c, category] of categories.entries()) {
      // A nominee is either a colleague (nomineeId) or a team (nomineeDeptId),
      // never both: the schema refines on exactly one being present.
      //
      // The pick is spread across the whole roster rather than rotated one step
      // per nominator. A rotation makes everyone nominate the same neighbour in
      // the same category, so only a handful of people ever reach a top-5 and
      // the pooled ranking cannot reach the 15 the cut requires. Real people
      // nominate a spread of colleagues, and this mirrors that.
      const intendedPickIndex = (i * 7 + c * 3) % employees.length;
      const pickIndex = employees[intendedPickIndex]?.id === person.employeeId
        ? (intendedPickIndex + 1) % employees.length
        : intendedPickIndex;
      const body = category.forTeams
        ? { categoryId: category.id, nomineeDeptId: departments[(i + c) % departments.length].id, justification: ME }
        : { categoryId: category.id, nomineeId: employees[pickIndex].id, justification: ME };
      const res = await voter('PUT', '/api/nominations', body);
      if (res.ok) nominations += 1;
      else if (nominations === 0 && c === 0) {
        console.log(`    (nomination: ${res.status} ${JSON.stringify(res.data).slice(0, 140)})`);
      }
    }
    if (i < PEOPLE.length) {
      check(`${person.phone} nominated in every category`, nominations === categories.length,
        `${nominations}/${categories.length}`);
    }
  }

  const nominationCount = await prisma.nomination.count();
  check('the nominations are on the record', nominationCount > 0, `${nominationCount} rows`);

  // A tie across the cut line blocks the cut until an organiser decides. That
  // is the rule working, not a failure: the runner acknowledges it the way a
  // real organiser would, and the decision is recorded in the audit log.
  const p1Tie = await api('POST', '/api/admin/candidates/confirm', { stage: 1 });
  if (!p1Tie.ok && p1Tie.data?.error?.code === 'TIE_UNRESOLVED') {
    console.log('  (a tie sits on the cut line — resolving it as the organiser would)');
  }
  const p1Cut = p1Tie.ok
    ? p1Tie
    : await api('POST', '/api/admin/candidates/confirm', { stage: 1, resolveTies: true });
  check('the Phase 1 cut is confirmed', p1Cut.ok, JSON.stringify(p1Cut.data));

  const before2 = await api('GET', '/api/admin/dashboard');
  check('readiness agrees Phase 2 is reachable', before2.data.readiness?.canAdvance === true,
    JSON.stringify(before2.data.readiness));

  const to2 = await api('POST', '/api/admin/phase', { phase: 'PHASE_2', confirm: true });
  check('the cycle advances to Phase 2', to2.ok && to2.data.phase === 'PHASE_2', JSON.stringify(to2.data));

  const inPhase2 = await prisma.candidate.count({ where: { inPhase2: true } });
  check('the cut carried candidates into Phase 2', inPhase2 > 0, `${inPhase2} advanced`);
  const phase2Coverage = await prisma.candidate.groupBy({
    by: ['categoryId'],
    where: { inPhase2: true },
    _count: { _all: true },
  });
  check('every category has the minimum Phase 2 candidates',
    categories.every((category) => (phase2Coverage.find((row) => row.categoryId === category.id)?._count._all ?? 0) >= 2));

  const phase1Publish = await api('POST', '/api/admin/publish', { stage: 'PHASE_1' });
  check('the admin can publish Phase 1 after it closes', phase1Publish.ok, JSON.stringify(phase1Publish.data));
  const phase1Public = await sessions.get(PEOPLE[4].phone)('GET', '/api/results');
  check('employees see Phase 1 results but not later phases',
    phase1Public.ok &&
      phase1Public.data.publications?.phase1 === true &&
      phase1Public.data.publications?.phase2 === false &&
      phase1Public.data.results?.length === 0 &&
      phase1Public.data.phaseResults?.phase1?.some((category) => category.results.length > 0),
    `status=${phase1Public.status} ${JSON.stringify(phase1Public.data.publications)}`);

  // ── Phase 2 ───────────────────────────────────────────────────────────────
  heading('2. Phase 2 — committee picks');
  const earlyPhase2Publish = await api('POST', '/api/admin/publish', { stage: 'PHASE_2' });
  check('Phase 2 results cannot be published while it is open', earlyPhase2Publish.status === 409,
    JSON.stringify(earlyPhase2Publish.data));
  // Phase 2 is the COMMITTEE round: employees do not vote here, they vote in
  // Phase 3. The API enforces this (POST /api/votes answers PHASE_CLOSED in
  // Phase 2), which is why the runner does not try.
  const employeeVoteInP2 = await sessions.get(PEOPLE[3].phone)('POST', '/api/votes', {
    categoryId: categories[0].id,
    candidateId: (await prisma.candidate.findFirst({ where: { inPhase2: true } }))?.id,
  });
  check('an employee cannot vote in the committee round', employeeVoteInP2.status === 409,
    `${employeeVoteInP2.status} ${JSON.stringify(employeeVoteInP2.data).slice(0, 100)}`);

  // Committee members make their picks in each category.
  let firstPickError = null;
  for (const person of PEOPLE.filter((p) => p.role === 'COMMITTEE')) {
    const voter = sessions.get(person.phone);
    let picks = 0;
    for (const category of categories) {
      const pool = await prisma.candidate.findMany({ where: { categoryId: category.id, inPhase2: true } });
      if (pool.length === 0) continue;
      // COMMITTEE_PICKS_PER_CATEGORY is 1 by default; the API rejects more.
      const res = await voter('PUT', '/api/committee/picks', {
        categoryId: category.id,
        candidateIds: pool.slice(0, 1).map((c) => c.id),
      });
      if (res.ok) picks += 1;
      else if (picks === 0 && !firstPickError) {
        firstPickError = `${res.status} ${JSON.stringify(res.data).slice(0, 160)}`;
      }
    }
    check(`committee ${person.phone} made picks`, picks > 0, firstPickError ?? `${picks} categories`);
  }

  const p2Votes = await prisma.committeeVote.count();
  check('the committee round is recorded', p2Votes > 0, `${p2Votes} committee votes`);

  const p2Tie = await api('POST', '/api/admin/candidates/confirm', { stage: 2 });
  if (!p2Tie.ok && p2Tie.data?.error?.code === 'TIE_UNRESOLVED') {
    console.log('  (a tie sits on the Phase 2 cut line — resolving it)');
  }
  const p2Cut = p2Tie.ok
    ? p2Tie
    : await api('POST', '/api/admin/candidates/confirm', { stage: 2, resolveTies: true });
  check('the Phase 2 cut is confirmed', p2Cut.ok, JSON.stringify(p2Cut.data));

  const before3 = await api('GET', '/api/admin/dashboard');
  check('readiness agrees Phase 3 is reachable', before3.data.readiness?.canAdvance === true,
    JSON.stringify(before3.data.readiness));

  const to3 = await api('POST', '/api/admin/phase', { phase: 'PHASE_3', confirm: true });
  check('the cycle advances to Phase 3', to3.ok && to3.data.phase === 'PHASE_3', JSON.stringify(to3.data));

  const inPhase3 = await prisma.candidate.count({ where: { inPhase3: true } });
  check('the cut carried candidates into Phase 3', inPhase3 > 0, `${inPhase3} finalists`);
  const phase3Coverage = await prisma.candidate.groupBy({
    by: ['categoryId'],
    where: { inPhase3: true },
    _count: { _all: true },
  });
  check('every category has the minimum Phase 3 finalists',
    categories.every((category) => (phase3Coverage.find((row) => row.categoryId === category.id)?._count._all ?? 0) >= 2));

  const phase2Publish = await api('POST', '/api/admin/publish', { stage: 'PHASE_2' });
  check('the admin can publish Phase 2 after it closes', phase2Publish.ok, JSON.stringify(phase2Publish.data));
  const phase2Public = await sessions.get(PEOPLE[4].phone)('GET', '/api/results');
  check('employees see Phase 1 and Phase 2 but not Phase 3',
    phase2Public.ok &&
      phase2Public.data.publications?.phase1 === true &&
      phase2Public.data.publications?.phase2 === true &&
      phase2Public.data.publications?.phase3 === false &&
      phase2Public.data.phaseResults?.phase2?.some((category) => category.results.length > 0),
    `status=${phase2Public.status} ${JSON.stringify(phase2Public.data.publications)}`);
  const earlyPhase3Publish = await api('POST', '/api/admin/publish', { stage: 'PHASE_3' });
  check('Phase 3 results cannot be published while voting is open', earlyPhase3Publish.status === 409,
    JSON.stringify(earlyPhase3Publish.data));

  // ── Phase 3 ───────────────────────────────────────────────────────────────
  heading('3. Phase 3 — final employee vote');
  // One pick per category, per voter — the rule the API enforces. Voting for
  // every candidate would give everyone the same points and produce a flat,
  // meaningless tie, which is not what a real ballot looks like.
  const finalists = await prisma.candidate.findMany({ where: { inPhase3: true } });
  const byCat = new Map();
  const finalistCategories = new Map();
  for (const candidate of finalists) {
    const list = byCat.get(candidate.categoryId) ?? [];
    list.push(candidate);
    byCat.set(candidate.categoryId, list);
    if (candidate.employeeId) {
      finalistCategories.set(candidate.employeeId, (finalistCategories.get(candidate.employeeId) ?? 0) + 1);
    }
  }
  const championId = [...finalistCategories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const [i, person] of PEOPLE.entries()) {
    const voter = sessions.get(person.phone);
    let votes = 0;
    for (const [c, category] of categories.entries()) {
      const pool = byCat.get(category.id) ?? [];
      if (pool.length === 0) continue;
      // Concentrate votes on the most widely shortlisted person so the test
      // exercises the single-overall-winner path as well as a complete tie.
      const pick = pool.find((candidate) => candidate.employeeId === championId)
        ?? pool[(i + c) % pool.length];
      const res = await voter('POST', '/api/votes', {
        categoryId: category.id,
        candidateId: pick.id,
      });
      if (res.ok) votes += 1;
    }
    check(`${person.phone} cast one vote per category`, votes === categories.length, `${votes}/${categories.length}`);
  }
  const p3Votes = await prisma.vote.count();
  check('Phase 3 votes are recorded', p3Votes > 0, `${p3Votes} votes`);

  // ── Close and publish ─────────────────────────────────────────────────────
  heading('4. Close and publish');
  const closed = await api('POST', '/api/admin/phase', { phase: 'CLOSED', confirm: true });
  check('the cycle closes', closed.ok && closed.data.phase === 'CLOSED', JSON.stringify(closed.data));

  const computed = await api('GET', '/api/admin/results');
  const rows = computed.data.winners ?? computed.data.items ?? computed.data.results ?? [];
  check('results are computed at close', rows.length > 0, `${rows.length} categories`);

  const beforeFinalPublish = await sessions.get(PEOPLE[4].phone)('GET', '/api/results');
  check('Phase 3 results stay private until the admin publishes them',
    beforeFinalPublish.ok &&
      beforeFinalPublish.data.publications?.phase1 === true &&
      beforeFinalPublish.data.publications?.phase2 === true &&
      beforeFinalPublish.data.publications?.phase3 === false &&
      beforeFinalPublish.data.results?.length === 0,
    `status=${beforeFinalPublish.status} ${JSON.stringify(beforeFinalPublish.data.publications)}`);

  // Publishing a category that ended in a tie needs an explicit acknowledgement.
  const published = await api('POST', '/api/admin/publish', { stage: 'PHASE_3', acknowledgeTies: true });
  check('results are published', published.ok, JSON.stringify(published.data));

  // GET /api/results is behind the session guard (results are for signed-in
  // employees, not the open web), so it is read with an employee's session.
  const resultsRes = await sessions.get(PEOPLE[4].phone)('GET', '/api/results');
  const publicResults = resultsRes.data ?? {};
  const categoriesOut = publicResults.results ?? [];
  check('a signed-in employee can see the results',
    publicResults.published === true &&
      publicResults.publications?.phase1 === true &&
      publicResults.publications?.phase2 === true &&
      publicResults.publications?.phase3 === true &&
      publicResults.phaseResults?.phase1?.length > 0 &&
      publicResults.phaseResults?.phase2?.length > 0 &&
      categoriesOut.length > 0,
    `status=${resultsRes.status} published=${publicResults.published} categories=${categoriesOut.length}`);

  const withWinner = categoriesOut.filter((c) => c.winnerId);
  check('every category has a winner', withWinner.length === categoriesOut.length,
    `${withWinner.length}/${categoriesOut.length}`);

  if (categoriesOut.length) {
    console.log('\n  Category winners (nomination + committee + final = total):');
    for (const category of categoriesOut) {
      const winner = (category.results ?? []).find((row) => row.id === category.winnerId);
      const name = winner?.name ?? '(tie)'; 
      const points = winner
        ? `${winner.nominationPoints} + ${winner.committeePoints} + ${winner.finalPoints} = ${winner.totalPoints}`
        : '';
      console.log(`    ${category.categoryName}: ${name}${points ? `  (${points})` : ''}`);
    }
  }

  // ── The single overall winner ─────────────────────────────────────────────
  heading('6. One overall winner');
  const overall = publicResults.overall;
  check('the results carry an overall champion block', Boolean(overall), 'missing');

  const overallRows = overall?.rows ?? [];
  check('the overall ranking is not empty', overallRows.length > 0, `${overallRows.length} people`);

  if (overallRows.length > 0) {
    const top = overallRows[0];
    const tied = overallRows.filter((row) => row.totalPoints === top.totalPoints);

    // A full score tie is unresolved; otherwise the aggregate and phase
    // tie-break chain must produce exactly one overall winner.
    if (tied.length > 1) {
      check('a shared top score is reported as a tie, not a winner',
        overall.winnerId === null && overall.tiebreakRequired === true,
        `winnerId=${overall.winnerId} tiebreakRequired=${overall.tiebreakRequired}`);
      console.log(`\n  \x1b[33mOverall: a tie at ${top.totalPoints} points\x1b[0m`);
      for (const row of tied) console.log(`    ${row.name} (${row.totalPoints})`);
      console.log('    The organiser decides; the system does not pick alphabetically.');
    } else {
      check('a clear top score produces one overall winner',
        overall.winnerId === top.id && overall.tiebreakRequired === false,
        `winnerId=${overall.winnerId} top=${top.id}`);
      console.log(`\n  \x1b[1mOverall winner: ${top.name}\x1b[0m`);
      console.log(`    ${top.nominationPoints} + ${top.committeePoints} + ${top.finalPoints} = ${top.totalPoints} points across ${top.categories} categor${top.categories === 1 ? 'y' : 'ies'}`);
    }

    check('teams are excluded from the overall title',
      overallRows.every((row) => row.name !== 'Finance and Admin'), 'a team appears in the ranking');
  }

  // ── Transparency ──────────────────────────────────────────────────────────
  heading('5. The trail is still readable');
  // Each phase's result is frozen onto the candidate when that phase closes, so
  // the whole path to the winner survives the vote table being cleared.
  const frozen = await prisma.candidate.findMany({
    where: { OR: [{ nominationPoints: { gt: 0 } }, { committeePoints: { gt: 0 } }, { finalPoints: { gt: 0 } }] },
    select: { nominationPoints: true, committeePoints: true, finalPoints: true },
  });
  const sum = (key) => frozen.reduce((total, row) => total + row[key], 0);
  console.log(`  Frozen points — Phase 1: ${sum('nominationPoints')}, Phase 2: ${sum('committeePoints')}, Phase 3: ${sum('finalPoints')}`);
  check('all three phases left a result behind',
    sum('nominationPoints') > 0 && sum('committeePoints') > 0 && sum('finalPoints') > 0);
  console.log(`  Nominations: ${await prisma.nomination.count()}, committee votes: ${await prisma.committeeVote.count()}`);

  const audit = await api('GET', '/api/admin/audit');
  check('every step is in the audit log', (audit.data.entries ?? audit.data.items ?? []).length > 0);

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log(`\x1b[32mAll ${passed} checks passed — Phase 1 → 2 → 3 → winner.\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed\n`);
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(`\n\x1b[31m${error.message}\x1b[0m\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
