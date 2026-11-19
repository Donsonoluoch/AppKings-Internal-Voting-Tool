// Writes tests/e2e/fixtures/roster.fixture.json from a database that already has the roster.
//
//   node scripts/e2e-roster-fixture.mjs
//
// The e2e suite seeds a throwaway database with the real roster workbook, which is not
// tracked in git. This captures the seeded accounts (name + phone) once, so the suite still
// runs on a checkout where the workbook is missing.
//
// It reads from DATABASE_URL when that is set, otherwise it starts the project's Docker
// database volume (appkings-voting_db_data) in a throwaway container, reads it, and removes
// the container again. Only SELECTs are run: the volume is never written.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const fixture = path.join(root, 'tests', 'e2e', 'fixtures', 'roster.fixture.json');
const VOLUME = 'appkings-voting_db_data';
const SIDECAR = 'appkings-roster-fixture';
// The role this project's compose file creates (POSTGRES_USER). The owner of the database
// is read from the volume itself and used instead when it differs.
const ROLE = 'appkings';
const sleep = (ms) => execFileSync(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);

function docker(args) {
  try {
    return { ok: true, out: execFileSync('docker', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

/** The roster the API connects to, read through the backend's own Prisma client. */
function readRoster(databaseUrl) {
  const script = `
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    const roster = await prisma.employee.findMany({ orderBy: { phone: 'asc' }, select: { fullName: true, phone: true } });
    console.log(JSON.stringify(roster));
    await prisma.$disconnect();
  `;
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    return JSON.parse(out.trim().split(/\r?\n/).at(-1));
  } catch {
    return null;
  }
}

/** Starts the project's database volume in a throwaway container. Returns when it is up. */
function startSidecar() {
  if (!docker(['volume', 'inspect', VOLUME]).ok) return false;
  docker(['rm', '--force', SIDECAR]);
  const started = docker([
    'run', '--detach', '--name', SIDECAR, '--label', 'appkings.fixture=1',
    '-v', `${VOLUME}:/var/lib/postgresql/data`,
    'postgres:16-alpine',
  ]);
  if (!started.ok) return false;

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (docker(['exec', SIDECAR, 'pg_isready', '-U', ROLE]).ok) return true;
    sleep(1500);
  }
  return false;
}

function stopSidecar() {
  if (docker(['inspect', '--format', '{{.State.Running}}', SIDECAR]).out.trim() === 'true') {
    docker(['rm', '--force', SIDECAR]);
    console.log(`Stopped the ${SIDECAR} container; the ${VOLUME} volume is untouched.`);
  }
}

/**
 * Reads the roster with the container's own `psql` over the local socket, which trusts the
 * database owner — so the volume's application password is never needed (and never
 * printed). The volume belongs to a deployment we did not create, so its credentials are
 * not ours to assume: the role is discovered from the database list (the owner of
 * `appkings_voting`).
 */
function readRosterFromSidecar() {
  const list = docker(['exec', SIDECAR, 'psql', '-U', ROLE, '-d', 'postgres', '-tAc', "select datname || '|' || pg_get_userbyid(datdba) from pg_database where datname = 'appkings_voting'"]);
  const owner = list.ok ? list.out.trim().split('|')[1] : null;
  const role = owner || ROLE;
  const sql = 'select json_agg(row_to_json(r) order by r.phone) from (select "fullName", phone from "Employee") r';
  const result = docker(['exec', SIDECAR, 'psql', '-U', role, '-d', 'appkings_voting', '-tAc', sql]);
  if (!result.ok) return null;
  try {
    const rows = JSON.parse(result.out.trim());
    return Array.isArray(rows) ? rows.map((row) => ({ fullName: row.fullName, phone: row.phone })) : null;
  } catch {
    return null;
  }
}

let roster = process.env.DATABASE_URL ? readRoster(process.env.DATABASE_URL) : null;
if (!roster?.length) {
  console.log(`Reading the roster from the ${VOLUME} volume (throwaway container ${SIDECAR}).`);
  try {
    startSidecar();
    roster = readRosterFromSidecar();
  } finally {
    stopSidecar();
  }
}

if (!roster || roster.length < 50) {
  console.error(`Expected the seeded roster (57 or more accounts), found ${roster?.length ?? 0}. Seed the database first, then re-run.`);
  process.exit(1);
}

writeFileSync(
  fixture,
  `${JSON.stringify(
    {
      note: 'The seeded accounts (name + phone; 57 roster rows plus the bootstrap admin), captured from the real roster. Used by the e2e stack when the roster workbook is not on the machine running the tests. Do not edit by hand.',
      source: 'backend/prisma/seed.js',
      roster,
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${roster.length} accounts to ${path.relative(root, fixture)}.`);
