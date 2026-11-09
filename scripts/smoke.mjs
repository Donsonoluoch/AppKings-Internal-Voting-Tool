// End-to-end smoke test against a running stack (web on :3000 proxy → API on :4000).
// Exercises the rules that must not break: device binding, phase gating,
// self-nomination limit, one nomination per category (replaceable), the top-5 / top-15 /
// 6–10 cuts with ties, one vote per category, confidential votes, points-only results and
// publishing.
//
//   node scripts/smoke.mjs                 # against http://localhost:3000
//   BASE_URL=http://localhost:3000 node scripts/smoke.mjs
//
// It changes the database phase, so run it on demo data, then `npm run db:reset`.

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = `${BASE}/api`;

let failures = 0;
let passes = 0;
function check(label, condition, detail = '') {
  if (condition) {
    passes += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

class Session {
  constructor(name) {
    this.name = name;
    this.cookie = '';
    this.deviceToken = null;
    this.user = null;
  }

  async call(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.deviceToken) headers['x-device-token'] = this.deviceToken;
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie?.() || [];
    for (const cookie of setCookie) {
      const pair = cookie.split(';')[0];
      if (pair.startsWith('appkings_session=')) this.cookie = pair;
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: response.status, body: payload };
  }

  async login(phone) {
    const result = await this.call('/auth/login', { method: 'POST', body: { phone } });
    if (result.body?.deviceToken) this.deviceToken = result.body.deviceToken;
    this.user = result.body?.user || null;
    return result;
  }

  async loginWithDevice(phone) {
    return this.call('/auth/login', { method: 'POST', body: { phone, deviceToken: this.deviceToken } });
  }
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);

  const admin = new Session('admin');
  let result = await admin.login('+254700000001');
  check('admin logs in on a first device and receives a device token', result.status === 200 && Boolean(admin.deviceToken));

  // --- device binding ------------------------------------------------------
  const intruder = new Session('intruder');
  result = await intruder.login('+254700000001');
  check(
    'same number on a second device is rejected with DEVICE_MISMATCH',
    result.status === 403 && result.body?.error?.code === 'DEVICE_MISMATCH',
    JSON.stringify(result.body)
  );

  // --- phase gating --------------------------------------------------------
  const emp = new Session('employee');
  result = await emp.login('+254700000004');
  check('employee logs in', result.status === 200 && emp.user?.role === 'EMPLOYEE');

  const categories = (await emp.call('/categories')).body.categories;
  check('8 categories are seeded', categories.length === 8, `got ${categories.length}`);

  result = await emp.call('/nominations', {
    method: 'PUT',
    body: { categoryId: categories[0].id, nomineeId: emp.user.id, justification: 'x'.repeat(30) },
  });
  check('nomination before Phase 1 is rejected (409 PHASE_CLOSED)', result.status === 409 && result.body?.error?.code === 'PHASE_CLOSED', JSON.stringify(result.body));

  result = await admin.call('/results');
  check('results are not published before publishing', result.body?.published === false);

  // --- open Phase 1 --------------------------------------------------------
  result = await admin.call('/admin/phase', { method: 'POST', body: { phase: 'PHASE_1', confirm: true } });
  check('admin opens Phase 1', result.status === 200, JSON.stringify(result.body));

  result = await admin.call('/admin/phase', { method: 'POST', body: { phase: 'NOT_STARTED', confirm: true } });
  check('phase cannot move backward', result.status === 409, JSON.stringify(result.body));

  // --- nominations ---------------------------------------------------------
  const colleagues = (await emp.call('/colleagues')).body;
  check('colleague list never exposes phone numbers', !JSON.stringify(colleagues).includes('+2547'), 'phone leaked');
  const colleague = colleagues.colleagues.find((c) => !c.isSelf);
  const other = colleagues.colleagues.find((c) => !c.isSelf && c.id !== colleague.id);

  result = await emp.call('/nominations', {
    method: 'PUT',
    body: { categoryId: categories[0].id, nomineeId: colleague.id, justification: 'short' },
  });
  check('justification under 20 characters is rejected', result.status === 400, JSON.stringify(result.body));

  result = await emp.call('/nominations', {
    method: 'PUT',
    body: {
      categoryId: categories[0].id,
      nomineeId: colleague.id,
      justification: 'Delivered the Q3 migration on time, with zero downtime and clear documentation.',
    },
  });
  check('a valid nomination is accepted in Phase 1', result.status === 200, JSON.stringify(result.body));

  result = await emp.call('/nominations', {
    method: 'PUT',
    body: {
      categoryId: categories[0].id,
      nomineeId: other.id,
      justification: 'Ran the customer onboarding revamp that cut time-to-first-ticket by 40%.',
    },
  });
  check('a second nomination in the same category replaces the first', result.status === 200, JSON.stringify(result.body));

  const mine = (await emp.call('/nominations/mine')).body.nominations;
  check(
    'one nomination per employee per category',
    mine.filter((n) => n.categoryId === categories[0].id).length === 1 && mine.some((n) => n.nomineeId === other.id),
    JSON.stringify(mine)
  );

  result = await emp.call('/nominations', {
    method: 'PUT',
    body: { categoryId: categories[1].id, nomineeId: emp.user.id, justification: 'I led the onboarding revamp that cut time-to-first-ticket by 40%.' },
  });
  check('first self-nomination is accepted', result.status === 200, JSON.stringify(result.body));

  result = await emp.call('/nominations', {
    method: 'PUT',
    body: { categoryId: categories[2].id, nomineeId: emp.user.id, justification: 'Independent evidence: I also ran the 2026 hack week for the whole company.' },
  });
  check('second self-nomination (any category) is rejected', result.status === 409, JSON.stringify(result.body));

  const teamCategory = categories.find((c) => c.forTeams);
  result = await emp.call('/nominations', {
    method: 'PUT',
    body: { categoryId: teamCategory.id, nomineeId: colleague.id, justification: 'Should not work: Team of the Year takes a department, not a person.' },
  });
  check('Team of the Year rejects employee nominees', result.status === 400, JSON.stringify(result.body));

  const teams = colleagues.teams;
  result = await emp.call('/nominations', {
    method: 'PUT',
    body: { categoryId: teamCategory.id, nomineeDeptId: teams[0].id, justification: 'The team shipped three releases while short two engineers and never missed a date.' },
  });
  check('Team of the Year accepts a department nominee', result.status === 200, JSON.stringify(result.body));

  // --- committee session (bind the device early, one login per demo person) --------
  const committee = new Session('committee');
  result = await committee.login('+254700000002');
  check('committee member logs in', result.status === 200 && committee.user?.role === 'COMMITTEE', JSON.stringify(result.body));

  // --- more employees nominating ------------------------------------------
  // Every other demo person nominates in every category. One login per person: a phone
  // number that is already bound to a device cannot log in a second time (§7).
  const voters = [];
  for (let i = 3; i <= 25; i += 1) {
    const session = new Session(`emp${i}`);
    const login = await session.login(`+2547000000${String(i).padStart(2, '0')}`);
    if (login.status === 200) voters.push(session);
  }
  check('the other demo employees log in', voters.length >= 20, `got ${voters.length}`);

  for (const [index, session] of voters.entries()) {
    for (const [categoryIndex, category] of categories.entries()) {
      const pool = colleagues.colleagues.filter((nominee) => nominee.id !== session.user.id);
      const nominee = pool[(index * 3 + categoryIndex) % pool.length];
      if (!nominee) continue;
      await session.call('/nominations', {
        method: 'PUT',
        body: {
          categoryId: category.id,
          ...(category.forTeams ? { nomineeDeptId: teams[categoryIndex % teams.length].id } : { nomineeId: nominee.id }),
          justification: `Nomination for ${category.name}: sustained excellent work with clear, specific outcomes.`,
        },
      });
    }
  }

  // --- Phase 1 tally & cut -------------------------------------------------
  const tally1 = (await admin.call('/admin/tally')).body;
  check('admin sees the Phase 1 tally', tally1.phase === 'PHASE_1' && Array.isArray(tally1.tally?.people), JSON.stringify(tally1).slice(0, 200));
  check(
    'every category keeps at most the top 5 finalists',
    (tally1.tally?.categories || []).every((category) => category.finalists.length <= 5),
    JSON.stringify((tally1.tally?.categories || []).map((c) => c.finalists.length))
  );

  result = await admin.call('/admin/phase', { method: 'POST', body: { phase: 'PHASE_2', confirm: true } });
  check('Phase 1 → 2 is blocked until the cut is confirmed', result.status === 409, JSON.stringify(result.body));

  result = await admin.call('/admin/candidates/confirm', { method: 'POST', body: { resolveTies: true } });
  check('admin confirms the top 15 cut', result.status === 200, JSON.stringify(result.body));
  const advancing = result.body?.people?.length ?? 0;
  check('the pooled cut advances the top 15 people', advancing === 15, `advanced ${advancing}`);

  result = await admin.call('/admin/phase', { method: 'POST', body: { phase: 'PHASE_2', confirm: true } });
  check('admin moves to Phase 2', result.status === 200, JSON.stringify(result.body));

  // --- committee -----------------------------------------------------------
  const committeeCandidates = (await committee.call('/committee/candidates')).body.categories;
  const firstCategory = committeeCandidates.find((category) => category.candidates.length > 0);
  const firstCandidate = firstCategory.candidates[0];

  result = await committee.call('/committee/picks', {
    method: 'PUT',
    body: { categoryId: firstCategory.id, candidateIds: firstCategory.candidates.slice(0, 2).map((c) => c.id) },
  });
  check('more picks than COMMITTEE_PICKS_PER_CATEGORY is rejected', result.status === 400, JSON.stringify(result.body));

  result = await committee.call('/committee/picks', {
    method: 'PUT',
    body: { categoryId: firstCategory.id, candidateIds: [firstCandidate.id] },
  });
  check('one committee pick per category is saved', result.status === 200, JSON.stringify(result.body));

  result = await committee.call('/committee/conflicts', {
    method: 'POST',
    body: { candidateId: firstCandidate.id, reason: 'Relative' },
  });
  check('conflict can be declared', result.status === 201, JSON.stringify(result.body));

  result = await committee.call('/committee/picks', {
    method: 'PUT',
    body: { categoryId: firstCategory.id, candidateIds: [firstCandidate.id] },
  });
  check('a declared conflict blocks picking that candidate', result.status === 403, JSON.stringify(result.body));

  for (const category of committeeCandidates) {
    if (category.candidates.length === 0) continue;
    const pick = category.candidates.find((candidate) => !candidate.hasConflict);
    if (!pick) continue;
    await committee.call('/committee/picks', { method: 'PUT', body: { categoryId: category.id, candidateIds: [pick.id] } });
  }

  const myPicks = (await committee.call('/committee/picks')).body;
  check('a member only ever sees their own picks', Object.values(myPicks.picks).every((list) => list.length <= 1), JSON.stringify(myPicks));

  const tally2 = (await admin.call('/admin/tally')).body;
  check('admin sees the Phase 2 tally', tally2.phase === 'PHASE_2' && Array.isArray(tally2.tally?.people), JSON.stringify(tally2).slice(0, 200));

  result = await admin.call('/admin/candidates/confirm', { method: 'POST', body: { resolveTies: true } });
  check('admin confirms the Phase 2 cut', result.status === 200, JSON.stringify(result.body));
  const shortlisted = result.body?.people?.length ?? 0;
  check('6–10 people advance after Phase 2', shortlisted >= 6 && shortlisted <= 10, `advanced ${shortlisted}`);

  result = await admin.call('/admin/phase', { method: 'POST', body: { phase: 'PHASE_3', confirm: true } });
  check('admin moves to Phase 3', result.status === 200, JSON.stringify(result.body));

  // --- Phase 3 voting ------------------------------------------------------
  result = await emp.call('/shortlist');
  const shortlist = result.body.categories;
  check('shortlist is visible in Phase 3', result.status === 200 && shortlist.length > 0, `categories: ${shortlist.length}`);

  const voteTarget = shortlist[0];
  const voteBody = { categoryId: voteTarget.id, candidateId: voteTarget.candidates[0].id };
  result = await emp.call('/votes', { method: 'POST', body: voteBody });
  check('a vote is accepted', result.status === 201, JSON.stringify(result.body));

  result = await emp.call('/votes', { method: 'POST', body: voteBody });
  check('a second vote in the same category is rejected', result.status === 409, JSON.stringify(result.body));

  const parallel = await Promise.all([
    emp.call('/votes', { method: 'POST', body: { categoryId: shortlist[1].id, candidateId: shortlist[1].candidates[0].id } }),
    emp.call('/votes', { method: 'POST', body: { categoryId: shortlist[1].id, candidateId: shortlist[1].candidates[1].id } }),
  ]);
  check('two parallel votes in one category: exactly one is accepted', parallel.filter((r) => r.status === 201).length === 1, JSON.stringify(parallel.map((r) => r.status)));

  for (const session of voters) {
    for (const category of shortlist) {
      await session.call('/votes', { method: 'POST', body: { categoryId: category.id, candidateId: category.candidates[0].id } });
    }
  }

  result = await emp.call('/results');
  check('results are hidden from employees before publishing', result.status === 409, JSON.stringify(result.body));

  const audit = (await admin.call('/admin/audit?action=VOTE_CAST&pageSize=100')).body;
  const voteEntriesHaveCandidates = audit.entries.some((entry) => JSON.stringify(entry.details || {}).includes('candidateId'));
  check('VOTE_CAST audit entries never contain a candidate id', audit.entries.length > 0 && !voteEntriesHaveCandidates);

  result = await admin.call('/admin/phase', { method: 'POST', body: { phase: 'CLOSED', confirm: true } });
  check('voting can be closed', result.status === 200, JSON.stringify(result.body));

  result = await admin.call('/votes', { method: 'POST', body: voteBody });
  check('voting after close is rejected', result.status === 409, JSON.stringify(result.body));

  const adminResults = (await admin.call('/admin/results')).body;
  check('admin sees results for every category', adminResults.results.length === 8, `${adminResults.results.length}`);
  const row = adminResults.results[0].results[0];
  check(
    'results are points only (no percentage field)',
    typeof row.totalPoints === 'number' && row.percentage === undefined,
    JSON.stringify(row)
  );
  check(
    'total points are the sum of the three phases',
    row.totalPoints === row.nominationPoints + row.committeePoints + row.finalPoints,
    JSON.stringify(row)
  );

  result = await admin.call('/admin/publish', { method: 'POST', body: { acknowledgeTies: true } });
  check('results are published', result.status === 200, JSON.stringify(result.body));

  result = await emp.call('/results');
  check('employees can see published results', result.status === 200 && result.body.results.length === 8);

  result = await emp.call('/results/me');
  check('an employee can see their own points per phase', result.status === 200 && result.body.totals !== undefined, JSON.stringify(result.body).slice(0, 200));

  // --- device reset --------------------------------------------------------
  const target = (await admin.call('/admin/employees?search=%2B254700000004')).body.employees[0];
  result = await admin.call(`/admin/devices/${target.id}/reset`, { method: 'POST' });
  check('admin resets a device once', result.status === 200, JSON.stringify(result.body));
  result = await admin.call(`/admin/devices/${target.id}/reset`, { method: 'POST' });
  check('a second reset is refused', result.status === 409, JSON.stringify(result.body));

  const reRegister = new Session('new-device');
  result = await reRegister.login('+254700000004');
  check('after a reset the next login registers the new device', result.status === 200 && Boolean(reRegister.deviceToken));

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
