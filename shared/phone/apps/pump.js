// Pump: live launches as fixed slots that move with transforms, 1-tap paper buys.
import { el, tick, usd, sol, pct, age, setText } from '../fmt.js';
import { Ticker } from '../motion.js';
import { sfx } from '../sound.js';
import { ic } from '../icons.js';

const ROW = 58, MAX = 14;
const show = (v) => String(+(+v).toFixed(4)); // 0.1, 0.375, 2

export function pumpApp(ctx) {
  const { net, wallet } = ctx;
  let tab = 'new';
  let size = +(load('burner.size') || 0.5);
  if (!(size > 0 && size <= 1000)) size = 0.5;

  const live = el('span.bp-live');
  const seg = el('div.bp-seg');
  for (const [id, label] of [['new', 'New'], ['rising', 'Rising'], ['bonding', 'Bonding']]) {
    seg.append(el('button', { text: label, data: { tab: id }, on: { click: () => { if (tab === id) return; sfx.tap(); tab = id; paintSeg(); render(true); } } }));
  }
  // the one-tap buy size: tap it to type any amount
  const sizeBtn = el('button.bp-size', { on: { click: async () => {
    sfx.tap();
    const v = await ctx.amount({ side: 'size', value: size });
    if (v > 0) { size = +v; save('burner.size', size); paintSize(); }
  } } });
  const card = buildCard();
  const list = el('div.bp-list');
  const empty = el('div.bp-empty');
  list.append(empty);
  const v = el('section.bp-pump', null,
    el('header.bp-hd', null, el('h1', { text: 'Pump' }), live),
    el('div.bp-segrow', null, seg, sizeBtn),
    card.el, list);

  function paintSeg() { for (const b of seg.children) b.classList.toggle('bp-sel', b.dataset.tab === tab); }
  function paintSize() { sizeBtn.innerHTML = ic.bolt + '<b>' + show(size) + '</b>'; for (const r of rows.values()) setText(r.buy.lastChild, show(size)); }

  // ---------- rows ----------
  const rows = new Map(); // mint -> row
  let shown = [];
  function makeRow(c) {
    const nm = el('b'), sub = el('small'), mc = el('b'), m2 = el('small');
    const bar = el('i.bp-prog', null, el('i'));
    const buy = el('button.bp-buy', { on: { click: (e) => { e.stopPropagation(); doBuy(c.mint, buy); } } }, el('i', { html: ic.check }), el('span', { text: show(size) }));
    const r = el('div.bp-row', { on: { click: (e) => { sfx.tap(); ctx.open('chart', c.mint, e.currentTarget); } } },
      ctx.pfp(c, 38), el('div.bp-row-nm', null, nm, sub), el('div.bp-row-m', null, mc, m2, bar), buy);
    setText(nm, c.name || c.symbol);
    const row = { el: r, nm, sub, mc, m2, bar, buy, mint: c.mint, y: null, tick: new Ticker(mc, usd, { k: 90, d: 20 }), lastFlash: 0 };
    list.append(r);
    return row;
  }
  function patch(row) {
    const c = net.coin(row.mint);
    if (!c) return;
    setText(row.sub, tick(c.symbol) + ' · ' + age(Date.now() - c.created));
    row.tick.set(net.mcOf(c));
    if (tab === 'bonding') {
      const p = c.prog ?? 0;
      setText(row.m2, c.prog == null ? '' : Math.round(p * 100) + '% bonded');
      row.bar.firstChild.style.transform = `scaleX(${p.toFixed(3)})`;
      row.bar.style.visibility = c.prog == null ? 'hidden' : '';
    } else if (tab === 'rising' && c.pc5 != null) {
      setText(row.m2, pct(c.pc5 / 100) + ' 5m');
      row.m2.dataset.dir = c.pc5 >= 0 ? 'up' : 'dn';
    } else {
      // buys in the last 5 minutes (Jupiter), or the last minute when the server has the coin's trades open
      const n = c.b5 ?? c.b1;
      setText(row.m2, n == null ? (c.complete ? 'bonded' : Date.now() - c.created < 60e3 ? 'new' : '') : n + (n === 1 ? ' buy' : ' buys'));
      delete row.m2.dataset.dir;
    }
    row.el.classList.toggle('bp-rugged', !!c.rugged);
    row.el.classList.toggle('bp-held', !!wallet.pos(row.mint));
    if (c.flags & 1 && Date.now() - row.lastFlash > 4000) {
      row.lastFlash = Date.now();
      row.el.animate([{ backgroundColor: 'rgba(43,224,122,.28)' }, { backgroundColor: 'rgba(43,224,122,0)' }], { duration: 1400, easing: 'ease-out' });
    }
  }
  // copycats and ticker wars: a launch sharing a name or a ticker with one the phone saw earlier gets a "copy" tag. The
  // first one stays untagged: the real original can be older than anything this phone has seen.
  const norm = (s) => {
    const raw = String(s || '').toLowerCase().trim();
    const k = raw.replace(/[^\p{L}\p{N}]+/gu, '') || raw.replace(/\s+/g, ''); // "_____" or "???" still match themselves
    return [...k].length >= 3 ? k : null;
  };
  const keysOf = (c) => [norm(c.name), norm(c.symbol) && '$' + norm(c.symbol)].filter(Boolean);
  function firstSeen() {
    const first = new Map();
    for (const c of net.coins.values()) if (c.created) for (const k of keysOf(c)) if (!(first.get(k) <= c.created)) first.set(k, c.created);
    return first;
  }
  const isCopy = (c, first) => keysOf(c).some((k) => first.get(k) < c.created);
  const mcap = (m) => net.mcOf(net.coin(m)) ?? 0;
  // New: a burst (launches linked by a shared name or ticker) is one row, "×N", where its newest launch would sit,
  // showing the one you hold or else the one with the most money in it (the oldest wins ties, so the row doesn't hop
  // to every fresh $3K copy)
  function ids() {
    const l = (net.lists[tab] || []).filter((m) => net.coin(m));
    const n = new Map();
    if (tab !== 'new') return { want: l.slice(0, MAX), n };
    const root = new Map(l.map((m) => [m, m]));
    const find = (m) => { while (root.get(m) !== m) m = root.get(m); return m; };
    const byKey = new Map();
    for (const m of l) for (const k of keysOf(net.coin(m))) {
      if (byKey.has(k)) { const a = find(m), b = find(byKey.get(k)); if (a !== b) root.set(a, b); } else byKey.set(k, m);
    }
    const groups = new Map();
    for (const m of l) { const r = find(m); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); }
    const want = [], done = new Set();
    for (const m of l) {
      const r = find(m), g = groups.get(r);
      if (g.length < 2) { want.push(m); continue; }
      if (done.has(r)) continue;
      done.add(r);
      const lead = g.find((x) => wallet.pos(x)) || g.reduceRight((a, b) => (mcap(b) > mcap(a) ? b : a));
      want.push(lead); n.set(lead, g.length);
    }
    return { want: want.slice(0, MAX), n };
  }
  function render(reset) {
    list.classList.toggle('bp-tab-bonding', tab === 'bonding');
    const { want, n } = ids();
    const first = firstSeen();
    const set = new Set(want);
    for (const [m, r] of rows) {
      if (!set.has(m)) {
        rows.delete(m);
        if (reset) r.el.remove();
        else { r.el.classList.add('bp-out'); setTimeout(() => r.el.remove(), 380); }
      }
    }
    want.forEach((m, i) => {
      let r = rows.get(m);
      const fresh = !r;
      if (fresh) { r = makeRow(net.coin(m)); rows.set(m, r); }
      const y = i * ROW;
      if (fresh && !reset && i === 0) {
        r.el.style.transform = `translate3d(0,${-ROW}px,0)`; r.el.style.opacity = '0';
        requestAnimationFrame(() => requestAnimationFrame(() => { r.el.style.transform = `translate3d(0,${y}px,0)`; r.el.style.opacity = ''; }));
      } else if (r.y !== y) {
        if (fresh) r.el.style.transition = 'none';
        r.el.style.transform = `translate3d(0,${y}px,0)`;
        if (fresh) requestAnimationFrame(() => (r.el.style.transition = ''));
      }
      r.y = y;
      patch(r);
      if (n.has(m)) r.sub.dataset.n = n.get(m); else delete r.sub.dataset.n;
      r.el.classList.toggle('bp-copy', !n.has(m) && isCopy(net.coin(m), first));
    });
    shown = want;
    setText(empty, net.st.lastMsg ? (tab === 'bonding' ? 'nothing close to bonding right now' : 'waiting for launches…') : net.st.mode === 'poll' ? 'reconnecting…' : 'connecting to the trenches…');
    empty.style.display = want.length ? 'none' : '';
  }

  async function doBuy(mint, btn) {
    const r = await ctx.trade('buy', net.coin(mint), size, btn);
    if (!r?.ok) return;
    btn.classList.remove('bp-done'); void btn.offsetWidth; btn.classList.add('bp-done');
    burst(btn);
    setTimeout(() => btn.classList.remove('bp-done'), 1100);
  }

  // ---------- your best bag, pinned on top ----------
  function buildCard() {
    const pf = el('span.bp-bc-pf'), nm = el('b'), sub = el('small'), big = el('b.bp-bc-big'), mc = el('small');
    const sv = el('div.bp-bc-spark');
    const half = el('button.bp-btn2', { text: 'sell 50%', on: { click: (e) => { e.stopPropagation(); sellBest(0.5, e.currentTarget); } } });
    const all = el('button.bp-btn1', { text: 'sell all', on: { click: (e) => { e.stopPropagation(); sellBest(1, e.currentTarget); } } });
    const any = el('button.bp-btn2', { text: 'any %', on: { click: async (e) => {
      e.stopPropagation(); sfx.tap();
      const b = wallet.bags().find((x) => x.p.mint === cur), btn = e.currentTarget;
      const p = cur && (await ctx.amount({ side: 'sell', coin: b?.c || net.coin(cur), held: b?.value ?? null }));
      if (p > 0) sellBest(Math.min(p, 100) / 100, btn);
    } } });
    const node = el('div.bp-bagcard', { on: { click: () => { if (cur) { sfx.tap(); ctx.open('chart', cur); } } } },
      el('div.bp-bc-row', null, pf, el('div.bp-bc-nm', null, nm, sub), el('div.bp-bc-r', null, big, mc)), sv, el('div.bp-bc-act', null, half, any, all));
    let cur = null;
    const bigT = new Ticker(big, (v) => sol(v) + ' SOL', { k: 90, d: 20 });
    function sellBest(f, btn) {
      if (!cur) return;
      ctx.trade('sell', net.coin(cur), f, btn);
    }
    return {
      el: node,
      paint() {
        const b = wallet.bags()[0];
        node.classList.toggle('bp-none', !b);
        if (!b) { cur = null; return; }
        if (cur !== b.p.mint) { cur = b.p.mint; pf.replaceChildren(ctx.pfp(b.c || { mint: cur, symbol: b.p.sym }, 42)); bigT.ready = false; }
        setText(nm, tick(b.p.sym));
        setText(sub, 'in ' + sol(b.p.cost) + ' SOL · ' + age(Date.now() - b.p.opened) + ' ago');
        bigT.set(b.value);
        big.dataset.dir = b.x >= 1 ? 'up' : 'dn';
        setText(mc, pct(b.x - 1) + ' · ' + usd(b.mc));
        ctx.spark(sv, (b.c?.hist || []).filter(([t]) => t >= b.p.opened - 30e3), { w: 300, h: 40, base: b.p.entryP });
      },
    };
  }

  function paintLive() {
    const lpm = net.st.lpm;
    setText(live, net.st.connected || net.st.mode === 'poll' ? 'live' + (lpm != null ? ' · ' + lpm + ' launches/min' : '') : 'reconnecting');
    live.classList.toggle('bp-off', !net.st.connected && net.st.mode !== 'poll');
  }

  paintSeg(); paintSize();
  return {
    el: v,
    enter() { paintLive(); card.paint(); render(true); },
    leave() {},
    tick(changed) {
      card.paint();
      const vis = new Set(shown);
      for (const c of changed) if (vis.has(c.mint)) { const r = rows.get(c.mint); if (r) patch(r); }
    },
    onNew() { if (tab === 'new' && ctx.phone?.view() === 'pump') render(false); },
    // the trenches' big moments land on the row itself: a stamp slams in, the row flashes
    onStamp(mint, kind) {
      const r = rows.get(mint);
      if (!r || r.el.querySelector('.bp-stamp')) return false;
      const st = el('b.bp-stamp.bp-stamp-' + kind, { text: kind === 'rug' ? 'RUGGED' : 'BONDED' });
      r.el.append(st);
      r.el.animate([{ backgroundColor: kind === 'rug' ? 'rgba(232,35,58,.32)' : 'rgba(255,194,61,.3)' }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 1600, easing: 'ease-out' });
      return shown.includes(mint) && ctx.phone?.view() === 'pump';
    },
    onLists() { if (ctx.phone?.view() === 'pump') render(false); },
    onWallet() { card.paint(); for (const r of rows.values()) r.el.classList.toggle('bp-held', !!wallet.pos(r.mint)); },
    second() { paintLive(); if (tab === 'new') for (const m of shown) { const r = rows.get(m), c = net.coin(m); if (r && c) setText(r.sub, tick(c.symbol) + ' · ' + age(Date.now() - c.created)); } card.paint(); },
  };
}

// a little coin burst out of the buy button
function burst(btn) {
  const row = btn.closest('.bp-row');
  if (!row) return;
  const x = btn.offsetLeft + btn.offsetWidth / 2, y = btn.offsetTop + btn.offsetHeight / 2;
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('i');
    d.className = 'bp-spark-dot';
    d.style.left = x + 'px'; d.style.top = y + 'px';
    row.append(d);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, dist = 26 + Math.random() * 30;
    d.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + (Math.cos(a) * dist).toFixed(1) + 'px,' + (Math.sin(a) * dist).toFixed(1) + 'px) scale(.3)', opacity: 0 }], { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(.2,.8,.4,1)' }).onfinish = () => d.remove();
  }
}

function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, String(v)); } catch {} }
