// node scripts/fps-worlds.mjs [url] [--soft] — fps per world on this GPU, or on software rendering (--soft) as a weak-GPU stand-in
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://localhost:5207/';
const soft = args.includes('--soft');
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: soft ? ['--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url + '?debug&still', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
for (const w of ['blocky', 'toon', 'tactical', 'obby', 'survival', 'city']) {
  await p.evaluate(async (id) => { await window.setWorld(id); }, w);
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last; const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else res({ fps: Math.round(n / 3), worst: Math.round(worst), pr: window.getWorld()?.renderer?.getPixelRatio?.() }); }; requestAnimationFrame(f); }));
  console.log(w.padEnd(9), JSON.stringify(r));
}
await b.close();
