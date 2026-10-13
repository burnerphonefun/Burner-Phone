// node scripts/readme-art.mjs [--gifs[=dir]] — the README / social art, rendered from the real phone skins and world posters
//   docs/banner.png   the README header (2x)
//   docs/phones.png   the six phones on their worlds (2x)
//   docs/social.png   1280x640 for the repo's social preview (Settings → Social preview)
//   --gifs            also docs/hero.gif (one phone, every game) + docs/rug.gif (WASTED → MISSION PASSED) from the teasers
//                     in web/public/media (or the dir given, e.g. ../launch for the high-quality masters)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { markSvg } from './brand-mark.mjs';

const APP = resolve(import.meta.dirname, '..');
const PUB = join(APP, 'web', 'public');
const OUT = join(APP, 'docs');
mkdirSync(OUT, { recursive: true });

const img = (f) => 'data:image/' + (f.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + readFileSync(join(PUB, f)).toString('base64');
const mark = markSvg({ crop: 0.78 }); // the X profile picture's mark (scripts/brand-mark.mjs)
// the fan's phones: the teaser plates (a frozen, curated snapshot: no live names), made by teaser-plates.mjs --stories=any
const plate = (n) => 'data:image/png;base64,' + readFileSync(join(APP, 'web', 'src', 'teaser', 'plates', n + '.png')).toString('base64');
const WORLDS = [
  ['blocky', 'blocky night', 'block survival games'],
  ['toon', 'toon island', 'battle royale'],
  ['tactical', 'bomb site', 'tactical shooters'],
  ['obby', 'obby', 'block-party games'],
  ['survival', 'survival', 'survival islands'],
  ['city', 'sunny city', 'crime cities'],
];

const css = `
  * { box-sizing: border-box; margin: 0; }
  html, body { background: transparent; }
  body { font-family: Geist, system-ui, sans-serif; color: #FFF4E6; -webkit-font-smoothing: antialiased; }
  .frame { position: relative; overflow: hidden; border-radius: 28px; background: #0B0A09; }
  .glow { position: absolute; border-radius: 50%; background: radial-gradient(closest-side, rgba(255,90,31,.34), rgba(255,90,31,.08) 60%, rgba(255,90,31,0)); }
  .word { font: 900 var(--word, 88px)/0.9 'Big Shoulders Display', Impact, sans-serif; letter-spacing: 2px; }
  .word span { color: #FF5A1F; }
  .tag { font-weight: 700; font-size: 30px; letter-spacing: -.3px; margin-top: 18px; }
  .sub { font-size: 18px; line-height: 1.45; color: rgba(255,244,230,.62); margin-top: 10px; max-width: 520px; }
  .sub b { color: #FFF4E6; font-weight: 600; }
  .chips { display: flex; gap: 8px; margin-top: 26px; }
  .chips i { font-style: normal; font-size: 14px; font-weight: 600; padding: 7px 12px; border-radius: 999px; background: rgba(255,244,230,.08); border: 1px solid rgba(255,244,230,.12); }
  .chips i:first-child { background: #FF5A1F; border-color: #FF5A1F; color: #170700; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand svg { width: 84px; height: 84px; flex: none; }
  .ph { position: absolute; width: 330px; filter: drop-shadow(0 30px 40px rgba(0,0,0,.55)); }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; padding: 0; }
  .card { position: relative; height: 330px; border-radius: 22px; overflow: hidden; background: #111 center / cover no-repeat; }
  .card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, rgba(8,6,12,.82) 0%, rgba(8,6,12,.45) 45%, rgba(8,6,12,0) 70%); }
  .card img { position: absolute; right: 18px; bottom: -150px; width: 240px; filter: drop-shadow(0 18px 26px rgba(0,0,0,.5)); }
  .card h3 { position: absolute; left: 26px; top: 24px; font: 900 40px/1 'Big Shoulders Display', Impact, sans-serif; letter-spacing: 1px; text-transform: uppercase; }
  .card p { position: absolute; left: 26px; top: 70px; font-size: 16px; font-weight: 600; color: rgba(255,244,230,.75); }
  .card .n { position: absolute; left: 26px; bottom: 22px; font: 700 13px/1 Geist, sans-serif; letter-spacing: 2px; color: rgba(255,244,230,.55); }
`;
const fonts = `<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&family=Geist:wght@400;600;700&display=block" rel="stylesheet">`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${css}</style></head><body>${body}</body></html>`;

// three phones fanned out of the bottom edge, the way the phone comes up in a hand
const fan = (x, y, s) => `
  <img class="ph" src="${plate('any-toon-pump')}" style="left:${x - 190 * s}px; top:${y + 40 * s}px; width:${300 * s}px; transform: rotate(-9deg)">
  <img class="ph" src="${plate('any-tactical-lock')}" style="left:${x + 190 * s}px; top:${y + 40 * s}px; width:${300 * s}px; transform: rotate(9deg)">
  <img class="ph" src="${plate('any-list')}" style="left:${x}px; top:${y}px; width:${330 * s}px">`;
const pitch = `
  <div class="brand">${mark}<div class="word">BURNER<span>PHONE</span></div></div>
  <div class="tag">a burner phone for your bags.</div>
  <div class="sub">press <b>alt+q</b> in any game and a phone comes up in your hand with <b>live pump.fun</b> on it. buy, sell, put it away.</div>
  <div class="chips"><i>windows 10 / 11</i><i>paper or your own wallet</i><i>open source</i></div>`;

const shots = [
  ['banner.png', 1280, 440, 2, `<div class="frame" style="width:1280px;height:440px">
    <div class="glow" style="left:640px; top:-120px; width:820px; height:820px"></div>
    <div style="position:absolute; left:64px; top:72px">${pitch}</div>
    ${fan(925, 84, .9)}</div>`],
  ['social.png', 1280, 640, 1, `<div class="frame" style="width:1280px;height:640px;border-radius:0">
    <div class="glow" style="left:560px; top:-80px; width:1000px; height:1000px"></div>
    <div style="position:absolute; left:72px; top:178px; --word: 92px">${pitch}</div>
    ${fan(915, 150, 1.06)}</div>`],
  ['phones.png', 1280, 696, 2, `<div class="cards" style="width:1280px">${WORLDS.map(([id, label, tag], i) => `
    <div class="card" style="background-image:url(${img('poster-' + id + '.jpg')})">
      <img src="${img('skins/' + id + '.png')}"><h3>${label}</h3><p>${tag}</p><span class="n">0${i + 1}</span></div>`).join('')}</div>`],
];

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
for (const [name, w, h, dpr, body] of shots) {
  const pg = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await pg.setContent(page(body), { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  await pg.close();
  console.log('docs/' + name + ' ' + Math.round(statSync(join(OUT, name)).size / 1024) + ' KB');
}
await browser.close();

const gifArg = process.argv.find((a) => a.startsWith('--gifs'));
if (gifArg) {
  const src = resolve(APP, gifArg.split('=')[1] || 'web/public/media');
  const { default: ffmpeg } = await import('ffmpeg-static');
  const gif = (teaser, from, len, width, fps, out) => {
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(from), '-t', String(len), '-i', join(src, `teaser-${teaser}.mp4`), '-filter_complex',
      `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, join(OUT, out)]);
    console.log('docs/' + out + ' ' + (statSync(join(OUT, out)).size / 1048576).toFixed(1) + ' MB');
  };
  gif('games', 0, 6.1, 720, 12, 'hero.gif'); // the six worlds, one phone
  gif('city', 7.2, 7.2, 600, 10, 'rug.gif'); // rug call → WASTED → MISSION PASSED
}
