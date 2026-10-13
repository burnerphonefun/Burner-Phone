// burner site v2: pick a game, the world and the phone in your hand change with it.
import '../../shared/phone/phone.css';
import './site.css';
import { createNet } from '../../shared/phone/net.js';
import { createWallet } from '../../shared/phone/wallet.js';
import { createPhone } from '../../shared/phone/phone.js';
import { initSound, isMuted, setMuted } from '../../shared/phone/sound.js';
import { money, tick, usd, age, sol as fmtSol } from '../../shared/phone/fmt.js';
import { tween, ease, wait } from '../../shared/phone/motion.js';

// the open-source repo (a new account for burner); the site reads the latest release from github's api
const GITHUB = { repo: 'burnerphonefun/Burner-Phone', live: true }; // false falls back to the zip on our own volume

export const GAMES = [
  { id: 'blocky', label: 'blocky night', blurb: 'a pixel phone in a blocky hand, inventory slots, Achievement get!', tag: 'block survival games' },
  { id: 'toon', label: 'toon island', blurb: 'a chunky cartoon phone that bounces, for storm-circle islands', tag: 'battle royale' },
  { id: 'tactical', label: 'bomb site', blurb: 'a rugged green-screen PDA with screws and scanlines', tag: 'tactical shooters' },
  { id: 'obby', label: 'obby', blurb: 'a glossy toy phone with studs on top, bright and loud', tag: 'block-party games' },
  { id: 'survival', label: 'survival', blurb: 'a battered walkie-phone with a cracked screen and rivets', tag: 'survival islands' },
  { id: 'city', label: 'sunny city', blurb: 'a glass smartphone, sunset os, WASTED and MISSION PASSED', tag: 'crime cities' },
];
const IDS = GAMES.map((g) => g.id);
const SPLASH = ['trade mid-mine!', 'diamond hands, diamond pickaxe', 'rugged? respawn!', 'paper SOL, real rugs', 'now with your own wallet', 'alt+q in any world', 'never touches the game!'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const hero = $('.st-hero');
const canvas = $('.st-world');
const mobile = matchMedia('(max-width: 760px)').matches;
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle('st-is-mobile', mobile);
document.body.dataset.world = IDS.includes(params.get('world')) ? params.get('world') : 'blocky';
const worldName = () => document.body.dataset.world;

initSound();
const net = createNet();
const wallet = createWallet(net);
let world = null;

// ---------- the phone ----------
const phoneHost = mobile ? Object.assign(document.createElement('div'), { className: 'st-phone-mobile' }) : hero;
if (mobile) hero.append(phoneHost);
const phone = createPhone(phoneHost, {
  net, wallet,
  mode: mobile ? 'mobile' : 'demo',
  skin: worldName(),
  grab: (w, h) => world?.snapshot(w, h) || posterCanvas(w, h),
  onFx: (fx) => { world?.fx(fx); hero.classList.toggle('st-fx-gray', fx.gray > 0); },
  toggleSound: () => setMuted(!isMuted()),
  isMuted,
  onEvent: (type, ev) => { if (type === 'tick' || type === 'wallet') paintHud(); },
});
fetch('/api/snapshot').then((r) => (r.ok ? r.json() : null)).then((s) => { if (s && !net.st.lastMsg) net.seed(s); }).catch(() => {});
net.connect();

let introStarted = false;
function startIntro() {
  if (introStarted) return;
  introStarted = true;
  if (!mobile) {
    setTimeout(() => phone.raise(), params.has('still') ? 0 : 500);
    setTimeout(() => { if (phone.view() === 'lock') phone.unlock(); }, params.has('still') ? 50 : 3000);
  } else {
    const fresh = !wallet.state.stats.buys;
    if (fresh) phone.notify({ title: 'this phone lives inside your games', body: 'on pc it comes up over any game with alt+q. here: live pump.fun, 10 paper SOL', icon: 'pump', tone: 'gold', buzz: false, ms: 3800 });
    setTimeout(() => { if (phone.view() === 'lock') phone.unlock(); }, fresh ? 5200 : 2600);
  }
  if (!wallet.state.stats.buys) setTimeout(() => {
    if (!wallet.state.stats.buys) phone.notify({ title: '10 paper SOL on this burner', body: 'tap 0.5 on any launch to ape it', icon: 'bolt', tone: 'gold', quiet: true, ms: 4200 });
  }, mobile ? 6800 : 5000);
}
startIntro(); // no loading screen: the poster is the first paint, the 3D world fades in over it when ready

// ---------- keys ----------
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'q' || e.key === 'Q') { if (!mobile) phone.toggle(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= IDS.length && !e.ctrlKey && !e.metaKey && !e.altKey) { setWorld(IDS[n - 1]); return; }
  if (phone.view() === 'lock' && phone.isUp() && e.key.length === 1) phone.unlock();
});

