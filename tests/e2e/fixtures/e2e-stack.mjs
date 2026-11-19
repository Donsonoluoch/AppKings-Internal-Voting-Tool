// The disposable stack the end-to-end suite runs against.
//
//   npm run test:e2e                 start an isolated stack, run the suite, tear it down
//   npm run test:e2e -- --keep       leave the stack running afterwards (prints its URLs)
//   npm run test:e2e:attach          run the suite against a stack you started yourself
//
// The suite changes election data from the first test to the last, so it must never run
// against the production volume. This runner therefore never touches `appkings-voting`:
//
//   * a throwaway PostgreSQL container on a random free host port, with no named volume
//     (the data disappears with the container), and a database whose name contains "test";
//   * the real seed (`prisma/seed.js`) run against it — the actual roster workbook when it
//     is on this machine, otherwise the same 58-person roster held in
//     tests/e2e/fixtures/roster.fixture.json (captured from the workbook). Either way the
//     suite tests the same accounts production has;
//   * the API started from `backend/` in development mode, so the session cookie works
//     over plain http, on a random free port, with sign-in rate limiting off.
//
// The stack needs Docker (for the throwaway database) and nothing else: the database is
// reached with the API's own `pg` client.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');
export const BACKEND = path.join(ROOT, 'backend');
const WORKBOOK_NAMES = ['AppKings Team Data.xlsx', 'AppKings Team Data.xlsm'];

/**
 * The path of the roster workbook, wherever this machine keeps it.
 *
 * `.env` or EMPLOYEE_ROSTER_FILE first, then the project root (the name may be suffixed
 * with a date or marked COPY), then one level up. The workbook is 58 rows and not tracked
 * in git, so a missing file is expected on a fresh checkout — `rosterFixture()` covers it.
 * @returns {string|null}
 */
