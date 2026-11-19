// One-time go-live seed for an EMPTY production database.
//
//   npm run db:golive -- --external-url "<postgres url>"   # seed a hosted DB (e.g. Neon) from the host
//   npm run db:golive -- --embedded-db                     # seed the api container's own database
//   npm run db:golive                                      # copy the workbook in, seed, verify
//   npm run db:golive -- --dry-run    # shows what would happen, changes nothing
//
// What it does:
//   1. Refuses to run if the database already has employees (a live election is never re-seeded
//      by accident). The admin console's "Reset voting progress" is the tool for that case.
//   2. Finds the roster. The workbook is never baked into an image, so it is either read
//      straight from this checkout (--external-url), copied into the api container
//      (--embedded-db / default), and always passed as EMPLOYEE_ROSTER_FILE.
//   3. Runs prisma/seed.js there, against whichever database the container is configured for —
//      the embedded PostgreSQL, or the external DATABASE_URL.
//   4. Prints the resulting roster and the categories/departments/teams, then checks the
//      production guards (no demo accounts, exactly one admin, every list matches the shared
//      constants).
//
// Safer than the README's copy/paste: the checks are automatic and the same every time.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readXlsxFile from 'read-excel-file/node';
// @appkings/shared is CommonJS, so its exports come in as one default object.
import shared from '@appkings/shared';

const { DEPARTMENTS, TEAMS } = shared;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const compose = ['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml'];
const dryRun = process.argv.includes('--dry-run');
const externalUrlIndex = process.argv.indexOf('--external-url');
const externalUrl = externalUrlIndex >= 0 ? process.argv[externalUrlIndex + 1] : null;
const embeddedDb = process.argv.includes('--embedded-db');
const SERVICE = 'api';
const WORKBOOK = process.env.EMPLOYEE_ROSTER_FILE
  || path.join(root, 'AppKings Team Data.xlsx');
const REMOTE = '/tmp/appkings-roster.xlsx';

