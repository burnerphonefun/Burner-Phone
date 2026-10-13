// node scripts/logo-kit.mjs [--out=../launch/logo] — the BurnerPhone logo directions, their lockups and a comparison sheet.
// Marks are pure vector paths on a 512 grid; wordmarks embed only the glyphs they use of Big Shoulders Display 900 (OFL).
// Writes <out>/<id>.svg (+ -icon on ink, -lockup-h, -lockup-v), PNGs at 1024/512/400/64/32/16 and sheet.png.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { markInner } from './brand-mark.mjs';

const APP = resolve(import.meta.dirname, '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || d;
const OUT = resolve(APP, arg('out', '../launch/logo'));
mkdirSync(OUT, { recursive: true });

const C = { ink: '#0B0A09', ink2: '#1C1613', paper: '#FFF4E6', burn: '#FF5A1F', gold: '#FFC23D', ember: '#B83A0E', hi: '#FF8B52' };

// ---------- the flame: one shape, nested three times (burn, gold, paper core) ----------
// unit flame: bottom centre at (0,0), 160 wide, 240 tall
const UNIT = [
  ['M', 0, -240],
  ['C', 6, -190, 80, -160, 80, -80],
  ['A', 80, 80, 0, 0, 1, -80, -80],
  ['C', -80, -128, -52, -154, -34, -176],
  ['C', -30, -152, -20, -136, -8, -132],
  ['C', -10, -168, -10, -204, 0, -240],
];
// sx < 1 makes a taller, narrower flame (the arc becomes an ellipse)
function flamePath(cx, by, s, sx = 1) {
  const p = (x, y) => `${+(cx + x * s * sx).toFixed(2)} ${+(by + y * s).toFixed(2)}`;
  return UNIT.map(([k, ...v]) => {
    if (k === 'A') return `A${+(v[0] * s * sx).toFixed(2)} ${+(v[1] * s).toFixed(2)} 0 0 1 ${p(v[5], v[6])}`;
    const pts = []; for (let i = 0; i < v.length; i += 2) pts.push(p(v[i], v[i + 1]));
    return k + pts.join(' ');
  }).join(' ') + 'Z';
}
// three nested layers; outline = an ink stroke around the outer layer (sticker style, separates it from what it crosses)
function flame(cx, by, s, cols = [C.burn, C.gold, C.paper], { sx = 1, outline = 0 } = {}) {
  return `<path d="${flamePath(cx, by, s, sx)}" fill="${cols[0]}"${outline ? ` stroke="${C.ink}" stroke-width="${outline}" stroke-linejoin="round" paint-order="stroke"` : ''}/>` +
    `<path d="${flamePath(cx, by - 10 * s, s * 0.64, sx)}" fill="${cols[1]}"/>` +
    `<path d="${flamePath(cx, by - 16 * s, s * 0.3, sx)}" fill="${cols[2]}"/>`;
}

// ---------- the five directions ----------
const MARKS = {
  // 0. in use: the X profile picture's mark (scripts/brand-mark.mjs), on its 400 grid scaled to 512
  x: { name: 'x profile (in use)', svg: `<g transform="scale(1.28)">${markInner()}</g>` },
  // 1. the phone + flame, redrawn: a wider body, side keys, the island, a three-tone flame
  phone: {
    name: 'phone + flame',
    svg: `<rect x="122" y="22" width="268" height="468" rx="70" fill="${C.burn}"/>
      <rect x="388" y="150" width="10" height="64" rx="4" fill="${C.ember}"/><rect x="114" y="132" width="10" height="44" rx="4" fill="${C.ember}"/><rect x="114" y="192" width="10" height="44" rx="4" fill="${C.ember}"/>
      <rect x="150" y="50" width="212" height="412" rx="44" fill="${C.ink}"/>
      <rect x="226" y="72" width="60" height="18" rx="9" fill="${C.ink2}"/>
      ${flame(256, 408, 1.02)}`,
  },
  // 2. the phone is on fire: tilted like it's held, the flame bursts out of the screen and over the frame
  burning: {
    name: 'burning phone',
    // the whole phone stays readable; only its top is alight, like a struck match
    svg: `<g transform="translate(256 256) scale(.95) translate(-256 -256)">
      <g transform="rotate(-14 260 356)">
        <rect x="154" y="200" width="212" height="300" rx="52" fill="${C.burn}"/>
        <rect x="362" y="272" width="10" height="52" rx="4" fill="${C.ember}"/>
        <rect x="178" y="226" width="164" height="250" rx="32" fill="${C.ink}"/>
        <rect x="200" y="392" width="120" height="14" rx="7" fill="${C.ink2}"/><rect x="200" y="420" width="84" height="14" rx="7" fill="${C.ink2}"/>
      </g>
      <g transform="rotate(-8 250 300)">${flame(250, 304, 1.06, [C.burn, C.gold, C.paper], { sx: 0.84, outline: 20 })}</g>
      <circle cx="356" cy="70" r="12" fill="${C.gold}"/><circle cx="392" cy="128" r="8" fill="${C.burn}"/><circle cx="146" cy="104" r="9" fill="${C.gold}"/>
    </g>`,
  },
  // 3. B monogram: the lower bowl's counter is a flame
  monogram: {
    name: 'B monogram',
    // condensed and squarish like the wordmark's B: two bowls with soft square corners, the lower one wider
    svg: `<path fill-rule="evenodd" fill="${C.burn}" d="M124 34H292Q376 34 376 118V160Q376 206 342 228Q400 248 400 318V390Q400 478 314 478H124Z
      M214 104H272Q290 104 290 122V156Q290 174 272 174H214Z ${flamePath(268, 418, 0.66, 0.92)}"/>
      ${flame(268, 404, 0.42, [C.gold, C.paper, C.paper], { sx: 0.92 })}`,
  },
  // 4. pixel: the same idea on a 16 grid, for the blocky world and anything tiny
  pixel: {
    name: 'pixel',
    grid: [
      '.....OOOOOOO....',
      '....HOOOOOOOOD..',
      '....HKKKKKKKOD..',
      '....HKKKKKKKOD..',
      '....HKKKKRKKOD..',
      '....HKKKRRKKOD..',
      '....HKKRRYRKOD..',
      '....HKRRYYRKOD..',
      '....HKRYYYRROD..',
      '....HRRYWYYROD..',
      '....HRYWWWYROD..',
      '....HRYWWWYROD..',
      '....HKRYYYRKOD..',
      '....HKKKKKKKOD..',
      '....HOOOOOOOOD..',
      '.....DDDDDDDD...',
    ],
  },
  // 5. the coin: the burning phone on an ink disc with a burn ring, for pump.fun / DEX Screener / X
  coin: {
    name: 'coin badge',
    svg: '', // filled in below from the burning phone
  },
};
// pixel grid → crisp rects (2 columns of padding on the right are trimmed by centring)
{
  const pal = { O: C.burn, H: C.hi, D: C.ember, K: C.ink, R: C.burn, Y: C.gold, W: C.paper };
  const g = MARKS.pixel.grid, cell = 32;
  let minX = 99, maxX = -1;
  for (const row of g) for (let x = 0; x < row.length; x++) if (row[x] !== '.') { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const dx = Math.round((16 - (maxX - minX + 1)) / 2) - minX;
  let s = '';
  g.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') s += `<rect x="${(x + dx) * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="${pal[ch]}"/>`; }));
  MARKS.pixel.svg = `<g shape-rendering="crispEdges">${s}</g>`;
}
MARKS.coin.svg = `<circle cx="256" cy="256" r="248" fill="${C.ink}"/><circle cx="256" cy="256" r="226" fill="none" stroke="${C.burn}" stroke-width="20"/>
    <g transform="translate(256 262) scale(.8) translate(-256 -262)">${MARKS.burning.svg}</g>`;

const svgDoc = (inner, bg = null) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg ? `<rect width="512" height="512" rx="112" fill="${bg}"/>` : ''}${inner}</svg>`;
// the app icon: the mark on an ink tile (the coin is already a disc)
const iconInner = (id) => (id === 'coin' ? MARKS.coin.svg : `<g transform="translate(256 256) scale(.78) translate(-256 -256)">${MARKS[id].svg}</g>`);

// ---------- the wordmark font: only these glyphs, embedded ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const css = await (await fetch('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&text=BURNEPHO%2412345', { headers: { 'user-agent': UA } })).text();
const fontUrl = /url\((https:[^)]+)\)/.exec(css)?.[1];
if (!fontUrl) throw new Error('no font url in: ' + css.slice(0, 200));
const font = Buffer.from(await (await fetch(fontUrl, { headers: { 'user-agent': UA } })).arrayBuffer()).toString('base64');
const fontFace = `@font-face{font-family:BSD;font-weight:900;src:url(data:font/woff2;base64,${font}) format('woff2')}`;

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent(`<!doctype html><html><head><style>${fontFace} body{margin:0}</style></head><body></body></html>`);
await page.evaluate(() => document.fonts.load('900 100px BSD'));

// lockups: measured in the browser so the viewBox hugs the type
async function lockup(id, dir, dark = true) {
  return page.evaluate(({ id, dir, dark, mark, fontFace, C }) => {
    const NS = 'http://www.w3.org/2000/svg';
    const probe = document.createElementNS(NS, 'svg'); document.body.append(probe);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('font-family', 'BSD'); t.setAttribute('font-weight', '900'); t.setAttribute('font-size', '200'); t.setAttribute('letter-spacing', '8');
    t.innerHTML = `<tspan fill="${dark ? C.paper : C.ink}">BURNER</tspan><tspan fill="${C.burn}">PHONE</tspan>`;
    probe.append(t);
    const bb = t.getBBox(); probe.remove();
    const capTop = bb.y + bb.height * 0.2, capH = 200 * 0.72; // Big Shoulders caps ~0.72 em
    let w, h, body;
    const word = (x, y) => `<text x="${x}" y="${y}" font-family="BSD" font-weight="900" font-size="200" letter-spacing="8"><tspan fill="${dark ? C.paper : C.ink}">BURNER</tspan><tspan fill="${C.burn}">PHONE</tspan></text>`;
    if (dir === 'h') {
      const m = capH * 1.5, gap = m * 0.18;
      w = m + gap + bb.width - 8; h = m;
      body = `<g transform="scale(${m / 512})">${mark}</g>` + word(m + gap - bb.x, m / 2 + capH / 2 - (capTop - bb.y) * 0 );
    } else {
      const m = bb.width * 0.42;
      w = bb.width - 8; h = m + capH * 0.34 + capH;
      body = `<g transform="translate(${(w - m) / 2} 0) scale(${m / 512})">${mark}</g>` + word(-bb.x, m + capH * 0.34 + capH);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}"><style>${fontFace}</style>${body}</svg>`;
  }, { id, dir, dark, mark: MARKS[id].svg, fontFace, C });
}

