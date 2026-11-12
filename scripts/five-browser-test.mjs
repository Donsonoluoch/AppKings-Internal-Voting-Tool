// Browser-context tests for independent sessions, phone-only login and role access.
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
//
// Each context has independent cookies and storage; the same roster phone is
// intentionally allowed to sign in in multiple contexts.
import { chromium, devices } from 'playwright';
import { PrismaClient } from '@prisma/client';

// ─── Config ──────────────────────────────────────────────────────────────────

// AppKings serves the UI and the API from ONE Next.js server, so WEB and API
// are the same origin by default.
const WEB = process.env.TEST_WEB_URL ?? 'http://localhost:3000';
const API = process.env.TEST_API_URL ?? WEB;
if (!['localhost', '127.0.0.1'].includes(new URL(WEB).hostname) ||
  !['localhost', '127.0.0.1'].includes(new URL(API).hostname)) {
  throw new Error('Browser tests only run against a local application URL.');
}
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const HEADED = process.argv.includes('--headed');
const SLOW = process.argv.includes('--slow');
if (!TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable local test database.');
const testDatabase = new URL(TEST_DATABASE_URL);
const testDatabaseName = decodeURIComponent(testDatabase.pathname.slice(1));
if (!['localhost', '127.0.0.1'].includes(testDatabase.hostname) ||
  (!/(?:^|[_-])(test|dev)(?:[_-]|$)/i.test(testDatabaseName) && testDatabase.port !== '5434')) {
  throw new Error('Use a local test/dev database, or the dedicated development port 5434.');
}
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

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

// ─── Isolated browser contexts ───────────────────────────────────────────────

/**
 * A fresh context with a phone viewport and its own storage.
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

/** Sign in through the real login form, completing first-login department onboarding. */
async function signIn(device) {
  const { page, person } = device;
  const authCheck = page.waitForResponse((response) =>
    response.url().includes('/api/auth/me') && response.status() === 401,
  );
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await authCheck;

  const local = person.phone.replace(/^\+254/, '').replace(/\D/g, '');
  await page.fill('#phone', local);
  await page.click('button[type="submit"]');

  const departmentSelect = page.locator('#department');
  await Promise.race([
    page.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => false),
    departmentSelect.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false),
  ]);
  let departmentAssigned = false;
  if (await departmentSelect.isVisible().catch(() => false)) {
    const options = await departmentSelect.locator('option').evaluateAll((items) =>
      items.map((item) => item.value).filter(Boolean),
    );
    if (!options.length) throw new Error('no department options were presented');
    await departmentSelect.selectOption(options[0]);
    await page.click('button[type="submit"]');
    departmentAssigned = true;
  }

  await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 20000 })
    .catch(() => { });

  const onLogin = new URL(page.url()).pathname.startsWith('/login');
  if (onLogin) {
    const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
    return { ok: false, message: (alert ?? 'stayed on the login page').trim(), departmentAssigned };
  }
  return { ok: true, path: new URL(page.url()).pathname, departmentAssigned };
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

async function loadPeople() {
  const adminPhone = process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847';
  const admin = await prisma.employee.findUnique({ where: { phone: adminPhone } });
  if (!admin || admin.role !== 'ADMIN') throw new Error('Test database is missing the seeded bootstrap admin.');
  const employees = await prisma.employee.findMany({
    where: { active: true, id: { not: admin.id } },
    orderBy: { phone: 'asc' },
    take: 4,
  });
  if (employees.length !== 4) throw new Error('Test database needs at least four additional active roster employees.');

  const roles = ['COMMITTEE', 'COMMITTEE', 'EMPLOYEE', 'EMPLOYEE'];
  for (const [index, employee] of employees.entries()) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { role: roles[index], departmentId: null },
    });
  }
  return [
    { fullName: admin.fullName, phone: admin.phone, role: 'ADMIN' },
    ...employees.map((employee, index) => ({
      fullName: employee.fullName,
      phone: employee.phone,
      role: roles[index],
    })),
  ];
}

