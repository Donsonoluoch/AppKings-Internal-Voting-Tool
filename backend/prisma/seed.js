// Seeds the award categories, company teams, staff departments, roster and initial admin.
// The roster import reads only first name, last name and phone from the workbook.
// Existing employee roles and departments are preserved on repeat runs.
// Categories, departments and teams come from packages/shared/constants.js and the database
// is reconciled to that list on every run (unused extras are removed), so the seeded lists
// and the values both apps validate against cannot drift apart.

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const path = require('node:path');
const fs = require('node:fs');
const readXlsxFile = require('read-excel-file/node');
const { PrismaClient, Role, Phase } = require('@prisma/client');
const { CATEGORIES, DEPARTMENTS, TEAMS, TEAM_DEFINITIONS } = require('@appkings/shared');
const { normalizePhone } = require('../src/lib/phone');
const { pruneTaxonomy } = require('../src/lib/taxonomy');

const prisma = new PrismaClient();
const ROSTER_FILE = process.env.EMPLOYEE_ROSTER_FILE
  || path.resolve(__dirname, '../../AppKings Team Data.xlsx');
const ADMIN_PHONE = normalizePhone(process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847');
const ADMIN_NAME = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Steve Martin';



function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Minimal RFC-4180 CSV reader for the roster fixture: quoted fields, doubled quotes and
 * CRLF or LF line endings. Returns rows of strings, like the workbook reader does.
 */
function parseRosterCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((line) => line.some((cell) => cell.trim()));
}

async function loadRoster(file) {
  let sheets;
  try {
    // A .csv is accepted as well as a workbook: the e2e stack writes the committed roster
    // fixture as CSV when the workbook itself is not on the machine running the tests.
    sheets = file.toLowerCase().endsWith('.csv')
      ? [{ sheet: 'Sheet1', data: parseRosterCsv(fs.readFileSync(file, 'utf8')) }]
      : await readXlsxFile(file);
  } catch (error) {
    throw new Error(`Could not read employee roster "${file}": ${error.message}`);
  }

  const rows = sheets.find((sheet) => sheet.sheet === 'Sheet1')?.data ?? sheets[0]?.data;
  if (!rows?.length) throw new Error('The employee roster workbook has no rows.');

  const headers = rows[0].map((header) => cellText(header).toLowerCase().replace(/[^a-z]/g, ''));
  const column = (name) => headers.indexOf(name);
  const firstNameColumn = column('firstname');
  const lastNameColumn = column('lastname');
  const phoneColumn = column('phone');
  if ([firstNameColumn, lastNameColumn, phoneColumn].some((index) => index < 0)) {
    throw new Error('The roster needs FIRSTNAME, LASTNAME and PHONE columns.');
  }

  const employees = [];
  const phoneRows = new Map();
  for (const [index, row] of rows.slice(1).entries()) {
    const rowNumber = index + 2;
    const firstName = cellText(row[firstNameColumn]);
    const lastName = cellText(row[lastNameColumn]);
    const rawPhone = cellText(row[phoneColumn]);
    if (!firstName && !lastName && !rawPhone) continue;

    const fullName = `${firstName} ${lastName}`.trim();
    const phone = normalizePhone(rawPhone);
    if (!fullName || !phone) {
      throw new Error(`Roster row ${rowNumber} needs a first name, last name and valid Kenyan phone number.`);
    }

    const firstRow = phoneRows.get(phone);
    if (firstRow) {
      console.warn(`[seed] Duplicate phone on rows ${firstRow} and ${rowNumber}; keeping the earlier row.`);
      continue;
    }
    phoneRows.set(phone, rowNumber);
    employees.push({ fullName, phone, rowNumber });
  }

  if (employees.length === 0) throw new Error('The employee roster contains no valid employees.');
  return employees;
}

