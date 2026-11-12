import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = 'http://localhost:3300';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: '700000005' }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const body = await fetch(`${BASE}/api/results`, { headers: { cookie } }).then((r) => r.json());

console.log('published:', body.published);
console.log('overall.winnerId:', body.overall?.winnerId);
console.log('overall.tiebreakRequired:', body.overall?.tiebreakRequired);
console.log('\nOverall ranking from the API:');
for (const row of body.overall?.rows ?? []) {
  console.log(`  ${String(row.totalPoints).padStart(3)}  ${row.name.padEnd(18)} ${row.categories} cat`);
}
await prisma.$disconnect();
