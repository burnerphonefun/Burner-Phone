// node scripts/amount-test.mjs [url] [--mobile] — the any-amount keypad in the real phone (paper wallet, localhost only):
// set the list's buy size to 0.37 by typing, buy with it, open the chart, buy "any" 0.2 by keyboard, sell "any %" 33,
// and check the wallet moved by exactly those amounts. Screenshots each sheet.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const [url = 'http://localhost:8790/', out = 'shots/amount'] = args.filter((a) => !a.startsWith('--'));
if (!/localhost|127\.0\.0\.1/.test(url)) { console.error('amount-test spends paper SOL: localhost only'); process.exit(1); }
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'debug');
await page.waitForFunction(() => window.wallet && document.querySelector('.bp-pump .bp-row .bp-buy'), null, { timeout: 30000 });
await page.waitForTimeout(mobile ? 6500 : 3800); // let the intro unlock the phone
await page.evaluate(() => { if (window.phone.view() === 'lock') window.phone.unlock(); });
await page.waitForTimeout(800);
const sol = () => page.evaluate(() => window.wallet.state.sol);
const shot = (n) => page.screenshot({ path: `${out}/${mobile ? 'm' : 'd'}-${n}.png` });
const tap = async (sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(120); };
const keys = async (s) => { for (const k of s) await page.locator(`.bp-amt-pad button[data-k="${k}"]`).click(); };

// 1. the list's buy size: tap it, type 0.37 on the keypad, use it
await tap('.bp-pump .bp-size');
await page.waitForSelector('.bp-amt-sheet.bp-on');
await keys('0.37');
await shot('1-size');
assert.match(await page.locator('.bp-amt-go').textContent(), /use 0\.37 SOL/);
await tap('.bp-amt-go');
await page.waitForTimeout(400);
assert.match(await page.locator('.bp-pump .bp-size').textContent(), /0\.37/);
assert.match(await page.locator('.bp-pump .bp-row .bp-buy').first().textContent(), /0\.37/);
const s0 = await sol();
await tap('.bp-pump .bp-row .bp-buy');
await page.waitForTimeout(900);
const s1 = await sol();
assert.ok(Math.abs(s0 - s1 - 0.37) < 1e-9, `a one-tap buy spends the typed size (spent ${s0 - s1})`);
const mint = await page.evaluate(() => Object.keys(window.wallet.state.pos)[0]);

// 2. the chart: "buy any" with the keyboard (0.2 + Enter), then "any %" 33 with the keypad
await page.evaluate((m) => window.phone.open('chart', m), mint);
await page.waitForTimeout(900);
await tap('.bp-ch-buys .bp-ch-any');
await page.waitForSelector('.bp-amt-sheet.bp-on');
await page.keyboard.type('0.2');
await shot('2-buy-any');
assert.match(await page.locator('.bp-amt-go').textContent(), /buy 0\.2 SOL/);
const worldBefore = await page.evaluate(() => document.body.dataset.world);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
const s2 = await sol();
assert.ok(Math.abs(s1 - s2 - 0.2) < 1e-9, `buy any spends what was typed (spent ${s1 - s2})`);
assert.equal(await page.evaluate(() => document.body.dataset.world), worldBefore, 'typing "2" did not switch worlds');
const tokensBefore = await page.evaluate((m) => window.wallet.state.pos[m]?.tokens, mint);
await tap('.bp-ch-sells .bp-ch-any');
await page.waitForSelector('.bp-amt-sheet.bp-on');
await keys('33');
await shot('3-sell-any');
assert.match(await page.locator('.bp-amt-go').textContent(), /sell 33%/);
assert.match(await page.locator('.bp-amt-note').textContent(), /of your/);
await tap('.bp-amt-go');
await page.waitForTimeout(900);
const tokensAfter = await page.evaluate((m) => window.wallet.state.pos[m]?.tokens, mint);
assert.ok(Math.abs(tokensAfter / tokensBefore - 0.67) < 1e-6, `sold 33% (kept ${(tokensAfter / tokensBefore).toFixed(4)})`);

// 3. guard rails: more than the balance can't be bought, more than 100% can't be sold, Escape closes
await tap('.bp-ch-buys .bp-ch-any');
await keys('9999');
assert.equal(await page.locator('.bp-amt-go').isDisabled(), true, 'over the balance is refused');
assert.match(await page.locator('.bp-amt-go').textContent(), /you have/);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
assert.equal(await page.locator('.bp-amt-sheet').count(), 0, 'Escape closes the sheet');
await tap('.bp-ch-sells .bp-ch-any');
await keys('150');
assert.equal(await page.locator('.bp-amt-go').isDisabled(), true, 'over 100% is refused');
await tap('.bp-amt-x');
await page.waitForTimeout(400);
await shot('4-done');
await browser.close();
assert.deepEqual(errs, [], 'no console errors');
console.log(`amount ok (${mobile ? 'mobile' : 'desktop'}): size 0.37 → bought 0.37, buy any 0.2, sell any 33%, limits hold`);
