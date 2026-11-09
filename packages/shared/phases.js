const { PHASES } = require('./constants');

const PHASE_META = {
  NOT_STARTED: {
    label: 'Not started',
    tagline: 'The 2026 Awards cycle has not opened yet.',
    employee: 'Nothing to do yet. You will be notified when nominations open.',
  },
  PHASE_1: {
    label: 'Phase 1 — Nominations',
    tagline: 'One nomination per category, 1 point each. One self-nomination allowed, in total.',
    employee: 'Nominate one colleague per category. Every nomination needs a short justification.',
  },
  PHASE_2: {
    label: 'Phase 2 — Committee review',
    tagline: 'The committee makes one pick per category among the top 15.',
    employee: 'Nominations are in. The committee is reviewing — sit tight.',
  },
  PHASE_3: {
    label: 'Phase 3 — Final vote',
    tagline: 'One vote per category, 1 point each. Votes are confidential and final.',
    employee: 'Vote once per category. Your vote is confidential and cannot be changed.',
  },
  CLOSED: {
    label: 'Voting closed',
    tagline: 'Voting has closed. Results are being verified.',
    employee: 'Voting has closed. Results will be published shortly.',
  },
  PUBLISHED: {
    label: 'Results published',
    tagline: 'The 2026 winners are published.',
    employee: 'The 2026 winners are published. Open Results to see them.',
  },
};

/** Strictly-forward phase order; used to block backward moves. */
function phaseIndex(phase) {
  return PHASES.indexOf(phase);
}

function canMoveTo(current, next) {
  if (!PHASES.includes(next)) return { ok: false, reason: 'Unknown phase' };
  if (phaseIndex(next) <= phaseIndex(current)) {
    return { ok: false, reason: `Cannot move back from ${current} to ${next}` };
  }
  if (current === 'CLOSED') {
    return next === 'PUBLISHED'
      ? { ok: true }
      : { ok: false, reason: 'CLOSED can only move to PUBLISHED' };
  }
  return { ok: true };
}

module.exports = { PHASE_META, phaseIndex, canMoveTo };
