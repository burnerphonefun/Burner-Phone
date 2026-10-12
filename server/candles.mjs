// Per-coin candle store: real OHLCV in SOL/token with SOL volume, shared by every phone.
//
// Sources, best first (measured 2026-10-12 from a home IP):
// - pump.fun swap-api candles (`/v2/coins/<mint>/candles?interval=1s|15s|30s|1m|5m&currency=SOL`): real OHLCV,
//   volume = the SOL traded in the bucket (checked against the trades in the same second), 0-3 s behind the
//   chain, up to 1000 rows a call, covers the curve and PumpSwap. No 429 at 100 calls/min over 120 calls.
//   Railway's IP is shared, so the budget starts at 60/min and backs off on a 429.
// - swap-api trades (polled by market.mjs on its own ~8/min budget): real prints, they move the open candle.
// - GeckoTerminal OHLCV (`/pools/<pool>/ohlcv/minute`): fallback when swap-api has nothing for a coin.
//   Free tier 429s after ~5 quick calls; second candles are paid-only. Used rarely, >= 8 s apart.
// - our own price samples (Jupiter every ~3 s, DEX Screener, trades): the live edge between fetches.
//   A bucket that only ever saw samples is marked est = 1 (drawn lighter on the phone).
//
// Rows: [t, o, h, l, c, v, est] (t ms, prices SOL/token, v SOL or null, est 0/1).
import { M } from './market.mjs';
import { BROWSER_HEADERS, LRU, blocked, budget, canSpend, getJSON, logEvery, num, record, sig, sleep, spend } from './util.mjs';

const SWAP = 'https://swap-api.pump.fun/v2/coins/';
const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana';
export const TF = { '5s': 5000, '1m': 60000, '5m': 300000 };
const KEEP = 300;              // candles kept and served per timeframe
const ACTIVE_MS = 30000;       // a coin someone asked for stays scheduled this long without a view
const STALE_MS = 15 * 60000;   // entries nobody viewed/held for this long are dropped
export const KB = budget(60, 90);
const GB = budget(4, 6);
let geckoLast = 0;
const NO_SWAP = process.env.CANDLES_NO_SWAP === '1';

const store = new LRU(300);    // mint -> entry
const stats = { swap: 0, swapRows: 0, gecko: 0, geckoRows: 0, pushes: 0, firstWaits: 0 };

function entry(mint, create = true) {
  let e = store.m.get(mint);
  if (!e && create) {
    e = {
      mint,
      rows: { '5s': new Map(), '1m': new Map(), '5m': new Map() },
      src: { '5s': new Set(), '1m': new Set(), '5m': new Set() },
      at: { '1s': 0, '1m': 0, '5m': 0 },       // last swap fetch per interval
      done: { '1s': false, '1m': false, '5m': false }, // history loaded once
      inflight: new Map(),                      // interval -> promise
      fails: 0, gecko: { pool: null, poolAt: 0, at: { '1m': 0, '5m': 0 }, miss: 0 },
      touched: Date.now(), seen: Date.now(),
      push: { '5s': 0, '1m': 0 }, pushT: { '5s': null, '1m': null },
    };
    store.set(mint, e);
  }
  return e;
}

const bucketOf = (t, tf) => Math.floor(t / TF[tf]) * TF[tf];
const watched = (mint) => M.view.has(mint);
const active = (e, now) => watched(e.mint) || now - e.touched < ACTIVE_MS;

function trim(map) {
  if (map.size <= KEEP + 40) return;
  const keys = [...map.keys()].sort((a, b) => a - b);
  for (let i = 0; i < keys.length - KEEP; i++) map.delete(keys[i]);
}

// an authoritative row (swap-api / gecko) replaces whatever we built for that bucket
function put(e, tf, row, src) {
  e.rows[tf].set(row[0], row);
  e.src[tf].add(src);
}

// ---------- live edge: samples and prints ----------

function edge(e, tf, t, p, vol, isTrade) {
  const map = e.rows[tf];
  const b = bucketOf(t, tf);
  let k = map.get(b);
  if (!k) {
    // open from the previous close so candles join up
    let prev = null, pb = -Infinity;
    for (const [kb, row] of map) if (kb < b && kb > pb) { pb = kb; prev = row; }
    if (prev && b - pb > TF[tf] * KEEP) prev = null;
    const o = prev ? prev[4] : p;
    k = [b, o, Math.max(o, p), Math.min(o, p), p, isTrade ? vol : null, isTrade ? 0 : 1];
    map.set(b, k);
    trim(map);
    e.src[tf].add(isTrade ? 'trades' : 'samples');
    return true;
  }
  const before = k[2] + ':' + k[3] + ':' + k[4] + ':' + k[5];
  if (p > k[2]) k[2] = p;
  if (p < k[3]) k[3] = p;
  k[4] = p;
  if (isTrade) { k[5] = Math.round(((k[5] || 0) + vol) * 1e6) / 1e6; k[6] = 0; }
  return before !== k[2] + ':' + k[3] + ':' + k[4] + ':' + k[5];
}

