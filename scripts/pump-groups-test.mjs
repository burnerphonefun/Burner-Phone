// node scripts/pump-groups-test.mjs [url] — the New list's copycat handling, in the real phone (?debug), on a controlled
// set of coins pushed through the page's own store: bursts linked by a name OR a ticker are one row "×N" at the newest
// launch's slot, led by the most money; the rest keeps its order; a later same-name launch elsewhere gets "copy".
// Localhost only (it rewrites the page's coin store).
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const url = process.argv[2] || 'http://localhost:8790/';
if (!/localhost|127\.0\.0\.1/.test(url)) { console.error('pump-groups-test rewrites the coin store: localhost only'); process.exit(1); }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'debug');
await page.waitForFunction(() => window.net && document.querySelector('.bp-pump'));
await page.waitForTimeout(1500);
const shown = await page.evaluate(async () => {
  const net = window.net, now = Date.now();
  net.connect = () => {}; // keep the live feed from overwriting the test store
  for (const ws of [net.ws].filter(Boolean)) try { ws.close(); } catch {}
  const coin = (mint, name, symbol, ageS, mc) => ({ mint, name, symbol, created: now - ageS * 1000, mc, p: null, img: '' });
  const set = [
    coin('t-a1', 'Crazy Tek Coin', 'CRAZY TEK', 5, 3000),
    coin('t-u1', 'Unrelated Thing', 'UNREL', 8, 4000),
    coin('t-a2', 'The Crazy Tek', 'CRAZY TEK', 12, 9000), // same ticker, different name
    coin('t-a3', 'CRAZYTEK', 'CTEK', 20, 3100),           // shares a name with t-a4 only
    coin('t-a4', 'crazytek', 'CRAZY TEK', 25, 3000),       // links the ticker group and the name group
    coin('t-s1', 'Solo Test', 'SOLOT', 30, 3000),
    coin('t-old', 'Solo Test', 'SOLOT', 600, 50000),       // older, not in the list: makes t-s1 a copy
  ];
  net.coins.clear();
  for (const c of set) net.coins.set(c.mint, c);
  net.lists.new = ['t-a1', 't-u1', 't-a2', 't-a3', 't-a4', 't-s1'];
  // switch tabs away and back: a full re-render from the store
  const seg = [...document.querySelectorAll('.bp-pump .bp-seg button')];
  seg.find((b) => b.dataset.tab === 'rising').click();
  seg.find((b) => b.dataset.tab === 'new').click();
  await new Promise((r) => setTimeout(r, 400));
  return [...document.querySelectorAll('.bp-pump .bp-row:not(.bp-out)')].map((r) => ({
    name: r.querySelector('.bp-row-nm b').textContent,
    n: r.querySelector('.bp-row-nm small').dataset.n || null,
    copy: r.classList.contains('bp-copy'),
    y: +(r.style.transform.match(/,\s*(-?[\d.]+)px/)?.[1] ?? 0),
  })).sort((a, b) => a.y - b.y);
});
console.log(shown);
await browser.close();
assert.deepEqual(shown.map((s) => s.name), ['The Crazy Tek', 'Unrelated Thing', 'Solo Test'], 'four Crazy Tek launches fold into one row at the top slot, led by the most money ($9K)');
assert.equal(shown[0].n, '4', 'the burst says ×4');
assert.equal(shown[1].copy, false, 'an unrelated launch is not a copy');
assert.equal(shown[2].copy, true, 'a later Solo Test is a copy of the older one');
console.log('pump groups ok');
