import 'dotenv/config';
// Put the app into a clean Phase 1, ready for a five-employee browser test.
import { PrismaClient } from '@prisma/client';
const BASE = process.env.APPKINGS_URL ?? 'http://localhost:3000';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable local test database.');
const appHost = new URL(BASE).hostname;
const testDatabase = new URL(TEST_DATABASE_URL);
const databaseName = decodeURIComponent(testDatabase.pathname.slice(1));
if (!['localhost', '127.0.0.1'].includes(appHost) ||
  !['localhost', '127.0.0.1'].includes(testDatabase.hostname) ||
  (!/(?:^|[_-])(test|dev)(?:[_-]|$)/i.test(databaseName) && testDatabase.port !== '5434')) {
  throw new Error('This helper only runs against a local test/dev stack.');
}
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

// 1. Reset the cycle through the API (so it is audited like a real reset).
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847' }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

const reset = await fetch(`${BASE}/api/admin/reset-cycle`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ confirm: 'RESET' }),
}).then((r) => r.json());
console.log('reset:', JSON.stringify(reset));

// 2. Open Phase 1.
const open = await fetch(`${BASE}/api/admin/phase`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ phase: 'PHASE_1', confirm: true }),
}).then((r) => r.json());
console.log('phase:', JSON.stringify(open));

const state = await prisma.settings.findFirst();
const eligible = await prisma.employee.count({ where: { active: true, eligible: true } });
console.log(`\nphase=${state.phase}  resultsPublic=${state.resultsPublic}`);
console.log(`employees eligible=${eligible}`);
await prisma.$disconnect();
