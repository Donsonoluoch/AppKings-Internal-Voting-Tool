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
    logs.push(`[${r.request().method()} ${r.status()}] ${r.url()} :: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
});

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.fill('#phone', '700000004');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(6000);
console.log('login ->', page.url());

// The vote page.
await page.goto(`${WEB}/employee/vote`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
console.log('\n/employee/vote ->', page.url());
console.log('screen:', (await page.locator('body').innerText()).slice(0, 500).replace(/\n+/g, ' | '));
console.log('disabled submit buttons:', await page.locator('button[type=submit][disabled]').count());
await page.screenshot({ path: 'C:/Users/johnw/AppData/Local/Temp/vote-page.png', fullPage: true });

console.log('\n--- writes ---', logs.join('\n') || '(none)');
await browser.close();
await prisma.$disconnect();
