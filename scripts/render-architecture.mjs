// Renders docs/architecture.html to docs/architecture.png (used for the README/deploy notes).
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const file = path.resolve('docs/architecture.html');
const out = path.resolve('docs/architecture.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 640 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`wrote ${out}`);