function run(args, { capture = false } = {}) {
  return execFileSync('docker', [...compose, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

/** Shows a connection URL without its password: postgresql://user:***@host/db */
function shortDb(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return '(unparsable URL)';
  }
}

/** Runs a node one-liner inside the api container, with the container's own DATABASE_URL. */
function node(args) {
  return run(['exec', SERVICE, 'node', ...args], { capture: true });
}

function check(label, ok, detail = '') {
  console.log(`${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

if (!existsSync(WORKBOOK)) {
  console.error(`\nRoster workbook not found: ${WORKBOOK}`);
  console.error('Set EMPLOYEE_ROSTER_FILE to its path, or put "AppKings Team Data.xlsx" in the repo root.\n');
  process.exit(1);
}

// The workbook is the only source of truth for who can sign in; read it here so the counts
// printed at the end are independent of the seed's own report.
const sheets = await readXlsxFile(WORKBOOK);
const rows = sheets.find((sheet) => sheet.sheet === 'Sheet1')?.data ?? sheets[0]?.data ?? [];
const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase().replace(/[^a-z]/g, ''));
const phoneColumn = headers.indexOf('phone');
const workbookPhones = rows.slice(1)
  .map((row) => String(row[phoneColumn] ?? '').trim())
  .filter(Boolean);
const uniquePhones = new Set(
  workbookPhones.map((phone) => {
    const digits = phone.replace(/[^\d+]/g, '');
    const plain = digits.replace(/^\+/, '');
    if (/^254[17]\d{8}$/.test(plain)) return `+${plain}`;
    if (/^0[17]\d{8}$/.test(plain)) return `+254${plain.slice(1)}`;
    if (/^[17]\d{8}$/.test(plain)) return `+254${plain}`;
    return plain;
  })
);

console.log(`\nRoster workbook : ${WORKBOOK}`);
console.log(`Data rows       : ${workbookPhones.length} (${uniquePhones.size} distinct phone values)`);
console.log(`Target          : ${externalUrl ? shortDb(externalUrl) : 'compose service api'}\n`);

// 1. Guard: never seed over a live election.
let existing;
const tally = 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();(async()=>{const employees=await p.employee.count();const s=await p.settings.findUnique({where:{id:1}});console.log(JSON.stringify({employees,phase:s?s.phase:"none"}));await p.$disconnect();})()';
try {
  existing = JSON.parse(externalUrl
    ? execFileSync(process.execPath, ['-e', tally], { cwd: root, env: { ...process.env, DATABASE_URL: externalUrl }, encoding: 'utf8' })
    : node(['-e', tally])
  );
} catch (error) {
  const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  if (externalUrl) {
    console.error('\nCould not reach --external-url:');
    console.error(String(error.stderr || error.message).split('\n').slice(0, 6).join('\n'));
    console.error('\nCheck the URL (Neon pooler URLs need ?sslmode=require) and that the migrations ran.\n');
    process.exit(1);
  }
  if (/DATABASE_URL/.test(detail) && /empty string/.test(detail)) {
    console.error('\nThe api container has no database configured.');
    console.error('Set DATABASE_URL in .env (external database), or set POSTGRES_PASSWORD and leave DATABASE_URL empty (embedded).');
    console.error('See docs/deploy.md § 0b.\n');
    process.exit(1);
  }
  throw error;
}
if (existing.employees > 0) {
  console.error(`The target database already has ${existing.employees} employees (phase: ${existing.phase}).`);
  console.error('Refusing to seed: this is a live cycle, not an empty database.');
  console.error('To restart an existing cycle use /admin → "Reset voting progress"; it clears votes but keeps accounts.\n');
  process.exit(1);
}
console.log('Target database is empty (0 employees) — safe to seed.\n');

if (dryRun) {
  console.log('Dry run: nothing was changed. Re-run without --dry-run to seed.\n');
  process.exit(0);
}

// 2 + 3. The workbook is not baked into an image, so choose where the seed reads it from:
//   --external-url <url>  seed from the host, straight at that DATABASE_URL (e.g. Neon)
//   --embedded-db         forward the container's own embedded-Postgres URL to the seed
//   (neither)             copy the workbook into the container and seed with its env
// 2 + 3. Seed with the workbook. prisma/seed.js reads it from EMPLOYEE_ROSTER_FILE, so
// every target below passes that path explicitly rather than relying on a baked-in copy.
if (externalUrl) {
  console.log('Seeding straight at --external-url from the host (no container needed).');
  execFileSync(process.execPath, [path.join(root, 'backend', 'prisma', 'seed.js')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: externalUrl,
      EMPLOYEE_ROSTER_FILE: WORKBOOK,
      BOOTSTRAP_ADMIN_PHONE: process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847',
    },
  });
} else if (embeddedDb) {
  // The container's DATABASE_URL is empty by design: its entrypoint derives the
  // 127.0.0.1 one before starting Node, so reconstruct that same value here.
  run(['cp', WORKBOOK, `${SERVICE}:${REMOTE}`]);
  const derived = 'DATABASE_URL=$(node -e ""process.stdout.write(`postgresql://${encodeURIComponent(process.env.POSTGRES_USER)}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@127.0.0.1:5432/${encodeURIComponent(process.env.POSTGRES_DB)}?schema=public`)"" )';
  run(['exec', SERVICE, 'sh', '-c', `${derived} EMPLOYEE_ROSTER_FILE=${REMOTE} node prisma/seed.js`]);
} else {
  run(['cp', WORKBOOK, `${SERVICE}:${REMOTE}`]);
  run(['exec', '-e', `EMPLOYEE_ROSTER_FILE=${REMOTE}`, SERVICE, 'node', 'prisma/seed.js']);
}

// 4. Verify the result from inside the container.
const probe = `
  const {PrismaClient}=require("@prisma/client");
  const p=new PrismaClient();
  (async () => {
    const [employees, admins, categories, departments, teams, settings] = await Promise.all([
      p.employee.count(),
      p.employee.findMany({ where: { role: "ADMIN" }, select: { fullName: true, phone: true, department: { select: { name: true } } } }),
      p.category.count(),
      p.department.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
      p.team.findMany({ select: { name: true, code: true }, orderBy: { name: "asc" } }),
      p.settings.findUnique({ where: { id: 1 } }),
    ]);
    const withoutDepartment = await p.employee.count({ where: { departmentId: null } });
    console.log(JSON.stringify({
      employees,
      admins,
      withoutDepartment,
      categories,
      departments: departments.map((d) => d.name),
      teams: teams.map((t) => ({ name: t.name, code: t.code })),
      phase: settings ? settings.phase : null,
    }));
    await p.$disconnect();
  })().catch((e) => { console.error(e.message); process.exit(1); });
`;
// The verification reads the SAME database that was seeded.
const summary = JSON.parse(externalUrl
  ? execFileSync(process.execPath, ['-e', probe], { cwd: root, env: { ...process.env, DATABASE_URL: externalUrl }, encoding: 'utf8' }).trim()
  : node(['-e', probe]).trim());

console.log('\nGo-live checks');
check('the roster was imported', summary.employees === uniquePhones.size,
  `${summary.employees} accounts (workbook has ${uniquePhones.size} distinct numbers)`);
check('exactly one admin exists', summary.admins.length === 1,
  summary.admins.map((a) => `${a.fullName} (${a.phone}, ${a.department?.name ?? 'no department'})`).join(', '));
check('the admin is in Finance', summary.admins[0]?.department?.name === 'Finance');
check('the 8 award categories exist', summary.categories === 8, `${summary.categories}`);
check('departments match the shared constants exactly',
  summary.departments.join('|') === [...DEPARTMENTS].sort().join('|'),
  summary.departments.join(', '));
check('teams match the shared constants exactly',
  summary.teams.length === TEAMS.length && summary.teams.every((team) => TEAMS.includes(team.name)),
  summary.teams.map((team) => team.name).join(', '));
check('the cycle starts at NOT_STARTED', summary.phase === 'NOT_STARTED', summary.phase ?? 'missing settings row');
check('every other account still needs to choose a department',
  summary.withoutDepartment === summary.employees - 1,
  `${summary.withoutDepartment} of ${summary.employees}`);

console.log(`
Next:
  1. Sign in as the admin, set committee members on /admin/employees.
  2. Take a backup (docs/deploy.md § 5).
  3. Open Phase 1 from /admin.
${process.exitCode ? '\nOne or more checks failed — do not open Phase 1 yet.\n' : '\nAll go-live checks passed.\n'}`);