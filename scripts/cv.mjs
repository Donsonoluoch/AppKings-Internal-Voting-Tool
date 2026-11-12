import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const prisma = new PrismaClient();
const WEB = 'http://localhost:3300';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', async (r) => {
  if (r.url().includes('/api/') && r.request().method() !== 'GET') {
    logs.push(`[${r.request().method()} ${r.status()}] ${r.url()} :: ${(await r.text().catch(() => '')).slice(0, 220)}`);
  }
});

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.fill('#phone', '700000004');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(6000);
console.log('after login ->', page.url());

await page.goto(`${WEB}/employee/nominate`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
console.log('/nominate ->', page.url());

const text = await page.locator('body').innerText();
console.log('screen:', text.slice(0, 700).replace(/\n+/g, ' | '));

console.log('\ncontrols — selects:', await page.locator('select').count(),
  '| radios:', await page.locator('input[type=radio]').count(),
  '| checkboxes:', await page.locator('input[type=checkbox]').count(),
  '| buttons:', await page.locator('button').count());

// Try to actually submit one nomination.
const selects = page.locator('select');
if (await selects.count()) {
  const first = selects.first();
  const options = await first.locator('option').allTextContents();
  console.log('first select options:', options.slice(0, 6));
  if (options.length > 1) await first.selectOption({ index: 1 });
}

const submit = page.locator('button[type=submit]').first();
if (await submit.count()) {
  await submit.click();
  await page.waitForTimeout(5000);
  console.log('after submit ->', page.url());
  console.log('screen:', (await page.locator('body').innerText()).slice(0, 500).replace(/\n+/g, ' | '));
}

await page.screenshot({ path: 'C:/Users/johnw/AppData/Local/Temp/nominate-result.png', fullPage: true });

console.log('\n--- writes ---');
console.log(logs.length ? logs.join('\n') : '(none)');
await browser.close();
await prisma.$disconnect();
