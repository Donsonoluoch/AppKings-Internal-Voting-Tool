import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const prisma = new PrismaClient();
const WEB = 'http://localhost:3300';

const before = await prisma.nomination.count();
console.log(`nominations before: ${before}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
const writes = [];
page.on('response', async (r) => {
  if (r.url().includes('/api/') && r.request().method() !== 'GET') {
    writes.push(`[${r.request().method()} ${r.status()}] ${r.url()} :: ${(await r.text().catch(() => '')).slice(0, 180)}`);
  }
});

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.fill('#phone', '700000004');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);

await page.goto(`${WEB}/employee/nominate`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Fill the FIRST category properly: pick a colleague, write a real justification.
const select = page.locator('select').first();
const options = await select.locator('option').allTextContents();
console.log('options:', options.slice(0, 4));
if (options.length > 1) await select.selectOption({ index: 1 });

// The justification is a textarea; the label says 20 characters minimum.
const justify = page.locator('textarea').first();
if (await justify.count()) {
  await justify.fill('Consistently helped the team ship on time this year.');
  console.log('justification filled');
}

const submit = page.locator('button[type=submit]').first();
const disabled = await submit.isDisabled();
console.log('submit disabled before click:', disabled);

if (!disabled) {
  await submit.click();
  await page.waitForTimeout(4000);
  const text = await page.locator('body').innerText();
  console.log('after submit:', text.slice(0, 300).replace(/\n+/g, ' | '));
}

const after = await prisma.nomination.count();
console.log(`\nnominations after: ${after} (delta ${after - before})`);

await page.screenshot({ path: 'C:/Users/johnw/AppData/Local/Temp/nominate-done.png', fullPage: true });
console.log('\n--- writes ---\n' + (writes.join('\n') || '(none)'));
await browser.close();
await prisma.$disconnect();
