import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const total = await prisma.employee.count();
const active = await prisma.employee.count({ where: { active: true } });
const eligible = await prisma.employee.count({ where: { active: true, eligible: true } });
const both = await prisma.employee.count({ where: { active: true, eligible: true } });

console.log({ total, active, eligible, both });

const rows = await prisma.employee.findMany({
  select: { fullName: true, phone: true, active: true, eligible: true, role: true },
  orderBy: { phone: 'asc' },
});
for (const r of rows) {
  console.log(`${r.phone} ${r.fullName.padEnd(20)} active=${r.active} eligible=${r.eligible} ${r.role}`);
}
await prisma.$disconnect();
