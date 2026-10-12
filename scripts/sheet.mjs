// node scripts/sheet.mjs out.png cols width a.png b.png ... — a contact sheet so many shots can be judged in one look
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [out, cols = '4', width = '1600', ...files] = process.argv.slice(2);
const imgs = files.map((f) => `<figure><img src="data:image/${f.endsWith(".jpg")?"jpeg":"png"};base64,${readFileSync(f).toString('base64')}"><figcaption>${basename(f)}</figcaption></figure>`).join('');
const html = `<html><body style="margin:0;background:#222;color:#ddd;font:12px sans-serif;display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:6px;width:${width}px;box-sizing:border-box">
<style>figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 0}</style>${imgs}</body></html>`;
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage({ viewport: { width: +width, height: 400 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
