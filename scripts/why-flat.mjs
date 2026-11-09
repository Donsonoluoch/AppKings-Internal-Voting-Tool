import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const finalists = await prisma.candidate.findMany({
  where: { inPhase3: true },
  include: { category: { select: { name: true } }, employee: { select: { fullName: true } } },
});

console.log('Phase 3 finalists and their frozen points:\n');
for (const c of finalists) {
  console.log(
    `${c.category.name.padEnd(28)} ${(c.employee?.fullName ?? '(team)').padEnd(18)} ` +
    `nom=${c.nominationPoints} com=${c.committeePoints} fin=${c.finalPoints} total=${c.nominationPoints + c.committeePoints + c.finalPoints}`,
  );
}

// How many votes did each phase actually get?
const votes = await prisma.vote.count();
const committee = await prisma.committeeVote.count();
const nominations = await prisma.nomination.count();
console.log(`\nnominations=${nominations} votes=${votes} committeeVotes=${committee}`);
await prisma.$disconnect();
