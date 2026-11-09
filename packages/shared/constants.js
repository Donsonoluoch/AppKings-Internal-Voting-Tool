// Single source of truth for values that both apps must agree on.
// Everything that the brief left open is here (or read from env), never hard-coded
// deep inside a route.

const PHASES = /** @type {const} */ ([
  'NOT_STARTED',
  'PHASE_1',
  'PHASE_2',
  'PHASE_3',
  'CLOSED',
  'PUBLISHED',
]);

const ROLES = /** @type {const} */ (['EMPLOYEE', 'COMMITTEE', 'ADMIN']);

// §4 — seeded in prisma/seed.js. `forTeams` is true only for Team of the Year.
const CATEGORIES = [
  {
    name: 'Most Consistent Staff',
    criteria:
      'Reliable attendance, steady output and the same standard of work week after week. Evidence: repeated delivery, low rework, dependable presence.',
    forTeams: false,
  },
  {
    name: 'Customer Satisfaction Champion',
    criteria:
      'Consistently high customer feedback, calm handling of complaints and a visible impact on customer retention.',
    forTeams: false,
  },
  {
    name: 'Dedicated and Most Committed Employee',
    criteria:
      'Goes beyond the job description, stays with hard problems to the end and invests in the team beyond their own tasks.',
    forTeams: false,
  },
  {
    name: 'Extra Milestone Achiever',
    criteria:
      'A specific, measurable milestone delivered this year that moved the business forward. Evidence: dates, outcomes, numbers.',
    forTeams: false,
  },
  {
    name: 'Innovator of the Year',
    criteria:
      'Introduced a new idea, process or tool that was adopted and produced a real improvement.',
    forTeams: false,
  },
  {
    name: 'Outstanding Leadership',
    criteria:
      'Develops people, sets direction, is trusted by their team and handles pressure without losing the team.',
    forTeams: false,
  },
  {
    name: 'Employee of the Year 2026',
    criteria:
      'The single strongest overall contribution of 2026. Consider performance, impact, conduct and how others describe this person.',
    forTeams: false,
  },
  {
    name: 'Team of the Year',
    criteria:
      'A team (or department) that achieved something together: delivery, collaboration and support for the wider business. Nominees are teams, not individuals.',
    forTeams: true,
  },
];

// §1 / §14 — every open decision lives here (or in env), never deep inside a route.
// Scoring is points only: one pick per category, 1 point each, no percentages.
const DEFAULT_RULES = {
  SELF_NOMINATION_LIMIT: 1, // once in total, Phase 1 only
  NOMINATION_MIN_JUSTIFICATION: 20,
  TOP_PER_CATEGORY: 5, // Phase 1: top 5 per category become finalists
  PHASE1_FINALISTS: 15, // Phase 1: pooled top 15 people overall
  PHASE2_FINALISTS_MIN: 6, // Phase 2: pooled top 6–10 people overall
  PHASE2_FINALISTS_MAX: 10,
  MIN_CANDIDATES_PER_CATEGORY: 2, // safety check after every cut
  TEAM_FINALISTS: 3, // Team of the Year: top 3 teams after Phase 2
  COMMITTEE_PICKS_PER_CATEGORY: 1, // raise to 2–3 if the committee keeps tying
};

const ERRORS = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  DEVICE_MISMATCH: 'DEVICE_MISMATCH',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  PHASE_CLOSED: 'PHASE_CLOSED',
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
  TIE_UNRESOLVED: 'TIE_UNRESOLVED',
  CUT_NOT_CONFIRMED: 'CUT_NOT_CONFIRMED',
};

module.exports = {
  PHASES,
  ROLES,
  CATEGORIES,
  DEFAULT_RULES,
  ERRORS,
};
