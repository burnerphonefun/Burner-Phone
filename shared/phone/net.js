// Live data client: one socket to the burner api, a store of coins, events.
// Falls back to polling /api/snapshot when the socket can't connect, and keeps the last state when everything is down.

const HIST_MAX = 400;  // price points per coin kept for sparklines / rug checks

export function createNet({ base = '', wsUrl } = {}) {
  const coins = new Map();          // mint -> Coin (+ priceAt, hist)
  const lists = { new: [], rising: [], bonding: [] };
  const handlers = {};
  const st = { sol: null, lpm: null, up: {}, lastMsg: 0, connected: false, mode: 'connecting' };
  let ws = null, fails = 0, pollTimer = 0, sub = { hold: [], view: null }, subSent = '';

  const on = (ev, fn) => ((handlers[ev] ||= new Set()).add(fn), () => handlers[ev].delete(fn));
  const emit = (ev, a) => handlers[ev]?.forEach((fn) => { try { fn(a); } catch (e) { console.error(e); } });

  const KEEP = ['name', 'symbol', 'img', 'created', 'dev', 'devPct', 'k']; // identity fields: a null never erases what we know
  function upsert(c) {
    const old = coins.get(c.mint);
    const t = Date.now();
    if (old) for (const f of KEEP) if (c[f] == null && f in c) { c = { ...c }; delete c[f]; }
    const m = old ? Object.assign(old, c) : { ...c, hist: [] };
    if (c.p != null) { m.priceAt = t; pushHist(m, t, c.p); }
    coins.set(c.mint, m);
    return m;
  }
  function pushHist(m, t, p) {
    const h = m.hist;
    if (h.length && t - h[h.length - 1][0] < 400) h[h.length - 1][1] = p;
    else h.push([t, p]);
    if (h.length > HIST_MAX) h.splice(0, h.length - HIST_MAX);
  }
  function capStore() {
    if (coins.size < 900) return;
    const keep = new Set([...lists.new, ...lists.rising, ...lists.bonding, ...sub.hold, sub.view]);
    for (const [k, c] of coins) if (!keep.has(k) && Date.now() - (c.priceAt || 0) > 10 * 60e3) coins.delete(k);
  }

  function handle(msg) {
    st.lastMsg = Date.now();
    if (msg.sol) st.sol = msg.sol;
    if (msg.stats) { st.lpm = msg.stats.lpm; st.up = msg.stats.up || st.up; }
    switch (msg.t) {
      case 'hello': {
        for (const c of msg.coins || []) upsert(c);
        if (msg.lists) setLists(msg.lists);
        emit('hello', msg); emit('lists'); break;
      }
      case 'new': {
        const c = upsert(msg.coin);
        if (!lists.new.includes(c.mint)) { lists.new.unshift(c.mint); lists.new.length = Math.min(lists.new.length, 40); }
        emit('new', c); break;
      }
      case 'tick': {
        const changed = [];
        for (const c of msg.coins || []) upsert(c);
        for (const r of msg.c || []) {
          const [mint, p, mc, b1, s1, u1, prog, flags, v1, b5, s5, h, dv, pc5, liq] = r;
          const c = upsert({ mint, p, mc, b1, s1, u1, prog, flags, v1, b5, s5, h, dv, pc5, liq });
          if (flags & 2) c.rugged = true;
          if (flags & 4) c.complete = true;
          if (flags & 8) c.devSold = true;
          changed.push(c);
        }
        if (msg.lists) { setLists(msg.lists); emit('lists'); }
        emit('tick', changed); break;
      }
      case 'trades': emit('trades', msg); break;
      case 'candle': emit('candle', msg); break;   // the open candle of the coin this phone has open
      case 'candles': emit('candles', msg); break; // a whole timeframe (first fetch / gecko fill-in)
      case 'rug': { const c = coins.get(msg.mint); if (c) c.rugged = true; emit('rug', msg); break; }
      case 'grad': { const c = coins.get(msg.mint); if (c) c.complete = true; emit('grad', msg); break; }
    }
    capStore();
  }
  function setLists(l) { for (const k of ['new', 'rising', 'bonding']) if (Array.isArray(l[k])) lists[k] = l[k].filter((m) => coins.has(m)); }

  function connect() {
    const url = wsUrl || (base ? base.replace(/^http/, 'ws') : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host) + '/ws';
    try { ws = new WebSocket(url); } catch { return fallback(); }
    const opened = { v: false };
    ws.onopen = () => { opened.v = true; fails = 0; st.connected = true; st.mode = 'live'; subSent = ''; sendSub(); stopPoll(); emit('status', st); };
    ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => {
      st.connected = false; emit('status', st);
      fails++;
      if (fails >= 3) fallback();
      setTimeout(connect, Math.min(15000, 800 * 2 ** Math.min(fails, 5)));
    };
    ws.onerror = () => {};
  }
  function fallback() {
    if (pollTimer) return;
    st.mode = 'poll'; emit('status', st);
    const poll = async () => {
      try {
        const r = await fetch(base + '/api/snapshot', { cache: 'no-store' });
        if (r.ok) handle({ ...(await r.json()), t: 'hello' });
      } catch {}
    };
    poll(); pollTimer = setInterval(poll, 4000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; } }

  function sendSub() {
    const s = JSON.stringify({ t: 'sub', hold: sub.hold.slice(0, 50), view: sub.view || null });
    if (s === subSent || !ws || ws.readyState !== 1) return;
    subSent = s; ws.send(s);
  }

  async function fetchCoin(mint, tries = 3) {
    try {
      const r = await fetch(base + '/api/coin/' + mint, { cache: 'no-store' });
      if (r.status === 503 && tries > 1) { await new Promise((ok) => setTimeout(ok, 1500)); return fetchCoin(mint, tries - 1); } // still loading on the server
      if (!r.ok) return null;
      const j = await r.json();
      if (j.coin) upsert(j.coin);
      seedHist(mint, j.trades);
      return j;
    } catch { return null; }
  }

  // older price points from real trades, so sparklines have a past the moment a coin is opened
  function seedHist(mint, trades) {
    const c = coins.get(mint);
    if (!c || !Array.isArray(trades) || !trades.length) return;
    const pts = trades.map((t) => [t[0] < 1e12 ? t[0] * 1000 : t[0], t[3]]).filter(([, p]) => p > 0);
    const first = c.hist.length ? c.hist[0][0] : Infinity;
    const older = pts.filter(([t]) => t < first).sort((a, b) => a[0] - b[0]);
    if (older.length) { c.hist = [...older, ...c.hist]; if (c.hist.length > HIST_MAX) c.hist.splice(0, c.hist.length - HIST_MAX); }
    c.seeded = true;
  }
  const seeding = new Set();
  async function ensureHist(mint) {
    const c = coins.get(mint);
    if (!c || c.seeded || seeding.has(mint)) return;
    seeding.add(mint);
    await fetchCoin(mint);
    seeding.delete(mint);
  }

  // 0..4 bars from how fresh the data is
  function signal() {
    if (!st.lastMsg) return 0;
    const age = Date.now() - st.lastMsg;
    if (st.mode === 'poll') return age < 9000 ? 2 : 1;
    return age < 2500 ? 4 : age < 5000 ? 3 : age < 10000 ? 2 : age < 30000 ? 1 : 0;
  }

  // demo/offline seeding: lets a page show the last known state while it reconnects
  function seed(snapshot) { handle({ ...snapshot, t: 'hello' }); }

  return {
    base, coins, lists, st, on, emit, connect, fetchCoin, ensureHist, signal, seed, // emit: tests fire fake events through the real handlers
    coin: (m) => coins.get(m),
    img: (m) => base + '/img/' + m,
    setSub(hold, view) { sub = { hold: [...new Set(hold)], view }; sendSub(); },
    // the server only sends coins whose numbers moved, so "fresh" = the feed itself is fresh
    priceFresh: (c) => c && c.p != null && Date.now() - st.lastMsg < 5000,
    mcOf: (c) => (c?.p != null && st.sol ? c.p * 1e9 * st.sol : c?.mc ?? null),
  };
}
