import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = 'http://localhost:3300';

await prisma.employee.updateMany({ data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 } });
const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: '700000005' }),
});
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const body = await fetch(`${BASE}/api/results`, { headers: { cookie } }).then((r) => r.json());

const first = body.results?.[0];
console.log('category keys:', Object.keys(first ?? {}));
console.log('row keys     :', Object.keys(first?.results?.[0] ?? {}));
console.log('\nfirst category:');
console.log(JSON.stringify(first, null, 2).slice(0, 900));
await prisma.$disconnect();
