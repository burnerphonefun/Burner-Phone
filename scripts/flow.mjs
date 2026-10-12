// node scripts/flow.mjs [url] [outDir] [--mobile] — clicks through every phone app like a stranger would,
// screenshots each step and the banners, and fails loudly on console errors. Localhost only (paper wallet).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const [url = 'http://localhost:5207/', out = 'shots/flow'] = args.filter((a) => !a.startsWith('--'));
if (!/localhost|127\.0\.0\.1/.test(url) && !args.includes('--live-ok')) { console.error('flow writes a paper wallet: localhost only'); process.exit(1); }
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const shot = async (n) => { await page.screenshot({ path: join(out, (mobile ? 'm-' : 'd-') + n + '.png') }); console.log('shot', n); };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, e.message.split('\n')[0]); errs.push('step ' + name); } };

await page.goto(url + (url.includes('?') ? '&' : '?') + 'debug', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5500);
await shot('01-pump');
await step('buy', async () => { await page.locator('.bp-row .bp-buy').first().click({ timeout: 5000 }); await page.waitForTimeout(500); await shot('02-bought'); });
await step('chart', async () => { await page.locator('.bp-row').nth(1).click({ timeout: 5000 }); await page.waitForTimeout(3500); await shot('03-chart'); });
await step('chart-buy', async () => { if (await page.locator('.bp-call.bp-call-on').count()) await page.locator('.bp-call-hold').click(); await page.locator('.bp-ch-buys button').nth(1).click({ timeout: 5000 }); await page.waitForTimeout(1500); await shot('04-chart-held'); });
await step('bags', async () => { await page.locator('.bp-tab[data-app="bags"]').click(); await page.waitForTimeout(900); await shot('05-bags'); });
await step('wallet', async () => { await page.locator('.bp-tab[data-app="wallet"]').click(); await page.waitForTimeout(900); await shot('06-wallet'); });
await step('home', async () => { if (await page.locator('.bp-homebar').isVisible()) { await page.locator('.bp-homebar').click(); await page.waitForTimeout(900); await shot('07-home'); } });
await step('camera', async () => { await page.locator('.bp-tab[data-app="camera"]').click(); await page.waitForTimeout(1500); await shot('08-camera'); });
await step('pump-back', async () => { await page.locator('.bp-cam-close').click(); await page.waitForTimeout(600); });
await step('wasted', async () => {
  await page.evaluate(() => { window.phone.banners.wasted({ sym: '$???', loss: 1.84, reason: 'dump' }); });
  await page.waitForTimeout(1300); await shot('09-wasted');
  await page.waitForTimeout(3000);
});
await step('passed', async () => {
  await page.evaluate(() => { window.phone.banners.passed({ sym: '$GRATIN', profit: 2.31, x: 3.3 }); });
  await page.waitForTimeout(1600); await shot('10-passed');
  await page.waitForTimeout(2500);
});
if (!mobile) {
  await step('lower', async () => { await page.keyboard.press('q'); await page.waitForTimeout(900); await shot('11-down'); await page.keyboard.press('q'); await page.waitForTimeout(900); });
  for (const w of ['toon', 'tactical', 'obby', 'survival', 'city', 'blocky']) await step('world-' + w, async () => { await page.locator('.st-pick[data-world="' + w + '"]').click(); await page.waitForTimeout(2600); await shot('12-' + w); });
  await step('ach', async () => { await page.evaluate(() => { window.phone.banners.achievement({ title: 'Diamond hands', text: 'held $DUNA through -50%' }); }); await page.waitForTimeout(900); await shot('13-ach'); });
}
console.log(errs.length ? 'ERRORS:\n  ' + [...new Set(errs)].join('\n  ') : 'no console errors');
await browser.close();
