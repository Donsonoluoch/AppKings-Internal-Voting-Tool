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

await page.selectOption('#category', { index: 1 });
await page.selectOption('#colleague-select', { index: 1 });
await page.fill('#justification', 'Consistently helped the team ship on time throughout the year.');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(1500);

// The submit opens a confirmation dialog — that is the step that was missed.
const dialogText = await page.locator('[role=dialog]').innerText().catch(() => '(no dialog)');
console.log('dialog:', dialogText.slice(0, 200).replace(/\n+/g, ' | '));

const dialogButtons = await page.locator('[role=dialog] button').evaluateAll((els) =>
  els.map((el) => ({ text: el.textContent.trim().slice(0, 30), disabled: el.disabled })),
);
console.log('dialog buttons:', JSON.stringify(dialogButtons));

// Confirm.
const confirm = page.locator('[role=dialog] button').filter({ hasText: /confirm|nominate|submit|yes/i }).first();
if (await confirm.count()) {
  await confirm.click();
  await page.waitForTimeout(4000);
}

console.log(`\nnominations: ${before} -> ${await prisma.nomination.count()}`);
console.log('screen:', (await page.locator('body').innerText()).slice(0, 220).replace(/\n+/g, ' | '));
console.log('\n--- writes ---\n' + (writes.join('\n') || '(none)'));

await browser.close();
await prisma.$disconnect();
