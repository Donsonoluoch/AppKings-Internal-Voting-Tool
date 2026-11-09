import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const log = [];

page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
page.on('response', async (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) {
    let body = '';
    try { body = (await r.text()).slice(0, 400); } catch { /* ignore */ }
    log.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}\n         ${body}`);
  }
});

await page.goto('http://localhost:3300/login', { waitUntil: 'networkidle' });
await page.fill('#phone', '700000005'); // Faith Njeri
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);

await page.goto('http://localhost:3300/employee/nominate', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Fill the first category.
const selects = page.locator('select');
console.log('select count:', await selects.count());

const first = selects.first();
const options = await first.locator('option').count();
console.log('options in first select:', options);

// Pick the third option (a colleague).
await first.selectOption({ index: 2 });
await page.waitForTimeout(500);

// Justification textarea.
const ta = page.locator('textarea').first();
const minLen = Number(await ta.getAttribute('minlength') ?? 20);
await ta.fill('Consistently delivered strong work across the quarter and supported the team.');

// Find the submit control.
const buttons = page.locator('button');
const labels = [];
for (let i = 0; i < await buttons.count(); i += 1) {
  const t = (await buttons.nth(i).innerText()).trim();
  if (t) labels.push(`${i}: ${t}`);
}
console.log('buttons:', labels.join(' | '));

const submit = page.locator('button[type="submit"]').first();
if (await submit.count()) {
  await submit.click();
} else {
  // Fall back to the last enabled button.
  const all = page.locator('button:enabled');
  await all.last().click();
}

await page.waitForTimeout(5000);
console.log('\nURL after submit:', page.url());
console.log('\n--- page text after submit ---');
console.log((await page.locator('body').innerText()).slice(0, 900));

await page.screenshot({ path: 'C:/Users/johnw/AppData/Local/Temp/nominate-after.png', fullPage: true });
console.log('\n--- errors ---');
console.log(log.length ? log.join('\n') : '(none)');
await browser.close();
