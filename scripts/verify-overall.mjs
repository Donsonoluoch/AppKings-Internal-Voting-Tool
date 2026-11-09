import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Recompute the overall ranking independently and compare with the API.
const finalists = await prisma.candidate.findMany({
  where: { inPhase3: true },
  include: { employee: { select: { id: true, fullName: true } } },
});

const people = new Map();
for (const c of finalists) {
  if (!c.employeeId) continue; // teams excluded
  const row = people.get(c.employeeId) ?? {
    name: c.employee.fullName,
    categories: 0,
    nomination: 0,
    committee: 0,
    final: 0,
    total: 0,
  };
  row.categories += 1;
  row.nomination += c.nominationPoints;
  row.committee += c.committeePoints;
  row.final += c.finalPoints;
  row.total += c.nominationPoints + c.committeePoints + c.finalPoints;
  people.set(c.employeeId, row);
}

const ranked = [...people.entries()]
  .map(([id, r]) => ({ id, ...r }))
  .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

console.log('Independent overall ranking:');
for (const r of ranked) {
  console.log(`  ${String(r.total).padStart(3)}  ${r.name.padEnd(18)} ${r.categories} cat  (${r.nomination}+${r.committee}+${r.final})`);
}

const top = ranked[0];
const tied = ranked.filter((r) => r.total === top.total);
console.log(`\nTop score: ${top.total}, shared by ${tied.length} people`);
console.log(tied.length > 1 ? '=> a genuine tie; no single winner' : `=> winner: ${top.name}`);
await prisma.$disconnect();
