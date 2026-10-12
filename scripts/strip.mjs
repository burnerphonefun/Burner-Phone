// node scripts/strip.mjs [url] [out.png] [--n=12] [--gap=250] [--clip=x,y,w,h] [--wait=6000]
// A frame strip of one region over time, to judge motion without a video.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; }));
const [url = 'http://localhost:5207/', out = 'strip.png'] = args.filter((a) => !a.startsWith('--'));
const n = +(flags.n || 12), gap = +(flags.gap || 250);
const [cx, cy, cw, ch] = (flags.clip || '940,200,420,700').split(',').map(Number);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(+(flags.wait || 6000));
const frames = [];
for (let i = 0; i < n; i++) {
  const t0 = Date.now();
  frames.push((await p.screenshot({ clip: { x: cx, y: cy, width: cw, height: ch }, type: 'jpeg', quality: 80 })).toString('base64'));
  const dt = gap - (Date.now() - t0);
  if (dt > 0) await p.waitForTimeout(dt);
}
const cols = Math.min(n, 6), w = 1800;
await p.setViewportSize({ width: w, height: 400 });
await p.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px;width:${w}px;box-sizing:border-box">${frames.map((f, i) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/jpeg;base64,${f}"><span style="position:absolute;left:4px;top:2px;color:#ff0;font:12px monospace">${i * gap}ms</span></div>`).join('')}</body>`);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
