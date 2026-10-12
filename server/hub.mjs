// Phones connected over /ws: hello on connect, one tick a second with only what moved,
// launches / rugs / bonds as they happen, trades for the coin each phone has open.
import { WebSocketServer } from 'ws';
import { M, applySub, hotSet, pub, refreshLists, snapshot, stats, tradesOut, tuple } from './market.mjs';
import { isMint, logEvery } from './util.mjs';
import { cached as cachedCandles, view as candleView } from './candles.mjs';

const MAX_CLIENTS = 500;
const MAX_HOLD = 50;
const clients = new Set();

export function clientCount() { return clients.size; }

function drop(cl) {
  if (cl.closed) return;
  cl.closed = true;
  clients.delete(cl);
  applySub(cl.hold, cl.view, new Set(), null);
}

function send(cl, obj) {
  if (cl.ws.readyState !== 1) return;
  if (cl.ws.bufferedAmount > 2 * 1024 * 1024) return; // a stuck phone drops ticks instead of growing memory
  try { cl.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch {}
}

export function startHub(server) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 6 } }, maxPayload: 16 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/ws' || clients.size >= MAX_CLIENTS) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws));
  });

  function onConnect(ws) {
    const cl = { ws, hold: new Set(), view: null, known: new Map(), pending: new Set(), lastSend: Date.now(), alive: true, msgs: [] };
    clients.add(cl);
    const hello = snapshot();
    for (const c of hello.coins) cl.known.set(c.mint, M.coins.get(c.mint)?.metaVer || 0);
    send(cl, hello);
    ws.on('pong', () => { cl.alive = true; });
    ws.on('message', (data) => {
      const now = Date.now();
      cl.msgs = cl.msgs.filter((t) => now - t < 10000);
      if (cl.msgs.length >= 30) return;
      cl.msgs.push(now);
      let d;
      try { d = JSON.parse(String(data)); } catch { return; }
      try { if (d && d.t === 'sub' && !cl.closed) onSub(cl, d); } catch (e) { logEvery('hub-sub', 30000, 'hub: sub', e?.message); }
    });
    ws.on('close', () => drop(cl));
    ws.on('error', () => {});
  }

  function onSub(cl, d) {
    const hold = new Set();
    if (Array.isArray(d.hold)) for (const m of d.hold) { if (hold.size >= MAX_HOLD) break; if (isMint(m)) hold.add(m); }
    const view = isMint(d.view) ? d.view : null;
    const oldHold = cl.hold, oldView = cl.view;
    applySub(oldHold, oldView, hold, view);
    for (const m of hold) if (!oldHold.has(m)) cl.pending.add(m);
    if (view && view !== oldView) {
      cl.pending.add(view);
      const c = M.coins.get(view);
      if (c && c.trades.length && Date.now() - c.tradesAt < 10000) send(cl, { t: 'trades', mint: view, tr: tradesOut(c) });
      // candles: whatever the store already has goes out now; the first fetches for a new coin follow by push
      candleView(view);
      for (const tf of ['5s', '1m']) {
        const rows = cachedCandles(view, tf);
        if (rows.length) send(cl, { t: 'candles', mint: view, tf, candles: rows });
      }
    }
    cl.hold = hold;
    cl.view = view;
  }

  // market events
  M.events.onNew = (c) => {
    if (!clients.size) return;
    tuple(c);
    const msg = JSON.stringify({ t: 'new', coin: pub(c) });
    for (const cl of clients) { send(cl, msg); cl.known.set(c.mint, c.metaVer); }
  };
  M.events.onTrades = (c) => {
    let msg = null;
    for (const cl of clients) if (cl.view === c.mint) send(cl, (msg ||= JSON.stringify({ t: 'trades', mint: c.mint, tr: tradesOut(c) })));
  };
  M.events.onCandle = (mint, tf, k) => {
    let msg = null;
    for (const cl of clients) if (cl.view === mint) send(cl, (msg ||= JSON.stringify({ t: 'candle', mint, tf, k })));
  };
  M.events.onCandles = (mint, tf, candles) => {
    let msg = null;
    for (const cl of clients) if (cl.view === mint) send(cl, (msg ||= JSON.stringify({ t: 'candles', mint, tf, candles })));
  };
  M.events.onRug = (r) => { const msg = JSON.stringify({ t: 'rug', ...r }); for (const cl of clients) send(cl, msg); };
  M.events.onGrad = (mint) => { const msg = JSON.stringify({ t: 'grad', mint }); for (const cl of clients) send(cl, msg); };

  let lastListsVer = -1, lastStats = '', lastSol = null;
  setInterval(() => {
    try { tick(); } catch (e) { logEvery('hub-tick', 10000, 'hub: tick failed', e?.stack || e); }
  }, 1000);

  function tick() {
    const now = Date.now();
    refreshLists(now);
    const listsChanged = M.listsVer !== lastListsVer;
    lastListsVer = M.listsVer;
    const st = stats();
    const stKey = JSON.stringify(st);
    const statsChanged = stKey !== lastStats;
    lastStats = stKey;
    const solChanged = M.sol !== lastSol;
    lastSol = M.sol;
    if (!clients.size) return;

    const hot = hotSet();
    const want = new Set(hot);
    for (const m of M.hold.keys()) want.add(m);
    for (const m of M.view.keys()) want.add(m);
    const tup = new Map(), changed = new Set(), confirmed = new Set();
    for (const m of want) {
      const c = M.coins.get(m);
      if (!c || c.blocked) continue;
      const tu = tuple(c, now);
      tup.set(m, tu);
      const key = JSON.stringify(tu);
      if (key !== c._t) { c._t = key; changed.add(m); }
      if (c.conf) confirmed.add(m);
      c.conf = false;
    }

    for (const cl of clients) {
      const out = [], full = [];
      const mine = new Set(cl.hold);
      if (cl.view) mine.add(cl.view);
      const consider = (m, isMine) => {
        const c = M.coins.get(m);
        const tu = tup.get(m);
        if (!c || !tu) return;
        // list coins need a name; a coin this phone holds goes out even before we know its name (the phone kept its own)
        if (!c.meta && !isMine) return;
        if (cl.known.get(m) !== c.metaVer) {
          full.push(pub(c, now));
          cl.known.set(m, c.metaVer);
          cl.pending.delete(m);
          return;
        }
        if (changed.has(m) || cl.pending.has(m) || (isMine && confirmed.has(m))) { out.push(tu); cl.pending.delete(m); }
      };
      for (const m of hot) if (!mine.has(m)) consider(m, false);
      for (const m of mine) consider(m, true);
      if (cl.known.size > 3000) { cl.known.clear(); }
      const msg = { t: 'tick', now, sol: M.sol };
      if (out.length) msg.c = out;
      if (full.length) msg.coins = full;
      if (listsChanged) msg.lists = M.lists;
      if (statsChanged) msg.stats = st;
      if (out.length || full.length || listsChanged || statsChanged || solChanged || now - cl.lastSend > 5000) {
        send(cl, msg);
        cl.lastSend = now;
      }
    }
  }

  // heartbeat: drop phones that stopped answering pings
  setInterval(() => {
    for (const cl of clients) {
      if (!cl.alive) { try { cl.ws.terminate(); } catch {} drop(cl); continue; }
      cl.alive = false;
      try { cl.ws.ping(); } catch {}
    }
  }, 25000);

  return wss;
}
