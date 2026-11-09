import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Are there duplicate employees with the same name?
const employees = await prisma.employee.findMany({
  select: { id: true, fullName: true, phone: true, active: true, eligible: true },
  orderBy: { fullName: 'asc' },
});

const byName = new Map();
for (const e of employees) {
  const list = byName.get(e.fullName) ?? [];
  list.push(e);
  byName.set(e.fullName, list);
}

console.log('Duplicate names:');
for (const [name, list] of byName) {
  if (list.length > 1) {
    console.log(`  ${name}: ${list.length} rows`);
    for (const e of list) console.log(`    ${e.id} ${e.phone} active=${e.active} eligible=${e.eligible}`);
  }
}

// And the finalists in Phase 3.
const finalists = await prisma.candidate.findMany({
  where: { inPhase3: true },
  include: { employee: { select: { id: true, fullName: true } }, category: { select: { name: true } } },
});
console.log(`\nPhase 3 finalists: ${finalists.length}`);
for (const f of finalists) {
  console.log(`  ${f.category.name}: ${f.employee?.fullName ?? '(team)'} emp=${f.employeeId ?? '-'} total=${f.nominationPoints + f.committeePoints + f.finalPoints}`);
}
await prisma.$disconnect();