// ---------- game picker + the block wipe ----------
const picker = $('.st-picker');
// on desktop the picker and key hints sit under the pitch, clear of each game's HUD
if (!mobile) $('.st-pitch').append(picker, $('.st-keys'));
GAMES.forEach((g, i) => {
  const b = document.createElement('button');
  b.className = 'st-pick'; b.dataset.world = g.id; b.setAttribute('role', 'tab');
  b.style.backgroundImage = `url(/poster-${g.id}.jpg)`;
  b.innerHTML = `<kbd>${i + 1}</kbd><b></b>`;
  b.querySelector('b').textContent = g.label;
  b.addEventListener('click', () => setWorld(g.id));
  picker.append(b);
});
const wipe = $('.st-wipe');
const cells = [];
for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) { const c = document.createElement('i'); c._d = (x + y) * 16; wipe.append(c); cells.push(c); }

let switching = false;
async function setWorld(name) {
  if (!IDS.includes(name) || name === worldName() || switching) return;
  switching = true;
  const animateWipe = !mobile && world;
  if (animateWipe) {
    wipe.style.setProperty('--wipe', getComputedStyle(document.body).getPropertyValue('--sky').trim() || '#111');
    await Promise.all(cells.map((c) => c.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.02)' }], { duration: 220, delay: c._d, easing: 'cubic-bezier(.3,.8,.4,1)', fill: 'forwards' }).finished));
  }
  // the hand puts one phone away and pulls out the one that belongs in this game
  document.body.dataset.world = name;
  paintPicker();
  if (mobile) setMobileWall();
  const ready = world ? Promise.resolve(world.setWorld(name)).catch((e) => console.warn('world', name, e?.message)) : Promise.resolve();
  await Promise.race([ready, wait(1500)]);
  phone.swap(name);
  paintHud();
  if (animateWipe) await Promise.all(cells.map((c) => c.animate([{ transform: 'scale(1.02)' }, { transform: 'scale(0)' }], { duration: 240, delay: 240 - c._d / 2, easing: 'ease-in', fill: 'forwards' }).finished));
  const u = new URL(location.href); if (name === 'blocky') u.searchParams.delete('world'); else u.searchParams.set('world', name);
  history.replaceState(null, '', u);
  switching = false;
}
function paintPicker() {
  for (const b of $$('.st-pick')) b.classList.toggle('st-on', b.dataset.world === worldName());
  for (const c of $$('.st-card')) c.classList.toggle('st-on', c.dataset.world === worldName());
}
paintPicker();

// ---------- worlds (three.js, desktop only) ----------
async function loadWorld() {
  try {
    const { createWorld } = await import('./scene/world.js');
    world = createWorld(canvas, { world: worldName(), pixelRatio: Math.min(devicePixelRatio || 1, 1.5) });
    await world.ready;
    world.start();
    hero.classList.add('st-world-ready');
    adaptQuality();
    // build the other worlds one at a time while the page is idle, so a switch never stalls
    const rest = IDS.filter((id) => id !== worldName());
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
    const next = () => { if (still) return; const id = rest.shift(); if (!id) return; idle(() => Promise.resolve(world.prepare?.(id)).catch(() => {}).then(() => setTimeout(next, 400)), { timeout: 5000 }); };
    setTimeout(next, 2500);
  } catch (e) {
    console.error('world failed', e);
    hero.classList.add('st-world-failed');
  }
}
// adaptive quality: a weak or software GPU gets a lower resolution, then a still frame of the world, so the phone
// (the product) always stays smooth. Reduced-motion users get the still frame straight away.
let still = false;
function goStill() {
  if (still || !world) return;
  still = true;
  world.stop();
  world.renderAt(2);
  hero.classList.add('st-still');
}
function measureFps(ms) {
  return new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < ms) requestAnimationFrame(f); else res((n * 1000) / (t - t0)); }; requestAnimationFrame(f); });
}
async function adaptQuality() {
  try {
    const gl = world.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(gpu) || matchMedia('(prefers-reduced-motion: reduce)').matches) { goStill(); return; }
    await wait(2500);
    if (document.hidden) return;
    let fps = await measureFps(2000);
    if (fps >= 45) return;
    if (fps >= 22) { // step down the resolution once, then check again
      world.renderer.setPixelRatio(Math.max(0.6, world.renderer.getPixelRatio() * 0.65));
      world.resize();
      await wait(1500);
      fps = await measureFps(2000);
    }
    if (fps < 22) goStill();
  } catch (e) { console.warn('quality', e?.message); }
}

