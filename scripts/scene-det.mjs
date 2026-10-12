// node scripts/scene-det.mjs world — where do two renders of the same t differ (after rendering a different t in between)?
import { chromium } from 'playwright-core';
const world = process.argv[2] || 'toon';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
await p.goto(`http://localhost:5241/scene-test.html?world=${world}&manual&t=0&nohud`);
await p.waitForSelector('body[data-ready="1"]');
const r = await p.evaluate(() => {
  const w = window.__world;
  const grab = () => { const c = w.snapshot(320, 200); return c.getContext('2d').getImageData(0, 0, 320, 200).data; };
  w.renderAt(12.5); const a = grab();
  w.renderAt(12.5); const a2 = grab();
  w.renderAt(3); w.renderAt(12.5); const b = grab();
  let n = 0, n2 = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - a2[i]) + Math.abs(a[i + 1] - a2[i + 1]) > 6) n2++;
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 0) { n++; const px = (i / 4) % 320, py = (i / 4 / 320) | 0; x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  }
  return { sameTwice: n2, diffAfterOther: n, box: [x0, y0, x1, y1] };
});
console.log(world, JSON.stringify(r));
await b.close();
