// Takes one camera shot per game on the local site and saves the stamped PNGs: node scripts/cam-shots.mjs [outDir] [base]
// Buys a paper bag first so the stamp has a coin on it. Localhost only.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || 'cam-shots';
const base = process.argv[3] || 'http://localhost:5207';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) throw new Error('local only');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const worlds = ['blocky', 'toon', 'tactical', 'obby', 'survival', 'city'];
for (const w of worlds) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${base}/?debug&still&world=${w}`);
  await page.waitForFunction(() => window.net?.lists?.rising?.length > 0, null, { timeout: 20000 });
  await page.evaluate(async () => {
    const m = window.net.lists.rising[0];
    await window.wallet.buy(window.net.coin(m), 0.5);
    window.phone.open('camera');
  });
  await page.waitForTimeout(1500);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('.bp-cam-shutter').click()]);
  await dl.saveAs(join(out, `cam-${w}.png`));
  console.log(w, 'saved', errs.length ? 'errors: ' + errs.join(' | ') : 'no errors');
  await ctx.close();
}
await browser.close();
