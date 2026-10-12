// Contact sheet of manual frames: node scripts/scene-sheet.mjs <world> <t0> <t1> <step> [base] -> scratch/scene/sheet-<world>.png
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
const PW = process.env.PW || 'playwright-core';
const { chromium } = await import(pathToFileURL(PW).href);
const [world = 'city', a = '0', b = '60', st = '5', base = 'http://localhost:5191'] = process.argv.slice(2);
const out = 'shots/scene';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const ctx = await browser.newContext({ viewport: { width: 720, height: 450 } });
const page = await ctx.newPage();
await page.goto(`${base}/scene-test.html?world=${world}&manual&t=${a}&nohud`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
const shots = [];
for (let t = +a; t <= +b; t += +st) {
  await page.evaluate((t) => window.__world.renderAt(t), t);
  const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
  shots.push({ t, src: 'data:image/jpeg;base64,' + buf.toString('base64') });
}
const cols = 4;
const sheet = await ctx.newPage();
await sheet.setViewportSize({ width: 360 * cols, height: 225 * Math.ceil(shots.length / cols) });
await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},360px);background:#000">${shots.map((s) => `<div style="position:relative"><img src="${s.src}" style="width:360px;height:225px;display:block"><b style="position:absolute;left:4px;top:2px;color:#fff;font:12px monospace;text-shadow:0 1px 2px #000">t=${s.t}</b></div>`).join('')}</body>`);
await sheet.screenshot({ path: `${out}/sheet-${world}.png`, fullPage: true });
await browser.close();
console.log(`${out}/sheet-${world}.png`);
