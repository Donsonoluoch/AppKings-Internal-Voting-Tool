// Environment, parsed once. All open decisions from the brief surface here.
const path = require('node:path');
const fs = require('node:fs');
const { DEFAULT_RULES } = require('@appkings/shared');

function loadEnv() {
  // The repo keeps a single .env at the root (and in backend/ for local runs).
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(__dirname, '../.env'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) require('dotenv').config({ path: file });
  }
}

loadEnv();

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const env = process.env;

const config = {
  env: env.NODE_ENV || 'development',
  isProduction: (env.NODE_ENV || 'development') === 'production',
  port: num('PORT', 4000),
  databaseUrl: env.DATABASE_URL,
  frontendUrl: env.FRONTEND_URL || 'http://localhost:3000',
  frontendUrls: (env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-before-deploying',
  sessionHours: num('SESSION_HOURS', 12),
  cookieName: 'appkings_session',
  cookieSecure: bool('COOKIE_SECURE', (env.NODE_ENV || 'development') === 'production'),
  trustProxy: num('TRUST_PROXY', 0),
  loginMaxPerWindow: num('LOGIN_RATE_LIMIT', 10),
  loginWindowMinutes: num('LOGIN_WINDOW_MINUTES', 15),
  // §1 / §14 — points only. Each of these is one assumption that is cheap to change.
  rules: {
    selfNominationLimit: num('SELF_NOMINATION_LIMIT', DEFAULT_RULES.SELF_NOMINATION_LIMIT),
    // The schema env name is the documented one; the older name is still accepted.
    minJustification: num(
      'NOMINATION_MIN_JUSTIFICATION',
      num('MIN_JUSTIFICATION', DEFAULT_RULES.NOMINATION_MIN_JUSTIFICATION)
    ),
    topPerCategory: num('TOP_PER_CATEGORY', DEFAULT_RULES.TOP_PER_CATEGORY),
    phase1Finalists: num('PHASE1_FINALISTS', DEFAULT_RULES.PHASE1_FINALISTS),
    phase2FinalistsMin: num('PHASE2_FINALISTS_MIN', DEFAULT_RULES.PHASE2_FINALISTS_MIN),
    phase2FinalistsMax: num('PHASE2_FINALISTS_MAX', DEFAULT_RULES.PHASE2_FINALISTS_MAX),
    minCandidatesPerCategory: num(
      'MIN_CANDIDATES_PER_CATEGORY',
      DEFAULT_RULES.MIN_CANDIDATES_PER_CATEGORY
    ),
    teamFinalists: num('TEAM_FINALISTS', DEFAULT_RULES.TEAM_FINALISTS),
    committeePicksPerCategory: num(
      'COMMITTEE_PICKS_PER_CATEGORY',
      DEFAULT_RULES.COMMITTEE_PICKS_PER_CATEGORY
    ),
  },
};

module.exports = config;
