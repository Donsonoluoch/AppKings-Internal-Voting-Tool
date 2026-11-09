import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const prisma = new PrismaClient();
await prisma.employee.updateMany({ data: { deviceHash: null, deviceRegisteredAt: null, deviceResetCount: 0 } });
const before = await prisma.nomination.count();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
const writes = [];
page.on('response', async (r) => {
  if (r.url().includes('/api/') && r.request().method() !== 'GET') {
    writes.push(`[${r.request().method()} ${r.status()}] ${r.url()} :: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
});

await page.goto('http://localhost:3300/login', { waitUntil: 'networkidle' });
await page.fill('#phone', '700000004');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
await page.goto('http://localhost:3300/employee/nominate', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// The real controls, by id.
await page.selectOption('#category', { index: 1 });
await page.waitForTimeout(500);
await page.selectOption('#colleague-select', { index: 1 });
await page.fill('#justification', 'Consistently helped the team ship on time throughout the year.');
await page.waitForTimeout(800);

const submit = page.locator('button[type=submit]').first();
console.log('submit disabled now:', await submit.isDisabled());
await submit.click();
await page.waitForTimeout(5000);

console.log('after submit:', (await page.locator('body').innerText()).slice(0, 260).replace(/\n+/g, ' | '));
console.log(`\nnominations: ${before} -> ${await prisma.nomination.count()}`);
await page.screenshot({ path: 'C:/Users/johnw/AppData/Local/Temp/nominate-ok.png', fullPage: true });
console.log('\n--- writes ---\n' + (writes.join('\n') || '(none)'));

await browser.close();
await prisma.$disconnect();