function findWorkbook() {
  const explicit = process.env.EMPLOYEE_ROSTER_FILE;
  if (explicit) return existsSync(explicit) ? path.resolve(explicit) : null;

  const dotenv = path.join(ROOT, '.env');
  const configured = existsSync(dotenv)
    ? readFileSync(dotenv, 'utf8').match(/^\s*EMPLOYEE_ROSTER_FILE\s*=\s*(.+?)\s*$/m)?.[1]
    : null;
  if (configured && existsSync(path.resolve(ROOT, configured.replace(/^["']|["']$/g, '')))) {
    return path.resolve(ROOT, configured.replace(/^["']|["']$/g, ''));
  }

  for (const folder of [ROOT, path.dirname(ROOT)]) {
    const match = WORKBOOK_NAMES.map((name) => path.join(folder, name)).find((candidate) => existsSync(candidate));
    if (match) return match;
    try {
      const found = readdirSync(folder)
        .filter((name) => /\.xlsx?$/i.test(name) && /appkings|team data/i.test(name))
        .map((name) => path.join(folder, name))
        .sort()[0];
      if (found) return found;
    } catch {
      // A folder that cannot be read simply has no workbook.
    }
  }
  return null;
}

const COMPOSE_PROJECT = 'appkings-voting';
const DB_CONTAINER = 'appkings-e2e-postgres';
const DB_IMAGE = process.env.E2E_PG_IMAGE || 'postgres:16-alpine';
const DB_USER = 'appkings';
const DB_PASSWORD = 'e2e-only-local-password';
const DB_NAME = 'appkings_voting_test';
// Every seeded person's name and phone, captured once from the running database so the
// suite can rebuild the roster without the workbook.
const FIXTURE = path.join(here, 'roster.fixture.json');
// Sign-in is rate limited per IP in a real deployment; 58 sign-ins from one machine would
// trip it. `NODE_ENV=test` is the switch the API already documents for this (auth.js).
const API_ENV = {
  NODE_ENV: 'test',
  COOKIE_SECURE: 'false',
  TRUST_PROXY: '0',
  JWT_SECRET: 'e2e-only-secret-at-least-32-characters-long',
  SESSION_HOURS: '2',
  // The suite signs in every account once; keep the failed-login guards out of its way.
  LOGIN_RATE_LIMIT: '1000',
  LOGIN_WINDOW_MINUTES: '1',
};

// ─── small helpers ────────────────────────────────────────────────────────────

/**
 * Polls `check` until it returns something truthy. Used for "is the database up yet".
 */
async function waitFor(label, check, { timeoutMs = 180_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function log(message) {
  console.log(`[e2e-stack] ${message}`);
}

/** A port nothing is listening on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', ...options });
}

function dockerQuiet(args) {
  try {
    return { ok: true, out: docker(args, { stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a node script in the backend workspace with a given environment. */
function nodeInBackend(args, env, options = {}) {
  return execFileSync(process.execPath, args, {
    cwd: BACKEND,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    ...options,
  });
}

function composeDatabaseUrl(port, dbName = DB_NAME) {
  return `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${port}/${dbName}?schema=public`;
}

// ─── 0. guards ────────────────────────────────────────────────────────────────

/** Refuses to run against anything that could be the live deployment. */
async function guard() {
  const err = 'E2E_ATTACH_DATABASE_URL';

  const dockerInfo = dockerQuiet(['info', '--format', '{{.ServerVersion}}']);
  if (!dockerInfo.ok) {
    throw new Error(
      'Docker is not running. The isolated stack needs it: start Docker Desktop, then re-run `npm run test:e2e`.',
    );
  }

  const state = dockerQuiet([
    'ps',
    '--all',
    '--filter',
    `label=com.docker.compose.project=${COMPOSE_PROJECT}`,
    '--format',
    '{{.Names}}',
  ]);
  if (state.ok && state.out.trim()) {
    throw new Error(
      `The production compose project "${COMPOSE_PROJECT}" has containers (${state.out.trim().split('\n').join(', ')}).\n` +
        'This suite would write elections into the live database, so it refuses to start.\n' +
        'Stop the production stack first: `docker compose --env-file .env -f infra/docker-compose.yml stop`.\n' +
        `(To run against a stack you started yourself, use \`npm run test:e2e:attach\` with ${err} set.)`,
    );
  }

  if (!existsSync(FIXTURE)) {
    throw new Error(`The roster fixture is missing: ${FIXTURE}. It is committed; restore it from git.`);
  }
}

// ─── 1. the database ──────────────────────────────────────────────────────────

async function startDatabase() {
  dockerQuiet(['rm', '--force', DB_CONTAINER]);
  const port = await freePort();
  log(`starting ${DB_IMAGE} as ${DB_CONTAINER} on 127.0.0.1:${port}`);
  docker([
    'run',
    '--detach',
    '--name',
    DB_CONTAINER,
    '--label',
    'appkings.e2e=1',
    '-e',
    `POSTGRES_USER=${DB_USER}`,
    '-e',
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-e',
    `POSTGRES_DB=${DB_NAME}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    DB_IMAGE,
  ]);

  // The container's own `pg_isready` is the readiness probe, so this needs no client.
  await waitFor('PostgreSQL to accept connections', async () => {
    const ready = dockerQuiet(['exec', DB_CONTAINER, 'pg_isready', '-U', DB_USER, '-d', DB_NAME]);
    return ready.ok;
  });
  return { port, url: composeDatabaseUrl(port) };
}

function stopDatabase() {
  dockerQuiet(['rm', '--force', DB_CONTAINER]);
}

// ─── 2. migrations and the real seed ──────────────────────────────────────────

// The prisma CLI is only needed for `migrate deploy`; the seed itself is plain Node.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function migrate(url) {
  log('applying migrations (prisma migrate deploy)');
  execFileSync(npx, ['prisma', 'migrate', 'deploy'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: true,
  });
}

function seed(url, rosterFile) {
  log(`seeding the real roster from ${rosterFile}`);
  nodeInBackend([path.join('prisma', 'seed.js')], {
    DATABASE_URL: url,
    EMPLOYEE_ROSTER_FILE: rosterFile ?? '',
    BOOTSTRAP_ADMIN_PHONE: process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847',
    BOOTSTRAP_ADMIN_NAME: process.env.BOOTSTRAP_ADMIN_NAME || 'Steve Martin',
  });
}

async function inspect(url) {
  // Top-level await in a `node -e` script, so this is an .mjs probe run from the backend.
  const probe = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    const [employees, categories, settings, roster] = await Promise.all([
      prisma.employee.count(),
      prisma.category.count(),
      prisma.settings.findUnique({ where: { id: 1 } }),
      prisma.employee.findMany({ orderBy: { phone: 'asc' }, select: { fullName: true, phone: true } }),
    ]);
    console.log(JSON.stringify({ employees, categories, phase: settings?.phase ?? null, roster }));
    await prisma.$disconnect();
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split(/\r?\n/).at(-1));
}

/**
 * Saves the roster the workbook just produced, so a checkout without the workbook (it is
 * not tracked in git) still seeds the same 58 people. Only rewrites the file when the
 * roster actually changed, so a ormal test run does not touch the repository.
 */
function rememberRoster(summary) {
  const roster = (summary.roster ?? []).filter((person) => person.fullName && person.phone);
  const current = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
  if (current && JSON.stringify(current.roster) === JSON.stringify(roster)) return;
  writeFileSync(
    FIXTURE,
    `${JSON.stringify(
      {
        note: 'The 58 seeded accounts, captured from the real roster workbook. Used by the e2e stack when the workbook is not on this machine. Do not edit by hand.',
        source: 'backend/prisma/seed.js',
        roster,
      },
      null,
      2,
    )}\n`,
  );
  log(`saved the ${roster.length}-account roster to tests/e2e/fixtures/roster.fixture.json`);
}

/**
 * The roster as a CSV the seed can read, when there is no workbook on this machine.
 * `prisma/seed.js` reads FIRSTNAME, LASTNAME and PHONE from the workbook or, for a .csv, a
 * one-sheet roster; so the fixture is written to a temporary file and passed as
 * EMPLOYEE_ROSTER_FILE.
 */
function rosterFixture() {
  const { roster } = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  if (!Array.isArray(roster) || roster.length < 50) {
    throw new Error(`tests/e2e/fixtures/roster.fixture.json must hold the seeded roster (has ${roster?.length ?? 0}).`);
  }
  const escape = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = ['FIRSTNAME,LASTNAME,PHONE'];
  for (const person of roster) {
    const [firstName, ...rest] = person.fullName.trim().split(/\s+/);
    lines.push([firstName, rest.join(' '), person.phone].map(escape).join(','));
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'appkings-e2e-roster-')), 'roster.csv');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

// ─── 3. the API ───────────────────────────────────────────────────────────────

async function startApi(url) {
  const port = await freePort();
  log(`starting the API on http://127.0.0.1:${port} (NODE_ENV=test)`);
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      ...API_ENV,
      PORT: String(port),
      API_HOST: '127.0.0.1',
      DATABASE_URL: url,
      FRONTEND_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logFile = path.join(mkdtempSync(path.join(tmpdir(), 'appkings-e2e-api-')), 'api.log');
  const chunks = [];
  const keep = (chunk) => {
    chunks.push(String(chunk));
    if (process.env.E2E_API_LOG === '1') process.stdout.write(String(chunk));
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => {
    if (code !== null && code !== 0) log(`API exited with code ${code}`);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitFor('the API health check', async () => {
      if (child.exitCode !== null) throw new Error('the API process exited');
      const response = await fetch(`${baseUrl}/api/health/ready`);
      if (!response.ok) return false;
      const body = await response.json();
      return body.db === 'up';
    });
  } catch (error) {
    writeFileSync(logFile, chunks.join(''));
    throw new Error(`${error.message}\nAPI log: ${logFile}\n${chunks.join('').slice(-4000)}`);
  }

  return { child, url: baseUrl, logFile };
}

async function stopApi(api) {
  if (!api?.child || api.child.exitCode !== null) return;
  api.child.kill();
  await Promise.race([
    new Promise((resolve) => api.child.once('exit', resolve)),
    sleep(5_000),
  ]);
}

// ─── 4. the whole thing ───────────────────────────────────────────────────────

/**
 * Brings up the disposable stack and returns the environment the Playwright suite needs.
 * @returns {Promise<{ env: object, databaseUrl: string, apiUrl: string, close: () => Promise<void> }>}
 */
export async function startE2eStack() {
  await guard();

  let started = null;
  try {
    const db = await startDatabase();
    started = { db, api: null };
    migrate(db.url);
    const workbook = findWorkbook();
    seed(db.url, workbook ?? rosterFixture());

    const summary = await inspect(db.url);
    if (summary.employees !== 58) {
      throw new Error(
        `The seeded database has ${summary.employees} employees, not 58. ` +
          (workbook
            ? `The suite runs on the real roster; check the workbook (${workbook}).`
            : 'The suite runs on the real roster; check the fixture and the seed log above.'),
      );
    }
    if (summary.phase !== 'NOT_STARTED') {
      throw new Error(`A fresh seed should be NOT_STARTED, got ${summary.phase}.`);
    }

    if (workbook) rememberRoster(summary);

    const api = await startApi(db.url);
    started.api = api;
    log(`ready: API ${api.url}, database ${DB_NAME} on 127.0.0.1:${db.port} (${summary.employees} accounts)`);

    return {
      env: {
        APPKINGS_URL: api.url,
        APPKINGS_API_URL: api.url,
        TEST_DATABASE_URL: db.url,
        E2E_STACK: 'isolated',
      },
      apiUrl: api.url,
      databaseUrl: db.url,
      close: async () => {
        await stopApi(api);
        stopDatabase();
      },
    };
  } catch (error) {
    await stopApi(started?.api);
    stopDatabase();
    throw error;
  }
}


