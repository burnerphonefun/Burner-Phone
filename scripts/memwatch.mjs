// node scripts/memwatch.mjs [url] [minutes] — DOM nodes, listeners and JS heap over time (forced GC), to catch growth
import { chromium } from 'playwright-core';

const [url = 'http://localhost:5207/', mins = '5'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
const cdp = await p.context().newCDPSession(p);
await cdp.send('Performance.enable');
const sample = async () => {
  await p.evaluate(() => window.gc && window.gc());
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const dom = await p.evaluate(() => document.getElementsByTagName('*').length);
  return { dom, nodes: m.Nodes, listeners: m.JSEventListeners, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), layouts: m.LayoutCount, styles: m.RecalcStyleCount };
};
const end = Date.now() + +mins * 60e3;
let i = 0;
while (Date.now() < end) {
  await p.waitForTimeout(i === 0 ? 8000 : 30000);
  const s = await sample();
  console.log(`${String(Math.round((Date.now() - (end - mins * 60e3)) / 1000)).padStart(4)}s`, JSON.stringify(s));
  i++;
}
console.log(errs.length ? 'errors:\n  ' + [...new Set(errs)].join('\n  ') : 'no errors');
await b.close();
