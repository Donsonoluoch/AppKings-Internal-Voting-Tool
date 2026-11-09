import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const log = [];

page.on('response', async (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) {
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch { /* ignore */ }
    log.push(`[http ${r.status()}] ${r.request().method()} ${r.url()} :: ${body}`);
  }
});

await page.goto('http://localhost:3300/login', { waitUntil: 'networkidle' });
await page.fill('#phone', '700000005');
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);

await page.goto('http://localhost:3300/employee/nominate', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 1. Choose the CATEGORY (the first select).
const categorySelect = page.locator('select').first();
const cats = await categorySelect.locator('option').evaluateAll((els) =>
  els.map((e) => ({ value: e.value, label: e.textContent.trim() })).filter((o) => o.value),
);
console.log('categories:', cats.length);
const target = cats.find((c) => !/team/i.test(c.label)) ?? cats[0];
await categorySelect.selectOption(target.value);
await page.waitForTimeout(800);

// 2. Choose the NOMINEE — this is the select that only appears after a category.
const selects = page.locator('select');
console.log('selects now:', await selects.count());
const nomineeSelect = selects.nth(1);
const people = await nomineeSelect.locator('option').evaluateAll((els) =>
  els.map((e) => ({ value: e.value, label: e.textContent.trim() })).filter((o) => o.value),
);
console.log(`nominee options: ${people.length}`);
await nomineeSelect.selectOption(people[0].value);

// 3. Justification.
await page.locator('textarea').first().fill(
  'Delivered consistently strong work across the quarter and supported the whole team.',
);
await page.waitForTimeout(500);

const btn = page.locator('button[type="submit"]').first();
console.log('submit enabled?', await btn.isEnabled());
await btn.click();
await page.waitForTimeout(4000);

console.log('\nURL:', page.url());
console.log((await page.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' | '));
console.log('\nerrors:', log.length ? log.join('\n') : '(none)');
await page.screenshot({ path: 'C:/Users/johnw/AppData/Local/Temp/nominate-ok.png', fullPage: true });
await browser.close();
