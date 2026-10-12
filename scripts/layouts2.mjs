// bisect idle layouts: hide one selector at a time while the world runs
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5207/?debug&still', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
const rate = async (label, css) => {
  await p.evaluate((c) => { let s = document.getElementById('bisect'); if (!s) { s = document.createElement('style'); s.id = 'bisect'; document.head.append(s); } s.textContent = c; }, css);
  await p.waitForTimeout(700);
  const a = await m(); await p.waitForTimeout(3000); const z = await m();
  console.log(label.padEnd(30), 'layouts/s', ((z.LayoutCount - a.LayoutCount) / 3).toFixed(1));
};
await rate('nothing hidden', '');
await rate('hud hidden', '.hud{display:none!important}');
await rate('phone layer hidden', '.bp-layer{display:none!important}');
await rate('hands hidden', '.bp-hand-wrap{display:none!important}');
await rate('screen hidden', '.bp-screen{display:none!important}');
await rate('pump list hidden', '.bp-list{display:none!important}');
await rate('rig no will-change', '.bp-rig{will-change:auto!important}');
await rate('canvas hidden', '.st-world{display:none!important}');
await rate('banner layer hidden', '.bn-layer{display:none!important}');
await b.close();
