// node scripts/teaser-plates.mjs [--record] [--site=http://localhost:5207/]
// Captures the REAL phone (hand + phone rig) as transparent PNG plates for the teasers, from a frozen data snapshot,
// a fixed clock and a staged paper wallet. Re-run after any phone polish: the teasers pick the new look up.
//   --record  refresh src/teaser/snapshot.json from the live API first (otherwise the frozen one is reused)
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web/src/teaser/plates');
const SNAP = join(ROOT, 'web/src/teaser/snapshot.json');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const SITE = args.site || 'http://localhost:5207/';
const API = args.api || 'http://localhost:8790';
mkdirSync(OUT, { recursive: true });

const GOOD = 'uv4GRWUTjunyToMKPBueeRYTRbVJt78wYLeaZDxpump'; // ConConAI: really ran from launch to ~$650K
const MILO = 'UE78bn5XMHKGhKY4CGbfaTYj8twNwUaaZyaCYwXpump'; // Milo: a real launch that ran ~2.5x
const NEWC = 'B3hvYyw2V8NDWHMJ7yAtMmnQi5eZxjDZ6oobPLtepump'; // Nubix: the launch that slides in
const RUG = 'teaser-rug-coin';                                // nameless "???" (no real coin is ever shown as a rug)

if (args.record || !existsSync(SNAP)) {
  const snap = await (await fetch(API + '/api/snapshot')).json();
  const good = await (await fetch(API + '/api/coin/' + GOOD)).json();
  snap.goodCandles = good.candles || [];
  writeFileSync(SNAP, JSON.stringify(snap));
  console.log('recorded snapshot', snap.coins.length, 'coins,', snap.goodCandles.length, 'candles for the bag');
}
const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const sol = snap.sol || 111.5;

function build(story) {
  const now = Date.parse(story === 'city' ? '2026-10-12T19:42:00' : story === 'games' ? '2026-10-12T21:07:00' : '2026-10-12T23:17:00');
  const by = new Map(snap.coins.map((c) => [c.mint, { ...c }]));
  const ages = [3, 9, 15, 22, 30, 41, 55, 68, 84, 101, 122, 150, 180, 220];
  // the New tab: real launches, minus the ones we stage, with tidy ages; filter repeats so it doesn't look like spam
  const seen = new Set();
  const fresh = snap.lists.new.filter((m) => { const c = by.get(m); if (!c || [GOOD, NEWC, MILO].includes(m)) return false; const k = (c.symbol || '').toLowerCase(); if (seen.has(k) || !c.img || !(c.mc > 2500)) return false; seen.add(k); return true; });
  // city: a nameless "???" bag sits third in the feed (a fresh snipe you hold) and gets stamped RUGGED before the phone rings
  const newList = (story === 'blocky' ? [MILO, ...fresh] : [fresh[0], fresh[1], RUG, ...fresh.slice(2)]).slice(0, 12);
  const rug = { mint: RUG, name: '???', symbol: '???', img: null, created: now - 15e3, dev: null, devPct: 9.8, devSold: false, k: 32190000000, p: 6e-8, mc: 6e-8 * 1e9 * sol, b1: 14, s1: 2, u1: 11, v1: 4.2, prog: 0.12, complete: false, ath: 7000, liq: null, flags: 0 };
  by.set(RUG, rug);
  newList.forEach((m, i) => { const c = by.get(m); c.created = now - ages[i] * 1000; if (c.b1 == null) c.b1 = [3, 7, 12, 5, 9, 18, 4, 11, 6, 14, 8, 2][i]; });
  const good = by.get(GOOD); good.created = now - 21 * 60e3;
  const milo = by.get(MILO); if (milo) { milo.created = now - ages[0] * 1000; milo.b1 = 26; }
  const nc = by.get(NEWC); if (nc) { nc.created = now - 1000; nc.b1 = 2; nc.flags = 0; }
  // bag curve: the coin's real 1m candles, shifted so the last one is "now"
  const ks = snap.goodCandles.map((k) => [k[0] < 1e12 ? k[0] * 1000 : k[0], +k[4]]).filter(([, p]) => p > 0);
  const shift = now - ks[ks.length - 1][0];
  const hist = ks.map(([t, p]) => [t + shift, p]);
  const pNow = good.p;
  // entry at a price the coin really traded through on its way up (it ran past every price from launch to now), for +214%
  const target = pNow / 3.14;
  let i = hist.findIndex(([, p]) => p >= target); if (i < 1) i = 1;
  const [ta, pa] = hist[i - 1], [tb, pb] = hist[i];
  const f = Math.min(1, Math.max(0, (Math.log(target) - Math.log(pa)) / (Math.log(pb) - Math.log(pa) || 1)));
  const entry = [ta + (tb - ta) * f, target];
  hist.splice(i, 0, entry);
  const hello = {
    t: 'hello', v: 1, now, sol,
    coins: [...by.values()],
    lists: { new: newList, rising: snap.lists.rising.filter((m) => m !== RUG).slice(0, 12), bonding: snap.lists.bonding.slice(0, 12) },
    stats: { lpm: 9, up: { stream: true, jup: true, trades: true } },
  };
  const ach = { 'first-buy': 1, '2x': 1, wasted: 1, camera: 1, diamond: 1, veteran: 1 };
  const stats = { buys: 6, sells: 4, wins: 3, rugs: 1, best: null, worst: null, realized: 0.6 };
  const wallet = story !== 'blocky'
    ? { v: 1, sol: 6.5, pos: { [GOOD]: { mint: GOOD, sym: good.symbol, name: good.name, tokens: 1 / entry[1], cost: 1, opened: entry[0], entryP: entry[1], entryMc: entry[1] * 1e9 * sol, high: pNow, low: entry[1], dip: 0 } }, hist: [], stats, ach, born: now - 3600e3 }
    : { v: 1, sol: 9.5, pos: {}, hist: [], stats, ach, born: now - 3600e3 };
  return { now, hello, wallet, hist, entry, rug, good, milo, nc };
}

