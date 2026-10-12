// PumpPortal: one socket for new pump.fun launches and migrations, shared by every phone.
// Uses the `ws` package, not the global WebSocket (Railway's Node 20 has none).
import WebSocket from 'ws';
import { clean, isOffensive } from './filter.mjs';
import { logEvery, num } from './util.mjs';
import { K0 } from '../shared/curve.js';

const URL = 'wss://pumpportal.fun/api/data';

export function startFeed({ onLaunch, onMigrate }) {
  const st = { connected: false, lastMsg: 0, launches: 0, dropped: 0, migrations: 0, reconnects: 0 };
  let ws = null, backoff = 1000, watchdog = null;

  function connect() {
    try { ws = new WebSocket(URL, { handshakeTimeout: 15000 }); } catch (e) { return retry(); }
    ws.on('open', () => {
      st.connected = true;
      st.lastMsg = Date.now();
      backoff = 1000;
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
      logEvery('feed-open', 0, 'feed: connected');
    });
    ws.on('message', (data) => {
      st.lastMsg = Date.now();
      let d;
      try { d = JSON.parse(String(data)); } catch { return; }
      try { handle(d); } catch (e) { logEvery('feed-handle', 30000, 'feed: bad message', e?.message); }
    });
    // 'close' always follows 'error' with ws, so only close schedules the reconnect
    ws.on('close', () => { st.connected = false; retry(); });
    ws.on('error', (e) => logEvery('feed-err', 30000, 'feed: socket error', e?.message));
  }

  function retry() {
    st.connected = false;
    st.reconnects++;
    const wait = backoff;
    backoff = Math.min(backoff * 2, 30000);
    setTimeout(connect, wait);
  }

  function handle(d) {
    if (!d || typeof d !== 'object' || !d.mint) return;
    if (d.txType === 'migrate' || d.txType === 'migration') {
      st.migrations++;
      onMigrate?.(d.mint);
      return;
    }
    if (d.txType !== 'create' || d.pool !== 'pump') return;
    const vSol = num(d.vSolInBondingCurve), vTok = num(d.vTokensInBondingCurve);
    if (!(vTok > 0)) return;
    // pump.fun curves now come in several quote tokens with their own virtual reserves, so the
    // price comes from the SOL market cap, and k is the curve in SOL terms at that price (p * vTok^2).
    // The virtual token reserve is the same on every curve, which keeps progress and slippage right.
    const mcSol = num(d.marketCapSol);
    let p = mcSol > 0 ? mcSol / 1e9 : vSol > 0 ? vSol / vTok : null;
    if (!(p > 0)) return;
    // no SOL curve starts above its completion cap (~411 SOL): a bigger "SOL" cap at launch is a curve quoted in
    // a dollar token read as SOL ($393K for a 6 s old coin). Price unknown until Jupiter has it.
    const foreignQuote = p * 1e9 > 460;
    if (foreignQuote) p = null;
    const name = clean(d.name, 40), symbol = clean(d.symbol, 14);
    if ((!name && !symbol) || isOffensive(d.name, d.symbol, name, symbol)) { st.dropped++; return; }
    const initialBuy = num(d.initialBuy) || 0;
    // a standard curve (30 virtual SOL, 1.073B virtual tokens) keeps vSol*vTok = K0; anything else
    // gets its curve re-read from pump.fun before we show a bonding progress for it
    const std = !foreignQuote && vSol > 0 && Math.abs((vSol * vTok) / K0 - 1) < 0.02 && Math.abs(p / (vSol / vTok) - 1) < 0.02;
    st.launches++;
    onLaunch({
      mint: d.mint,
      name: name || symbol,
      symbol: symbol || name,
      dev: typeof d.traderPublicKey === 'string' ? d.traderPublicKey : null,
      devTokens: initialBuy,
      devPct: Math.round((initialBuy / 1e9) * 100 * 100) / 100,
      k: p ? p * vTok * vTok : null,
      std,
      p,
      created: Date.now(),
    });
  }

  // a socket that goes quiet for a minute is dead even if it never closed
  watchdog = setInterval(() => {
    if (ws && st.connected && Date.now() - st.lastMsg > 60000) {
      logEvery('feed-dog', 0, 'feed: silent 60 s, reconnecting');
      try { ws.terminate(); } catch {}
    }
  }, 10000);
  watchdog.unref?.();

  connect();
  return st;
}
