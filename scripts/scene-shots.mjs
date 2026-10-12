// Screenshots + fps for the 3D worlds. Uses a playwright-core from another factory product (not a dependency here).
// node scripts/scene-shots.mjs [base=http://localhost:5173] [outDir]   GPU=1 for the real GPU
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const PW = process.env.PW || 'playwright-core';
const { chromium } = await import(pathToFileURL(PW).href);

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'shots/scene';
mkdirSync(out, { recursive: true });
const only = process.env.ONLY; // e.g. "city" / "blocky"
const args = process.env.GPU ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ channel: 'chrome', args });
const race = (p, ms, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout ' + what)), ms))]);

const measure = (page, ms = 5000) => page.evaluate((ms) => new Promise((res) => {
  let n = 0, worst = 0, last = performance.now(); const t0 = last;
  const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res({ fps: +(n / ((t - t0) / 1000)).toFixed(1), worst: Math.round(worst) }); };
  requestAnimationFrame(f);
}), ms);

for (const world of ['city', 'blocky']) {
  if (only && only !== world) continue;
  for (const [vw, vh, tag] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
    const t0 = Date.now();
    await race(page.goto(`${base}/scene-test.html?world=${world}&nohud`, { waitUntil: 'domcontentloaded' }), 30000, 'goto');
    await race(page.waitForSelector('body[data-ready="1"]', { timeout: 60000 }), 61000, 'ready');
    const readyMs = Date.now() - t0;
    if (tag === 'd') console.log(world, 'gpu:', await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none'; }), 'ready', readyMs, 'ms');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${out}/${world}-${tag}-02s.png` });
    if (tag === 'd') {
      // motion strip: 10 frames over 2 s
      for (let i = 0; i < 10; i++) { await page.screenshot({ path: `${out}/${world}-strip-${i}.png`, clip: { x: 0, y: 0, width: vw, height: vh }, scale: 'css' }); await page.waitForTimeout(160); }
      console.log(world, 'fps', JSON.stringify(await measure(page)));
    }
    await page.waitForTimeout(tag === 'd' ? 9000 : 16000);
    await page.screenshot({ path: `${out}/${world}-${tag}-20s.png` });
    if (process.env.LONG && tag === 'd') { await page.waitForTimeout(40000); await page.screenshot({ path: `${out}/${world}-${tag}-60s.png` }); }
    if (logs.length) console.log(world, tag, 'console:', logs.slice(0, 8).join(' | '));
    await ctx.close();
  }
}
// manual + gray checks
if (!only || only === 'city') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const [q, name] of [['world=city&manual&t=12.5', 'city-t12'], ['world=city&manual&t=12.5', 'city-t12b'], ['world=city&gray=1', 'city-gray'], ['world=city&manual&t=40', 'city-t40'], ['world=blocky&manual&t=30', 'blocky-t30']]) {
    await page.goto(`${base}/scene-test.html?${q}&nohud`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
    await page.waitForTimeout(q.includes('gray') ? 2600 : 300);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log('shots in', out);