const posters = {};
function poster(id) { if (!posters[id]) { posters[id] = new Image(); posters[id].src = '/poster-' + id + '.jpg'; } return posters[id]; }
function posterCanvas(w, h) {
  const im = poster(worldName());
  if (!im.complete || !im.naturalWidth) return null;
  const c = document.createElement('canvas'); c.width = w || im.naturalWidth; c.height = h || im.naturalHeight;
  const s = Math.max(c.width / im.naturalWidth, c.height / im.naturalHeight);
  c.getContext('2d').drawImage(im, (c.width - im.naturalWidth * s) / 2, (c.height - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
  return c;
}
function setMobileWall() {
  poster(worldName());
  phone.el.style.setProperty('--bp-wall', 'linear-gradient(180deg, rgba(20,8,30,.25), rgba(20,8,30,.55)), url(/poster-' + worldName() + '.jpg) center / cover');
}
if (mobile) setMobileWall(); else loadWorld();

setInterval(() => {
  if (!world || document.hidden || mobile) return;
  const c = world.envColor?.();
  if (c) phone.el.style.setProperty('--bp-env', c.map((v) => Math.round(v)).join(','));
}, 600);

// splash line, game-title style (blocky only)
const splash = $('.st-splash');
let splashI = 0;
setInterval(() => {
  if (document.hidden || worldName() !== 'blocky' || mobile) return;
  splashI = (splashI + 1) % SPLASH.length;
  splash.textContent = SPLASH[splashI];
  splash.classList.remove('st-pop'); void splash.offsetWidth; splash.classList.add('st-pop');
}, 6500);

// ---------- game HUDs: your paper money and bags drive every one ----------
const hearts = $('.hud-hearts'), hotbar = $('.hud-hotbar'), stars = $$('.hud-stars i'), mapRot = $('.hud-map-rot');
for (let i = 0; i < 10; i++) hearts.append(document.createElement('i'));
for (let i = 0; i < 9; i++) hotbar.append(document.createElement('span'));
let shownMoney = 0, moneyTarget = 0, moneyRaf = 0;
const binds = (k) => $$(`[data-bind="${k}"]`);
const setAll = (k, fn) => { for (const n of binds(k)) fn(n); };
function paintHud() {
  const s = wallet.state.sol, bags = wallet.bags(), inBags = bags.reduce((a, b) => a + b.value, 0);
  moneyTarget = net.st.sol ? wallet.worth() * net.st.sol : 0;
  if (!moneyRaf) moneyRaf = requestAnimationFrame(stepMoney);
  const solK = Math.max(0, Math.min(1, s / 10)), bagK = Math.max(0, Math.min(1, inBags / 10));
  setAll('solbar', (n) => (n.style.transform = `scaleX(${solK.toFixed(3)})`));
  setAll('bagsbar', (n) => (n.style.transform = `scaleX(${bagK.toFixed(3)})`));
  setAll('soln', (n) => setTxt(n, String(Math.round(solK * 100))));
  setAll('bagsn', (n) => setTxt(n, String(Math.round(bagK * 100))));
  setAll('stage', (n) => setTxt(n, String(wallet.state.stats.buys + wallet.state.stats.sells + 1)));
  setAll('alive', (n) => setTxt(n, String(net.lists.new.filter((m) => !net.coin(m)?.rugged).length || 0)));
  stars.forEach((st, i) => st.classList.toggle('on', i < bags.length));
  [...hearts.children].forEach((h, i) => { const k = s >= i + 1 ? 'full' : s >= i + 0.5 ? 'half' : ''; if (h.className !== k) h.className = k; });
  [...hotbar.children].forEach((slot, i) => {
    const b = bags[i], key = b ? b.p.mint : '';
    if (slot.dataset.m !== key) {
      slot.dataset.m = key; slot.replaceChildren();
      if (b) { const im = new Image(); im.src = net.img(b.p.mint); im.alt = ''; im.onerror = () => im.remove(); slot.append(im, Object.assign(document.createElement('em'), { textContent: tick(b.p.sym).slice(1, 5) })); }
    }
    slot.classList.toggle('sel', i === 0 && !!b);
  });
  // the hotbar only shows once you hold something, and the first bag pops in like an item pickup
  const had = !hotbar.classList.contains('st-empty');
  hotbar.classList.toggle('st-empty', !bags.length);
  if (bags.length && !had) { hotbar.classList.remove('st-pick-up'); void hotbar.offsetWidth; hotbar.classList.add('st-pick-up'); }
}
function setTxt(n, t) { if (n.textContent !== t) n.textContent = t; }
function stepMoney() {
  const d = moneyTarget - shownMoney;
  shownMoney += Math.abs(d) < 1 ? d : d * 0.18;
  setAll('money', (n) => setTxt(n, money(shownMoney)));
  moneyRaf = Math.abs(moneyTarget - shownMoney) >= 0.5 ? requestAnimationFrame(stepMoney) : 0;
}
// a round clock for the HUDs that have one (storm / round timer), counting down and looping
let clockLeft = 84;
setInterval(() => {
  if (document.hidden) return;
  clockLeft = clockLeft <= 0 ? 115 : clockLeft - 1;
  setAll('clock', (n) => setTxt(n, Math.floor(clockLeft / 60) + ':' + String(clockLeft % 60).padStart(2, '0')));
}, 1000);
setInterval(() => { if (world && !document.hidden && worldName() === 'city') mapRot.style.transform = `rotate(${((-(world.heading?.() || 0) * 180) / Math.PI).toFixed(1)}deg)`; }, 120);
paintHud();
net.on('hello', paintHud);

// ---------- live from the trenches: real rugs, bonds and launches ----------
const track = $('.st-ticker-track');
const events = [];
const pushEvent = (kind, mint, extra) => {
  const c = net.coin(mint);
  if (!c || !c.symbol) return;
  // one line per coin per kind in the recent window, so one busy coin can't fill the ticker
  if (events.slice(0, 8).some((e) => e.mint === mint && (e.kind === kind || kind === 'pump'))) return;
  events.unshift({ kind, mint, sym: c.symbol, at: Date.now(), extra, mc: net.mcOf(c) });
  events.length = Math.min(events.length, 18);
  if (!tickerVisible || track.childElementCount < 8) paintTicker();
};
net.on('rug', (m) => { pushEvent('rug', m.mint, m.drop != null ? '-' + Math.round(m.drop * 100) + '%' : ''); react('rug', m.mint); });
net.on('grad', (m) => react('grad', m.mint));
// the world itself reacts when a coin in the visible list rugs (a red hit) or bonds (a gold sweep), at most every 25 s
let lastReact = 0;
function react(kind, mint) {
  if (mobile || document.hidden || Date.now() - lastReact < 25000) return;
  if (!net.lists.new.slice(0, 14).includes(mint) && !net.lists.rising.slice(0, 14).includes(mint)) return;
  if (wallet.pos(mint)) return; // your own bag gets the full WASTED
  lastReact = Date.now();
  const r = document.querySelector('.st-react');
  r.className = 'st-react'; void r.offsetWidth; r.classList.add('st-react-' + kind);
  if (kind === 'rug' && world && !still) { world.fx({ gray: 0.55, slow: 0.6, push: 0.25 }); setTimeout(() => world.fx({ gray: 0, slow: 0, push: 0 }), 700); }
}
// today's biggest WASTED: the day's worst real rug cuts in once per visit, tap it to open that chart in the phone
const wst = $('.st-wst');
let wstMint = null, wstT = 0;
function hideWasted() { clearTimeout(wstT); wst.classList.remove('st-on'); }
async function showWasted() {
  try {
    const d = await fetch('/api/wasted').then((r) => (r.ok ? r.json() : null));
    const r = d?.top?.find((x) => x.sym && x.peakMc > x.rugMc);
    if (!r || document.hidden) return;
    try { if (sessionStorage.getItem('burner.wst') === r.mint) return; sessionStorage.setItem('burner.wst', r.mint); } catch {}
    wstMint = r.mint;
    const fall = usd(r.peakMc) + ' → ' + usd(r.rugMc) + (r.born && r.at > r.born ? ' · ' + age(r.at - r.born) + ' after launch' : '');
    // the card needs the bottom of the hero to itself; on phones (the visitor's screen is the burner) and on short laptop
    // screens (the pitch and game picker reach down there) the rug rings in on the phone instead, tap it for the chart
    if (mobile || wastedCardCrowded()) {
      phone.notify({ title: "today's biggest WASTED", body: tick(r.sym) + '  ' + fall, side: '-' + Math.round((1 - r.rugMc / r.peakMc) * 100) + '%', tone: 'dn',
        coin: { mint: r.mint, symbol: r.sym }, quiet: true, ms: 6500, tap: () => openWasted() });
      return;
    }
    wst.querySelector('small').textContent = "today's biggest" + (d.count > 1 ? ' · ' + d.count + ' rugs so far' : '');
    wst.querySelector('strong').textContent = tick(r.sym) + (r.name && r.name.toLowerCase() !== r.sym.toLowerCase() ? '  ' + r.name : '');
    wst.querySelector('em').textContent = fall + ' · ' + age(Date.now() - r.at) + ' ago';
    const pf = wst.querySelector('.st-wst-pf'); pf.style.backgroundImage = `url(${net.img(r.mint)})`;
    wst.classList.add('st-on');
    wstT = setTimeout(hideWasted, 8000);
  } catch {}
}
function wastedCardCrowded() {
  // where the card will land (its layout box, ignoring the slide-in transform) against the pitch, picker and key hints
  const h = hero.getBoundingClientRect();
  const card = { l: h.left + wst.offsetLeft, t: h.top + wst.offsetTop, r: h.left + wst.offsetLeft + wst.offsetWidth, b: h.top + wst.offsetTop + wst.offsetHeight };
  return ['.st-pitch h1', '.st-pitch p', '.st-cta', '.st-picker', '.st-keys'].some((s) => {
    const e = $(s);
    if (!e) return false;
    const rg = document.createRange(); rg.selectNodeContents(e); // what's drawn, not the full-width row box
    const r = rg.getBoundingClientRect();
    return r && r.width && card.l < r.right + 12 && r.left - 12 < card.r && card.t < r.bottom + 12 && r.top - 12 < card.b;
  });
}
wst.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') clearTimeout(wstT); });
wst.addEventListener('pointerleave', () => { if (wst.classList.contains('st-on')) wstT = setTimeout(hideWasted, 2500); });
function openWasted() {
  if (!wstMint) return;
  hideWasted();
  if (mobile) phoneHost.scrollIntoView({ behavior: 'smooth', block: 'center' }); else phone.raise();
  if (phone.view() === 'lock') phone.unlock();
  phone.open('chart', { mint: wstMint, tf: '5m', fit: true, rugged: true });
}
wst.addEventListener('click', openWasted);
setTimeout(() => { if (!params.has('still')) showWasted(); }, mobile ? 12000 : 9000);
net.on('grad', (m) => pushEvent('grad', m.mint));
net.on('new', (c) => { if (events.filter((e) => e.kind === 'new').length < 6) pushEvent('new', c.mint); });
net.on('tick', (changed) => { for (const c of changed) if (c.flags & 1 && Math.random() < 0.3) pushEvent('pump', c.mint); });
net.on('hello', () => { if (!events.length) for (const m of net.lists.new.slice(0, 8)) pushEvent('new', m); });
let tickerVisible = false;
new IntersectionObserver((es) => { tickerVisible = es[0].isIntersecting; if (!tickerVisible) paintTicker(); }).observe($('.st-ticker'));
function paintTicker() {
  if (!events.length) return;
  const label = { rug: 'RUGGED', grad: 'BONDED', new: 'NEW', pump: 'BIG BUY' };
  const items = events.map((e) => {
    const d = document.createElement('div');
    d.className = 'st-tk st-tk-' + e.kind;
    const im = new Image(); im.alt = ''; im.className = 'st-tk-pf'; im.src = net.img(e.mint); im.onerror = () => { im.style.visibility = 'hidden'; };
    const b = document.createElement('b'); b.textContent = tick(e.sym);
    const em = document.createElement('em'); em.textContent = label[e.kind];
    const sm = document.createElement('small'); sm.textContent = [e.extra, e.mc ? usd(e.mc) : '', age(Date.now() - e.at) + ' ago'].filter(Boolean).join(' · ');
    d.append(im, b, em, sm);
    return d;
  });
  track.replaceChildren(...items, ...items.map((n) => n.cloneNode(true)));
}

// ---------- game cards ----------
const cards = $('.st-cards');
GAMES.forEach((g, i) => {
  const b = document.createElement('button');
  b.className = 'st-card'; b.dataset.world = g.id; b.style.setProperty('--i', i);
  b.style.backgroundImage = `url(/poster-${g.id}.jpg)`;
  b.innerHTML = '<img class="st-card-phone" alt="" loading="lazy"><div class="st-card-txt"><b></b><small></small><em></em></div>';
  const img = b.querySelector('img'); img.src = `/skins/${g.id}.png`; img.onerror = () => img.remove();
  b.querySelector('b').textContent = g.label; b.querySelector('small').textContent = g.blurb; b.querySelector('em').textContent = 'for ' + g.tag;
  b.addEventListener('click', () => { setWorld(g.id); hero.scrollIntoView({ behavior: 'smooth' }); });
  // tilt toward the pointer while hovering (desktop)
  b.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = b.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    b.classList.add('st-tilting');
    b.style.transform = `rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 8).toFixed(2)}deg) translateZ(0)`;
  });
  b.addEventListener('pointerleave', () => { b.classList.remove('st-tilting'); b.style.transform = ''; });
  cards.append(b);
});
paintPicker();

