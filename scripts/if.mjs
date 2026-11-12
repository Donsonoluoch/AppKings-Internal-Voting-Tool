import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const prisma = new PrismaClient();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
await page.goto('http://localhost:3300/login', { waitUntil: 'networkidle' });
await page.fill('#phone', '700000004');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
await page.goto('http://localhost:3300/employee/nominate', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// What element is actually the category picker?
const selects = await page.locator('select').evaluateAll((els) =>
  els.map((el) => ({ id: el.id, name: el.name, disabled: el.disabled, value: el.value, options: el.options.length })),
);
console.log('selects:', JSON.stringify(selects, null, 2));

// Is there a category button group instead?
const radios = await page.locator('input[type=radio],button[role=radio]').count();
console.log('radio-ish controls:', radios);

const buttons = await page.locator('button').evaluateAll((els) =>
  els.map((el) => ({ text: el.textContent.trim().slice(0, 40), disabled: el.disabled, type: el.type })),
);
console.log('buttons:', JSON.stringify(buttons, null, 2));

const textareas = await page.locator('textarea').evaluateAll((els) => els.map((el) => ({ id: el.id, value: el.value })));
console.log('textareas:', JSON.stringify(textareas));

await browser.close();
await prisma.$disconnect();
