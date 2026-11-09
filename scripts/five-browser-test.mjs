// Five-browser test: one real browser per employee, each its own device.
//
// Lives in the DrillKe workspace but targets the AppKings Voting Tool, because
// this is where Playwright is installed. Copy it across with:
//
//   npm run appkings:install-test
//
// Then, in the AppKings repo:
//
//   npm run test:five-browsers                # headless
//   npm run test:five-browsers -- --headed    # watch it happen
//   TEST_DATABASE_URL=... npm run test:five-browsers -- --reset
//                                            # clear only the five demo device bindings
//
// WHY REAL BROWSERS
//   The device rule is "one device per employee". A test that calls the API five
//   times from one process cannot prove that rule — it shares one cookie jar and
//   one device id. These five are genuine, isolated browser contexts: separate
//   storage, separate sessions, separate device ids. That is what a person on
//   five phones looks like.
import { chromium, devices } from 'playwright';
import { PrismaClient } from '@prisma/client';

// ─── Config ──────────────────────────────────────────────────────────────────

// AppKings serves the UI and the API from ONE Next.js server, so WEB and API
// are the same origin by default.
const WEB = process.env.TEST_WEB_URL ?? 'http://localhost:3000';
const API = process.env.TEST_API_URL ?? WEB;
const HEADED = process.argv.includes('--headed');
const SLOW = process.argv.includes('--slow');
const RESET = process.argv.includes('--reset');

/** The five people, in the order the seed creates them. */
const PEOPLE = [
  { fullName: 'Grace Wanjiru', phone: '+254700000001', role: 'ADMIN' },
  { fullName: 'Peter Otieno', phone: '+254700000002', role: 'COMMITTEE' },
  { fullName: 'Mary Achieng', phone: '+254700000003', role: 'COMMITTEE' },
  { fullName: 'Brian Kamau', phone: '+254700000004', role: 'EMPLOYEE' },
  { fullName: 'Faith Njeri', phone: '+254700000005', role: 'EMPLOYEE' },
];

// ─── Reporting ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function pass(label) {
  passed += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}

function fail(label, detail) {
  failed += 1;
  failures.push({ label, detail });
  console.log(`  \x1b[31m✗ ${label}\x1b[0m`);
  if (detail) console.log(`      ${String(detail).split('\n')[0]}`);
}

async function step(label, fn) {
  try {
    const result = await fn();
    pass(label);
    if (SLOW) await new Promise((r) => setTimeout(r, 400));
    return result;
  } catch (error) {
    fail(label, error.message);
    return null;
  }
}

async function waitForApp(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`The API at ${API} is not responding. Is the stack running?`);
}

// ─── One browser per employee ────────────────────────────────────────────────

/**
 * A fresh context with a phone viewport and its own storage. Two contexts never
 * share a cookie or a device id — which is exactly what the device restriction
 * is checking.
 */
async function openDevice(browser, person) {
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    locale: 'en-KE',
    timezoneId: 'Africa/Nairobi',
    userAgent: `${devices['Pixel 7'].userAgent} AppKingsTest/${person.phone}`,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => fail(`${person.fullName}: page error`, error.message));
  return { person, context, page };
}

/** Sign in through the real login form. */
async function signIn(device) {
  const { page, person } = device;
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });

  const local = person.phone.replace(/^\+254/, '').replace(/\D/g, '');
  await page.fill('#phone', local);
  await page.click('button[type="submit"]');

  await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 20000 })
    .catch(() => { });

  const onLogin = new URL(page.url()).pathname.startsWith('/login');
  if (onLogin) {
    const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
    return { ok: false, message: (alert ?? 'stayed on the login page').trim() };
  }
  return { ok: true, path: new URL(page.url()).pathname };
}

/**
 * Read the current phase from the API (works regardless of UI state).
 *
 * The phase is published on /api/auth/me, not on a /api/phase route — there is
 * no such route, which is why this used to return null and the voting section
 * was skipped.
 */
async function currentPhase(context) {
  const res = await context.request.get(`${API}/api/auth/me`);
  if (!res.ok()) return null;
  const body = await res.json();
  return body.phase ?? null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function resetTestDevices() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('--reset requires TEST_DATABASE_URL pointing to a disposable local test database.');
  }
  const database = new URL(process.env.TEST_DATABASE_URL);
  const databaseName = decodeURIComponent(database.pathname.slice(1));
  if (
    !['localhost', '127.0.0.1'].includes(database.hostname) ||
    !/(?:^|[_-])(test|dev)(?:[_-]|$)/i.test(databaseName)
  ) {
    throw new Error('--reset only accepts a local database whose name contains "test" or "dev".');
  }

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
  try {
    await prisma.employee.updateMany({
      where: { phone: { in: PEOPLE.map((person) => person.phone) } },
      data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 },
    });
  } finally {
    await prisma.$disconnect();
  }
  await waitForApp();
  console.log('\n  Reset the five demo device bindings.\n');
}