// ---------- reveals + moments ----------
for (const s of $$('.st-rv')) [...s.children].forEach((c, i) => c.style.setProperty('--i', i));
const ro = new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('st-in');
    ro.unobserve(e.target);
    if (e.target.classList.contains('st-moments')) playMoments(e.target);
  }
}, { threshold: 0.15 });
$$('.st-rv').forEach((s) => ro.observe(s));
async function playMoments(sec) {
  const [w, p, st] = sec.querySelectorAll('.st-m');
  await wait(350); w.classList.add('st-go');
  await wait(600); p.classList.add('st-go');
  const count = p.querySelector('.st-m-count');
  tween(1100, (k) => { count.textContent = '+' + fmtSol(2.93 * k) + ' SOL'; }, ease.out);
  await wait(700); st.classList.add('st-go');
}

// ---------- teasers: muted autoplay only while mostly on screen, tap for sound ----------
const vio = new IntersectionObserver((es) => { for (const e of es) { const v = e.target; if (e.intersectionRatio >= 0.6) v.play().catch(() => {}); else v.pause(); } }, { threshold: [0, 0.6, 1] });
for (const fig of $$('.st-vid')) {
  const v = fig.querySelector('video'), b = fig.querySelector('.st-snd');
  vio.observe(v);
  const toggle = () => {
    v.muted = !v.muted;
    if (!v.muted) { v.currentTime = 0; v.play().catch(() => {}); for (const o of $$('.st-vid video')) if (o !== v) o.muted = true; }
    for (const f of $$('.st-vid')) { const s = f.querySelector('.st-snd'), vv = f.querySelector('video'); s.textContent = vv.muted ? 'sound off' : 'sound on'; s.classList.toggle('on', !vv.muted); }
  };
  b.addEventListener('click', toggle); v.addEventListener('click', toggle);
}

