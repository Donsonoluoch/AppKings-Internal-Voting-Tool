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
