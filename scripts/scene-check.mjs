// node scripts/scene-check.mjs <world,...> [--base=http://localhost:5241] [--out=dir] [--ts=0,2,5,10,20] [--live] [--mobile] [--strip]
// Manual-mode frames (deterministic) at chosen times, plus optional live fps, motion strip, determinism + snapshot checks.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }));
const worlds = (args.find((a) => !a.startsWith('--')) || 'blocky').split(',');
const base = flags.base || 'http://localhost:5241';
const out = flags.out || 'shots/scene2';
const ts = String(flags.ts || '0,2,6,12,20').split(',').map(Number);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const race = (p, ms, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout ' + what)), ms))]);

for (const world of worlds) {
  const views = [[1440, 900, 'd']];
  if (flags.mobile) views.push([390, 844, 'm']);
  for (const [vw, vh, tag] of views) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
    const t0 = Date.now();
    await race(page.goto(`${base}/scene-test.html?world=${world}&manual&t=0&nohud`, { waitUntil: 'domcontentloaded' }), 30000, 'goto');
    await race(page.waitForSelector('body[data-ready="1"]', { timeout: 60000 }), 61000, 'ready');
    const build = await page.evaluate(() => window.__buildMs || null);
    if (tag === 'd') console.log(world, 'ready', Date.now() - t0, 'ms', build ? 'build ' + build + ' ms' : '');
    for (const t of ts) {
      await page.evaluate((t) => window.__world.renderAt(t), t);
      await page.screenshot({ path: `${out}/${world}-${tag}-t${t}.png` });
    }
    if (tag === 'd' && flags.det) {
      const a = await page.evaluate(() => { window.__world.renderAt(12.5); return window.__world.snapshot(320, 200).toDataURL(); });
      const b = await page.evaluate(() => { window.__world.renderAt(3); window.__world.renderAt(12.5); return window.__world.snapshot(320, 200).toDataURL(); });
      console.log(world, 'deterministic', a === b, 'snapshot bytes', a.length);
    }
    if (logs.length) console.log(world, tag, 'console:', logs.slice(0, 6).join(' | '));
    await ctx.close();
  }
  if (flags.live || flags.strip) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/scene-test.html?world=${world}&nohud`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
    await page.waitForTimeout(1500);
    if (flags.strip) for (let i = 0; i < 10; i++) { await page.screenshot({ path: `${out}/${world}-strip-${i}.png`, type: 'jpeg', quality: 70 }); await page.waitForTimeout(150); }
    if (flags.live) {
      const r = await page.evaluate(() => new Promise((res) => {
        let n = 0, worst = 0, last = performance.now(); const t0 = last;
        const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 5000) requestAnimationFrame(f); else res({ fps: +(n / ((t - t0) / 1000)).toFixed(1), worst: Math.round(worst), info: window.__world.info() }); };
        requestAnimationFrame(f);
      }));
      console.log(world, 'live', JSON.stringify(r));
    }
    await ctx.close();
  }
}
await browser.close();
console.log('out', out);
