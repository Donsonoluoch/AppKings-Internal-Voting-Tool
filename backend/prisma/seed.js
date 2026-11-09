// Seeds the 8 award categories (§4), departments, the Settings row and demo people.
// Idempotent: safe to run repeatedly. Run with `npm run db:seed`.
//
// Safe to run on a live database: it never touches nominations, votes or candidates,
// never changes the phase and never removes an employee. Re-running only refreshes the
// category criteria and the demo accounts. (Phase 3 of the docs/roadmap.md plan uses it
// to make sure the categories and the first admin exist before the real CSV import.)
//
// SEED_DEMO=false seeds categories, departments and the admin only — use that when the
// database holds real employees.
//
// Demo accounts are phone numbers only — log in with one of them to try the portal:
//   +254700000001  Admin (Grace Wanjiru)          role ADMIN
//   +254700000002  Committee (Peter Otieno)       role COMMITTEE
//   +254700000003 ... +254700000010               role EMPLOYEE
// Every demo employee is in department "Engineering" unless listed otherwise.

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const { PrismaClient, Role, Phase } = require('@prisma/client');
const { CATEGORIES } = require('@appkings/shared');
const { normalizePhone } = require('../src/lib/phone');

const prisma = new PrismaClient();

const DEPARTMENTS = [
  'Engineering',
  'Customer Success',
  'Operations',
  'Sales and Marketing',
  'Finance and Admin',
];

// 25 demo people: enough to exercise the top-5-per-category and top-15-overall cut.
// The real 60 employees are imported by the admin from CSV (§3).
const DEMO_PEOPLE = [
  { fullName: 'Grace Wanjiru', phone: '+254700000001', role: Role.ADMIN, department: 'Operations' },
  { fullName: 'Peter Otieno', phone: '+254700000002', role: Role.COMMITTEE, department: 'Engineering' },
  { fullName: 'Mary Achieng', phone: '+254700000003', role: Role.COMMITTEE, department: 'Operations' },
  { fullName: 'Brian Kamau', phone: '+254700000004', department: 'Engineering' },
  { fullName: 'Faith Njeri', phone: '+254700000005', department: 'Customer Success' },
  { fullName: 'Kevin Mwangi', phone: '+254700000006', department: 'Engineering' },
  { fullName: 'Aisha Hassan', phone: '+254700000007', department: 'Sales and Marketing' },
  { fullName: 'Dennis Kiprop', phone: '+254700000008', department: 'Finance and Admin' },
  { fullName: 'Lucy Wambui', phone: '+254700000009', department: 'Customer Success' },
  { fullName: 'Samuel Njoroge', phone: '+254700000010', department: 'Engineering' },
  { fullName: 'Wanjiku Mbugua', phone: '+254700000011', department: 'Engineering' },
  { fullName: 'Hassan Ali', phone: '+254700000012', department: 'Customer Success' },
  { fullName: 'Cynthia Adhiambo', phone: '+254700000013', department: 'Operations' },
  { fullName: 'Victor Mutua', phone: '+254700000014', department: 'Sales and Marketing' },
  { fullName: 'Esther Chebet', phone: '+254700000015', department: 'Finance and Admin' },
  { fullName: 'Joseph Maina', phone: '+254700000016', department: 'Engineering' },
  { fullName: 'Naomi Kerubo', phone: '+254700000017', department: 'Customer Success' },
  { fullName: 'Elijah Barasa', phone: '+254700000018', department: 'Operations' },
  { fullName: 'Mercy Nyambura', phone: '+254700000019', department: 'Sales and Marketing' },
  { fullName: 'Collins Odhiambo', phone: '+254700000020', department: 'Engineering' },
  { fullName: 'Rehema Said', phone: '+254700000021', department: 'Finance and Admin' },
  { fullName: 'Anthony Kariuki', phone: '+254700000022', department: 'Customer Success' },
  { fullName: 'Beatrice Atieno', phone: '+254700000023', department: 'Operations' },
  { fullName: 'George Wafula', phone: '+254700000024', department: 'Engineering' },
  { fullName: 'Halima Noor', phone: '+254700000025', department: 'Sales and Marketing' },
];

const seedDemo = ['1', 'true', 'yes', 'on'].includes(String(process.env.SEED_DEMO ?? 'true').toLowerCase());
const bootstrapAdminPhone = process.env.BOOTSTRAP_ADMIN_PHONE
  ? normalizePhone(process.env.BOOTSTRAP_ADMIN_PHONE)
  : null;

async function main() {
  if (process.env.BOOTSTRAP_ADMIN_PHONE && !bootstrapAdminPhone) {
    throw new Error('BOOTSTRAP_ADMIN_PHONE must be a valid Kenyan phone number.');
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

  const existingAdmin = seedDemo
    ? null
    : await prisma.employee.findFirst({ where: { role: Role.ADMIN }, select: { phone: true } });
  if (!seedDemo && !bootstrapAdminPhone && !existingAdmin) {
    throw new Error('Set BOOTSTRAP_ADMIN_PHONE before seeding a production database without demo users.');
  }
  const people = seedDemo
    ? DEMO_PEOPLE
    : bootstrapAdminPhone
      ? [{
        fullName: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'AppKings Administrator',
        phone: bootstrapAdminPhone,
        role: Role.ADMIN,
        department: 'Operations',
      }]
      : [];

  for (const person of people) {
    await prisma.employee.upsert({
      where: { phone: person.phone },
      update: {
        fullName: person.fullName,
        role: person.role || Role.EMPLOYEE,
        departmentId: departments[person.department].id,
        active: true,
        eligible: true,
        // Demo accounts always start with NO device bound. Re-running the seed
        // must give a clean slate: without this, a device registered by an
        // earlier test run survives the re-seed and the next run is refused
        // with "This number is registered to another device".
        ...(seedDemo ? { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 } : {}),
      },
      create: {
        fullName: person.fullName,
        phone: person.phone,
        role: person.role || Role.EMPLOYEE,
        departmentId: departments[person.department].id,
      },
    });
  }
  if (seedDemo) {
    // Belt and braces: clear any device binding left on a demo phone.
    const cleared = await prisma.employee.updateMany({
      where: { phone: { in: people.map((person) => person.phone) } },
      data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 },
    });
    console.log(`Demo employees: ${people.length} ready, ${cleared.count} device binding(s) cleared (log in as +254700000001 = ADMIN)`);
  } else {
    console.log(`Demo employees skipped (SEED_DEMO=false); admin account: ${bootstrapAdminPhone ?? existingAdmin.phone}`);
  }
  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
