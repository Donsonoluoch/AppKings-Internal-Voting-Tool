import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const cleared = await prisma.employee.updateMany({
  data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 },
});
const bound = await prisma.employee.count({ where: { deviceHash: { not: null } } });
const state = await prisma.settings.findFirst();
console.log(`cleared ${cleared.count} device binding(s); still bound: ${bound}; phase: ${state.phase}`);
await prisma.$disconnect();
