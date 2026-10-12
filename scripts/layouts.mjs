import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5207/?debug&still', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
async function rate(label, setup) {
  if (setup) await p.evaluate(setup);
  await p.waitForTimeout(800);
  const a = await m(); await p.waitForTimeout(4000); const z = await m();
  console.log(label.padEnd(26), 'layouts/s', ((z.LayoutCount - a.LayoutCount) / 4).toFixed(1), 'styles/s', ((z.RecalcStyleCount - a.RecalcStyleCount) / 4).toFixed(1));
}
await rate('everything');
await rate('world stopped', () => window.getWorld().stop());
await rate('+ phone hidden', () => window.phone.setHidden(true));
await rate('+ hud hidden', () => { for (const e of document.querySelectorAll('.hud')) e.style.display = 'none'; });
await rate('world back on', () => window.getWorld().start());
await b.close();