async function main() {
  if (!ADMIN_PHONE) throw new Error('BOOTSTRAP_ADMIN_PHONE must be a valid Kenyan phone number.');
  // The workbook is read only to create the initial roster. Re-running the seed on a live
  // election does not need it (employees already exist), so a missing file is reported and
  // skipped instead of aborting before the categories and department/team lists are synced.
  let roster = null;
  if (fs.existsSync(ROSTER_FILE)) {
    roster = await loadRoster(ROSTER_FILE);
  } else {
    console.warn(`[seed] No roster workbook at "${ROSTER_FILE}"; skipping the roster import.`);
  }

  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: { criteria: category.criteria, forTeams: category.forTeams, sortOrder: index + 1 },
      create: {
        name: category.name,
        criteria: category.criteria,
        forTeams: category.forTeams,
        sortOrder: index + 1,
      },
    });
  }
  console.log(`Categories: ${CATEGORIES.length} ready`);

  // Departments and teams are reconciled to packages/shared/constants.js in one place, so the
  // seed and the admin "Sync departments & teams" action can never disagree.
  const pruned = await pruneTaxonomy(prisma);
  console.log(`Departments: ${DEPARTMENTS.length} ready`);
  console.log(`Teams: ${TEAMS.length} ready`);
  if (pruned.departments.created || pruned.teams.created) {
    console.log(
      `Created ${pruned.departments.created} department(s) and ${pruned.teams.created} team(s).`
    );
  }
  if (pruned.departments.removed || pruned.teams.removed) {
    console.log(
      `Removed ${pruned.departments.removed} unused department(s) and ${pruned.teams.removed} unused team(s).`
    );
  }
  for (const name of pruned.teams.retired) {
    console.log(`Retired the old team row "${name}" (kept for history, no longer a team).`);
  }
  for (const name of pruned.departments.renamed) {
    console.log(
      `[seed] Department "${name.from}" is not configured; moved its ${name.employees} employee(s) to "${name.to}".`
    );
  }
  for (const name of pruned.departments.kept) {
    console.warn(
      `[seed] Department "${name.name}" is not configured and could not be folded in (${name.employees} employee(s)); kept.`
    );
  }
  for (const name of pruned.teams.kept) {
    console.warn(`[seed] Team "${name}" is not in TEAMS but is still in use; kept.`);
  }

  // TEAMS is the list of names; TEAM_DEFINITIONS carries the stable codes behind them.
  const teams = {};
  for (const definition of TEAM_DEFINITIONS) {
    teams[definition.name] = await prisma.team.findUnique({ where: { code: definition.code } });
  }

  const departments = {};
  for (const name of DEPARTMENTS) {
    departments[name] = await prisma.department.findUnique({ where: { name } });
  }

  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      phase: Phase.NOT_STARTED,
      phase1ResultsPublic: false,
      phase2ResultsPublic: false,
      resultsPublic: false,
    },
  });

  await prisma.employee.upsert({
    where: { phone: ADMIN_PHONE },
    update: {
      fullName: ADMIN_NAME,
      role: Role.ADMIN,
      departmentId: departments.Finance.id,
      teamId: teams.Academics.id,
      active: true,
      eligible: true,
    },
    create: {
      fullName: ADMIN_NAME,
      phone: ADMIN_PHONE,
      role: Role.ADMIN,
      departmentId: departments.Finance.id,
      teamId: teams.Academics.id,
    },
  });
  console.log(`Administrator: ${ADMIN_NAME} (${ADMIN_PHONE})`);

  let created = 0;
  let updated = 0;
  let adminRosterMatches = 0;
  for (const person of roster ?? []) {
    if (person.phone === ADMIN_PHONE) {
      adminRosterMatches += 1;
      continue;
    }
    const existing = await prisma.employee.findUnique({
      where: { phone: person.phone },
      select: { id: true },
    });
    await prisma.employee.upsert({
      where: { phone: person.phone },
      update: { fullName: person.fullName },
      create: {
        fullName: person.fullName,
        phone: person.phone,
        role: Role.EMPLOYEE,
        active: true,
        eligible: true,
      },
    });
    if (existing) updated += 1;
    else created += 1;
  }

  if (adminRosterMatches > 0) {
    console.log(`Administrator phone matched ${adminRosterMatches} roster row; using the configured admin profile.`);
  }
  console.log(`Roster: ${created} created, ${updated} updated; only names and phone numbers imported.`);
  console.log('Seed complete. Each employee chooses their department at first sign-in; an admin sets their team.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
