// Real wallet for the phone (desktop app only; see app/shared/WALLET.md). Same interface as the paper wallet
// (shared/phone/wallet.js), but trades are async and balances come from the chain. The key never comes near this file:
// it only talks to window.burner.wallet, which forwards to the Electron main process.
import { curveBuy, curveSell, poolBuy, poolSell, K0 } from '../curve.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const FEE_KEEP = 0.003; // SOL left for fees + a token account's rent
const short = (m) => m.slice(0, 4) + '…' + m.slice(-4);
const freshBook = () => ({ v: 1, basis: {}, hist: [], stats: { buys: 0, sells: 0, wins: 0, rugs: 0, best: null, worst: null, realized: 0 }, ach: {}, born: Date.now() });

// one listener per bridge, forwarded to whichever real wallet is current (bridge.on can't unsubscribe)
const hubs = new WeakMap();
function hubFor(bridge) {
  let h = hubs.get(bridge);
  if (!h) {
    h = { current: null };
    bridge.on?.('balances', (b) => h.current?._onBalances(b));
    bridge.on?.('tx', (e) => h.current?._onTx(e));
    hubs.set(bridge, h);
  }
  return h;
}

export function createRealWallet(net, bridge, { slippage = null } = {}) {
  let address = null, ready = false, dead = false, slip = slippage;
  let book = freshBook();
  const pending = new Set(); // mints with a trade in flight: their balance rows wait for the trade's own result
  const subs = new Set();
  const emit = (ev) => subs.forEach((f) => { try { f(ev); } catch (e) { console.error(e); } });
  const state = { v: 1, sol: null, get pos() { return book.basis; }, get hist() { return book.hist; }, get stats() { return book.stats; }, get ach() { return book.ach; }, get born() { return book.born; } };
  const key = () => 'burner.real.v1.' + address;
  function load() { try { const b = JSON.parse(localStorage.getItem(key()) || 'null'); book = b && b.v === 1 ? b : freshBook(); } catch { book = freshBook(); } }
  function save() { if (!address) return; try { localStorage.setItem(key(), JSON.stringify(book)); } catch {} }
  const hub = hubFor(bridge);

  async function init() {
    const st = await bridge.status();
    if (!st?.ready || !st.address) return false;
    address = st.address; load(); ready = true;
    hub.current = api;
    if (st.sol != null) state.sol = st.sol;
    await refresh();
    return true;
  }
  async function refresh() {
    if (dead || !ready) return null;
    const b = await bridge.balances();
    if (b && !b.err) apply(b);
    return b;
  }

  // chain balances → positions. A token we have no record of (held before import, or bought elsewhere) shows with an unknown cost.
  function apply(bal) {
    if (dead) return;
    state.sol = bal.sol;
    const held = new Set();
    for (const t of bal.tokens || []) {
      if (t.mint === SOL_MINT || !(t.amount > 0)) continue;
      held.add(t.mint);
      if (pending.has(t.mint)) continue;
      const c = net.coin(t.mint);
      let p = book.basis[t.mint];
      if (!p) p = book.basis[t.mint] = { mint: t.mint, sym: c?.symbol || short(t.mint), name: c?.name || null, tokens: t.amount, cost: null, opened: Date.now(), entryP: null, entryMc: null, high: c?.p ?? null, low: c?.p ?? null, dip: 0, outside: true };
      // tokens that moved outside burner: keep the cost per token, scale the cost to what's held now
      if (p.cost != null && p.tokens > 0 && Math.abs(t.amount - p.tokens) / p.tokens > 1e-6) p.cost *= t.amount / p.tokens;
      p.tokens = t.amount;
      p.decimals = t.decimals;
      if (c?.symbol && p.sym === short(t.mint)) { p.sym = c.symbol; p.name = c.name; }
    }
    for (const m of Object.keys(book.basis)) if (!held.has(m) && !pending.has(m)) delete book.basis[m];
    save();
    emit({ type: 'balances', sol: state.sol });
  }

  const slipFor = (c) => slip ?? (c?.complete ? 8 : 15);

  async function buy(c, amt) {
    if (!ready) return { err: 'import a wallet first' };
    if (!c?.mint) return { err: 'pick a coin' };
    if (!(amt > 0)) return { err: 'pick an amount' };
    if (state.sol != null && amt > state.sol - FEE_KEEP) return { err: `not enough SOL (you have ${state.sol.toFixed(3)}, keep ~${FEE_KEEP} for fees)` };
    const mint = c.mint;
    pending.add(mint);
    emit({ type: 'pending', side: 'buy', mint, amt });
    let r;
    try { r = await bridge.trade({ side: 'buy', mint, sol: amt, slippage: slipFor(c) }); } catch (e) { r = { err: 'the app lost the trade (' + (e?.message || 'ipc') + ')' }; }
    if (!r?.ok) {
      pending.delete(mint);
      emit({ type: 'failed', side: 'buy', mint, err: r?.err || 'failed', stage: r?.stage, sig: r?.sig || null });
      return { err: r?.err || 'failed', stage: r?.stage, sig: r?.sig || null };
    }
    const now = Date.now();
    const spent = r.solDelta != null ? -r.solDelta : amt; // what left the wallet, fees and rent included
    const got = r.tokenDelta != null && r.tokenDelta > 0 ? r.tokenDelta : null;
    const p = (book.basis[mint] ||= { mint, sym: c.symbol || short(mint), name: c.name || null, tokens: 0, cost: 0, opened: now, entryP: null, entryMc: net.mcOf(c), high: c.p ?? null, low: c.p ?? null, dip: 0 });
    if (p.cost != null) p.cost += spent; // a bag we never had a cost for stays unknown
    if (got != null) p.tokens += got;
    if (p.cost != null && p.tokens > 0) p.entryP = p.cost / p.tokens;
    p.last = now; p.lastSig = r.sig;
    book.stats.buys++;
    pending.delete(mint);
    save();
    emit({ type: 'buy', mint, amt, tokens: got, sig: r.sig, route: r.route });
    refresh().catch(() => {});
    return { ok: true, tokens: got, impact: null, sig: r.sig, route: r.route, fee: r.fee, pos: p };
  }

  async function sell(c, frac = 1) {
    const mint = c?.mint;
    const p = book.basis[mint];
    if (!ready) return { err: 'import a wallet first' };
    if (!p) return { err: 'no bag' };
    frac = Math.min(1, Math.max(0.01, frac));
    pending.add(mint);
    emit({ type: 'pending', side: 'sell', mint, frac });
    let r;
    try { r = await bridge.trade({ side: 'sell', mint, pct: frac, slippage: slipFor(c) }); } catch (e) { r = { err: 'the app lost the trade (' + (e?.message || 'ipc') + ')' }; }
    if (!r?.ok) {
      pending.delete(mint);
      emit({ type: 'failed', side: 'sell', mint, err: r?.err || 'failed', stage: r?.stage, sig: r?.sig || null });
      return { err: r?.err || 'failed', stage: r?.stage, sig: r?.sig || null };
    }
    const now = Date.now();
    const got = r.solDelta != null ? r.solDelta : null; // SOL in, after fees
    const sold = r.tokenDelta != null ? Math.max(0, -r.tokenDelta) : p.tokens * frac;
    const share = p.tokens > 0 ? Math.min(1, sold / p.tokens) : 1;
    const cost = p.cost != null ? p.cost * share : null;
    const x = cost > 0 && got != null ? got / cost : null;
    p.tokens = Math.max(0, p.tokens - sold);
    if (p.cost != null) p.cost = Math.max(0, p.cost - cost);
    const closed = frac >= 0.999 || p.tokens <= 1e-9;
    book.hist.unshift({ mint, sym: p.sym, name: p.name, cost, got, x, opened: p.opened, closed: now, part: !closed, entryMc: p.entryMc, exitMc: net.mcOf(c), exitP: c?.p ?? null, rugged: !!c?.rugged, sig: r.sig });
    book.hist.length = Math.min(book.hist.length, 80);
    const st = book.stats;
    st.sells++;
    if (cost != null && got != null) { st.realized += got - cost; if (got > cost) st.wins++; }
    if (x != null) {
      if (st.best == null || x > st.best.x) st.best = { x, sym: p.sym, pnl: got - cost };
      if (st.worst == null || x < st.worst.x) st.worst = { x, sym: p.sym, pnl: got - cost };
    }
    if (closed) delete book.basis[mint];
    pending.delete(mint);
    save();
    emit({ type: 'sell', mint, got, cost, x, closed, sig: r.sig, route: r.route });
    refresh().catch(() => {});
    return { ok: true, got, cost, x, closed, sym: p.sym, sig: r.sig, route: r.route, fee: r.fee };
  }

  // value at the live price, PnL against what was put in. Unknown cost → pnl and x are null (show "–"), never a guess.
  function mark(p) {
    const c = net.coin(p.mint);
    const price = c?.p ?? p.entryP ?? null;
    const value = price != null ? p.tokens * price : null;
    const pnl = value != null && p.cost != null ? value - p.cost : null;
    const x = value != null && p.cost > 0 ? value / p.cost : null;
    return { c, value, pnl, x, mc: net.mcOf(c) ?? p.entryMc };
  }
  function bags() { return Object.values(book.basis).filter((p) => p.tokens > 0).map((p) => ({ p, ...mark(p) })).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)); }
  function worth() { return (state.sol ?? 0) + bags().reduce((a, b) => a + (b.value ?? 0), 0); }

  // same rules as paper: WASTED needs the bag actually down and a 70% fall from a 5-min high held two points in a row
  function watch() {
    const ev = [];
    const now = Date.now();
    let dirty = false;
    for (const p of Object.values(book.basis)) {
      const c = net.coin(p.mint);
      if (!c || c.p == null || !(p.tokens > 0)) continue;
      if (p.high == null || c.p > p.high) { p.high = c.p; dirty = true; }
      if (p.low == null || c.p < p.low) { p.low = c.p; dirty = true; }
      if (!(p.cost > 0)) continue; // unknown cost: we can't say it's down
      const x = (p.tokens * c.p) / p.cost;
      if (x < 0.5) p.dip = Math.max(p.dip || 0, 1 - x);
      const h = (c.hist || []).filter(([t]) => now - t < 5 * 60e3);
      let h5 = 0;
      for (let i = 1; i < h.length; i++) h5 = Math.max(h5, Math.min(h[i - 1][1], h[i][1]));
      const top = Math.max(h5, p.entryP || 0);
      const down = x < 0.6;
      if (!p.wasted && down && top > 0 && c.p <= top * 0.3) { p.wasted = now; dirty = true; ev.push({ type: 'wasted', p, c, drop: 1 - c.p / top }); }
      if (!p.wasted && down && c.rugged) { p.wasted = now; dirty = true; ev.push({ type: 'wasted', p, c, drop: top > 0 ? 1 - c.p / top : null }); }
      if (p.dip >= 0.5 && x >= 1 && !p.diamond) { p.diamond = now; dirty = true; ev.push({ type: 'diamond', p, c }); }
    }
    if (dirty) save();
    return ev;
  }

  function quoteBuy(c, amt) {
    if (!c || c.p == null) return null;
    return c.complete && c.liq ? poolBuy(amt, c.p, c.liq, net.st.sol) : curveBuy(amt, c.p, c.k || K0);
  }
  function quoteSell(c, tokens) {
    if (!c || c.p == null || !(tokens > 0)) return null;
    return c.complete && c.liq ? poolSell(tokens, c.p, c.liq, net.st.sol) : curveSell(tokens, c.p, c.k || K0);
  }
  function award(id) { if (book.ach[id]) return false; book.ach[id] = Date.now(); save(); return true; }

  const api = {
    kind: 'real',
    get state() { return state; },
    get address() { return address; },
    get ready() { return ready; },
    bridge,
    on: (f) => (subs.add(f), () => subs.delete(f)),
    buy, sell, bags, worth, mark, watch, award, quoteBuy, quoteSell, refresh, init,
    pos: (m) => (book.basis[m]?.tokens > 0 ? book.basis[m] : undefined),
    holds: () => Object.keys(book.basis).filter((m) => book.basis[m].tokens > 0),
    pending: (m) => pending.has(m),
    save,
    setSlippage: (pct) => { slip = pct == null ? null : Math.min(50, Math.max(0.5, Number(pct))); },
    destroy() { dead = true; if (hub.current === api) hub.current = null; subs.clear(); },
    _onBalances: (b) => { if (ready && b && !b.err) apply(b); },
    _onTx: (e) => emit({ type: 'tx', ...e }),
  };
  return api;
}

// A wallet the phone can hold forever while the real one comes and goes: every call goes to the current wallet
// (paper or real), events are re-emitted, and a swap tells the screens to repaint with { type: 'swap', kind }.
export function createSwitchWallet(initial) {
  let cur = initial;
  const subs = new Set();
  const fwd = (ev) => subs.forEach((f) => { try { f(ev); } catch (e) { console.error(e); } });
  let off = cur.on(fwd);
  function swap(next) {
    if (!next || next === cur) return;
    off?.();
    const old = cur;
    cur = next;
    off = cur.on(fwd);
    if (old.kind === 'real') old.destroy?.();
    fwd({ type: 'swap', kind: cur.kind });
  }
  return new Proxy({}, {
    get(_t, k) {
      if (k === 'on') return (f) => (subs.add(f), () => subs.delete(f));
      if (k === 'swap') return swap;
      if (k === 'current') return cur;
      const v = cur[k];
      return typeof v === 'function' ? v.bind(cur) : v;
    },
    has(_t, k) { return k === 'swap' || k === 'current' || k in cur; },
  });
}
