// Chart: one coin full screen. Real candles from the server's candle store (5s / 1m / 5m), volume, a crosshair,
// your own buys and sells marked on it, the tape and one-tap trades.
import { el, tick, usd, sol, pct, age, setText } from '../fmt.js';
import { Ticker, every } from '../motion.js';
import { sfx } from '../sound.js';
import { ic } from '../icons.js';

const TFS = [['5s', 5000], ['1m', 60000], ['5m', 300000]];
const CW = 328, CH = 200, VOL_H = 30;
const ms = (t) => (t < 1e12 ? t * 1000 : t);

export function chartApp(ctx) {
  const { net, wallet } = ctx;
  let mint = null, tf = '1m', trades = [], zoom = 48, loading = false, dirty = true;
  let srv = { '5s': [], '1m': [], '5m': [] };
  let hover = null; // { x, y } in canvas css px while the pointer is over the chart
  let anim = null;  // the last close easing toward its new value

  const pf = el('span.bp-ch-pf'), nm = el('b'), sub = el('small');
  const mc = el('b.bp-ch-mc'), chg = el('small.bp-ch-chg');
  const mcT = new Ticker(mc, usd, { k: 90, d: 20 });
  const tfs = el('div.bp-seg.bp-seg-sm');
  for (const [label] of TFS) tfs.append(el('button', { text: label, data: { tf: label }, on: { click: () => { sfx.tap(); tf = label; paintTf(); loadCandles(mint, tf); dirty = true; draw(); } } }));
  const cv = el('canvas.bp-ch-cv');
  const note = el('div.bp-ch-note');
  const stats = el('div.bp-ch-stats');
  const statEls = {};
  for (const [k, label] of [['u1', 'buyers 1m'], ['h', 'holders'], ['dev', 'dev'], ['prog', 'bonded']]) {
    const b = el('b'), s = el('small', { text: label });
    statEls[k] = { b, s };
    stats.append(el('div.bp-ch-stat', null, b, s));
  }
  const prog = el('i.bp-prog.bp-ch-prog', null, el('i'));
  const tape = el('div.bp-tape');
  const pos = el('div.bp-ch-pos');
  const buys = el('div.bp-ch-btns.bp-ch-buys');
  for (const a of [0.1, 0.5, 1]) buys.append(el('button', { on: { click: (e) => doBuy(a, e.currentTarget) } }, el('small', { text: 'buy' }), el('b', { text: a + ' SOL' })));
  const sells = el('div.bp-ch-btns.bp-ch-sells');
  for (const f of [0.25, 0.5, 1]) sells.append(el('button', { on: { click: (e) => doSell(f, e.currentTarget) } }, el('small', { text: 'sell' }), el('b', { text: f === 1 ? 'all' : f * 100 + '%' })));
  const v = el('section.bp-chart', null,
    el('header.bp-ch-hd', null,
      el('button.bp-backbtn', { html: ic.back, on: { click: () => { sfx.tap(); ctx.back(); } } }),
      pf, el('div.bp-ch-nm', null, nm, sub), el('div.bp-ch-r', null, mc, chg)),
    el('div.bp-ch-tfrow', null, tfs, note),
    el('div.bp-ch-box', null, cv),
    stats, prog, tape,
    el('div.bp-ch-act', null, pos, buys, sells));

  // zoom: wheel or pinch; crosshair: hover or a one-finger drag
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(16, Math.min(160, Math.round(zoom * (e.deltaY > 0 ? 1.15 : 0.87)))); dirty = true; draw(); }, { passive: false });
  const pts = new Map(); let pinch0 = 0, zoom0 = zoom;
  cv.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); zoom0 = zoom; hover = null; } });
  cv.addEventListener('pointermove', (e) => {
    if (pts.size === 2 && pts.has(e.pointerId)) {
      pts.set(e.pointerId, e);
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch0) { zoom = Math.max(16, Math.min(160, Math.round(zoom0 * pinch0 / d))); dirty = true; draw(); }
      return;
    }
    if (e.pointerType === 'mouse' || pts.has(e.pointerId)) { hover = { x: e.offsetX, y: e.offsetY }; dirty = true; draw(); }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; if (e.pointerType !== 'mouse') { hover = null; dirty = true; draw(); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hover = null; dirty = true; draw(); });

  function paintTf() { for (const b of tfs.children) b.classList.toggle('bp-sel', b.dataset.tf === tf); }
  paintTf();

  async function load(m) {
    mint = m; trades = []; srv = { '5s': [], '1m': [], '5m': [] }; dirty = true; hover = null;
    const c = net.coin(m);
    // fresh coins read best on 5s candles, older ones on 1m
    tf = c?.created && Date.now() - c.created < 10 * 60e3 ? '5s' : '1m'; paintTf();
    pf.replaceChildren(ctx.pfp(c || { mint: m }, 40));
    mcT.ready = false;
    paintHead(); paintStats(); paintPos(); paintTape(); draw();
    loading = true; setText(note, 'loading chart…');
    const [j] = await Promise.all([net.fetchCoin(m), loadCandles(m, tf)]);
    if (mint !== m) return;
    loading = false;
    if (j) {
      trades = (j.trades || []).map((t) => [ms(t[0]), t[1], t[2], t[3], t[4]]);
      if (!c && j.coin) pf.replaceChildren(ctx.pfp(j.coin, 40));
    }
    setText(note, srv[tf].length || trades.length ? '' : 'live price only');
    dirty = true; paintHead(); paintStats(); paintTape(); paintPos(); draw();
  }
  async function loadCandles(m, key) {
    if (!m) return;
    try {
      const r = await fetch(net.base + '/api/candles/' + m + '?tf=' + key, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (mint !== m || !Array.isArray(j.candles)) return;
      srv[key] = j.candles.map((k) => [ms(k[0]), +k[1], +k[2], +k[3], +k[4], k[5] == null ? null : +k[5], k[6] ? 1 : 0]).filter((k) => k[4] > 0).slice(-300);
      dirty = true; draw();
    } catch {}
  }

  function paintHead() {
    const c = net.coin(mint);
    if (!c) { setText(nm, 'pick a coin'); setText(sub, ''); mcT.set(null); setText(chg, ''); return; }
    setText(nm, c.name || c.symbol);
    setText(sub, tick(c.symbol) + ' · ' + (c.created ? age(Date.now() - c.created) + ' old' : '') + (c.complete ? ' · bonded' : ''));
    mcT.set(net.mcOf(c));
    const ks = series();
    if (ks.length > 1) { const x = ks[ks.length - 1][4] / ks[Math.max(0, ks.length - zoom)][1] - 1; setText(chg, pct(x) + ' in view'); chg.dataset.dir = x >= 0 ? 'up' : 'dn'; } else setText(chg, '');
    v.classList.toggle('bp-rugged', !!c.rugged);
  }
  function paintStats() {
    const c = net.coin(mint) || {};
    if (c.u1 != null) { setText(statEls.u1.b, c.u1); setText(statEls.u1.s, 'buyers 1m'); }
    else { setText(statEls.u1.b, c.b5 ?? '–'); setText(statEls.u1.s, 'buys 5m'); }
    setText(statEls.h.b, c.h != null ? Number(c.h).toLocaleString('en-US') : '–');
    const dvNow = c.dv != null ? c.dv : null;
    setText(statEls.dev.b, c.devSold && !(dvNow > 0.05) ? 'sold' : dvNow != null ? dvNow.toFixed(1) + '%' : c.devPct != null ? c.devPct.toFixed(1) + '%' : '–');
    statEls.dev.b.dataset.dir = c.devSold ? 'dn' : '';
    setText(statEls.dev.s, c.devSold && !(dvNow > 0.05) ? 'dev' : dvNow != null ? 'dev holds' : 'dev bought');
    if (c.complete) { setText(statEls.prog.b, c.liq ? usd(c.liq) : 'bonded'); setText(statEls.prog.s, c.liq ? 'liquidity' : 'curve'); }
    else { setText(statEls.prog.b, c.prog != null ? Math.round(c.prog * 100) + '%' : '–'); setText(statEls.prog.s, 'bonded'); }
    prog.firstChild.style.transform = `scaleX(${(c.complete ? 1 : c.prog || 0).toFixed(3)})`;
  }
  function paintTape() {
    const now = Date.now();
    const rows = trades.slice(0, 5).map((t) => el('div.bp-tr' + (t[1] ? '.bp-tr-b' : '.bp-tr-s'), null,
      el('span', { text: t[1] ? 'buy' : 'sell' }), el('b', { text: sol(t[2]) + ' SOL' }), el('em', { text: net.st.sol ? usd(t[3] * 1e9 * net.st.sol) : '' }), el('small', { text: (t[4] || '').slice(0, 4) }), el('time', { text: age(now - t[0]) })));
    tape.replaceChildren(...(rows.length ? rows : [el('div.bp-tr-none', { text: loading ? '' : 'no trades seen yet' })]));
  }
  function paintPos() {
    const p = wallet.pos(mint);
    v.classList.toggle('bp-holding', !!p);
    if (!p) { pos.replaceChildren(); return; }
    const m = wallet.mark(p);
    pos.replaceChildren(el('span', { text: 'your bag' }), el('b', { text: sol(p.cost) + ' → ' + sol(m.value) + ' SOL' }), el('em', { text: pct(m.x - 1), data: { dir: m.x >= 1 ? 'up' : 'dn' } }));
  }

  // server candles when it has them, else candles built here from trades + the live price
  function series() {
    const step = TFS.find((t) => t[0] === tf)[1];
    const c = net.coin(mint);
    const live = c?.hist || [];
    let base = srv[tf];
    if (base.length < 2) base = build(step);
    if (!base.length) return base;
    // keep the open candle moving with the live price between server pushes
    const lastP = live.length ? live[live.length - 1] : null;
    if (lastP) {
      const out = base.slice();
      const bucket = Math.floor(lastP[0] / step) * step;
      const last = out[out.length - 1];
      if (bucket === last[0]) out[out.length - 1] = [last[0], last[1], Math.max(last[2], lastP[1]), Math.min(last[3], lastP[1]), lastP[1], last[5], last[6]];
      else if (bucket > last[0]) out.push([bucket, last[4], Math.max(last[4], lastP[1]), Math.min(last[4], lastP[1]), lastP[1], null, 1]);
      return out;
    }
    return base;
  }
  function build(step) {
    const c = net.coin(mint);
    const pts = [];
    for (const t of trades) pts.push([t[0], t[3], t[2], 0]);
    for (const [t, p] of c?.hist || []) pts.push([t, p, 0, 1]);
    pts.sort((a, b) => a[0] - b[0]);
    const out = [];
    let cur = null;
    for (const [t, p, vol, est] of pts) {
      if (!(p > 0)) continue;
      const b = Math.floor(t / step) * step;
      if (!cur || cur[0] !== b) { if (cur) out.push(cur); const o = cur ? cur[4] : p; cur = [b, o, Math.max(o, p), Math.min(o, p), p, vol || null, est]; }
      else { cur[2] = Math.max(cur[2], p); cur[3] = Math.min(cur[3], p); cur[4] = p; if (vol) cur[5] = (cur[5] || 0) + vol; if (!est) cur[6] = 0; }
    }
    if (cur) out.push(cur);
    return out;
  }

  let raf = 0;
  function draw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
  function paint() {
    if (!dirty || ctx.phone?.view() !== 'chart') return;
    dirty = false;
    const dpr = Math.min(3, (window.devicePixelRatio || 1) * 1.25);
    if (cv.width !== Math.round(CW * dpr)) { cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, CW, CH);
    let ks = series().slice(-zoom);
    const solUsd = net.st.sol || 0;
    const style = getComputedStyle(v);
    const upC = style.getPropertyValue('--bp-up').trim() || '#2BE07A', dnC = style.getPropertyValue('--bp-dn').trim() || '#E8233A';
    const gridC = style.getPropertyValue('--bp-grid').trim() || 'rgba(255,255,255,.07)', txtC = style.getPropertyValue('--bp-dim').trim() || '#8b8b96';
    const accC = style.getPropertyValue('--bp-accent').trim() || '#FF5A1F', textC = style.getPropertyValue('--bp-text').trim() || '#fff';
    const font = style.fontFamily;
    if (ks.length < 2) {
      g.fillStyle = txtC; g.font = '600 13px ' + font; g.textAlign = 'center';
      g.fillText(loading ? 'loading…' : 'waiting for trades', CW / 2, CH / 2);
      return;
    }
    // the last close eases to its new value instead of jumping
    const lastK = ks[ks.length - 1];
    if (anim && anim.t === lastK[0]) {
      const k = Math.min(1, (performance.now() - anim.t0) / 260);
      const c = anim.from + (anim.to - anim.from) * (1 - Math.pow(1 - k, 3));
      ks = ks.slice(); ks[ks.length - 1] = [lastK[0], lastK[1], Math.max(lastK[2], c), Math.min(lastK[3], c), c, lastK[5], lastK[6]];
    }
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const k of ks) { lo = Math.min(lo, k[3]); hi = Math.max(hi, k[2]); if (k[5]) vmax = Math.max(vmax, k[5]); }
    const p = wallet.pos(mint);
    if (p && p.entryP > lo * 0.5 && p.entryP < hi * 2) { lo = Math.min(lo, p.entryP); hi = Math.max(hi, p.entryP); }
    const logS = hi / lo > 4;
    const f = (x) => (logS ? Math.log(x) : x);
    const a = f(lo), b = f(hi), span = (b - a) || Math.abs(a) * 0.1 || 1;
    const top = 12, bot = CH - VOL_H - 6, right = CW - 46;
    const Y = (x) => top + (1 - (f(x) - a) / span) * (bot - top);
    const inv = (y) => { const fv = b - ((y - top) / (bot - top)) * span; return logS ? Math.exp(fv) : fv; };
    g.font = '600 10px ' + font; g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let i = 0; i <= 3; i++) {
      const y = top + (i / 3) * (bot - top);
      g.strokeStyle = gridC; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(right, Math.round(y) + 0.5); g.stroke();
      g.fillStyle = txtC; g.fillText(usd(inv(y) * 1e9 * solUsd), right + 5, y);
    }
    const n = ks.length, cw = right / Math.max(n, 12), body = Math.max(1.5, cw * 0.62), x0 = right - n * cw;
    const X = (i) => i * cw + cw / 2 + x0;
    // volume underneath
    if (vmax > 0) for (let i = 0; i < n; i++) {
      const k = ks[i]; if (!k[5]) continue;
      const h = Math.max(1, (k[5] / vmax) * (VOL_H - 4));
      g.fillStyle = k[4] >= k[1] ? upC : dnC; g.globalAlpha = 0.32;
      g.fillRect(X(i) - body / 2, CH - h, body, h);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      const [, o, h, l, c, , est] = ks[i];
      const x = X(i), upK = c >= o;
      g.strokeStyle = g.fillStyle = upK ? upC : dnC;
      g.globalAlpha = est ? 0.5 : 1;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(h)); g.lineTo(Math.round(x) + 0.5, Y(l)); g.stroke();
      const y1 = Y(Math.max(o, c)), y2 = Y(Math.min(o, c));
      if (est) g.strokeRect(x - body / 2 + 0.5, y1 + 0.5, Math.max(1, body - 1), Math.max(1, y2 - y1));
      else g.fillRect(x - body / 2, y1, body, Math.max(1.2, y2 - y1));
    }
    g.globalAlpha = 1;
    // your entry + your trades on the chart
    if (p) {
      const y = Y(p.entryP);
      if (y > top - 2 && y < bot + 2) {
        g.setLineDash([4, 4]); g.strokeStyle = accC; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(0, y); g.lineTo(right, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = accC; g.textAlign = 'left'; g.fillText('your entry', 4, y - 8);
      }
    }
    const t0 = ks[0][0], step = TFS.find((t) => t[0] === tf)[1];
    const marks = [];
    if (p && p.opened >= t0) marks.push([p.opened, p.entryP, 1]);
    for (const h of wallet.state.hist || []) if (h.mint === mint && h.closed >= t0 && h.exitP) marks.push([h.closed, h.exitP, 0]);
    for (const [t, pr, buy] of marks) {
      const i = Math.floor((t - t0) / step); if (i < 0 || i >= n) continue;
      const x = X(i), y = Math.max(top + 6, Math.min(bot - 6, Y(pr)));
      g.fillStyle = buy ? upC : dnC;
      g.beginPath();
      if (buy) { g.moveTo(x, y + 4); g.lineTo(x - 5, y + 12); g.lineTo(x + 5, y + 12); } else { g.moveTo(x, y - 4); g.lineTo(x - 5, y - 12); g.lineTo(x + 5, y - 12); }
      g.closePath(); g.fill();
    }
    // last price pill
    const last = ks[n - 1][4], ly = Y(last);
    g.setLineDash([2, 3]); g.strokeStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.moveTo(0, ly); g.lineTo(right, ly); g.stroke(); g.setLineDash([]);
    g.fillStyle = last >= ks[n - 1][1] ? upC : dnC;
    roundRect(g, right + 1, ly - 8, 45, 16, 4); g.fill();
    g.fillStyle = '#0b0a09'; g.font = '700 10px ' + font; g.fillText(usd(last * 1e9 * solUsd), right + 5, ly + 0.5);
    // crosshair + the candle under it
    let shown = ks[n - 1];
    if (hover && hover.x >= 0 && hover.x <= right && hover.y >= 0 && hover.y <= CH) {
      const i = Math.max(0, Math.min(n - 1, Math.floor((hover.x - x0) / cw)));
      shown = ks[i];
      const x = X(i);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, CH); g.stroke();
      if (hover.y >= top && hover.y <= bot) { g.beginPath(); g.moveTo(0, Math.round(hover.y) + 0.5); g.lineTo(right, Math.round(hover.y) + 0.5); g.stroke(); }
      g.setLineDash([]);
      if (hover.y >= top && hover.y <= bot) {
        g.fillStyle = textC; roundRect(g, right + 1, hover.y - 8, 45, 16, 4); g.fill();
        g.fillStyle = '#0b0a09'; g.fillText(usd(inv(hover.y) * 1e9 * solUsd), right + 5, hover.y + 0.5);
      }
      const d = new Date(shown[0]);
      const tl = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + (step < 60000 ? ':' + String(d.getSeconds()).padStart(2, '0') : '');
      g.font = '600 10px ' + font; const tw = g.measureText(tl).width + 10;
      g.fillStyle = 'rgba(0,0,0,.7)'; roundRect(g, Math.min(right - tw, Math.max(0, x - tw / 2)), CH - 15, tw, 14, 4); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(tl, Math.min(right - tw / 2, Math.max(tw / 2, x)), CH - 8);
      g.textAlign = 'left';
    }
    // OHLC readout (market cap terms)
    const M = (x) => usd(x * 1e9 * solUsd);
    const txt = `O ${M(shown[1])}  H ${M(shown[2])}  L ${M(shown[3])}  C ${M(shown[4])}` + (shown[5] ? `  ·  ${sol(shown[5])} SOL` : '');
    g.font = '600 9.5px ' + font; g.fillStyle = txtC; g.textAlign = 'left'; g.fillText(txt, 4, 6);
  }

  async function doBuy(a, btn) {
    const c = net.coin(mint);
    await ctx.trade('buy', c, a, btn);
  }
  async function doSell(f, btn) {
    await ctx.trade('sell', net.coin(mint), f, btn);
  }

  function pokeLast() {
    const ks = series();
    const k = ks[ks.length - 1];
    if (!k) return;
    const prev = anim && anim.t === k[0] ? anim.to : k[4];
    if (prev === k[4]) return;
    anim = { t: k[0], from: prev, to: k[4], t0: performance.now() };
    every(() => { dirty = true; paint(); return performance.now() - anim.t0 < 280; });
  }

  return {
    el: v,
    mint: () => mint,
    enter(m) {
      const target = m || mint || pickDefault();
      if (target && target !== mint) load(target);
      else { dirty = true; paintHead(); paintStats(); paintPos(); paintTape(); draw(); }
    },
    leave() { hover = null; },
    tick(changed) {
      if (!mint) return;
      if (changed.some((c) => c.mint === mint)) { pokeLast(); dirty = true; paintHead(); paintStats(); draw(); }
      paintPos();
    },
    onTrades(m) {
      if (m.mint !== mint) return;
      const seen = new Set(trades.map((t) => t[0] + ':' + t[2] + ':' + t[4]));
      const add = (m.tr || []).map((t) => [ms(t[0]), t[1], t[2], t[3], t[4]]).filter((t) => !seen.has(t[0] + ':' + t[2] + ':' + t[4]));
      if (!add.length) return;
      trades = [...add, ...trades].sort((x, y) => y[0] - x[0]).slice(0, 600);
      dirty = true; paintTape(); draw();
    },
    onCandle(m) {
      if (m.mint !== mint || !srv[m.tf] || !Array.isArray(m.k)) return;
      const k = [ms(m.k[0]), +m.k[1], +m.k[2], +m.k[3], +m.k[4], m.k[5] == null ? null : +m.k[5], m.k[6] ? 1 : 0];
      const arr = srv[m.tf];
      if (arr.length && arr[arr.length - 1][0] === k[0]) arr[arr.length - 1] = k;
      else if (!arr.length || k[0] > arr[arr.length - 1][0]) { arr.push(k); if (arr.length > 300) arr.shift(); }
      if (m.tf === tf) { pokeLast(); dirty = true; draw(); }
    },
    onCandles(m) {
      if (m.mint !== mint || !srv[m.tf] || !Array.isArray(m.candles)) return;
      srv[m.tf] = m.candles.map((k) => [ms(k[0]), +k[1], +k[2], +k[3], +k[4], k[5] == null ? null : +k[5], k[6] ? 1 : 0]).filter((k) => k[4] > 0).slice(-300);
      if (m.tf === tf) { setText(note, ''); dirty = true; draw(); }
    },
    onWallet() { if (ctx.phone?.view() === 'chart') { paintPos(); dirty = true; draw(); } },
    second() { if (mint) { paintTape(); paintHead(); } },
  };

  function pickDefault() {
    const b = wallet.bags()[0];
    if (b) return b.p.mint;
    return net.lists.rising[0] || net.lists.new[0] || null;
  }
}

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
