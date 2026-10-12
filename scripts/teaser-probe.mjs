// node scripts/teaser-probe.mjs [t1,t2,...] — a contact sheet of every world at a few world times (to pick each shot's wt0)
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, 'node_modules/.teaser/probe');
mkdirSync(TMP, { recursive: true });
const ts = (process.argv[2] || '1,6,14,24,40').split(',').map(Number);
const worlds = (process.argv[3] || 'blocky,toon,tactical,obby,survival,city').split(',');
const PORT = 5232;
const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => vite.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/teaser.html?story=games`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.ready);
  const files = [];
  for (const w of worlds) for (const t of ts) {
    const url = await page.evaluate(([w, t]) => window.probe(w, t), [w, t]);
    const f = join(TMP, `${w}-${String(t).padStart(5, '0')}.jpg`);
    writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); files.push(f);
  }
  execFileSync(process.execPath, [join(ROOT, 'scripts/sheet.mjs'), join(TMP, 'sheet.png'), String(ts.length), '2200', ...files], { stdio: 'inherit' });
} finally { await browser.close(); vite.kill(); }
