const test = require('node:test');
const assert = require('node:assert/strict');
const { selectAdvancingPeople } = require('./tally');

test('preserves the pooled limit and adds category finalists when coverage needs them', () => {
  const tally = {
    limits: { minCandidatesPerCategory: 2 },
    categories: [
      {
        forTeams: false,
        finalists: [{ employeeId: 'a' }, { employeeId: 'b' }, { employeeId: 'c' }],
      },
      {
        forTeams: false,
        finalists: [{ employeeId: 'd' }, { employeeId: 'e' }, { employeeId: 'f' }],
      },
      {
        forTeams: true,
        finalists: [{ employeeId: 'team-placeholder' }],
      },
    ],
    people: [
      { id: 'a' },
      { id: 'b' },
      { id: 'g' },
      { id: 'h' },
      { id: 'd' },
      { id: 'e' },
    ],
  };

  assert.deepEqual([...selectAdvancingPeople(tally, 5)], ['a', 'b', 'g', 'h', 'd', 'e']);
});

test('counts people shared between category minimums only once', () => {
  const tally = {
    limits: { minCandidatesPerCategory: 2 },
    categories: [
      { forTeams: false, finalists: [{ employeeId: 'a' }, { employeeId: 'b' }] },
      { forTeams: false, finalists: [{ employeeId: 'a' }, { employeeId: 'c' }] },
    ],
    people: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  };

  assert.deepEqual([...selectAdvancingPeople(tally, 4)], ['a', 'b', 'c', 'd']);
});

// ── The cut is what the next phase receives ───────────────────────────────────
// These pin the two rules the phase hand-off depends on: the shortlist floor after
// Phase 2, and Team of the Year advancing on its own track in every phase.
const { peopleAdvanceLimit, teamAdvanceLimit } = require('./tally');

test('the Phase 2 shortlist keeps at least the 6–10 minimum when enough people are ranked', () => {
  const ranked = { phase: 'PHASE_2', people: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}` })), limits: { phase2FinalistsMin: 6 } };
  assert.equal(peopleAdvanceLimit(ranked, 10), 10);
  // MAX lowered below MIN is raised to MIN, never left short of the brief.
  assert.equal(peopleAdvanceLimit(ranked, 4), 6);
  // Never more people than the ranking holds.
  const few = { ...ranked, people: ranked.people.slice(0, 3) };
  assert.equal(peopleAdvanceLimit(few, 10), 3);
});

test('Phase 1 advances the pooled 15 and never exceeds the ranking', () => {
  const tally = { phase: 'PHASE_1', people: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` })), limits: {} };
  assert.equal(peopleAdvanceLimit(tally, 15), 15);
});

test('Team of the Year advances at least two teams, so the final vote is a contest', () => {
  assert.ok(teamAdvanceLimit() >= 2);
});

test('the shortlist keeps category coverage, so no category arrives at the final vote empty', () => {
  // 'z' is the only finalist in category B yet ranks last in the pooled list. The pooled
  // limit alone would drop it, leaving category B with no finalist.
  const tally = {
    phase: 'PHASE_2',
    limits: { phase2FinalistsMin: 2, minCandidatesPerCategory: 2 },
    categories: [
      { forTeams: false, finalists: [{ employeeId: 'a' }, { employeeId: 'b' }] },
      { forTeams: false, finalists: [{ employeeId: 'z' }, { employeeId: 'y' }] },
    ],
    people: [
      { id: 'a', points: 5 },
      { id: 'b', points: 4 },
      { id: 'y', points: 3 },
      { id: 'z', points: 1 },
    ],
  };
  const advancing = selectAdvancingPeople(tally, peopleAdvanceLimit(tally, 2));
  assert.ok(advancing.has('a') && advancing.has('b'));
  assert.ok(advancing.has('z'), 'the lowest-ranked finalist of a short category is protected');
});

// ── A tie on the Phase 2 cut line ─────────────────────────────────────────────
// §5 step 5: the admin decides a tie. The one exception is a tie the committee's ballot
// could not separate at all — a block of people level in every category they share — where
// there is no evidence for anyone to decide with, so the cut orders it instead.
const { resolveCutLineTies } = require('./tally');

const person = (id, points, priorPoints, name = id) => ({ id, points, priorPoints, name });

test('a tie the committee separated stays a tie, for the admin to resolve', () => {
  const sorted = [person('a', 5, 9), person('b', 3, 4), person('c', 3, 4), person('d', 1, 2)];
  // b and c are level, but not on the line: the cut takes both.
  assert.deepEqual(resolveCutLineTies(sorted, 3, [[3, 2], [3, 0], [0, 3], [1, 0]]).map((r) => r.id), [
    'a',
    'b',
    'c',
    'd',
  ]);
  // With room for only one of them, the committee still told them apart somewhere: the tie
  // is a real choice, so it is left for the admin.
  const rows = [[3, 2], [3, 0], [0, 3], [1, 0]];
  assert.equal(resolveCutLineTies(sorted, 2, rows).map((r) => r.id).join(','), 'a,b,c,d');
});

test('a deadlock on the cut line is ordered, so the cut can be made', () => {
  // b and c each took exactly one category, and are level on nominations too. Nothing in
  // the record separates them; the cut orders them rather than blocking the hand-over.
  const sorted = [person('a', 5, 9), person('c', 1, 4), person('b', 1, 4)];
  const points = [[3, 2], [0, 1], [1, 0]];
  const ordered = resolveCutLineTies(sorted, 2, points);
  assert.equal(ordered.length, 3);
  assert.equal(ordered[0].id, 'a', 'the person above the line does not move');
  assert.deepEqual(new Set([ordered[1].id, ordered[2].id]), new Set(['b', 'c']));
});

test('nobody is added or dropped by ordering a tie', () => {
  const sorted = [person('a', 4, 7), person('y', 2, 3), person('x', 2, 3), person('z', 2, 3), person('w', 1, 1)];
  const ordered = resolveCutLineTies(sorted, 2, [[2, 2], [1, 1], [1, 1], [1, 1], [1, 0]]);
  assert.deepEqual(
    ordered.map((row) => row.id).sort(),
    sorted.map((row) => row.id).sort(),
  );
});

test('no tie at all leaves the ranking untouched', () => {
  const sorted = [person('a', 5, 1), person('b', 4, 1), person('c', 1, 1)];
  assert.equal(resolveCutLineTies(sorted, 2, [[5], [4], [1]]), sorted);
});
