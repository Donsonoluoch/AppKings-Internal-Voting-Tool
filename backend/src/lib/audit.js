const prisma = require('./prisma');

/**
 * §11 — every write action is recorded. Never throws: an audit failure must not
 * roll back the user's action, but it is logged loudly.
 *
 * Confidentiality: never put a candidate id in a VOTE_CAST entry (§9).
 */
async function audit({ actorId = null, action, details = null, ip = null }, client = prisma) {
  try {
    await client.auditLog.create({
      data: { actorId, action, details: details ?? undefined, ip },
    });
  } catch (error) {
    console.error('[audit] failed to write entry', action, error);
  }
}

const ACTIONS = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  DEVICE_RESET: 'DEVICE_RESET',
  PHASE_CHANGE: 'PHASE_CHANGE',
  NOMINATE: 'NOMINATE',
  COMMITTEE_PICK: 'COMMITTEE_PICK',
  CONFLICT_DECLARED: 'CONFLICT_DECLARED',
  CUT_CONFIRMED: 'CUT_CONFIRMED',
  CANDIDATE_REMOVED: 'CANDIDATE_REMOVED',
  VOTE_CAST: 'VOTE_CAST',
  RESULTS_PUBLISHED: 'RESULTS_PUBLISHED',
  EMPLOYEE_IMPORTED: 'EMPLOYEE_IMPORTED',
  EMPLOYEE_UPDATED: 'EMPLOYEE_UPDATED',
  DEPARTMENT_CREATED: 'DEPARTMENT_CREATED',
};

module.exports = { audit, ACTIONS };
