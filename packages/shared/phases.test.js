const test = require('node:test');
const assert = require('node:assert/strict');
const { canMoveTo } = require('./phases');

test('phases only move forward', () => {
  assert.equal(canMoveTo('NOT_STARTED', 'PHASE_1').ok, true);
  assert.equal(canMoveTo('PHASE_1', 'NOT_STARTED').ok, false);
  assert.equal(canMoveTo('PHASE_3', 'PHASE_3').ok, false);
  assert.equal(canMoveTo('CLOSED', 'PHASE_3').ok, false);
  assert.equal(canMoveTo('CLOSED', 'PUBLISHED').ok, true);
});