const CSS = `body>:not(.st-hero),.st-hero>:not(.bp-layer),.st-world,.st-shade,.hud,.st-top,.st-pitch,.st-keys,.st-paper,.st-main,.st-foot,.st-boot,.bn-layer{visibility:hidden!important}
html,body,.st-hero{background:transparent!important}
.bp-layer[data-skin='blocky'] .bp-call h2,.bp-layer[data-skin='blocky'] .bp-call-lt,.bp-layer[data-skin='blocky'] .bp-call-btns span{color:#fff!important}.bp-layer[data-skin='blocky'] .bp-call p{color:#ffc9c9!important}
.st-hero{width:1440px!important;height:900px!important;min-height:0!important;overflow:visible!important}`;

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--ignore-gpu-blocklist'] });
// plates.json keeps the stories not re-captured this run
const meta = existsSync(join(OUT, 'plates.json')) ? JSON.parse(readFileSync(join(OUT, 'plates.json'), 'utf8')) : {};
const STORY_LIST = args.stories ? String(args.stories).split(',') : ['city', 'blocky', 'games'];

for (const story of STORY_LIST) {
  const S = build(story);
  const ctx = await browser.newContext({ viewport: { width: 1660, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('world failed')) errs.push(m.text().slice(0, 200)); });
  await page.clock.setFixedTime(S.now);
  await page.addInitScript(({ wallet, css }) => {
    localStorage.setItem('burner.wallet.v1', JSON.stringify(wallet));
    localStorage.setItem('burner.size', '0.5');
    localStorage.setItem('burner.mute', '1');
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); });
  }, { wallet: S.wallet, css: CSS });
  let sock = null;
  await page.routeWebSocket(/\/ws$/, (ws) => { sock = ws; ws.onMessage(() => {}); ws.send(JSON.stringify(S.hello)); });
  await page.route('**/api/snapshot', (r) => r.fulfill({ json: S.hello }));
  await page.route('**/api/coin/**', (r) => { const m = r.request().url().split('/').pop().split('?')[0]; const c = S.hello.coins.find((x) => x.mint === m); r.fulfill({ json: { coin: c || null, trades: [], candles: [] } }); });
  await page.route('**/download/**', (r) => r.fulfill({ status: 200, body: '' }));
  // the 3D world isn't needed for plates (and would just burn GPU)
  await page.route('**/src/scene/world.js*', (r) => r.fulfill({ contentType: 'application/javascript', body: 'export function createWorld(){ throw new Error("plates: no world"); }' }));
  await page.goto(SITE + '?debug&still' + (story === 'blocky' ? '&world=blocky' : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.phone && window.net && window.net.lists.new.length > 3, null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  // the bag's real curve for its sparkline
  await page.evaluate(({ mint, hist }) => { const c = window.net.coin(mint); if (c) { c.hist = hist; c.seeded = true; } }, { mint: GOOD, hist: S.hist });
  await page.waitForTimeout(1500);

  // one clip for every plate of a story (the union over every skin it uses), so all phones sit in the same place
  const SKINS = story === 'games' ? ['blocky', 'toon', 'tactical', 'obby', 'survival', 'city'] : [story === 'blocky' ? 'blocky' : 'city'];
  let box = null;
  for (const sk of SKINS) {
    await page.evaluate((sk) => window.phone.setSkin(sk), sk);
    await page.waitForTimeout(350);
    const b = await page.evaluate(() => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const e of document.querySelectorAll('.bp-rig, .bp-rig .bp-phone, .bp-rig .bp-hand-wrap')) { const r = e.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      return { x0, y0, x1, y1 };
    });
    box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  }
  await page.evaluate((sk) => window.phone.setSkin(sk), SKINS[0]);
  const clip = (() => { const x0 = Math.max(0, Math.floor(box.x0 - 12)), y0 = Math.max(0, Math.floor(box.y0 - 12)), x1 = Math.min(1660, Math.ceil(box.x1 + 12)); return { x: x0, y: y0, width: x1 - x0, height: 1100 - y0 }; })();
  const point = (sel) => page.evaluate(({ sel, clip }) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2 - clip.x, r.top + r.height / 2 - clip.y]; }, { sel, clip });
  const plates = {};
  const snapPlate = async (name) => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); const f = join(OUT, `${story}-${name}.png`); await page.screenshot({ path: f, clip, omitBackground: true }); plates[name] = `${story}-${name}.png`; console.log('plate', story, name); };
  const send = (o) => sock.send(JSON.stringify(o));
  const tickCoin = (mint, p) => send({ t: 'tick', now: S.now, sol, c: [[mint, p, p * 1e9 * sol, null, null, null, null, 0, null]] });
  const taps = {};

  if (story === 'city') {
    await page.evaluate(() => window.phone.open('lock'));
    // the bag ticks: the phone's own "+25% since the last notice" rule opens the island ("$ConConAI is running +214%")
    tickCoin(GOOD, S.good.p);
    await page.waitForTimeout(650);
    await snapPlate('peek');
    const edge = (cls, on) => page.evaluate(({ cls, on }) => { const e = document.querySelector('.bp-edge'); e.className = 'bp-edge ' + cls; e.style.animation = 'none'; e.style.opacity = on ? '1' : '0'; }, { cls, on });
    await edge('bp-edge-go', true); await page.waitForTimeout(120);
    await snapPlate('peek-lit');
    await edge('', false);
    await page.waitForTimeout(3200);
    await snapPlate('lock');
    // a fresh snipe you hold, about to die (third row in the feed)
    await page.evaluate(({ rug, now }) => { const w = window.wallet; w.state.pos[rug.mint] = { mint: rug.mint, sym: '???', name: '???', tokens: 2 / 6e-8, cost: 2, opened: now - 10e3, entryP: 6e-8, entryMc: 6e-8 * 1e9 * 111.5, high: 6e-8, low: 6e-8, dip: 0 }; w.save(); }, { rug: S.rug, now: S.now });
    await page.evaluate(() => window.phone.open('pump'));
    await page.waitForTimeout(1300);
    await snapPlate('pump');
    // a launch slides in: freeze the row transitions and capture two in-between states
    await page.addStyleTag({ content: '.bp-row{transition:none!important}' });
    send({ t: 'new', coin: S.nc });
    await page.waitForTimeout(400);
    const rowsAt = (k) => page.evaluate(({ k, nc }) => {
      const e = (x) => 1 - Math.pow(1 - x, 3);
      for (const r of document.querySelectorAll('.bp-row')) {
        if (!r.dataset.fy) r.dataset.fy = (/translate3d\(0px?,\s*(-?[\d.]+)px/.exec(r.style.transform) || [0, 0])[1];
        const fy = +r.dataset.fy, isNew = r.querySelector('.bp-row-nm b')?.textContent === nc;
        const from = isNew ? -58 : fy - 58, y = from + (fy - from) * e(k);
        r.style.transform = `translate3d(0,${y}px,0)`; r.style.opacity = isNew ? String(Math.min(1, k * 1.4)) : '';
      }
    }, { k, nc: S.nc.name });
    await rowsAt(0.3); await page.waitForTimeout(80); await snapPlate('pump-slide1');
    await rowsAt(0.62); await page.waitForTimeout(80); await snapPlate('pump-slide2');
    await rowsAt(1); await page.waitForTimeout(80);
    await snapPlate('pump-new');
    taps.buy = await page.evaluate(({ clip }) => { const rows = [...document.querySelectorAll('.bp-row')].filter((r) => !r.classList.contains('bp-out')); rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const b = rows[0].querySelector('.bp-buy'); b.classList.add('bp-done'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2 - clip.x, r.top + r.height / 2 - clip.y]; }, { clip });
    await page.evaluate(({ mint }) => window.phone.notify({ title: 'bought $Nubix', body: '0.5 SOL in at $3.4K', coin: window.net.coin(mint), tone: 'up', quiet: true, buzz: false, ms: 2200 }), { mint: NEWC });
    await page.waitForTimeout(700);
    await snapPlate('pump-buy');
    await page.evaluate(() => document.querySelectorAll('.bp-buy.bp-done').forEach((b) => b.classList.remove('bp-done')));
    await page.waitForTimeout(2600);
    // the snipe dumps -45%: the phone's own rule opens "$??? is dumping"
    tickCoin(RUG, 3.3e-8);
    await page.waitForTimeout(700);
    await snapPlate('pump-dump');
    // RUGGED lands on its row (the pump app's own stamp markup), first big, then settled
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.bp-row')].find((r) => r.querySelector('.bp-row-nm b')?.textContent === '???');
      if (!row) return;
      row.classList.add('bp-rugged');
      const st = document.createElement('b'); st.className = 'bp-stamp bp-stamp-rug'; st.textContent = 'RUGGED';
      st.style.animation = 'none'; st.style.transform = 'rotate(-9deg) scale(1.45)'; st.style.opacity = '.75';
      row.append(st); row.style.backgroundColor = 'rgba(232,35,58,.3)';
    });
    await page.waitForTimeout(100);
    await snapPlate('pump-rugged-a');
    await page.evaluate(() => { const st = document.querySelector('.bp-stamp'); if (st) { st.style.transform = 'rotate(-9deg) scale(1)'; st.style.opacity = '1'; st.parentElement.style.backgroundColor = 'rgba(232,35,58,.14)'; } });
    await page.waitForTimeout(100);
    await snapPlate('pump-rugged');
    // the price collapses: the wallet's own rug watch rings the phone (RUG ALERT)
    send({ t: 'tick', now: S.now, sol, c: [[RUG, 3.1e-9, 3.1e-9 * 1e9 * sol, 0, 41, 0, 0, 2, 18.2]] });
    await page.waitForTimeout(3000);
    await snapPlate('ring');
    await page.evaluate(() => { const e = document.querySelector('.bp-edge'); e.className = 'bp-edge bp-edge-red'; e.style.animation = 'none'; e.style.opacity = '1'; });
    await page.waitForTimeout(150);
    await snapPlate('ring-lit');
    await page.evaluate(() => { const e = document.querySelector('.bp-edge'); e.style.opacity = '0'; document.querySelector('.bp-call').classList.remove('bp-call-on'); });
    // the second run: the bag is up 4x, sell all
    await page.evaluate(({ rug }) => { delete window.wallet.state.pos[rug]; window.wallet.save(); }, { rug: RUG });
    tickCoin(GOOD, S.entry[1] * 4.12);
    await page.waitForTimeout(1600);
    await snapPlate('win');
    taps.sell = await point('.bp-bagcard .bp-btn1');
    await page.evaluate(() => { document.querySelector('.bp-bagcard .bp-btn1').style.transform = 'scale(.94)'; });
    await page.waitForTimeout(120);
    await snapPlate('win-press');
    await page.evaluate(() => { document.querySelector('.bp-bagcard .bp-btn1').style.transform = ''; document.querySelector('.bp-bagcard .bp-btn1').click(); });
    await page.waitForTimeout(1200);
    await snapPlate('sold');
  } else if (story === 'games') {
    await gamesPlates({ page, S, snapPlate, send, tickCoin, point, clip, taps });
  } else {
    await page.evaluate(() => window.phone.open('pump'));
    await page.waitForTimeout(1300);
    await snapPlate('pump');
    taps.buy = await page.evaluate(({ clip, mint }) => { const rows = [...document.querySelectorAll('.bp-row')]; rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const b = rows[0].querySelector('.bp-buy'); b.classList.add('bp-done'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2 - clip.x, r.top + r.height / 2 - clip.y]; }, { clip, mint: MILO });
    await page.waitForTimeout(400);
    await snapPlate('pump-buy');
    await page.evaluate(() => document.querySelectorAll('.bp-buy.bp-done').forEach((b) => b.classList.remove('bp-done')));
    const entry = S.milo.p;
    await page.evaluate(({ mint, entry, now }) => { const c = window.net.coin(mint); const w = window.wallet; w.state.pos[mint] = { mint, sym: c.symbol, name: c.name, tokens: 0.5 / entry, cost: 0.5, opened: now - 40e3, entryP: entry, entryMc: entry * 1e9 * 111.5, high: entry, low: entry, dip: 0 }; w.save(); c.hist = [[now - 40e3, entry], [now - 30e3, entry * 1.3], [now - 20e3, entry * 0.8], [now - 8e3, entry * 0.55], [now, entry * 0.48]]; c.seeded = true; }, { mint: MILO, entry, now: S.now });
    tickCoin(MILO, entry * 0.48);
    await page.waitForTimeout(1500);
    await snapPlate('dip');
    await page.evaluate(({ mint, entry, now }) => { const c = window.net.coin(mint); c.hist = [[now - 40e3, entry], [now - 30e3, entry * 1.3], [now - 24e3, entry * 0.8], [now - 18e3, entry * 0.5], [now - 10e3, entry * 1.4], [now - 4e3, entry * 2.6], [now, entry * 3.4]]; }, { mint: MILO, entry, now: S.now });
    tickCoin(MILO, entry * 3.4);
    await page.waitForTimeout(1500);
    await snapPlate('up');
    taps.sell = await point('.bp-bagcard .bp-btn1');
    await page.evaluate(() => { document.querySelector('.bp-bagcard .bp-btn1').style.transform = 'scale(.94)'; });
    await page.waitForTimeout(120);
    await snapPlate('up-press');
  }
  meta[story] = { clip, plates, taps, view: { width: 1660, height: 1100, heroW: 1440, heroH: 900, dpr: 2 } };
  if (errs.length) console.log(story, 'page errors:', errs);
  await ctx.close();
}
writeFileSync(join(OUT, 'plates.json'), JSON.stringify(meta, null, 1));
await browser.close();
console.log('plates.json written');