async function png(svg, file, w, h = w) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style></head><body>${svg}</body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: file, omitBackground: true });
  await p.close();
}

const files = {};
for (const id of Object.keys(MARKS)) {
  const mark = svgDoc(MARKS[id].svg), icon = svgDoc(iconInner(id), id === 'coin' ? null : C.ink);
  writeFileSync(join(OUT, `${id}.svg`), mark);
  writeFileSync(join(OUT, `${id}-icon.svg`), icon);
  for (const s of [1024, 512, 400, 64, 32, 16]) await png(icon, join(OUT, `${id}-icon-${s}.png`), s);
  await png(mark, join(OUT, `${id}-512.png`), 512);
  const lh = await lockup(id, 'h'), lv = await lockup(id, 'v'), lhl = await lockup(id, 'h', false);
  writeFileSync(join(OUT, `${id}-lockup-h.svg`), lh); writeFileSync(join(OUT, `${id}-lockup-v.svg`), lv); writeFileSync(join(OUT, `${id}-lockup-h-light.svg`), lhl);
  files[id] = { mark, icon, lh, lv, lhl };
  console.log('logo', id);
}

// ---------- the comparison sheet: every direction where it has to work ----------
const row = (id) => {
  const f = files[id], tiny = (s) => `<img src="data:image/svg+xml;base64,${Buffer.from(f.icon).toString('base64')}" width="${s}" height="${s}">`;
  return `<div class="row">
    <div class="lab"><b>${['x', 'phone', 'burning', 'monogram', 'pixel', 'coin'].indexOf(id)}</b>${MARKS[id].name}</div>
    <div class="cell dark big">${f.mark}</div>
    <div class="cell light big">${f.mark}</div>
    <div class="cell dark sizes"><div class="tab">${tiny(16)}<span>BurnerPhone</span></div><div class="bar">${tiny(24)}</div>
      <div class="avatar">${tiny(96)}</div><div class="zoom">${tiny(16)}</div></div>
    <div class="cell dark lock">${f.lh}</div>
    <div class="cell light lock">${f.lhl}</div>
  </div>`;
};
const sheet = `<!doctype html><html><head><style>${fontFace}
  body{margin:0;padding:36px;background:#141110;font-family:Geist,system-ui,sans-serif;color:${C.paper};width:2140px}
  h1{font:900 64px BSD;letter-spacing:3px;margin:0 0 24px}h1 span{color:${C.burn}}h1 small{font:600 28px Geist,system-ui,sans-serif;letter-spacing:0;color:rgba(255,244,230,.6);margin-left:14px}
  .row{display:grid;grid-template-columns:150px 230px 230px 300px 560px 560px;gap:14px;margin-bottom:14px;align-items:stretch}
  .lab{display:flex;flex-direction:column;justify-content:center;font-size:20px;font-weight:600;color:rgba(255,244,230,.8)}.lab b{font:900 72px BSD;color:${C.burn}}
  .cell{border-radius:18px;display:grid;place-items:center;padding:18px;overflow:hidden}
  .dark{background:${C.ink}}.light{background:${C.paper}}
  .big svg{width:190px;height:190px}.lock svg{width:500px;height:150px}
  .sizes{grid-template-columns:1fr 1fr;grid-template-rows:auto auto;gap:12px;align-items:center;justify-items:center}
  .tab{grid-column:1/3;display:flex;align-items:center;gap:8px;background:#2a2725;border-radius:8px 8px 0 0;padding:7px 14px;font-size:13px}
  .bar{display:flex;gap:10px;background:#202020;padding:8px 14px;border-radius:6px}
  .avatar img{border-radius:50%;display:block}
  .zoom img{width:96px;height:96px;image-rendering:pixelated}
</style></head><body><h1>BURNER<span>PHONE</span> <small>logo directions</small></h1>${Object.keys(MARKS).map(row).join('')}</body></html>`;
const sp = await browser.newPage({ viewport: { width: 2212, height: 900 } });
await sp.setContent(sheet);
await sp.evaluate(() => document.fonts.ready);
await sp.screenshot({ path: join(OUT, 'sheet.png'), fullPage: true });
await browser.close();
console.log('sheet → ' + join(OUT, 'sheet.png'));
