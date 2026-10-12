// Paper wallet. Paper SOL only (D, 2026-10-11): no keys, no real trades.
// Fills use the live price and the curve (or pool) maths for size-aware slippage plus the fee.
import { curveBuy, curveSell, poolBuy, poolSell, K0 } from '../curve.js';

export const START_SOL = 10;
const fresh = () => ({ v: 1, sol: START_SOL, pos: {}, hist: [], stats: { buys: 0, sells: 0, wins: 0, rugs: 0, best: null, worst: null, realized: 0 }, ach: {}, born: Date.now() });

// storage: { load() -> state|null, save(state) }
export function localStore(key = 'burner.wallet.v1') {
  return {
    load() { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    save(s) { try { localStorage.setItem(key, JSON.stringify(s)); } catch {} },
  };
}

export function createWallet(net, store = localStore()) {
  let s = store.load();
  if (!s || s.v !== 1) s = fresh();
  const subs = new Set();
  const changed = (what) => { store.save(s); subs.forEach((f) => f(what)); };

  function quoteBuy(c, amt) {
    if (!c || c.p == null) return null;
    return c.complete && c.liq ? poolBuy(amt, c.p, c.liq, net.st.sol) : curveBuy(amt, c.p, c.k || K0);
  }
  function quoteSell(c, tokens) {
    if (!c || c.p == null || !(tokens > 0)) return null;
    return c.complete && c.liq ? poolSell(tokens, c.p, c.liq, net.st.sol) : curveSell(tokens, c.p, c.k || K0);
  }

  function buy(c, amt) {
    if (!net.priceFresh(c)) return { err: 'price moving, try again' };
    if (c.rugged) return { err: 'rugged. not touching that' };
    if (!(amt > 0)) return { err: 'pick an amount' };
    if (amt > s.sol + 1e-9) return { err: 'not enough paper SOL' };
    const q = quoteBuy(c, amt);
    if (!q || !(q.tokens > 0) || !isFinite(q.tokens)) return { err: 'no price yet' };
    const now = Date.now();
    const p = (s.pos[c.mint] ||= { mint: c.mint, sym: c.symbol, name: c.name, tokens: 0, cost: 0, opened: now, entryP: c.p, entryMc: net.mcOf(c), high: c.p, low: c.p, dip: 0 });
    p.tokens += q.tokens; p.cost += amt; p.last = now;
    p.entryP = p.cost / p.tokens; // average price paid, fee and slippage included
    s.sol = Math.max(0, s.sol - amt);
    s.stats.buys++;
    changed({ type: 'buy', mint: c.mint, amt, tokens: q.tokens, impact: q.impact });
    return { ok: true, tokens: q.tokens, impact: q.impact, pos: p };
  }

  function sell(c, frac = 1) {
    const p = s.pos[c?.mint];
    if (!p) return { err: 'no bag' };
    if (!net.priceFresh(c) && !c.rugged) return { err: 'price moving, try again' };
    frac = Math.min(1, Math.max(0.01, frac));
    const tokens = frac >= 0.999 ? p.tokens : p.tokens * frac;
    const q = c.p != null ? quoteSell(c, tokens) : { sol: 0 };
    const got = q ? q.sol : 0;
    const cost = p.cost * (tokens / p.tokens);
    const x = cost > 0 ? got / cost : 0;
    const now = Date.now();
    p.tokens -= tokens; p.cost -= cost;
    s.sol += got;
    s.stats.sells++; s.stats.realized += got - cost;
    if (got > cost) s.stats.wins++;
    if (s.stats.best == null || x > s.stats.best.x) s.stats.best = { x, sym: p.sym, pnl: got - cost };
    if (s.stats.worst == null || x < s.stats.worst.x) s.stats.worst = { x, sym: p.sym, pnl: got - cost };
    const closed = frac >= 0.999 || p.tokens * (c.p || 0) < 1e-6;
    s.hist.unshift({ mint: p.mint, sym: p.sym, name: p.name, cost, got, x, opened: p.opened, closed: now, part: !closed, entryMc: p.entryMc, exitMc: net.mcOf(c), exitP: c.p ?? null, rugged: !!c.rugged });
    s.hist.length = Math.min(s.hist.length, 80);
    if (closed) delete s.pos[p.mint];
    changed({ type: 'sell', mint: p.mint, got, cost, x, closed });
    return { ok: true, got, cost, x, closed, sym: p.sym };
  }

  // mark a bag to market: value at the live price (what apps show), PnL vs what you put in
  function mark(p) {
    const c = net.coin(p.mint);
    const price = c?.p ?? p.entryP;
    const value = p.tokens * price;
    return { c, value, pnl: value - p.cost, x: p.cost > 0 ? value / p.cost : 1, mc: net.mcOf(c) ?? p.entryMc };
  }

  function bags() { return Object.values(s.pos).map((p) => ({ p, ...mark(p) })).sort((a, b) => b.value - a.value); }
  function worth() { return s.sol + bags().reduce((a, b) => a + b.value, 0); }

  // track highs/lows per bag (rug + diamond-hands checks); returns events
  function watch() {
    const ev = [];
    const now = Date.now();
    for (const p of Object.values(s.pos)) {
      const c = net.coin(p.mint);
      if (!c || c.p == null) continue;
      if (c.p > p.high) p.high = c.p;
      if (c.p < p.low) p.low = c.p;
      const x = (p.tokens * c.p) / p.cost;
      if (x < 0.5) p.dip = Math.max(p.dip || 0, 1 - x);
      // a 70%+ fall from the 5-minute high that leaves you actually down (a dump while you're still 4x up isn't WASTED).
      // the high must hold for two points in a row, so one bad print can't fake a top.
      const h = (c.hist || []).filter(([t]) => now - t < 5 * 60e3);
      let h5 = 0;
      for (let i = 1; i < h.length; i++) h5 = Math.max(h5, Math.min(h[i - 1][1], h[i][1]));
      const top = Math.max(h5, p.entryP);
      const down = x < 0.6;
      if (!p.wasted && down && top > 0 && c.p <= top * 0.3) { p.wasted = now; ev.push({ type: 'wasted', p, c, drop: 1 - c.p / top }); }
      if (!p.wasted && down && c.rugged) { p.wasted = now; ev.push({ type: 'wasted', p, c, drop: 1 - c.p / top }); }
      if (p.dip >= 0.5 && x >= 1 && !p.diamond) { p.diamond = now; ev.push({ type: 'diamond', p, c }); }
    }
    return ev;
  }

  function reset() { s = fresh(); changed({ type: 'reset' }); }
  function award(id) { if (s.ach[id]) return false; s.ach[id] = Date.now(); store.save(s); return true; }

  return {
    kind: 'paper',
    get state() { return s; },
    on: (f) => (subs.add(f), () => subs.delete(f)),
    buy, sell, bags, worth, mark, watch, reset, award, quoteBuy, quoteSell,
    pos: (m) => s.pos[m],
    holds: () => Object.keys(s.pos),
    save: () => store.save(s),
  };
}
