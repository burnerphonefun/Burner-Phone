// node scripts/brand-apply.mjs — puts the mark from scripts/brand-mark.mjs (the X profile picture) on the site:
//   web/public/favicon.svg (bold, on black), apple-touch-icon.png (180), icon-512.png, og.png (1200x630 link preview)
// Then: node scripts/desktop-build.mjs icon (app + tray icons from favicon.svg), node scripts/readme-art.mjs (README art).
import { chromium } from 'playwright-core';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { markSvg, tileSvg } from './brand-mark.mjs';

const APP = resolve(import.meta.dirname, '..');
const PUB = join(APP, 'web', 'public');
const PLATES = join(APP, 'web', 'src', 'teaser', 'plates');

writeFileSync(join(PUB, 'favicon.svg'), tileSvg({ bold: true, crop: 0.78, radius: 0.22 }));
console.log('web/public/favicon.svg');

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function render(html, file, w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&family=Geist:wght@500;650&display=block" rel="stylesheet">
    <style>*{margin:0;box-sizing:border-box}html,body{background:transparent}svg{display:block}</style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: file, omitBackground: true });
  await p.close();
  console.log(file.replace(APP, '').replace(/\\/g, '/').slice(1));
}
const sized = (svg, w, h = w) => svg.replace('<svg ', `<svg width="${w}" height="${h}" `);
await render(sized(tileSvg({ radius: 0 }), 180), join(PUB, 'apple-touch-icon.png'), 180, 180);
await render(sized(tileSvg({ radius: 0.22 }), 512), join(PUB, 'icon-512.png'), 512, 512);

// the link preview: the mark, the wordmark, the line, three real phones coming up out of the bottom (the teaser plates
// come from a frozen, curated snapshot: no live names)
const plate = (n) => { const f = join(PLATES, n + '.png'); if (!existsSync(f)) throw new Error('missing plate ' + n + ' (node scripts/teaser-plates.mjs --stories=any)'); return 'data:image/png;base64,' + readFileSync(f).toString('base64'); };
const og = `<div style="position:relative;width:1200px;height:630px;overflow:hidden;background:radial-gradient(circle at 80% 30%,rgba(255,90,31,.3),rgba(255,90,31,.07) 40%,rgba(255,90,31,0) 62%),#000;color:#FFF4E6;font-family:Geist,sans-serif">
  ${[['any-toon-pump', 760, 168, -10, 330], ['any-tactical-lock', 1010, 168, 10, 330], ['any-list', 868, 100, 0, 360]].map(([n, x, y, r, w]) => `<img src="${plate(n)}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;transform:rotate(${r}deg);filter:drop-shadow(0 26px 36px rgba(0,0,0,.7))">`).join('')}
  <div style="position:absolute;left:64px;top:150px">${sized(markSvg({ crop: 0.78 }), 150)}</div>
  <div style="position:absolute;left:64px;top:318px;font:900 118px/.86 'Big Shoulders Display',sans-serif;letter-spacing:.045em;white-space:nowrap">BURNER<span style="color:#FF5A1F">PHONE</span></div>
  <div style="position:absolute;left:68px;top:436px;font:650 32px Geist,sans-serif">a burner phone for your bags.</div>
  <div style="position:absolute;left:68px;top:486px;font:500 22px Geist,sans-serif;color:rgba(255,244,230,.72)">live pump.fun over any game · windows · open source</div>
</div>`;
await render(og, join(PUB, 'og.png'), 1200, 630);
await browser.close();
