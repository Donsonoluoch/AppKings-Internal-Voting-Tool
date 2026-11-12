// Seeds the award categories, company departments, roster and initial admin.
// The roster import reads only first name, last name and phone from the workbook.
// Existing employee roles and departments are preserved on repeat runs.

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const path = require('node:path');
const readXlsxFile = require('read-excel-file/node');
const { PrismaClient, Role, Phase } = require('@prisma/client');
const { CATEGORIES } = require('@appkings/shared');
const { normalizePhone } = require('../src/lib/phone');

const prisma = new PrismaClient();
const ROSTER_FILE = process.env.EMPLOYEE_ROSTER_FILE
  || path.resolve(__dirname, '../../AppKings Team Data.xlsx');
const ADMIN_PHONE = normalizePhone(process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847');
const ADMIN_NAME = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Steve Martin';

const DEPARTMENTS = [
  'Administration',
  'Customer Success',
  'Engineering',
  'Finance',
  'Human Resources',
  'Information Technology',
  'Legal and Compliance',
  'Marketing and Communications',
  'Operations',
  'Other / Not Listed',
  'Product and Design',
  'Procurement and Logistics',
  'Sales',
  'Support',
];

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

async function loadRoster(file) {
  let sheets;
  try {
    sheets = await readXlsxFile(file);
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
  const roster = await loadRoster(ROSTER_FILE);

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

  const departments = {};
  for (const name of DEPARTMENTS) {
    departments[name] = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Departments: ${DEPARTMENTS.length} ready`);

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
      active: true,
      eligible: true,
    },
    create: {
      fullName: ADMIN_NAME,
      phone: ADMIN_PHONE,
      role: Role.ADMIN,
      departmentId: departments.Finance.id,
    },
  });
  console.log(`Administrator: ${ADMIN_NAME} (${ADMIN_PHONE})`);

  let created = 0;
  let updated = 0;
  let adminRosterMatches = 0;
  for (const person of roster) {
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
  console.log('Seed complete. Employee departments are selected at first sign-in.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
