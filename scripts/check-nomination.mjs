import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const nominations = await prisma.nomination.findMany({
  include: {
    nominator: { select: { fullName: true, phone: true } },
    category: { select: { name: true } },
    nominee: { select: { fullName: true } },
    nomineeTeam: { select: { name: true } },
  },
  orderBy: { createdAt: 'desc' },
  take: 5,
});

console.log(`total nominations: ${await prisma.nomination.count()}`);
for (const n of nominations) {
  console.log(
    `  ${n.nominator.phone} (${n.nominator.fullName}) → ` +
    `${n.category.name}: ${n.nominee?.fullName ?? n.nomineeTeam?.name ?? '?'}`,
  );
}
await prisma.$disconnect();