function onPrice(c, p, at) {
  const e = store.m.get(c.mint);
  if (!e || !(p > 0)) return;
  let moved = false;
  for (const tf of Object.keys(TF)) moved = edge(e, tf, at, p, 0, false) || moved;
  if (moved) schedulePush(e);
}

function onPrints(c, trades) {
  const e = store.m.get(c.mint);
  if (!e || !trades?.length) return;
  // prints already inside a bucket a swap fetch covered are part of that row's volume: skip them
  let moved = false;
  for (const t of [...trades].sort((a, b) => a.ts - b.ts)) {
    if (!(t.p > 0)) continue;
    for (const tf of Object.keys(TF)) {
      const covered = e.rows[tf].get(bucketOf(t.ts, tf));
      if (covered && covered._auth && covered._authAt > t.ts) continue;
      moved = edge(e, tf, t.ts, t.p, t.sol || 0, true) || moved;
    }
  }
  if (moved) schedulePush(e);
}

// ---------- pushes to phones viewing the coin (open candle, <= 2/s per timeframe) ----------

function schedulePush(e) {
  if (!watched(e.mint)) return;
  for (const tf of ['5s', '1m']) {
    if (e.pushT[tf]) continue;
    const wait = Math.max(0, 500 - (Date.now() - e.push[tf]));
    e.pushT[tf] = setTimeout(() => {
      e.pushT[tf] = null;
      e.push[tf] = Date.now();
      const k = openRow(e, tf);
      if (k) { stats.pushes++; M.events.onCandle(e.mint, tf, k); }
    }, wait);
  }
}

function openRow(e, tf) {
  let best = null;
  for (const [b, row] of e.rows[tf]) if (!best || b > best[0]) best = row;
  return best ? best.slice(0, 7) : null;
}

// ---------- swap-api fetches ----------