// ---------- download: straight from the latest github release (built there from the public code) ----------
// The links start on the release page and become direct file links once the release's assets are known: the
// installer when the release has one, else the portable zip. No answer from github: the release page still works.
const setSub = (t) => { for (const s of $$('[data-dl-sub]')) s.textContent = t; };
if (GITHUB.live) fetch(`https://api.github.com/repos/${GITHUB.repo}/releases/latest`).then((r) => (r.ok ? r.json() : null)).then((rel) => {
  if (!rel) return;
  const assets = rel.assets || [];
  const setup = assets.find((a) => /setup.*\.exe$/i.test(a.name)), zip = assets.find((a) => /\.zip$/i.test(a.name));
  const main = setup || zip;
  if (main) for (const a of $$('[data-dl]')) a.href = main.browser_download_url;
  if (zip) for (const a of $$('[data-zip]')) a.href = zip.browser_download_url;
  setSub([rel.tag_name, main ? Math.round(main.size / 1048576) + ' MB' : null, 'windows 10 / 11', 'free', 'open source'].filter(Boolean).join(' · '));
}).catch(() => {});
else {
  // no github release yet: the windows build from our own server
  fetch('/api/download').then((r) => r.json()).then((d) => {
    if (!d.available) return;
    for (const a of $$('[data-dl], [data-zip]')) a.href = d.url;
    setSub('windows 10 / 11 · ' + Math.round(d.size / 1048576) + ' MB · free');
  }).catch(() => {});
}

if (params.has('debug')) Object.assign(window, { net, wallet, phone, getWorld: () => world, setWorld });
