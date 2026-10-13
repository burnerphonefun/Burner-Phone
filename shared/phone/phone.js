// The burner phone: a phone in a hand that comes up from the corner of the screen.
// DOM, not WebGL, so the screen stays crisp and clickable; CSS 3D transforms driven by springs.
import { el, clock, dateLine, tick, pct, sol, usd, age, mult, setText } from './fmt.js';
import { Spring, every, wait } from './motion.js';
import { sfx } from './sound.js';
import { ic, signalSvg } from './icons.js';
import { hands } from './hands.js';
import { createBanners } from './banners.js';
import { pumpApp } from './apps/pump.js';
import { chartApp } from './apps/chart.js';
import { bagsApp } from './apps/bags.js';
import { walletApp } from './apps/wallet.js';
import { cameraApp } from './apps/camera.js';
import { spark } from './apps/spark.js';
import { askAmount } from './amount.js';

const W = 360, H = 780, BEZEL = 13; // screen size (9:19.5) and bezel
const PW = W + BEZEL * 2, PH = H + BEZEL * 2;
const TABS = [['pump', 'Pump'], ['chart', 'Chart'], ['bags', 'Bags'], ['wallet', 'Wallet'], ['camera', 'Camera']];

export function createPhone(host, opts) {
  const { net, wallet, mode = 'demo', grab, onFx, onEvent = () => {} } = opts;
  let skin = opts.skin || 'city';
  let hotkey = opts.hotkey || null; // the overlay's put-away key, shown on the lock screen
  function hintText() { return mode !== 'overlay' ? 'tap to unlock' : hotkey ? 'tap to unlock · ' + hotkey.toLowerCase() + ' hides it' : 'tap or press any key to unlock'; }
  const listeners = [];

  // ---------- DOM ----------
  const layer = el('div.bp-layer' + (mode === 'mobile' ? '.bp-mobile' : ''));
  const rig = el('div.bp-rig');
  const handBack = el('div.bp-hand-wrap');
  const handFront = el('div.bp-hand-wrap.bp-front');
  const phone = el('div.bp-phone');
  const screen = el('div.bp-screen');
  const glass = el('div.bp-glass');
  const edge = el('div.bp-edge');
  phone.append(el('i.bp-key.bp-k1'), el('i.bp-key.bp-k2'), el('i.bp-key.bp-k3'), screen, glass, edge);
  rig.append(handBack, phone, handFront);
  layer.append(rig);
  host.append(layer);
  const banners = createBanners(host, { onFx, skin: () => skin });

  // status bar + island
  const status = el('div.bp-status', null,
    el('span', null, el('span.bp-time'), el('span.bp-modechip')),
    el('span.bp-right', null, el('span.bp-sigw'), el('span.bp-batt', null, el('i.bp-batt-fill'), el('b.bp-batt-bolt', { html: ic.bolt }))));
  const island = el('div.bp-island', null,
    el('div.bp-isl-compact', null, el('span.bp-isl-pf'), el('span.bp-isl-pct')),
    el('div.bp-isl-full', null, el('span.bp-isl-icon'), el('div.bp-isl-txt', null, el('b'), el('small')), el('span.bp-isl-side')));
  const wall = el('div.bp-wall');
  const views = el('div.bp-views');
  const tabbar = el('nav.bp-tabs');
  const homebar = el('div.bp-homebar', { title: 'home' });
  const call = el('div.bp-call');
  screen.append(wall, views, tabbar, homebar, call, status, island);

  // ---------- apps ----------
  const ctx = {
    net, wallet, mode, grab,
    open: (id, arg, from) => open(id, arg, from),
    back: () => open(prevApp && prevApp !== current ? prevApp : 'pump'),
    notify: (n) => notify(n),
    say: (title, body, tone) => notify({ title, body, tone, quiet: true }),
    buzz: () => buzz(),
    pfp, spark,
    skin: () => skin,
    phone: null,
    celebrate: (r) => onSold(r),
    trade: (side, c, amt, btn) => trade(side, c, amt, btn),
    // any amount: a keypad sheet on the phone, resolves with SOL (buy/size) or % (sell), or null
    amount: (o) => askAmount(screen, { balance: wallet.state?.sol ?? null, solUsd: net.st?.sol || null, ...o }),
    shot: (o) => banners.flash(o),
  };
  const apps = { pump: pumpApp(ctx), chart: chartApp(ctx), bags: bagsApp(ctx), wallet: walletApp(ctx), camera: cameraApp(ctx) };
  const lock = buildLock();
  const home = buildHome();
  views.append(lock.el, home.el);
  for (const k in apps) { apps[k].el.classList.add('bp-view', 'bp-app'); views.append(apps[k].el); }
  for (const [id, label] of TABS) {
    tabbar.append(el('button.bp-tab', { data: { app: id }, on: { click: (e) => { sfx.tap(); open(id, undefined, e.currentTarget); } } }, el('i', { html: ic[id] }), el('span', { text: label })));
  }
  homebar.addEventListener('click', () => { sfx.swoosh(); open('home'); });

  let current = 'lock', prevApp = 'pump', lastApp = 'pump';
  // apps zoom open from whatever you tapped (a row grows into its chart, a tab into its app); the old one falls back
  function originOf(node) {
    if (!node?.getBoundingClientRect) return null;
    const s = screen.getBoundingClientRect(), r = node.getBoundingClientRect();
    if (!s.width || !s.height) return null;
    return [((r.left + r.width / 2 - s.left) / s.width) * 100, ((r.top + r.height / 2 - s.top) / s.height) * 100];
  }
  function show(id, arg, fromNode) {
    const target = id === 'lock' ? lock : id === 'home' ? home : apps[id];
    if (!target) return;
    const from = current;
    const o = originOf(fromNode);
    for (const v of views.children) v.classList.toggle('bp-on', v === target.el);
    if (from !== id) {
      const old = from === 'lock' ? lock : from === 'home' ? home : apps[from];
      old?.leave?.();
      if (old && from !== 'lock') { old.el.classList.remove('bp-leave'); void old.el.offsetWidth; old.el.classList.add('bp-leave'); setTimeout(() => old.el.classList.remove('bp-leave'), 260); }
      target.el.style.setProperty('--ox', o ? o[0].toFixed(1) + '%' : '50%');
      target.el.style.setProperty('--oy', o ? o[1].toFixed(1) + '%' : '60%');
      target.el.classList.toggle('bp-zoom', !!o);
      target.el.classList.remove('bp-enter'); void target.el.offsetWidth; target.el.classList.add('bp-enter');
    }
    current = id;
    screen.dataset.view = id; // view-level styling hook lives on the screen, never a click target
    tabbar.classList.toggle('bp-hide', id === 'lock' || id === 'home' || id === 'camera');
    for (const b of tabbar.children) b.classList.toggle('bp-sel', b.dataset.app === id);
    target.enter?.(arg);
    if (apps[id]) { if (from !== id && apps[from]) prevApp = from; lastApp = id; }
    syncSub();
  }
  function open(id, arg, fromNode) { if (id === current && !arg) return; show(id, arg, fromNode); }

  // ---------- lock screen ----------
  function buildLock() {
    const date = el('div.bp-lk-date'), time = el('div.bp-lk-time');
    const acts = el('div.bp-lk-acts'), notes = el('div.bp-lk-notes');
    const cam = el('button.bp-lk-btn', { html: ic.camera, title: 'camera', on: { click: (e) => { e.stopPropagation(); sfx.tap(); open('camera'); } } });
    const snd = el('button.bp-lk-btn', { title: 'sound', on: { click: (e) => { e.stopPropagation(); opts.toggleSound?.(); paintSnd(); } } });
    const paintSnd = () => { snd.innerHTML = opts.isMuted?.() ? ic.mute : ic.sound; };
    paintSnd();
    const hint = el('div.bp-lk-hint', { text: hintText() });
    const v = el('section.bp-view.bp-lock', { on: { click: () => unlock() } }, date, time, acts, notes, el('div.bp-lk-bottom', null, snd, hint, cam));
    const cards = new Map();
    function paint() {
      const d = new Date();
      setText(date, dateLine(d)); setText(time, clock(d));
      const bags = wallet.bags().slice(0, 3);
      const want = bags.length ? bags.map((b) => ({ key: b.p.mint, b })) : hot().map((c) => ({ key: 'hot:' + c.mint, c }));
      const keys = new Set(want.map((w) => w.key));
      for (const [k, card] of cards) if (!keys.has(k)) { card.el.remove(); cards.delete(k); }
      want.forEach((w, i) => {
        let card = cards.get(w.key);
        if (!card) { card = actCard(w); cards.set(w.key, card); }
        if (acts.children[i] !== card.el) acts.insertBefore(card.el, acts.children[i] || null);
        card.update(w);
      });
    }
    function actCard(w) {
      const c0 = w.b ? w.b.c || net.coin(w.b.p.mint) : w.c;
      const top = el('div.bp-act-top', null, pfp(c0 || { mint: w.key, symbol: w.b?.p.sym }, 34), el('div.bp-act-nm', null, el('b'), el('small')), el('div.bp-act-big'));
      const sv = el('div.bp-act-spark');
      const card = el('div.bp-act' + (w.b ? '' : '.bp-act-hot'), { on: { click: (e) => { e.stopPropagation(); unlock(); open('chart', w.b ? w.b.p.mint : w.c.mint); } } }, top, sv);
      return {
        el: card,
        update(w2) {
          if (w2.b) {
            const { p, x, value, mc } = w2.b;
            setText(top.querySelector('b'), tick(p.sym));
            setText(top.querySelector('small'), 'your bag · ' + sol(value) + ' SOL · ' + usd(mc));
            const big = top.querySelector('.bp-act-big'); setText(big, pct(x - 1)); big.dataset.dir = x >= 1 ? 'up' : 'dn';
            spark(sv, (net.coin(p.mint)?.hist || []).filter(([t]) => t >= p.opened - 30e3), { w: 300, h: 34, base: p.entryP });
          } else {
            const c = net.coin(w2.c.mint) || w2.c;
            net.ensureHist(c.mint);
            setText(top.querySelector('b'), tick(c.symbol));
            setText(top.querySelector('small'), 'hot right now · ' + usd(net.mcOf(c)));
            const big = top.querySelector('.bp-act-big'); const ch = c.pc5 != null ? c.pc5 / 100 : change5m(c);
            setText(big, ch != null ? pct(ch) : usd(net.mcOf(c))); big.dataset.dir = (ch ?? 0) >= 0 ? 'up' : 'dn';
            spark(sv, c.hist || [], { w: 300, h: 34 });
            if (ch != null) sv.dataset.dir = ch >= 0 ? 'up' : 'dn'; // colour by the real 5 m move, not our short history
          }
        },
      };
    }
    return { el: v, enter: paint, paint, leave() {} };
  }

  // the best coin to show a newcomer: rising first, else the newest with buys
  function hot() {
    const pick = net.lists.rising.map((m) => net.coin(m)).filter(Boolean).slice(0, 1);
    if (pick.length) return pick;
    const n = net.lists.new.map((m) => net.coin(m)).filter((c) => c && c.b1).sort((a, b) => (b.b1 || 0) - (a.b1 || 0));
    return n.slice(0, 1);
  }
  function change5m(c) {
    const h = c.hist || [];
    if (h.length < 2) return null;
    const now = Date.now();
    const old = h.find(([t]) => now - t < 5 * 60e3);
    if (!old || h[h.length - 1][0] - old[0] < 60e3) return null; // not enough history to say
    return old[1] > 0 ? h[h.length - 1][1] / old[1] - 1 : null;
  }

  // ---------- home ----------
  function buildHome() {
    const worthB = el('b'), pnlS = el('small');
    const wWorth = el('div.bp-wid.bp-wid-worth', { on: { click: () => open('wallet') } }, el('span', { text: 'burner' }), worthB, pnlS);
    const lpf = el('div.bp-wid-pf'), lnm = el('b'), lsub = el('small');
    const wLaunch = el('div.bp-wid.bp-wid-new', { on: { click: () => open('pump') } }, el('span', { text: 'just launched' }), lpf, lnm, lsub);
    const grid = el('div.bp-home-grid');
    const names = { pump: 'Pump', chart: 'Chart', bags: 'Bags', wallet: 'Wallet', camera: 'Camera' };
    for (const id of ['camera']) grid.append(appIcon(id, names[id]));
    const dock = el('div.bp-dock');
    for (const id of ['pump', 'chart', 'bags', 'wallet']) dock.append(appIcon(id, names[id], true));
    const v = el('section.bp-view.bp-home', null, el('div.bp-home-wids', null, wWorth, wLaunch), grid, dock);
    function appIcon(id, name, docked) {
      return el('button.bp-icon.bp-icon-' + id, { on: { click: () => { sfx.tap(); open(id); } } }, el('i', { html: ic[id] }), docked ? null : el('span', { text: name }));
    }
    function paint() {
      const w = wallet.worth();
      setText(worthB, sol(w) + ' SOL');
      const d = w - 10; setText(pnlS, (d >= 0 ? '+' : '') + sol(d) + ' SOL all time'); pnlS.dataset.dir = d >= 0 ? 'up' : 'dn';
      const c = net.coin(net.lists.new[0]);
      if (c) {
        if (lpf.dataset.m !== c.mint) { lpf.replaceChildren(pfp(c, 44)); lpf.dataset.m = c.mint; }
        setText(lnm, tick(c.symbol)); setText(lsub, age(Date.now() - c.created) + ' ago · ' + usd(net.mcOf(c)));
      } else { setText(lnm, 'waiting for launches'); setText(lsub, ''); }
    }
    return { el: v, enter: paint, paint, leave() {} };
  }

  // ---------- coin picture: coloured initial underneath, picture on top when it loads ----------
  function pfp(c, size = 38) {
    const sym = String(c?.symbol || '?').replace(/^\$+/, '');
    const hue = [...(c?.mint || sym)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);
    const box = el('span.bp-pfp', { style: { width: size + 'px', height: size + 'px', background: `hsl(${Math.abs(hue) % 360} 55% 42%)` } }, el('em', { text: sym.slice(0, 1).toUpperCase() }));
    if (c?.mint && c.mint.length > 30) {
      // a seconds-old coin's picture often isn't up yet: try again twice, 20 s apart, while it's young
      const load = (tries) => {
        const img = new Image();
        img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.crossOrigin = 'anonymous';
        img.onload = () => box.classList.add('bp-pfp-ok');
        img.onerror = () => {
          img.remove();
          const young = c.created && Date.now() - c.created < 5 * 60e3;
          if (tries > 0 && young && box.isConnected) setTimeout(() => { if (box.isConnected) load(tries - 1); }, 20000);
        };
        img.src = net.img(c.mint);
        box.append(img);
      };
      load(2);
    }
    return box;
  }

  // ---------- island + notifications ----------
  const queue = [];
  const notes = []; // lock screen stack
  let islBusy = false;
  function notify(n) {
    if (!n.quiet) { notes.unshift({ ...n, t: Date.now() }); notes.length = Math.min(notes.length, 5); paintNotes(); }
    if (n.buzz !== false) buzz();
    if (!n.quiet && current === 'lock') return; // the lock screen stack already shows it
    queue.push(n);
    if (!islBusy) nextNote();
  }
  async function nextNote() {
    const n = queue.shift();
    if (!n) { islBusy = false; island.classList.remove('bp-isl-open'); return; }
    islBusy = true;
    const full = island.querySelector('.bp-isl-full');
    setText(full.querySelector('b'), n.title || '');
    setText(full.querySelector('small'), n.body || '');
    const icon = full.querySelector('.bp-isl-icon');
    icon.replaceChildren(n.coin ? pfp(n.coin, 34) : el('i', { html: ic[n.icon || 'pump'] }));
    const side = full.querySelector('.bp-isl-side'); setText(side, n.side || ''); side.dataset.dir = n.tone || '';
    island.dataset.tone = n.tone || '';
    island.classList.add('bp-isl-open');
    // a note with tap() can be tapped while it's open (and closes at once); the rest are look-only
    let cut;
    island.classList.toggle('bp-isl-tap', !!n.tap);
    island.onclick = n.tap ? (e) => { e.stopPropagation(); island.onclick = null; n.tap(); cut?.(); } : null;
    await Promise.race([wait(n.ms || 2600), new Promise((r) => { cut = r; })]);
    island.onclick = null;
    island.classList.remove('bp-isl-open', 'bp-isl-tap');
    await wait(260);
    nextNote();
  }
  function paintNotes() {
    const box = lock.el.querySelector('.bp-lk-notes');
    box.replaceChildren(...notes.slice(0, 3).map((n) => el('div.bp-note', null,
      el('span.bp-note-ic', null, n.coin ? pfp(n.coin, 30) : el('i', { html: ic[n.icon || 'pump'] })),
      el('div.bp-note-tx', null, el('b', { text: n.title || '' }), el('small', { text: n.body || '' })),
      el('time', { text: age(Date.now() - n.t) }))));
  }
  function paintIsland() {
    const best = wallet.bags()[0];
    const cmp = island.querySelector('.bp-isl-compact');
    if (!best) { island.classList.remove('bp-isl-live'); return; }
    island.classList.add('bp-isl-live');
    const pf = cmp.querySelector('.bp-isl-pf');
    if (pf.dataset.m !== best.p.mint) { pf.replaceChildren(pfp(best.c || { mint: best.p.mint, symbol: best.p.sym }, 22)); pf.dataset.m = best.p.mint; }
    const pc = cmp.querySelector('.bp-isl-pct'); setText(pc, pct(best.x - 1)); pc.dataset.dir = best.x >= 1 ? 'up' : 'dn';
  }

  // ---------- status bar ----------
  function paintStatus() {
    setText(status.querySelector('.bp-modechip'), wallet.kind === 'real' ? 'REAL' : '');
    setText(status.querySelector('.bp-time'), clock());
    const bars = net.signal();
    const sw = status.querySelector('.bp-sigw');
    if (sw.dataset.b !== String(bars)) { sw.innerHTML = signalSvg(bars); sw.dataset.b = bars; }
    const s = wallet.state.sol, w = wallet.worth();
    const fill = status.querySelector('.bp-batt-fill');
    fill.style.transform = `scaleX(${Math.max(0.04, Math.min(1, s / 10))})`;
    status.querySelector('.bp-batt').classList.toggle('bp-charging', w > 10.0001);
    status.querySelector('.bp-batt').classList.toggle('bp-low', s < 1.5);
  }

  // ---------- motion: raise / lower / sway / buzz ----------
  let up = false, scale = 1, swayX = 0, swayY = 0, shake = 0, shakeKind = 'buzz', shakeT0 = 0;
  const raise = new Spring(0, { k: 210, d: 21, onUpdate: () => place() });
  const sx = new Spring(0, { k: 40, d: 12, onUpdate: () => place() });
  const sy = new Spring(0, { k: 40, d: 12, onUpdate: () => place() });
  function place() {
    if (mode === 'mobile') return;
    const r = raise.v;
    const down = PH * scale - 50 * scale - 8;
    let x = 0, y = (1 - r) * down, rz = -5 + (1 - r) * 5 + sx.v * 1.4, ry = -9 + sx.v * 4, rx = 5 - sy.v * 3;
    if (shake) {
      const t = (performance.now() - shakeT0) / 1000;
      const amp = shakeKind === 'ring' ? (Math.sin(t * Math.PI * 2.5) > 0 ? 1 : 0.15) * 2.6 : Math.max(0, 1 - t / 0.32) * 2.4;
      x += Math.sin(t * 2 * Math.PI * 23) * amp; rz += Math.sin(t * 2 * Math.PI * 17) * amp * 0.25;
    }
    rig.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${scale}) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
    phone.style.transform = `translateY(${(raise.vel * 4).toFixed(2)}px)`;
    layer.classList.toggle('bp-is-down', r < 0.5);
    // the lock screen and home wallpaper drift a little against the hand: depth
    if (current === 'lock' || current === 'home') wall.style.transform = `translate3d(${(-sx.v * 8).toFixed(1)}px,${(-sy.v * 8).toFixed(1)}px,0) scale(1.06)`;
  }
  function setUp(v, why) {
    if (mode === 'mobile') return;
    up = v;
    if (v) raise.set(1, { k: 210, d: 21 }); else raise.set(0, { k: 320, d: 36 });
    if (v && why !== 'ring') sfx.swoosh();
    if (!v) { lockAfter = setTimeout(() => { if (!up) show('lock'); }, 1200); } else clearTimeout(lockAfter);
    onEvent('raise', v);
  }
  let lockAfter = 0;
  function buzz(kind = 'buzz', ms = 320) {
    // on a real phone the burner buzzes the visitor's own phone too (Android; needs a tap first, iOS ignores it)
    if (mode === 'mobile' && navigator.vibrate && navigator.userActivation?.hasBeenActive) {
      try { navigator.vibrate(kind === 'ring' ? [400, 200, 400, 200, 400] : [70, 60, 70]); } catch {}
    }
    shakeKind = kind; shakeT0 = performance.now(); shake = 1;
    edge.classList.remove('bp-edge-go', 'bp-edge-red'); void edge.offsetWidth; edge.classList.add(kind === 'ring' ? 'bp-edge-red' : 'bp-edge-go');
    if (kind === 'buzz') sfx.buzz();
    every(() => { place(); if (performance.now() - shakeT0 > ms) { shake = 0; place(); return false; } });
  }
  function fit() {
    const r = host.getBoundingClientRect();
    if (mode === 'mobile') {
      scale = r.width / W;
      screen.style.transform = `scale(${scale})`;
      screen.style.height = r.height / scale + 'px';
      layer.style.setProperty('--bp-h', r.height / scale + 'px');
      return;
    }
    scale = Math.max(0.5, Math.min(1.05, r.height / 1010)) * (opts.scale || 1);
    if (r.width < 900) scale *= Math.max(0.7, r.width / 1100);
    layer.style.setProperty('--bp-right', Math.max(12, r.width * 0.055) + 'px');
    place();
  }
  if (mode !== 'mobile') {
    const onMove = (e) => {
      const r = host.getBoundingClientRect();
      sx.set(Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)));
      sy.set(Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2)));
    };
    addEventListener('pointermove', onMove, { passive: true });
    listeners.push(() => removeEventListener('pointermove', onMove));
    phone.addEventListener('click', (e) => { if (!up) { e.stopPropagation(); e.preventDefault(); setUp(true); } }, true);
  }
  const ro = new ResizeObserver(fit); ro.observe(host);
  fit();

  function unlock() {
    if (current !== 'lock') return;
    sfx.swoosh();
    lock.el.classList.add('bp-unlocking');
    setTimeout(() => lock.el.classList.remove('bp-unlocking'), 420);
    show(lastApp || 'pump');
  }

  // ---------- live data → screens ----------
  // the phone remembers what you sold for 15 minutes, to call out paper hands and good exits
  const recentExits = () => wallet.state.hist.filter((t) => !t.part && t.exitP > 0 && Date.now() - t.closed < 15 * 60e3 && !wallet.pos(t.mint));
  function syncSub() {
    const view = current === 'chart' ? apps.chart.mint() : null;
    net.setSub([...wallet.holds(), ...recentExits().map((t) => t.mint)], view);
  }
  function watchExits() {
    for (const t of recentExits()) {
      const c = net.coin(t.mint);
      if (!c || c.p == null) continue;
      const since = c.p / t.exitP;
      if (!t.calledPaper && since >= 2) {
        t.calledPaper = Date.now(); wallet.save();
        notify({ title: 'paper hands', body: 'you sold ' + tick(t.sym) + ' at ' + mult(t.x) + '. it ran ' + mult(since) + ' since', side: pct(since - 1), tone: 'up', coin: c });
        awardOnce('paper', 'Paper hands', 'sold ' + tick(t.sym) + ' at ' + mult(t.x) + ', it ran ' + mult(since) + ' after');
      } else if (!t.calledDodge && (since <= 0.3 || c.rugged)) {
        t.calledDodge = Date.now(); wallet.save();
        notify({ title: 'good exit', body: tick(t.sym) + ' fell ' + pct(since - 1) + ' after you sold at ' + mult(t.x), side: pct(since - 1), tone: 'gold', coin: c });
      }
    }
  }
  const lastNotice = new Map();
  listeners.push(net.on('tick', (changed) => {
    for (const e of wallet.watch()) {
      if (e.type === 'wasted') wasted(e);
      if (e.type === 'diamond') achieve('diamond', 'Diamond hands', `held ${tick(e.p.sym)} through -${Math.round(e.p.dip * 100)}%`);
    }
    watchExits();
    // ±25% moves on bags since the last notice
    for (const b of wallet.bags()) {
      const last = lastNotice.get(b.p.mint) ?? 1;
      if (b.c && !b.p.wasted && Math.abs(b.x / last - 1) >= 0.25) {
        lastNotice.set(b.p.mint, b.x);
        const upMove = b.x > last;
        notify({ title: tick(b.p.sym) + (upMove ? ' is running' : ' is dumping'), body: 'your bag is ' + sol(b.value) + ' SOL', side: pct(b.x - 1), tone: upMove ? 'up' : 'dn', coin: b.c });
      }
    }
    const app = apps[current];
    app?.tick?.(changed);
    if (current === 'lock') lock.paint();
    if (current === 'home') home.paint();
    paintIsland();
    onEvent('tick');
  }));
  listeners.push(net.on('new', (c) => { apps.pump.onNew?.(c); if (current === 'home') home.paint(); }));
  listeners.push(net.on('lists', () => { apps.pump.onLists?.(); }));
  listeners.push(net.on('trades', (m) => apps.chart.onTrades?.(m)));
  listeners.push(net.on('candle', (m) => apps.chart.onCandle?.(m)));
  listeners.push(net.on('candles', (m) => apps.chart.onCandles?.(m)));
  listeners.push(net.on('hello', () => { apps[current]?.enter?.(); if (current === 'lock') lock.paint(); syncSub(); }));
  // rugs and bondings anywhere in the visible list: a stamp on the row, and now and then the island says it
  let lastDrama = 0;
  const drama = (mint, kind, side) => {
    if (wallet.pos(mint) || recentExits().some((t) => t.mint === mint)) return; // your own bags (and ones you just sold) get their own lines
    const onScreen = apps.pump.onStamp?.(mint, kind);
    const c = net.coin(mint);
    if (!onScreen || !c || !up && mode !== 'mobile' || Date.now() - lastDrama < 40000) return;
    lastDrama = Date.now();
    const old = c.created ? age(Date.now() - c.created) + ' old' : '';
    notify(kind === 'rug'
      ? { title: tick(c.symbol) + ' just rugged', body: [old, 'you dodged it'].filter(Boolean).join(' · '), side, tone: 'dn', coin: c, quiet: true, buzz: false }
      : { title: tick(c.symbol) + ' bonded', body: [old, 'off the curve, onto the pool'].filter(Boolean).join(' · '), side: usd(net.mcOf(c)), tone: 'gold', coin: c, quiet: true, buzz: false });
  };
  listeners.push(net.on('rug', (m) => drama(m.mint, 'rug', m.drop != null ? '-' + Math.round(m.drop * 100) + '%' : '')));
  listeners.push(net.on('grad', (m) => drama(m.mint, 'grad')));
  listeners.push(net.on('rug', (m) => {
    const p = wallet.pos(m.mint);
    if (!p || p.wasted) return;
    const c = net.coin(m.mint);
    const x = c?.p != null ? (p.tokens * c.p) / p.cost : 0;
    if (x < 0.6) { p.wasted = Date.now(); wallet.save(); wasted({ p, c, drop: m.drop, reason: m.reason }); }
    else if (!p.dumpNoted) { p.dumpNoted = Date.now(); notify({ title: tick(p.sym) + (m.reason === 'dev' ? ': the dev sold' : ' dumped from the top'), body: "you're still " + pct(x - 1) + '. take something off?', side: '-' + Math.round((m.drop || 0) * 100) + '%', tone: 'dn', coin: c }); }
  }));
  listeners.push(wallet.on((ev) => {
    for (const k in apps) apps[k].onWallet?.(ev);
    syncSub(); paintIsland(); paintStatus();
    // paper ⇄ real swapped live (desktop app): every screen repaints from the new wallet
    if (ev.type === 'swap') { if (current === 'lock') lock.paint(); else if (current === 'home') home.paint(); else apps[current]?.enter?.(); }
    if (ev.type === 'failed') notify({ title: 'trade failed', body: (ev.err || 'nothing was spent') + (ev.stage ? ' · ' + ev.stage : ''), tone: 'dn', icon: 'x', quiet: true, buzz: false });
    if (ev.type === 'buy') {
      if (wallet.award('first-buy')) achieve('first-buy', 'Ape mode', 'first buy on the burner');
    }
    onEvent('wallet', ev);
  }));

  // ---------- big moments ----------
  let lastBanner = 0;
  async function wasted(e) {
    const { p, c } = e;
    const lossNow = p.cost - p.tokens * (c?.p ?? 0);
    wallet.state.stats.rugs++; wallet.save();
    awardOnce('wasted', 'Wasted', 'got rugged on ' + tick(p.sym));
    // the phone rings at the edge; if it's down it peeks up
    const wasUp = up;
    if (!up && mode !== 'mobile') { raise.set(0.42, { k: 160, d: 14 }); }
    ringCall({ p, c, drop: e.drop, reason: e.reason, loss: lossNow });
    buzz('ring', 2600); sfx.ring();
    if (Date.now() - lastBanner < 10000) return;
    lastBanner = Date.now();
    await wait(700);
    banners.wasted({ sym: tick(p.sym), loss: lossNow, reason: e.reason });
    onEvent('wasted', { p, c });
    await wait(3600);
    if (!wasUp && !up && mode !== 'mobile') raise.set(0, { k: 320, d: 36 });
  }
  function ringCall({ p, c, drop, reason, loss }) {
    const now = p.tokens * (c?.p ?? 0);
    call.replaceChildren(
      el('div.bp-call-who', null, c ? pfp(c, 92) : el('em', { text: '?' })),
      el('h2', { text: 'RUG ALERT' }),
      el('p', { text: tick(p.sym) + ' · ' + (reason === 'dev' ? 'the dev dumped' : reason === 'liq' ? 'liquidity pulled' : 'it fell off a cliff') }),
      el('div.bp-call-loss', { text: drop != null ? '-' + Math.round(drop * 100) + '%' : 'rugged' }),
      el('div.bp-call-lt', { text: `your ${sol(p.cost)} SOL is now ${sol(now)}` }),
      el('div.bp-call-btns', null,
        el('button.bp-call-sell', { on: { click: (ev) => { ev.stopPropagation(); hideCall(); trade('sell', net.coin(p.mint) || c, 1, null); } } }, el('i', { html: ic.x }), el('span', { text: 'sell' })),
        el('button.bp-call-hold', { on: { click: (ev) => { ev.stopPropagation(); hideCall(); } } }, el('i', { html: ic.skull }), el('span', { text: 'hold' }))));
    call.classList.add('bp-call-on');
    clearTimeout(call._t); call._t = setTimeout(hideCall, 9000);
  }
  function hideCall() { call.classList.remove('bp-call-on'); }

  // ---------- one trade flow for every button: pending, real-money confirm, result ----------
  async function trade(side, c, amt, btn) {
    if (!c) return { err: 'no coin' };
    if (btn?.classList.contains('bp-pending')) return { err: 'busy' };
    if (wallet.kind === 'real' && !(await confirmReal(side, c, amt))) return { err: 'cancelled' };
    btn?.classList.add('bp-pending');
    let r;
    try { r = side === 'buy' ? await wallet.buy(c, amt) : await wallet.sell(c, amt); }
    catch (e) { r = { err: String(e?.message || e || 'failed').slice(0, 80) }; }
    btn?.classList.remove('bp-pending');
    if (r?.ok) {
      if (side === 'buy') {
        sfx.buy();
        notify({ title: 'bought ' + tick(c.symbol), body: amt + ' SOL in at ' + usd(net.mcOf(c)) + (r.impact > 0.02 ? ' · ' + pct(r.impact) + ' impact' : '') + (r.sig ? ' · on chain' : ''), coin: c, tone: 'up', buzz: false, quiet: true, ms: 1800 });
      } else { sfx.sell(); onSold(r); }
      return r;
    }
    if (r?.err !== 'cancelled' && r?.err !== 'busy') {
      btn?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      notify({ title: r?.err || 'trade failed', body: wallet.kind === 'real' ? 'nothing was spent' : '', tone: 'dn', icon: 'x', quiet: true, buzz: false });
    }
    return r;
  }
  // the first real trade of a session asks once; "don't ask again" sticks for this browser
  let realOk = (() => { try { return localStorage.getItem('burner.realConfirm') === 'off'; } catch { return false; } })();
  function confirmReal(side, c, amt) {
    if (realOk) return Promise.resolve(true);
    return new Promise((res) => {
      const what = side === 'buy' ? 'buy ' + amt + ' SOL of ' + tick(c.symbol) : 'sell ' + Math.round(amt * 100) + '% of your ' + tick(c.symbol);
      const keep = el('input', { type: 'checkbox' });
      const close = (ok) => { sheet.classList.remove('bp-on'); setTimeout(() => sheet.remove(), 260); if (ok && keep.checked) { realOk = true; try { localStorage.setItem('burner.realConfirm', 'off'); } catch {} } res(ok); };
      const sheet = el('div.bp-sheet', null, el('div.bp-sheet-card', null,
        el('b', { text: 'real trade' }),
        el('p', { text: what + ' from ' + (wallet.address || 'your wallet').slice(0, 4) + '…' + (wallet.address || '').slice(-4) + '. this moves real SOL on chain.' }),
        el('label.bp-sheet-keep', null, keep, el('span', { text: "don't ask again" })),
        el('div.bp-sheet-btns', null,
          el('button.bp-btn2', { text: 'cancel', on: { click: () => close(false) } }),
          el('button.bp-btn1', { text: side === 'buy' ? 'buy for real' : 'sell for real', on: { click: () => close(true) } }))));
      screen.append(sheet);
      requestAnimationFrame(() => sheet.classList.add('bp-on'));
    });
  }

  function onSold(r) {
    if (!r?.ok) return;
    if (r.x >= 2 && Date.now() - lastBanner > 10000) {
      lastBanner = Date.now();
      banners.passed({ sym: tick(r.sym), profit: r.got - r.cost, x: r.x });
      awardOnce('2x', 'Two times', `closed ${tick(r.sym)} at ${r.x.toFixed(1)}x`);
      onEvent('passed', r);
    } else {
      notify({ title: (r.got >= r.cost ? 'sold ' : 'cut ') + tick(r.sym), body: (r.got - r.cost >= 0 ? '+' : '') + sol(r.got - r.cost) + ' SOL', side: r.x.toFixed(2) + 'x', tone: r.got >= r.cost ? 'up' : 'dn', icon: 'bags', buzz: false });
    }
    if (wallet.state.stats.sells >= 10) awardOnce('veteran', 'Burner veteran', '10 trades on one burner');
  }
  function awardOnce(id, title, text) { if (wallet.award(id)) achieve(id, title, text); }
  function achieve(id, title, text) {
    if (skin === 'blocky') banners.achievement({ title, text });
    else notify({ title: 'achievement: ' + title.toLowerCase(), body: text, icon: 'bolt', tone: 'gold', buzz: false });
    sfx.achieve();
  }

  // ---------- timers ----------
  const sec = setInterval(() => {
    if (document.hidden) return;
    paintStatus();
    if (current === 'lock') lock.paint();
    apps[current]?.second?.();
  }, 1000);

  // the hand puts one phone away and pulls out the one that belongs in the new game, staying on the same app
  async function swap(s) {
    if (mode === 'mobile' || !up) { setSkin(s); return; }
    raise.set(0, { k: 420, d: 40 });
    await wait(240);
    setSkin(s);
    raise.set(1, { k: 210, d: 21 });
    sfx.swoosh();
  }
  function setSkin(s) {
    skin = s;
    layer.dataset.skin = s;
    banners.setSkin(s);
    const h = hands[s] || hands.city;
    handBack.innerHTML = mode === 'mobile' ? '' : h.back;
    handFront.innerHTML = mode === 'mobile' ? '' : h.front;
    for (const k in apps) apps[k].onSkin?.(s);
  }
  setSkin(skin);
  paintStatus();
  show('lock');

  const api = {
    raise: () => setUp(true), lower: () => setUp(false), toggle: () => setUp(!up),
    isUp: () => up, view: () => current,
    open, unlock, notify, buzz, setSkin, swap, skin: () => skin, achieve,
    // hide everything we draw (the desktop overlay hides the phone for a clean screen capture)
    setHidden(h) { layer.style.visibility = h ? 'hidden' : ''; banners.el.style.visibility = h ? 'hidden' : ''; },
    // the overlay's put-away key, shown on the lock screen (the player can change it from the tray)
    setKey(k) { hotkey = k || null; const h = layer.querySelector('.bp-lk-hint'); if (h) h.textContent = hintText(); },
    el: layer, rig, phone, screen, banners,
    destroy() { clearInterval(sec); ro.disconnect(); listeners.forEach((f) => f()); layer.remove(); },
  };
  ctx.phone = api;
  if (mode === 'mobile') { layer.classList.add('bp-up'); }
  return api;
}
