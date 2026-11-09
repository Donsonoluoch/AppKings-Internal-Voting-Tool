import 'dotenv/config';
// Put the app into a clean Phase 1, ready for a five-employee browser test.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = process.env.APPKINGS_URL ?? 'http://localhost:3000';

// 1. Clear device bindings so all five can sign in fresh.
await prisma.employee.updateMany({ data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 } });

// 2. Reset the cycle through the API (so it is audited like a real reset).
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: '700000001' }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

const reset = await fetch(`${BASE}/api/admin/reset-cycle`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ confirm: 'RESET' }),
}).then((r) => r.json());
console.log('reset:', JSON.stringify(reset));

// 3. Open Phase 1.
const open = await fetch(`${BASE}/api/admin/phase`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ phase: 'PHASE_1', confirm: true }),
}).then((r) => r.json());
console.log('phase:', JSON.stringify(open));

// 4. Clear devices again: the admin login above re-bound one.
await prisma.employee.updateMany({ data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 } });

const state = await prisma.settings.findFirst();
const bound = await prisma.employee.count({ where: { deviceHash: { not: null } } });
const eligible = await prisma.employee.count({ where: { active: true, eligible: true } });
console.log(`\nphase=${state.phase}  resultsPublic=${state.resultsPublic}`);
console.log(`employees eligible=${eligible}  devices bound=${bound}`);
await prisma.$disconnect();
