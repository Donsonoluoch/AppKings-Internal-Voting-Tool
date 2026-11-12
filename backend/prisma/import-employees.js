require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

// Phase 3 — seeds the real employee list before Phase 1 opens (docs/roadmap.md).
//
//   npm run db:import -- ./employees.csv            # dry run first (default)
//   npm run db:import -- ./employees.csv --apply    # write it
//   npm run db:import -- ./employees.csv --apply --deactivate-missing
//
// CSV columns (header aliases in lib/csv.js are accepted too):
//   fullName, phone, department, role
//   role is EMPLOYEE (default), COMMITTEE or ADMIN.
//
// Same rules as the admin CSV import in the portal, so both paths behave identically:
//   * phone numbers are normalised to +2547XXXXXXXX (invalid rows are reported, not imported)
//   * existing phone numbers are updated (name, role, department) — never duplicated
//   * missing departments are created
//   * employees are matched by phone, so re-running is safe
//
// It never touches nominations, votes or phases. A dry run prints the
// report and exits without writing.
const fs = require('node:fs');
const path = require('node:path');

const { PrismaClient, Role } = require('@prisma/client');
const { parseCsv } = require('../src/lib/csv');
const { normalizePhone } = require('../src/lib/phone');

const prisma = new PrismaClient();

function readArgs(argv) {
  const args = { file: null, apply: false, deactivateMissing: false };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--deactivate-missing') args.deactivateMissing = true;
    else if (!arg.startsWith('--')) args.file = arg;
  }
  return args;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Usage: npm run db:import -- <file.csv> [--apply] [--deactivate-missing]\n' +
      '  (without --apply it is a dry run)'
    );
    process.exitCode = 1;
    return;
  }

  const file = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(file)) {
    console.error(`CSV not found: ${file}`);
    process.exitCode = 1;
    return;
  }

  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (rows.length === 0) {
    console.error('The CSV has no data rows.');
    process.exitCode = 1;
    return;
  }

  const departments = new Map(
    (await prisma.department.findMany()).map((department) => [department.name.toLowerCase(), department.id])
  );

  const report = { created: 0, updated: 0, skipped: [], departmentsCreated: [], missing: [] };
  const pending = [];
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    const line = index + 2; // header is line 1
    const fullName = (row.fullName || '').trim();
    const phone = normalizePhone(row.phone);
    const roleValue = (row.role || 'EMPLOYEE').trim().toUpperCase();
    const departmentName = (row.department || '').trim();

    if (!fullName) {
      report.skipped.push({ line, reason: 'Missing full name' });
      continue;
    }
    if (!phone) {
      report.skipped.push({ line, reason: `Invalid phone: ${row.phone || '(empty)'}` });
      continue;
    }
    if (seen.has(phone)) {
      report.skipped.push({ line, reason: `Duplicate phone in file: ${phone}` });
      continue;
    }
    if (!Object.values(Role).includes(roleValue)) {
      report.skipped.push({ line, reason: `Unknown role: ${row.role}` });
      continue;
    }
    seen.add(phone);

    const departmentKey = departmentName ? departmentName.toLowerCase() : null;
    if (departmentKey && !departments.has(departmentKey)) {
      departments.set(departmentKey, { name: departmentName });
      report.departmentsCreated.push(departmentName);
    }

    pending.push({ fullName, phone, role: roleValue, departmentKey });
  }

  const existing = await prisma.employee.findMany({ select: { id: true, phone: true, fullName: true } });
  const existingByPhone = new Map(existing.map((employee) => [employee.phone, employee]));

  for (const person of pending) {
    if (existingByPhone.has(person.phone)) report.updated += 1;
    else report.created += 1;
  }

  if (args.deactivateMissing) {
    report.missing = existing
      .filter((employee) => !seen.has(employee.phone))
      .map((employee) => ({ id: employee.id, phone: employee.phone, fullName: employee.fullName }));
  }

  console.log(`Rows read: ${rows.length}`);
  console.log(`Would create: ${report.created}, would update: ${report.updated}, skipped: ${report.skipped.length}`);
  if (report.departmentsCreated.length > 0) {
    console.log(`New departments: ${report.departmentsCreated.join(', ')}`);
  }
  for (const row of report.skipped) console.log(`  skipped line ${row.line}: ${row.reason}`);
  if (args.deactivateMissing) {
    console.log(`Not in the CSV (would be deactivated): ${report.missing.length}`);
    for (const person of report.missing) console.log(`  ${person.fullName} ${person.phone}`);
  }

  if (!args.apply) {
    console.log('\nDry run — nothing was written. Re-run with --apply to import.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const name of report.departmentsCreated) {
      const department = await tx.department.upsert({ where: { name }, update: {}, create: { name } });
      departments.set(name.toLowerCase(), department.id);
    }

    for (const person of pending) {
      const mapped = person.departmentKey ? departments.get(person.departmentKey) : null;
      const departmentId = typeof mapped === 'string' ? mapped : null;
      const data = { fullName: person.fullName, role: person.role, departmentId, active: true };

      const match = existingByPhone.get(person.phone);
      if (match) {
        await tx.employee.update({ where: { id: match.id }, data });
      } else {
        await tx.employee.create({ data: { ...data, phone: person.phone } });
      }
    }

    for (const person of report.missing) {
      await tx.employee.update({ where: { id: person.id }, data: { active: false } });
    }
  });

  console.log(`\nImported: ${report.created} created, ${report.updated} updated.`);
  if (args.deactivateMissing) console.log(`Deactivated: ${report.missing.length}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
