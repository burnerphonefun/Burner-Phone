// node scripts/banner-kit.mjs [--out=../launch/banner] [--guides] — 1500x500 banners for X and DEX Screener, from the real
// phone plates (web/src/teaser/plates, made by teaser-plates.mjs), the world posters and the X profile picture's mark (scripts/brand-mark.mjs).
// Writes <out>/banner-<id>.png (1500x500), -2x.png (3000x1000), .jpg, and sheet.png; --guides also draws the crop zones.
// X covers the bottom-left with the profile picture (~x 40-380, y 330-500 at 1500 wide): nothing important goes there.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { markSvg } from './brand-mark.mjs';

const APP = resolve(import.meta.dirname, '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || d;
const OUT = resolve(APP, arg('out', '../launch/banner'));
const GUIDES = process.argv.includes('--guides');
mkdirSync(OUT, { recursive: true });

const data = (f) => { const p = resolve(APP, f); if (!existsSync(p)) throw new Error('missing ' + f); return `data:image/${p.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(p).toString('base64')}`; };
const PLATES = 'web/src/teaser/plates/';
const MARK = markSvg({ crop: 0.78 }); // the X profile picture's mark (scripts/brand-mark.mjs)
const PFP = resolve(APP, '../launch/logo/x-pfp/x-pfp-400.jpg'); // the real picture, for the preview's avatar
const C = { ink: '#0B0A09', paper: '#FFF4E6', burn: '#FF5A1F', gold: '#FFC23D', blood: '#E8233A', up: '#2BE07A' };
const WORLDS = ['blocky', 'toon', 'tactical', 'obby', 'survival', 'city'];

const css = `
  *{box-sizing:border-box;margin:0}
  body{width:1500px;height:500px;overflow:hidden;background:${C.ink};font-family:Geist,system-ui,sans-serif;color:${C.paper};-webkit-font-smoothing:antialiased}
  .b{position:relative;width:1500px;height:500px;overflow:hidden;background:${C.ink}}
  .abs{position:absolute}
  .word{font:900 var(--ws,118px)/.86 'Big Shoulders Display',Impact,sans-serif;letter-spacing:.045em;white-space:nowrap}
  .word span{color:${C.burn}}
  .lock{display:flex;align-items:center;gap:18px}
  .lock svg{width:var(--ms,104px);height:var(--ms,104px);flex:none}
  .tag{font-weight:650;font-size:30px;letter-spacing:-.3px}
  .sub{font-weight:500;font-size:20px;color:rgba(255,244,230,.72)}
  .chips{display:flex;gap:10px}
  .chips i{font-style:normal;font-weight:650;font-size:16px;padding:8px 14px;border-radius:999px;background:rgba(255,244,230,.1);border:1px solid rgba(255,244,230,.18)}
  .chips i.on{background:${C.burn};border-color:${C.burn};color:#170700}
  .tick{font:900 34px/1 'Big Shoulders Display',Impact,sans-serif;letter-spacing:.06em;color:${C.gold}}
  .guide{position:absolute;pointer-events:none;border:3px dashed rgba(0,255,255,.9)}
`;
const fonts = `<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&family=Geist:wght@500;600;650;700&display=block" rel="stylesheet">`;
const guides = `<div class="guide" style="left:40px;top:330px;width:340px;height:340px;border-radius:50%"></div>`;

const lockup = (ws, ms) => `<div class="lock" style="--ws:${ws}px;--ms:${ms}px">${MARK}<div class="word">BURNER<span>PHONE</span></div></div>`;

const BANNERS = {
  // A. six worlds, one phone: the worlds as slanted slices, the glass phone with the live list in a hand
  worlds: `<div class="b">
    <div class="abs" style="left:-120px;top:0;height:500px;display:flex">
      ${WORLDS.map((w) => `<div style="width:300px;height:500px;transform:skewX(-14deg);overflow:hidden;border-right:6px solid ${C.ink}">
        <div style="width:420px;height:500px;margin-left:-60px;transform:skewX(14deg);background:url(${data('web/public/poster-' + w + '.jpg')}) center/cover"></div></div>`).join('')}
    </div>
    <div class="abs" style="inset:0;background:linear-gradient(90deg,rgba(8,6,12,.94) 0%,rgba(8,6,12,.86) 34%,rgba(8,6,12,.35) 62%,rgba(8,6,12,.15) 100%)"></div>
    <div class="abs" style="inset:0;background:linear-gradient(0deg,rgba(8,6,12,.55) 0%,rgba(8,6,12,0) 30%)"></div>
    <div class="abs" style="right:-8px;bottom:-250px;width:500px;height:697px;background:url(${data(PLATES + 'any-list.png')}) top center/contain no-repeat;filter:drop-shadow(0 30px 40px rgba(0,0,0,.6))"></div>
    <div class="abs" style="left:64px;top:62px">${lockup(124, 112)}</div>
    <div class="abs tag" style="left:66px;top:206px">a burner phone for your bags.</div>
    <div class="abs sub" style="left:66px;top:250px;width:640px">press a key in any game and live pump.fun comes up in your hand.</div>
    <div class="abs chips" style="left:430px;top:346px"><i class="on">$BURNERPHONE</i><i>6 games · 1 phone</i><i>windows · open source</i></div>
  </div>`,

  // B. the rug moment: a grey city, WASTED, the phone ringing with RUG ALERT
  rug: `<div class="b">
    <div class="abs" style="inset:-20px;background:url(${data('web/public/poster-city.jpg')}) center 60%/cover;filter:grayscale(.88) contrast(1.15) brightness(.55)"></div>
    <div class="abs" style="inset:0;background:radial-gradient(ellipse at 76% 50%,rgba(232,35,58,.35),rgba(232,35,58,0) 46%),radial-gradient(ellipse at 40% 55%,rgba(0,0,0,0) 30%,rgba(10,0,2,.75) 100%)"></div>
    <div class="abs" style="left:56px;top:46px">${lockup(64, 58)}</div>
    <div class="abs" style="left:404px;top:150px;font:900 186px/.82 'Big Shoulders Display',Impact,sans-serif;letter-spacing:.05em;color:${C.blood};-webkit-text-stroke:8px #120204;paint-order:stroke fill;text-shadow:0 10px 0 #3a0008;transform:rotate(-3deg)">WASTED</div>
    <div class="abs" style="left:432px;top:346px;padding:10px 20px;border-radius:10px;background:rgba(0,0,0,.66);font:600 24px Geist,sans-serif">your phone rang before your bag hit zero</div>
    <div class="abs" style="right:40px;bottom:-286px;width:520px;height:725px;background:url(${data(PLATES + 'city-ring.png')}) top center/contain no-repeat;transform:rotate(4deg);filter:drop-shadow(0 0 40px rgba(232,35,58,.55))"></div>
    <div class="abs tick" style="left:566px;top:62px;color:${C.gold}">$BURNERPHONE</div>
  </div>`,

  // C. clean: ink, a burn glow, the big wordmark, three phones fanned out
  clean: `<div class="b" style="background:radial-gradient(circle at 80% 35%,rgba(255,90,31,.3),rgba(255,90,31,.07) 38%,rgba(255,90,31,0) 60%),#000">
    <svg class="abs" style="left:0;top:0" width="1500" height="500" viewBox="0 0 1500 500"><g fill="none" stroke="${C.burn}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" opacity=".13"><polyline points="420,560 700,300 850,440 1230,40"/><polyline points="1060,46 1240,34 1236,214"/></g></svg>
    ${[['any-toon-pump', -150, 92, -10, 360], ['any-tactical-lock', 176, 92, 10, 360], ['any-list', 0, 40, 0, 384]].map(([pl, dx, y, r, w]) => `<img class="abs" src="${data(PLATES + pl + '.png')}" style="left:${1082 + dx}px;top:${y}px;width:${w}px;transform:rotate(${r}deg);filter:drop-shadow(0 26px 36px rgba(0,0,0,.6))">`).join('')}
    <div class="abs" style="left:70px;top:76px">${lockup(118, 104)}</div>
    <div class="abs tag" style="left:72px;top:214px;font-size:32px">a burner phone for your bags.</div>
    <div class="abs sub" style="left:72px;top:262px;font-size:21px">press alt+q in any game. live pump.fun, one tap to buy or sell.</div>
    <div class="abs chips" style="left:430px;top:348px"><i class="on">$BURNERPHONE</i><i>paper or your own wallet</i><i>open source</i></div>
  </div>`,
};

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const shots = [];
for (const [id, body] of Object.entries(BANNERS)) {
  for (const dpr of [1, 2]) {
    const p = await browser.newPage({ viewport: { width: 1500, height: 500 }, deviceScaleFactor: dpr });
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${css}</style></head><body>${body}${GUIDES && dpr === 1 ? guides : ''}</body></html>`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    const base = join(OUT, `banner-${id}${dpr === 2 ? '-2x' : ''}${GUIDES && dpr === 1 ? '-guides' : ''}`);
    await p.screenshot({ path: base + '.png' });
    if (!GUIDES) await p.screenshot({ path: base + '.jpg', type: 'jpeg', quality: 92 });
    if (dpr === 1) shots.push(base + '.png');
    await p.close();
  }
  console.log('banner', id);
}
// one sheet to compare, each with an X profile picture where X puts it
const sp = await browser.newPage({ viewport: { width: 1560, height: 1700 } });
await sp.setContent(`<!doctype html><html><body style="margin:0;padding:30px;background:#141110;font:600 22px system-ui;color:#fff4e6">
  ${shots.map((f, i) => `<div style="margin-bottom:26px"><div style="margin-bottom:8px">${'ABC'[i]} · ${Object.keys(BANNERS)[i]}</div><div style="position:relative;width:1500px;height:500px">
    <img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="display:block;width:1500px;height:500px;border-radius:12px">
    <div style="position:absolute;left:44px;top:340px;width:300px;height:300px;border-radius:50%;background:#0B0A09;border:8px solid #141110;display:grid;place-items:center;overflow:hidden"><img src="data:image/jpeg;base64,${readFileSync(PFP).toString('base64')}" width="284" height="284" style="border-radius:50%"></div></div></div>`).join('')}
</body></html>`);
await sp.screenshot({ path: join(OUT, 'sheet.png'), fullPage: true });
await browser.close();
console.log('sheet → ' + join(OUT, 'sheet.png'));
