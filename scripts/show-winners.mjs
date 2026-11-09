import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = 'http://localhost:3300';

// Clear device bindings so a fresh sign-in is allowed.
await prisma.employee.updateMany({ data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 } });

const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: '700000005' }),
});
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
console.log('login:', res.status);

const body = await fetch(`${BASE}/api/results`, { headers: { cookie } }).then((r) => r.json());
console.log('published:', body.published);
console.log('keys:', Object.keys(body));

for (const category of body.results ?? []) {
  const rows = category.results ?? [];
  const winner = rows.find((r) => r.candidateId === category.winnerId);
  console.log(`\n${category.categoryName}`);
  console.log(`  winnerId: ${category.winnerId}`);
  console.log(`  winner:   ${winner ? JSON.stringify(winner) : '(not in rows)'}`);
  console.log(`  top 3:    ${rows.slice(0, 3).map((r) => `${r.name ?? r.fullName ?? r.candidateId}=${r.total ?? r.points ?? '?'}`).join(' | ')}`);
}
await prisma.$disconnect();