function parseSwap(data) {
  const out = [];
  if (!Array.isArray(data)) return out;
  for (const k of data) {
    const t = num(k?.timestamp), o = num(k?.open), h = num(k?.high), l = num(k?.low), cl = num(k?.close), v = num(k?.volume);
    if (t == null || !(o > 0) || !(cl > 0)) continue;
    out.push([t, sig(o, 6), sig(Math.max(h || o, o, cl), 6), sig(Math.min(l || o, o, cl), 6), sig(cl, 6), v == null ? null : Math.round(v * 1e6) / 1e6, 0]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

function createdTs(c) {
  const cr = c?.created;
  return Math.floor(cr && cr < Date.now() ? cr - 60000 : Date.now() - 48 * 3600e3);
}

async function swapFetch(e, iv) {
  if (e.inflight.has(iv)) return e.inflight.get(iv);
  const p = (async () => {
    const c = M.coins.get(e.mint);
    const first = !e.done[iv];
    if (NO_SWAP) { e.at[iv] = Date.now(); e.fails++; return false; } // test hook: exercise the gecko fallback
    const limit = iv === '1s' ? (first ? 1000 : 60) : iv === '1m' ? (first ? KEEP : 6) : (first ? KEEP : 3);
    spend(KB);
    e.at[iv] = Date.now();
    const url = SWAP + e.mint + '/candles?interval=' + iv + '&limit=' + limit + '&currency=SOL&createdTs=' + createdTs(c);
    const res = await getJSON(url, { headers: BROWSER_HEADERS, timeout: 4000 });
    record('candles', res);
    stats.swap++;
    if (res.status === 429) { blocked(KB, res.retryAfter); logEvery('candles-429', 30000, 'candles: 429, budget now', KB.limit, '/min'); return false; }
    if (!res.ok) { e.fails++; return false; }
    const rows = parseSwap(res.data);
    stats.swapRows += rows.length;
    if (!rows.length) { if (first) e.fails++; e.done[iv] = true; return true; }
    e.fails = 0;
    const fetchedAt = Date.now();
    if (iv === '1s') {
      // 1 s rows → 5 s candles. When the call hit its limit the oldest bucket may be cut, so it's skipped.
      const agg = new Map();
      for (const r of rows) {
        const b = bucketOf(r[0], '5s');
        const k = agg.get(b);
        if (!k) agg.set(b, [b, r[1], r[2], r[3], r[4], r[5] || 0, 0]);
        else { k[2] = Math.max(k[2], r[2]); k[3] = Math.min(k[3], r[3]); k[4] = r[4]; k[5] += r[5] || 0; }
      }
      const keys = [...agg.keys()].sort((a, b) => a - b);
      if (rows.length >= limit) keys.shift();
      for (const b of keys) {
        const k = agg.get(b);
        k[5] = Math.round(k[5] * 1e6) / 1e6;
        k._auth = true; k._authAt = fetchedAt;
        put(e, '5s', k, 'swap');
      }
      trim(e.rows['5s']);
    } else {
      const tf = iv; // '1m' | '5m'
      for (const r of rows) { r._auth = true; r._authAt = fetchedAt; put(e, tf, r, 'swap'); }
      trim(e.rows[tf]);
    }
    const wasFirst = first;
    e.done[iv] = true;
    if (wasFirst && watched(e.mint)) {
      const tf = iv === '1s' ? '5s' : iv;
      M.events.onCandles(e.mint, tf, output(e, tf));
    } else schedulePush(e);
    return true;
  })().finally(() => e.inflight.delete(iv));
  e.inflight.set(iv, p);
  return p;
}

// ---------- GeckoTerminal fallback (1 m / 5 m) ----------

async function geckoFetch(e, tf) {
  const now = Date.now();
  if (!canSpend(GB, now) || now - geckoLast < 8000) return false;
  const g = e.gecko;
  if (!g.pool) {
    if (now - g.poolAt < 10 * 60000 && g.miss) return false;
    spend(GB); geckoLast = now; g.poolAt = now;
    const res = await getJSON(GECKO + '/tokens/' + e.mint + '/pools?page=1', { headers: { accept: 'application/json' }, timeout: 5000 });
    record('gecko', res);
    stats.gecko++;
    if (res.status === 429) { blocked(GB, 60); return false; }
    // only pools quoted in SOL (a pool in another quote token gives prices in that token), most liquidity first
    const pools = (Array.isArray(res.data?.data) ? res.data.data : []).filter((p) => p?.relationships?.quote_token?.data?.id === 'solana_So11111111111111111111111111111111111111112' && p?.relationships?.base_token?.data?.id === 'solana_' + e.mint);
    pools.sort((a, b) => (num(b?.attributes?.reserve_in_usd) || 0) - (num(a?.attributes?.reserve_in_usd) || 0));
    g.pool = pools[0]?.attributes?.address || null;
    if (!g.pool) { g.miss++; return false; }
    return true; // the candles go out on the next slot
  }
  spend(GB); geckoLast = now; g.at[tf] = now;
  const agg = tf === '5m' ? 5 : 1;
  const res = await getJSON(GECKO + '/pools/' + g.pool + '/ohlcv/minute?aggregate=' + agg + '&limit=' + KEEP + '&currency=token&token=base', { headers: { accept: 'application/json' }, timeout: 6000 });
  record('gecko', res);
  stats.gecko++;
  if (res.status === 429) { blocked(GB, 60); return false; }
  const list = res.data?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return false;
  const fetchedAt = Date.now();
  for (const k of list) {
    const t = num(k?.[0]) * 1000, o = num(k?.[1]), h = num(k?.[2]), l = num(k?.[3]), cl = num(k?.[4]), v = num(k?.[5]);
    if (!(t > 0) || !(o > 0) || !(cl > 0)) continue;
    const row = [t, sig(o, 6), sig(h, 6), sig(l, 6), sig(cl, 6), v == null ? null : Math.round(v * 1e6) / 1e6, 0];
    // swap-api rows win where both exist
    const have = e.rows[tf].get(t);
    if (have && have._auth && e.src[tf].has('swap')) continue;
    row._auth = true; row._authAt = fetchedAt;
    put(e, tf, row, 'gecko');
    stats.geckoRows++;
  }
  trim(e.rows[tf]);
  if (watched(e.mint)) M.events.onCandles(e.mint, tf, output(e, tf));
  return true;
}

// ---------- scheduling: the open coins first, spread fairly ----------

const JOBS = [
  // interval, refresh every (ms), weight
  ['1s', 2500, 3],
  ['1m', 15000, 2],
  ['5m', 60000, 1],
];

function pick(now) {
  let best = null, bestScore = -1;
  for (const e of store.m.values()) {
    if (!active(e, now)) continue;
    const viewers = M.view.get(e.mint) || 0;
    for (const [iv, every, w] of JOBS) {
      if (e.inflight.has(iv)) continue;
      const due = e.done[iv] ? e.at[iv] + every : 0;
      const over = now - due;
      if (over < 0) continue;
      // a coin whose swap candles keep failing waits longer (and goes to gecko for 1m/5m)
      if (e.fails >= 3 && now - e.at[iv] < 30000) continue;
      const score = (e.done[iv] ? over + 1 : 1e9) * w * (1 + viewers * 0.25);
      if (score > bestScore) { bestScore = score; best = [e, iv]; }
    }
  }
  return best;
}

async function loop() {
  for (;;) {
    try {
      const now = Date.now();
      // gecko for coins swap-api can't chart
      for (const e of store.m.values()) {
        if (!active(e, now) || e.fails < 2) continue;
        for (const tf of ['1m', '5m']) if (now - e.gecko.at[tf] > (tf === '1m' ? 30000 : 120000)) { geckoFetch(e, tf).catch(() => {}); break; }
      }
      if (!canSpend(KB, now)) { await sleep(250); continue; }
      const job = pick(now);
      if (!job) { await sleep(200); continue; }
      swapFetch(job[0], job[1]).catch((err) => logEvery('candles-fetch', 30000, 'candles: fetch', err?.message));
      await sleep(Math.max(250, Math.round(60000 / KB.limit)));
    } catch (err) {
      logEvery('candles-loop', 30000, 'candles: loop', err?.message);
      await sleep(1000);
    }
  }
}

// drop what nobody looks at any more
function gc() {
  const now = Date.now();
  for (const e of [...store.m.values()]) {
    if (watched(e.mint) || M.hold.has(e.mint)) { e.seen = now; continue; }
    if (now - Math.max(e.seen, e.touched) > STALE_MS) store.delete(e.mint);
  }
}

// ---------- reads ----------

// sorted rows, the last KEEP buckets, empty buckets between real ones filled flat (est 1, v 0)
// so the time axis is continuous
export function output(e, tf) {
  const map = e.rows[tf];
  if (!map.size) return [];
  const step = TF[tf];
  const keys = [...map.keys()].sort((a, b) => b - a); // newest first: walk back and stop at KEEP
  const out = [];
  for (let i = 0; i < keys.length && out.length < KEEP; i++) {
    const r = map.get(keys[i]).slice(0, 7);
    if (out.length) {
      // flat candles for the empty buckets between this row and the next (newer) one, at this row's close
      const newer = out[out.length - 1][0];
      for (let t = newer - step; t > r[0] && out.length < KEEP; t -= step) out.push([t, r[4], r[4], r[4], r[4], 0, 1]);
      if (out.length >= KEEP) break;
    }
    out.push(r);
  }
  return out.reverse();
}

// GET /api/candles/:mint?tf= — what's cached; the very first ask for a coin waits up to ~1.5 s for
// swap-api (its limit is generous), everything after answers from the store and updates by push
export async function candlesFor(mint, tf) {
  if (!TF[tf]) tf = '1m';
  const e = entry(mint);
  e.touched = Date.now();
  const iv = tf === '5s' ? '1s' : tf;
  if (!e.done[iv] && canSpend(KB)) {
    stats.firstWaits++;
    await Promise.race([swapFetch(e, iv), sleep(1500)]);
  }
  const c = M.coins.get(mint);
  // a coin we only know from samples so far: seed the live edge from its price history
  if (!e.rows[tf].size && c?.hist?.length) for (const [t, p] of c.hist) edge(e, tf, t, p, 0, false);
  const from = [...e.src[tf]];
  return { mint, tf, candles: output(e, tf), from };
}

// 1 m rows in the old [t, o, h, l, c, v] shape for /api/coin (keeps the old phone working)
export async function rows1m(mint, ms = 1500) {
  const e = entry(mint);
  e.touched = Date.now();
  if (!e.done['1m'] && canSpend(KB)) await Promise.race([swapFetch(e, '1m'), sleep(ms)]);
  return output(e, '1m').map((r) => r.slice(0, 6));
}

// a phone opened a coin: make sure it's in the store so its first fetches go out now
export function view(mint) { if (mint) entry(mint).touched = Date.now(); }

export function candleHealth() {
  const now = Date.now();
  return {
    coins: store.size,
    active: [...store.m.values()].filter((e) => active(e, now)).length,
    budget: { limit: KB.limit, used: KB.calls.filter((t) => t > now - 60000).length, blockedFor: Math.max(0, Math.round((KB.blockedUntil - now) / 1000)), blocks: KB.blocks },
    gecko: { limit: GB.limit, used: GB.calls.filter((t) => t > now - 60000).length, blockedFor: Math.max(0, Math.round((GB.blockedUntil - now) / 1000)) },
    ...stats,
  };
}

export function startCandles() {
  M.events.onPrice = onPrice;
  M.events.onPrints = onPrints;
  M.candleRows = rows1m;
  loop();
  setInterval(gc, 60000).unref?.();
}

// what the store has for a coin right now (no fetch)
export function cached(mint, tf) {
  const e = store.m.get(mint);
  return e && TF[tf] ? output(e, tf) : [];
}
