import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const log = [];

page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
page.on('response', async (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) {
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch { /* ignore */ }
    log.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}\n         ${body}`);
  }
});

// Sign in.
await page.goto('http://localhost:3300/login', { waitUntil: 'networkidle' });
await page.fill('#phone', '700000004'); // Brian Kamau, plain EMPLOYEE
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);
console.log('after login:', page.url());

// Go to the nomination screen.
await page.goto('http://localhost:3300/employee/nominate', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
console.log('nominate URL:', page.url());
console.log('\n--- page text ---');
console.log((await page.locator('body').innerText()).slice(0, 1200));

console.log('\n--- form controls ---');
for (const sel of ['select', 'textarea', 'input', 'button']) {
  const n = await page.locator(sel).count();
  console.log(`  ${sel}: ${n}`);
}

await page.screenshot({ path: 'C:/Users/johnw/AppData/Local/Temp/nominate.png', fullPage: true });
console.log('\n--- console / failed requests ---');
console.log(log.length ? log.join('\n') : '(none)');
await browser.close();