async function main() {
  const people = await loadPeople();
  console.log(`\n\x1b[1mAppKings — phone login and browser-context test\x1b[0m`);
  console.log(`  web ${WEB}`);
  console.log(`  api ${API}\n`);

  await waitForApp();

  const browser = await chromium.launch({ headless: !HEADED });

  try {
    // ── 1. First login and department onboarding ────────────────────────────
    console.log('\x1b[1m1. Roster employees sign in and choose missing departments\x1b[0m');
    const signedIn = [];
    for (const person of people) {
      const device = await openDevice(browser, person);
      const result = await step(
        `${person.fullName} (${person.role}) signs in for the first time`,
        async () => {
          const signInResult = await signIn(device);
          if (!signInResult.ok) throw new Error(signInResult.message);
          if (person.role !== 'ADMIN' && !signInResult.departmentAssigned) {
            throw new Error('expected first-login department selection');
          }
          return signInResult;
        },
      );
      signedIn.push({ device, ok: Boolean(result?.ok) });
    }

    // ── 2. Repeated phone sign-in ───────────────────────────────────────────
    console.log('\n\x1b[1m2. The same phone can sign in in a second browser context\x1b[0m');
    const intruder = await openDevice(browser, people[4]);
    const second = await signIn(intruder);
    if (second.ok) pass('the same employee can sign in from a second browser');
    else fail('the same employee can sign in from a second browser', second.message);
    await intruder.context.close();

    const good = signedIn.filter((s) => s.ok).map((s) => s.device);

    // ── 3. Published results are shared by every account role ───────────────
    console.log('\n\x1b[1m3. Published results are available across roles\x1b[0m');
    for (const device of good) {
      await step(`${device.person.fullName} (${device.person.role}) can open published results`, async () => {
        await device.page.getByRole('button', { name: 'Open navigation menu' }).click();
        await device.page.getByRole('link', { name: 'Published results' }).click();
        await device.page.getByRole('heading', { name: '2026 Awards results' }).waitFor({ timeout: 10000 });
        for (const phaseTitle of [
          'Phase 1 — Nominations',
          'Phase 2 — Committee picks',
          'Phase 3 — Final vote',
        ]) {
          await device.page.getByRole('heading', { name: phaseTitle }).waitFor({ timeout: 10000 });
        }
        return device.page.url();
      });
    }

    // ── 4. Voting ───────────────────────────────────────────────────────────
    const phase = good.length ? await currentPhase(good[0].context) : null;
    console.log(`\n\x1b[1m4. Voting (phase: ${phase ?? 'unknown'})\x1b[0m`);

    if (phase === 'PHASE_1') {
      for (const device of good) {
        await step(`${device.person.fullName} can open the nomination screen`, async () => {
          await device.page.goto(`${WEB}/employee/nominate`, { waitUntil: 'domcontentloaded' });
          if (device.page.url().includes('/login')) throw new Error('was sent to login');
          await device.page.getByRole('navigation', { name: 'Nomination categories' }).waitFor({ timeout: 10000 });
          return device.page.url();
        });
      }
      const employee = good.find((device) => device.person.role === 'EMPLOYEE');
      if (employee) {
        await step('an employee can submit a nomination without an extra confirmation step', async () => {
          await employee.page.locator('input[name="nominee"]').first().check();
          await employee.page.getByLabel('Justification').fill(
            'Consistently delivers careful work and supports colleagues with difficult tasks.'
          );
          await employee.page.getByRole('button', { name: 'Save nomination' }).click();
          await employee.page.getByText(/Nomination saved for/).waitFor();
          return 'nomination saved';
        });
      }
    } else if (phase === 'PHASE_3') {
      for (const device of good) {
        await step(`${device.person.fullName} can open the ballot`, async () => {
          await device.page.goto(`${WEB}/employee/vote`, { waitUntil: 'domcontentloaded' });
          if (device.page.url().includes('/login')) throw new Error('was sent to login');
          await device.page.getByRole('progressbar', { name: 'Voting progress' }).waitFor({ timeout: 10000 });
          return device.page.url();
        });
      }
      if (good.length) {
        await step('a voter can review a selection before casting it', async () => {
          const page = good[0].page;
          await page.locator('input[type="radio"]').first().check();
          await page.getByText('1 selection ready').waitFor();
          await page.getByRole('button', { name: /Submit vote for/ }).first().click();
          const dialog = page.getByRole('dialog');
          await dialog.getByText(/You are voting for/).waitFor();
          await dialog.getByRole('button', { name: 'Cancel' }).click();
          return 'selection reviewed; no vote was submitted';
        });
      }
    } else {
      console.log(`  \x1b[33m·\x1b[0m phase is ${phase}; open a voting phase in the admin console first`);
    }

    // ── 5. Roles ────────────────────────────────────────────────────────────
    console.log('\n\x1b[1m5. Roles go where they should\x1b[0m');
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

    // ── 6. Audit ────────────────────────────────────────────────────────────
    console.log('\n\x1b[1m6. The admin can read the audit trail\x1b[0m');
    const admin = good.find((d) => d.person.role === 'ADMIN');
    if (admin) {
      await step('the admin can open the reset confirmation from any phase', async () => {
        await admin.page.goto(`${WEB}/admin`, { waitUntil: 'domcontentloaded' });
        const resetButton = admin.page.getByRole('button', { name: 'Reset voting progress' });
        await resetButton.waitFor({ timeout: 10000 });
        if (await admin.page.getByRole('button', { name: /Cancel progress & start Phase 1/i }).count()) {
          throw new Error('duplicate start-over action is still visible');
        }
        await resetButton.click();
        const dialog = admin.page.getByRole('dialog');
        await dialog.getByText(/permanently clears all nominations, votes, committee picks/i).waitFor();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        return 'reset dialog opened and safely cancelled';
      });

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
}).finally(() => prisma.$disconnect());