async function main() {
  console.log(`\n\x1b[1mAppKings — five-browser device test\x1b[0m`);
  console.log(`  web ${WEB}`);
  console.log(`  api ${API}\n`);

  if (RESET) await resetTestDevices();
  else await waitForApp();

  const browser = await chromium.launch({ headless: !HEADED });

  try {
    // ── 1. Every employee signs in on their own device ──────────────────────
    console.log('\x1b[1m1. First sign-in registers a device\x1b[0m');
    const signedIn = [];
    for (const person of PEOPLE) {
      const device = await openDevice(browser, person);
      const result = await step(
        `${person.fullName} (${person.role}) signs in for the first time`,
        () => signIn(device),
      );
      if (!result?.ok) fail(`${person.fullName}: login failed`, result?.message);
      signedIn.push({ device, ok: Boolean(result?.ok) });
    }

    // ── 2. The device rule ──────────────────────────────────────────────────
    console.log('\n\x1b[1m2. A second device is refused\x1b[0m');
    const intruder = await openDevice(browser, PEOPLE[4]);
    const second = await signIn(intruder);
    if (second.ok) {
      fail('the same employee on a second device is refused', `it was allowed through to ${second.path}`);
    } else if (/device/i.test(second.message)) {
      pass('the same employee on a second device is refused (device mismatch)');
    } else {
      fail('the second device is refused', `refused, but not for a device reason: ${second.message}`);
    }
    await intruder.context.close();

    const good = signedIn.filter((s) => s.ok).map((s) => s.device);

    // ── 3. Voting ───────────────────────────────────────────────────────────
    const phase = good.length ? await currentPhase(good[0].context) : null;
    console.log(`\n\x1b[1m3. Voting (phase: ${phase ?? 'unknown'})\x1b[0m`);

    if (phase === 'PHASE_1') {
      for (const device of good) {
        await step(`${device.person.fullName} can open the nomination screen`, async () => {
          await device.page.goto(`${WEB}/employee/nominate`, { waitUntil: 'domcontentloaded' });
          if (device.page.url().includes('/login')) throw new Error('was sent to login');
          return device.page.url();
        });
      }
    } else if (phase === 'PHASE_3') {
      for (const device of good) {
        await step(`${device.person.fullName} can open the ballot`, async () => {
          await device.page.goto(`${WEB}/employee/vote`, { waitUntil: 'domcontentloaded' });
          if (device.page.url().includes('/login')) throw new Error('was sent to login');
          return device.page.url();
        });
      }
    } else {
      console.log(`  \x1b[33m·\x1b[0m phase is ${phase}; open a voting phase in the admin console first`);
    }

    // ── 4. Roles ────────────────────────────────────────────────────────────
    console.log('\n\x1b[1m4. Roles go where they should\x1b[0m');
    for (const device of good.filter((d) => d.person.role === 'COMMITTEE')) {
      await step(`${device.person.fullName} (committee) can open the committee screen`, async () => {
        await device.page.goto(`${WEB}/committee/vote`, { waitUntil: 'domcontentloaded' });
        if (device.page.url().includes('/login')) throw new Error('was sent to login');
        return device.page.url();
      });
    }
    for (const device of good.filter((d) => d.person.role === 'EMPLOYEE')) {
      await step(`${device.person.fullName} (employee) is kept out of the committee screen`, async () => {
        await device.page.goto(`${WEB}/committee/vote`, { waitUntil: 'domcontentloaded' });
        // The role guard is a client-side redirect fired from useEffect, so it
        // lands AFTER the first paint. Checking the URL at domcontentloaded
        // always sees /committee/vote and reports a false failure. Give the
        // redirect its moment, then judge where the employee actually ended up.
        await device.page
          .waitForURL((url) => !url.pathname.startsWith('/committee'), { timeout: 10000 })
          .catch(() => {});
        const url = device.page.url();
        if (url.includes('/committee')) {
          throw new Error(`stayed on ${url}`);
        }
        return url;
      });
    }

    // ── 5. Audit ────────────────────────────────────────────────────────────
    console.log('\n\x1b[1m5. The admin can read the audit trail\x1b[0m');
    const admin = good.find((d) => d.person.role === 'ADMIN');
    if (admin) {
      await step('the admin can open the audit trail', async () => {
        await admin.page.goto(`${WEB}/admin/audit`, { waitUntil: 'domcontentloaded' });
        if (admin.page.url().includes('/login')) throw new Error('was sent to login');
        return admin.page.url();
      });
    }

    if (HEADED) {
      console.log('\n  Browsers left open for 30s so you can look around…');
      await new Promise((r) => setTimeout(r, 30000));
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log(`\x1b[32mAll ${passed} checks passed.\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed`);
    for (const f of failures) console.log(`  · ${f.label}: ${String(f.detail).split('\n')[0]}`);
    console.log('');
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`\n\x1b[31m${error.message}\x1b[0m\n`);
  process.exitCode = 1;
});