// ---------- games: one phone, every game (six skins on one page) ----------
async function gamesPlates({ page, S, snapPlate, send, tickCoin, point, clip, taps }) {
  const skin = (s) => page.evaluate((s) => window.phone.setSkin(s), s);
  const open = (v) => page.evaluate((v) => window.phone.open(v), v);
  // the bag ticks once: the phone's own rule opens "$ConConAI is running +214%", then the island settles on the live +%
  tickCoin(GOOD, S.good.p);
  await page.waitForTimeout(3300);
  for (const s of ['toon', 'tactical', 'obby', 'survival', 'city']) {
    await skin(s); await open('pump'); await page.waitForTimeout(900); await snapPlate(s + '-pump');
    await open('lock'); await page.waitForTimeout(700); await snapPlate(s + '-lock');
  }
  // blocky: a real buy tap, the real coin burst frozen at three moments
  await skin('blocky'); await open('pump'); await page.waitForTimeout(900);
  await snapPlate('blocky-pump');
  taps.buy = await page.evaluate(({ clip }) => {
    const rows = [...document.querySelectorAll('.bp-row')].filter((r) => !r.classList.contains('bp-out'));
    rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const b = rows[0].querySelector('.bp-buy'), r = b.getBoundingClientRect();
    b.click();
    document.getAnimations().forEach((a) => a.pause());
    return [r.left + r.width / 2 - clip.x, r.top + r.height / 2 - clip.y];
  }, { clip });
  for (const [ms, name] of [[90, 'buy1'], [230, 'buy2'], [420, 'buy3']]) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => { try { a.currentTime = ms; } catch {} }), ms);
    await snapPlate('blocky-' + name);
  }
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  await snapPlate('blocky-bought');
  await page.waitForTimeout(1600);
  // the ??? snipe you hold: dumps, gets stamped RUGGED, then the price collapses and the wallet's rug watch rings
  await page.evaluate(({ rug, now }) => { const w = window.wallet; w.state.pos[rug] = { mint: rug, sym: '???', name: '???', tokens: 2 / 6e-8, cost: 2, opened: now - 10e3, entryP: 6e-8, entryMc: 6e-8 * 1e9 * 111.5, high: 6e-8, low: 6e-8, dip: 0 }; w.save(); }, { rug: RUG, now: S.now });
  tickCoin(RUG, 3.3e-8);
  await page.waitForTimeout(900);
  await snapPlate('blocky-pump2');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.bp-row')].find((r) => r.querySelector('.bp-row-nm b')?.textContent === '???');
    if (!row) return;
    row.classList.add('bp-rugged');
    const st = document.createElement('b'); st.className = 'bp-stamp bp-stamp-rug'; st.textContent = 'RUGGED';
    st.style.animation = 'none'; st.style.transform = 'rotate(-9deg) scale(1.45)'; st.style.opacity = '.75';
    row.append(st); row.style.backgroundColor = 'rgba(232,35,58,.3)';
  });
  await snapPlate('blocky-rugged-a');
  await page.evaluate(() => { const st = document.querySelector('.bp-stamp'); if (st) { st.style.transform = 'rotate(-9deg) scale(1)'; st.style.opacity = '1'; st.parentElement.style.backgroundColor = 'rgba(232,35,58,.14)'; } });
  await snapPlate('blocky-rugged');
  send({ t: 'tick', now: S.now, sol: S.hello.sol, c: [[RUG, 3.1e-9, 3.1e-9 * 1e9 * S.hello.sol, 0, 41, 0, 0, 2, 18.2]] });
  await page.waitForTimeout(3000);
  await snapPlate('blocky-ring');
  await page.evaluate(() => { const e = document.querySelector('.bp-edge'); e.className = 'bp-edge bp-edge-red'; e.style.animation = 'none'; e.style.opacity = '1'; });
  await snapPlate('blocky-ring-lit');
  await page.evaluate(() => { const e = document.querySelector('.bp-edge'); e.style.opacity = '0'; document.querySelector('.bp-call').classList.remove('bp-call-on'); });
  // toon: the bag has run to +312%, sell all
  await page.evaluate((rug) => { delete window.wallet.state.pos[rug]; window.wallet.save(); }, RUG);
  await skin('toon'); await open('pump');
  tickCoin(GOOD, S.entry[1] * 4.12);
  await page.waitForTimeout(1600);
  await snapPlate('toon-win');
  taps.sell = await point('.bp-bagcard .bp-btn1');
  await page.evaluate(() => { document.querySelector('.bp-bagcard .bp-btn1').style.transform = 'scale(.94)'; });
  await snapPlate('toon-win-press');
  await page.evaluate(() => { const b = document.querySelector('.bp-bagcard .bp-btn1'); b.style.transform = ''; b.click(); });
  await page.waitForTimeout(1200);
  await snapPlate('toon-sold');
}
