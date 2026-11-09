const test = require('node:test');
const assert = require('node:assert/strict');
const { rankWithTies, pooledTotals, compareByTieBreak, rankCategory, overallChampion } = require('./scoring');

test('rankWithTies sorts by points and flags a tie that spills over the cut', () => {
  const clean = rankWithTies(
    [
      { id: 'a', points: 9 },
      { id: 'b', points: 7 },
      { id: 'c', points: 3 },
    ],
    2
  );
  assert.deepEqual(clean.sorted.map((row) => row.id), ['a', 'b', 'c']);
  assert.equal(clean.tiedAtCutoff, false);

  const tied = rankWithTies(
    [
      { id: 'a', points: 9 },
      { id: 'b', points: 7 },
      { id: 'c', points: 7 },
    ],
    2
  );
  assert.equal(tied.tiedAtCutoff, true);
});

test('rankWithTies does not flag a tie below the cut line', () => {
  const result = rankWithTies(
    [
      { id: 'a', points: 9 },
      { id: 'b', points: 7 },
      { id: 'c', points: 3 },
      { id: 'd', points: 3 },
    ],
    2
  );
  assert.equal(result.tiedAtCutoff, false);
});

test('pooledTotals sums a person across the categories where they are a finalist', () => {
  // §5 example: Ayan 9 + 6 = 15, Brian 12 in one category only.
  const totals = pooledTotals([
    { personId: 'ayan', points: 9 },
    { personId: 'ayan', points: 6 },
    { personId: 'brian', points: 12 },
  ]);
  assert.deepEqual(totals, [
    { id: 'ayan', points: 15 },
    { id: 'brian', points: 12 },
  ]);
});

test('the tie-break chain is this phase, then Phase 2, then Phase 1', () => {
  const a = { finalPoints: 5, committeePoints: 1, nominationPoints: 2 };
  const b = { finalPoints: 5, committeePoints: 3, nominationPoints: 0 };
  assert.ok(compareByTieBreak(a, b) > 0, 'b wins on Phase 2 points');

  const c = { finalPoints: 5, committeePoints: 3, nominationPoints: 4 };
  assert.ok(compareByTieBreak(b, c) > 0, 'c wins on Phase 1 points');

  const d = { finalPoints: 5, committeePoints: 3, nominationPoints: 4 };
  assert.equal(compareByTieBreak(c, d), 0, 'a full tie is left to the admin');
});

test('rankCategory picks the winner and flags an unresolved tie', () => {
  const decided = rankCategory([
    { id: 'a', finalPoints: 4, committeePoints: 0, nominationPoints: 9 },
    { id: 'b', finalPoints: 6, committeePoints: 0, nominationPoints: 1 },
  ]);
  assert.equal(decided.winnerId, 'b');
  assert.equal(decided.tiebreakRequired, false);

  const tied = rankCategory([
    { id: 'a', finalPoints: 4, committeePoints: 2, nominationPoints: 9 },
    { id: 'b', finalPoints: 4, committeePoints: 2, nominationPoints: 9 },
  ]);
  assert.equal(tied.tiebreakRequired, true);
});

test('an empty category does not throw', () => {
  const result = rankCategory([]);
  assert.equal(result.winnerId, null);
  assert.equal(result.tiebreakRequired, false);
});

test('overall champion uses total points, then phase points to break ties', () => {
  const result = overallChampion([
    {
      id: 'a',
      personId: 'a',
      kind: 'employee',
      nominationPoints: 3,
      committeePoints: 2,
      finalPoints: 1,
      totalPoints: 6,
    },
    {
      id: 'b',
      personId: 'b',
      kind: 'employee',
      nominationPoints: 0,
      committeePoints: 0,
      finalPoints: 5,
      totalPoints: 5,
    },
    {
      id: 'c',
      personId: 'c',
      kind: 'employee',
      nominationPoints: 1,
      committeePoints: 2,
      finalPoints: 3,
      totalPoints: 6,
    },
  ]);

  assert.equal(result.winnerId, 'c');
  assert.equal(result.tiebreakRequired, false);
  assert.deepEqual(result.rows.map((row) => row.id), ['c', 'a', 'b']);
});

test('overall champion reports a genuine tie when all phase totals match', () => {
  const result = overallChampion([
    {
      id: 'a',
      personId: 'a',
      kind: 'employee',
      nominationPoints: 1,
      committeePoints: 2,
      finalPoints: 3,
      totalPoints: 6,
    },
    {
      id: 'b',
      personId: 'b',
      kind: 'employee',
      nominationPoints: 1,
      committeePoints: 2,
      finalPoints: 3,
      totalPoints: 6,
    },
  ]);

  assert.equal(result.winnerId, null);
  assert.equal(result.tiebreakRequired, true);
  assert.deepEqual(result.tiedIds, ['a', 'b']);
});
