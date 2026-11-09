import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rows = await prisma.employee.findMany({
  where: { phone: { in: ['+254700000001', '+254700000002', '+254700000003', '+254700000004', '+254700000005'] } },
  select: { phone: true, fullName: true, deviceHash: true, deviceRegisteredAt: true, deviceResetCount: true },
  orderBy: { phone: 'asc' },
});

for (const r of rows) {
  console.log(`${r.phone} ${r.fullName.padEnd(16)} device=${r.deviceHash ? r.deviceHash.slice(0, 12) + '…' : '(none)'} resets=${r.deviceResetCount}`);
}

const state = await prisma.settings.findFirst();
console.log(`\nphase=${state.phase} resultsPublic=${state.resultsPublic}`);
await prisma.$disconnect();
