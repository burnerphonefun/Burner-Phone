// node scripts/mutations.mjs [url] — which DOM nodes change every frame while idle (MutationObserver over 3 s)
import { chromium } from 'playwright-core';
const [url = 'http://localhost:5207/?debug&still'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
const out = await p.evaluate(() => new Promise((res) => {
  const counts = new Map();
  const key = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; return (e?.tagName || '?').toLowerCase() + '.' + String(e?.className?.baseVal ?? e?.className ?? '').split(' ').slice(0, 2).join('.'); };
  const mo = new MutationObserver((ms) => { for (const m of ms) { const k = m.type + ' ' + key(m.target) + (m.attributeName ? '[' + m.attributeName + ']' : ''); counts.set(k, (counts.get(k) || 0) + 1); } });
  mo.observe(document.body, { subtree: true, attributes: true, characterData: true, childList: true });
  setTimeout(() => { mo.disconnect(); res([...counts].sort((a, b) => b[1] - a[1]).slice(0, 15)); }, 3000);
}));
for (const [k, n] of out) console.log(String((n / 3).toFixed(1)).padStart(6) + '/s ', k);
await b.close();
