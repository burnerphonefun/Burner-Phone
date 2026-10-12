// The market: every coin any phone can see, its live numbers, the lists, rug/bond detection.
// One set of upstream polls shared by every phone (Jupiter prices, pump.fun trades, coin
// details, DEX Screener for bonded coins). Nothing in here waits on an upstream inside a
// request for longer than the request's own budget.
import { K0, REAL_TOK, SUPPLY, V_TOK0, progressFromPrice } from '../shared/curve.js';
import { BROWSER_HEADERS, LRU, blocked, budget, canSpend, fix, getJSON, isMint, logEvery, meter, num, record, sig, sleep, spend } from './util.mjs';
import { clean, isOffensive } from './filter.mjs';
import { recordRug } from './wasted.mjs';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUP_KEY = process.env.JUP_API_KEY || '';
const JUP_URL = JUP_KEY ? 'https://api.jup.ag/price/v3' : 'https://lite-api.jup.ag/price/v3';
const JUP_HEADERS = JUP_KEY ? { 'x-api-key': JUP_KEY, accept: 'application/json' } : { accept: 'application/json' };
const SWAP = 'https://swap-api.pump.fun/v2/coins/';
const PUMP = process.env.PUMPFUN_API || 'https://frontend-api-v3.pump.fun'; // override only to test the 403 path

// ---------- pump.fun frontend-api availability ----------
// Datacenter IPs (Railway) get 403 access_denied from frontend-api-v3 (lists and coins-v2).
// Then everything it gave us comes from Jupiter instead; re-probe every 10 minutes.
// PUMPFUN_BLOCKED=1 forces the blocked path for local testing.
const FORCE_BLOCKED = process.env.PUMPFUN_BLOCKED === '1';
export const PB = { blocked: FORCE_BLOCKED, probeAt: 0, since: FORCE_BLOCKED ? Date.now() : 0 };
export const pumpBlocked = () => FORCE_BLOCKED || PB.blocked;
// may this frontend-api call go out? (while blocked, one call every 10 min is the probe)
function pumpOk(now = Date.now()) {
  if (FORCE_BLOCKED) return false;
  if (!PB.blocked) return true;
  if (now >= PB.probeAt) { PB.probeAt = now + 600000; return true; }
  return false;
}
function pumpResult(res) {
  if (res.status === 403) {
    if (!PB.blocked) { PB.since = Date.now(); logEvery('pump-403', 0, 'pump.fun frontend-api: 403 (datacenter block), using Jupiter, re-probe in 10 min'); }
    PB.blocked = true;
    PB.probeAt = Date.now() + 600000;
  } else if (res.ok && PB.blocked) {
    PB.blocked = false;
    logEvery('pump-ok', 0, 'pump.fun frontend-api: reachable again');
  }
}

const RING_MAX = 600;      // launches kept
const NEW_LIST = 40;       // lists.new
const TOP_LIST = 20;       // rising / bonding
const HIST_MS = 600000;    // per-coin price history
const BIG_BUY = 1;         // SOL, flash a row

export const M = {
  sol: null,               // SOL/USD shown to phones, refreshed every 30 s
  solLive: null,           // latest SOL/USD seen in any Jupiter batch
  solAt: 0,
  coins: new Map(),        // mint -> internal coin
  ring: [],                // launch mints, newest first
  launchTimes: [],
  candidates: new Map(),   // mint -> last seen in pump.fun's active list
  lists: { new: [], rising: [], bonding: [] },
  listsVer: 0,
  listsAt: 0,
  hold: new Map(),         // mint -> number of phones holding it
  view: new Map(),         // mint -> number of phones viewing it
  // onPrice/onPrints feed the candle store (candles.mjs); onCandle/onCandles push candles to phones (hub.mjs)
  events: { onNew() {}, onTrades() {}, onRug() {}, onGrad() {}, onMeta() {}, onPrice() {}, onPrints() {}, onCandle() {}, onCandles() {} },
  candleRows: null,        // (mint, ms) → 1 m rows from the candle store, set by candles.mjs
  feed: null,
  gaps: { trades: 350, jup: 2500, detail: 1100 },
};

// ---------- coins ----------

function blank(mint) {
  return {
    mint, name: null, symbol: null, meta: false, metaVer: 0, blocked: false, missing: false,
    created: null, dev: null, devTokens: null, devPct: null, devSold: false, devSoldTok: 0,
    k: K0, kAt: 0, kSrc: null, p: null, pAt: 0, pSrc: null, launchP: null, athP: 0, conf: false,
    prog: null, complete: null, ath: null, liq: null, liqMax: 0,
    bigAt: 0, rugged: false,
    hist: [], trades: [], txSet: null, tradesAt: 0, tradesKey: '', lastTradeFetch: 0,
    jupAt: 0, dexAt: 0, detailAt: 0, tokAt: 0, tokFresh: 0,
    b5: null, s5: null, pc5: null, h: null, dv: null, bv5: null, cliq: null, cliqAt: 0, liqBad: false,
    twitter: null, website: null, replies: null, icon: null, jupMiss: 0,
    _t: '', _cnt: null,
  };
}

function setMeta(c, { name, symbol }) {
  const n = clean(name || '', 40), s = clean(symbol || '', 14);
  if (isOffensive(name, symbol, n, s)) { c.blocked = true; return; }
  if (!n && !s) return;
  const changed = !c.meta || c.name !== (n || s) || c.symbol !== (s || n);
  c.name = n || s;
  c.symbol = s || n;
  c.meta = true;
  if (changed) { c.metaVer++; M.events.onMeta(c); }
}

export function setPrice(c, p, src, at = Date.now()) {
  if (!(p > 0) || !Number.isFinite(p)) return;
  c.p = p; c.pAt = at; c.pSrc = src; c.conf = true;
  if (c.launchP == null) c.launchP = p;
  if (p > c.athP) c.athP = p;
  const h = c.hist, last = h[h.length - 1];
  if (!last) h.push([at, p]);
  else if (at - last[0] < 1000) last[1] = p;
  else if (last[1] !== p || at - last[0] > 10000) h.push([at, p]);
  const cut = at - HIST_MS;
  let drop = 0;
  while (drop < h.length && h[drop][0] < cut) drop++;
  if (drop) h.splice(0, drop);
  if (h.length > 500) h.splice(0, h.length - 500);
  c.prog = curveProg(c);
  checkDump(c, at);
  M.events.onPrice(c, p, at);
}

// Bonding progress. From a curve read off pump.fun's api it's exact. Anything else (a launch
// from the stream, or any coin while the api is blocked) is an estimate on the coin's k (the
// standard curve if unknown), cross-checked against Jupiter's liquidity, which tracks the
// curve's virtual SOL. Measured on 19 live curve coins: when the two disagree by more than
// 0.12 the estimate was off by 0.6-0.9 (newer curves that start at ~$10K, or launches that
// looked standard in the stream), so that case is unknown (null) and, if the api is reachable,
// the curve gets re-read.
const V_OFFSET = V_TOK0 - REAL_TOK;
function curveProg(c) {
  if (c.complete) return 1;
  if (!c.p) return null;
  const blockedApi = pumpBlocked();
  if (!blockedApi && !c.kAt) return null; // waiting for pump.fun to tell us the curve
  const est = progressFromPrice(c.p, c.k || K0);
  // some curves change their reserves outside trades, so even a curve read from pump.fun goes
  // stale: it's checked too, unless the read is under 30 s old
  const freshRead = c.kSrc === 'pump' && Date.now() - c.kAt < 30000;
  if (!c.liqBad && c.cliq > 0 && Date.now() - c.cliqAt < 60000 && M.solLive) {
    const vTok = c.cliq / M.solLive / c.p;
    const fromLiq = Math.max(0, Math.min(1, 1 - (vTok - V_OFFSET) / REAL_TOK));
    if (Math.abs(est - fromLiq) > 0.12) {
      // a curve we just read beats Jupiter's liquidity, which is then off for this coin (seen: 2.4x)
      if (freshRead) { c.liqBad = true; return est; }
      if (!blockedApi) queueDetail(c.mint);
      return null;
    }
  }
  return est;
}

function markComplete(c, announce) {
  const wasCurve = c.complete === false;
  if (c.complete === true) return;
  c.complete = true;
  c.prog = 1;
  if (announce && wasCurve) M.events.onGrad(c.mint);
}

function high5(c, now) {
  let hi = 0;
  for (const [t, p] of c.hist) if (t >= now - 300000 && p > hi) hi = p;
  return hi;
}

function rug(c, drop, reason) {
  if (c.rugged) return;
  c.rugged = true;
  M.events.onRug({ mint: c.mint, drop: fix(drop, 3), reason });
  // the day's rug log: the cap it fell from (its recent high, or its ATH if it's under an hour old) and where it landed
  const now = Date.now();
  const hiP = Math.max(high5(c, now), c.athP && c.created && now - c.created < 3600e3 ? c.athP : 0);
  if (M.sol && hiP > 0 && c.p > 0 && !c.blocked) {
    recordRug({ mint: c.mint, sym: c.symbol || null, name: c.name || null, peakMc: Math.round(hiP * SUPPLY * M.sol), rugMc: Math.round(c.p * SUPPLY * M.sol), drop: fix(drop, 3), reason, at: now, born: c.created || null });
  }
}

function checkDump(c, now) {
  if (c.rugged || !c.p) return;
  const hi = high5(c, now);
  if (hi > 0 && c.launchP && hi >= 1.5 * c.launchP && c.p <= 0.3 * hi) rug(c, 1 - c.p / hi, 'dump');
}

function checkDev(c, now) {
  if (c.rugged || !c.devSold || !(c.devPct >= 2) || !(c.devTokens > 0)) return;
  if (c.devSoldTok < 0.8 * c.devTokens) return;
  const hi = high5(c, now);
  if (hi > 0 && c.p && c.p <= 0.6 * hi) rug(c, 1 - c.p / hi, 'dev');
}

function checkLiq(c) {
  if (c.rugged || !c.complete || !(c.liqMax >= 5000) || c.liq == null) return;
  if (c.liq < 0.2 * c.liqMax) rug(c, 1 - c.liq / c.liqMax, 'liq');
}

export function onLaunch(l) {
  if (M.coins.has(l.mint) && M.coins.get(l.mint).meta) return;
  const c = M.coins.get(l.mint) || blank(l.mint);
  c.created = l.created;
  c.dev = l.dev;
  c.devTokens = l.devTokens;
  c.devPct = l.devPct;
  c.k = l.k || K0;
  c.kAt = l.std ? l.created : 0;
  c.kSrc = 'stream';
  c.complete = false;
  if (!l.std) setTimeout(() => queueDetail(l.mint), 4000);
  setMeta(c, l);
  if (c.blocked) return;
  setPrice(c, l.p, 'launch', l.created);
  M.coins.set(c.mint, c);
  M.ring.unshift(c.mint);
  if (M.ring.length > RING_MAX) M.ring.length = RING_MAX;
  M.launchTimes.push(Date.now());
  M.lists.new = M.ring.filter((m) => okForList(M.coins.get(m))).slice(0, NEW_LIST);
  M.listsVer++;
  M.events.onNew(c);
}

export function onMigrate(mint) {
  const c = M.coins.get(mint);
  if (c) markComplete(c, true);
}

const okForList = (c) => c && c.meta && !c.blocked && !c.missing;

// ---------- what phones see ----------

function counts(c, now) {
  if (!c.tradesAt || now - c.tradesAt > 30000) return { b1: null, s1: null, u1: null, v1: null };
  let b1 = 0, s1 = 0, v1 = 0;
  const who = new Set();
  for (const t of c.trades) {
    if (t.ts < now - 60000) break;
    if (t.side) { b1++; who.add(t.who); } else s1++;
    v1 += t.sol;
  }
  return { b1, s1, u1: who.size, v1: fix(v1, 2) };
}

const mcOf = (c) => (c.p && M.sol ? Math.round(c.p * SUPPLY * M.sol) : null);

export function flagsOf(c, now = Date.now()) {
  let f = 0;
  if (c.bigAt && now - c.bigAt < 8000) f |= 1;
  if (c.rugged) f |= 2;
  if (c.complete) f |= 4;
  if (c.devSold) f |= 8;
  return f;
}

function athOf(c) {
  const own = c.athP && M.sol ? Math.round(c.athP * SUPPLY * M.sol) : null;
  if (c.ath == null) return own;
  return own == null ? c.ath : Math.max(c.ath, own);
}

// Jupiter's 5 m stats, null once they're 30 s stale
function stats5(c, now) {
  if (!c.tokFresh || now - c.tokFresh > 30000) return { b5: null, s5: null, h: null, dv: null, pc5: null };
  return { b5: c.b5, s5: c.s5, h: c.h, dv: c.dv, pc5: c.pc5 };
}

// [mint, p, mc, b1, s1, u1, prog, flags, v1, b5, s5, h, dv, pc5, liq]
export function tuple(c, now = Date.now()) {
  const n = counts(c, now);
  const j = stats5(c, now);
  c._cnt = n;
  return [c.mint, sig(c.p), mcOf(c), n.b1, n.s1, n.u1, c.prog == null ? null : fix(c.prog, 3), flagsOf(c, now), n.v1, j.b5, j.s5, j.h, j.dv, j.pc5, c.liq == null ? null : Math.round(c.liq)];
}

export function pub(c, now = Date.now()) {
  const n = c._cnt || counts(c, now);
  const j = stats5(c, now);
  return {
    mint: c.mint, name: c.name, symbol: c.symbol, img: '/img/' + c.mint,
    created: c.created, dev: c.dev, devPct: c.devPct, devSold: c.devSold,
    k: c.k || K0, p: sig(c.p), mc: mcOf(c),
    b1: n.b1, s1: n.s1, u1: n.u1, v1: n.v1,
    b5: j.b5, s5: j.s5, h: j.h, dv: j.dv, pc5: j.pc5,
    prog: c.prog == null ? null : fix(c.prog, 3), complete: !!c.complete,
    ath: athOf(c), liq: c.liq == null ? null : Math.round(c.liq), flags: flagsOf(c, now),
  };
}

export function tradesOut(c) {
  return c.trades.map((t) => [t.ts, t.side, fix(t.sol, 4), sig(t.p), t.who.slice(0, 4)]);
}

export function stats() {
  const now = Date.now();
  while (M.launchTimes.length && M.launchTimes[0] < now - 60000) M.launchTimes.shift();
  const f = M.feed || {};
  return {
    lpm: M.launchTimes.length,
    up: {
      stream: !!(f.connected && now - f.lastMsg < 60000),
      jup: now - meter('jup').lastOk < 15000,
      trades: now - meter('trades').lastOk < 45000,
      pump: !pumpBlocked(), // pump.fun's frontend-api (false on datacenter IPs: Jupiter stands in)
    },
  };
}

export function hotSet() {
  const s = new Set(M.lists.new);
  for (const m of M.lists.rising) s.add(m);
  for (const m of M.lists.bonding) s.add(m);
  return s;
}

export function snapshot() {
  const now = Date.now();
  const coins = [];
  for (const m of hotSet()) {
    const c = M.coins.get(m);
    if (okForList(c)) { tuple(c, now); coins.push(pub(c, now)); }
  }
  return { t: 'hello', v: 1, now, sol: M.sol, coins, lists: M.lists, stats: stats() };
}

// rising / bonding, recomputed every 5 s so phones don't get a reshuffle every second
export function refreshLists(now = Date.now()) {
  if (now - M.listsAt < 5000) return false;
  M.listsAt = now;
  const fresh = (c) => okForList(c) && c.p && now - c.pAt < 120000 && !c.rugged;
  const bonding = [], rising = [];
  const blockedApi = pumpBlocked();
  for (const c of M.coins.values()) {
    if (!fresh(c)) continue;
    const mc = mcOf(c);
    if (blockedApi) {
      // no curve to read: curve coins between $15K and the $45.6K bonding cap, by approximate progress
      if (!c.complete && c.complete != null && c.prog != null && mc >= 15000 && mc <= 45600) bonding.push(c);
    } else if (!c.complete && c.prog >= 0.35 && c.prog <= 0.995) {
      // some curves change their virtual reserves outside trades, so a progress worked out from an
      // old k can be far off: a bonding candidate needs its curve re-read from pump.fun in the last 5 min
      if (c.kSrc !== 'pump' || now - c.kAt > 120000) queueDetail(c.mint);
      if (c.kSrc === 'pump' && now - c.kAt < 300000) bonding.push(c);
    }
    if (mc >= 8000) {
      // our own 5 m history once we have most of it, else Jupiter's 5 m change, else what we have (>= 60 s)
      let ch = null;
      const span = c.hist.length ? now - c.hist[0][0] : 0;
      let base = null;
      for (const [t, p] of c.hist) if (t >= now - 300000) { base = p; break; }
      if (base && span >= 270000) ch = c.p / base - 1;
      else if (c.pc5 != null && now - c.tokFresh < 30000) ch = c.pc5 / 100;
      else if (base && span >= 60000) ch = c.p / base - 1;
      // at least +2% (a $100M coin up 0.2% on Jupiter's trending list isn't rising)
      if (ch != null && ch > 0.02) rising.push([c, ch]);
    }
  }
  bonding.sort((a, b) => b.prog - a.prog);
  rising.sort((a, b) => b[1] - a[1]);
  // rising rows show a progress bar too: keep their curves re-read every couple of minutes
  if (!blockedApi) for (const [c] of rising.slice(0, TOP_LIST)) if (!c.complete && (c.kSrc !== 'pump' || now - c.kAt > 120000)) queueDetail(c.mint);
  const next = {
    new: M.ring.filter((m) => okForList(M.coins.get(m))).slice(0, NEW_LIST),
    rising: rising.slice(0, TOP_LIST).map((r) => r[0].mint),
    bonding: bonding.slice(0, TOP_LIST).map((c) => c.mint),
  };
  const key = JSON.stringify(next), old = JSON.stringify(M.lists);
  M.lists = next;
  if (key !== old) { M.listsVer++; return true; }
  return false;
}

// ---------- subscriptions (from phones) ----------

const bump = (map, m, d) => {
  const n = (map.get(m) || 0) + d;
  if (n > 0) map.set(m, n); else map.delete(m);
};

export function applySub(oldHold, oldView, newHold, newView) {
  for (const m of oldHold) if (!newHold.has(m)) bump(M.hold, m, -1);
  for (const m of newHold) if (!oldHold.has(m)) { bump(M.hold, m, 1); ensureCoin(m); }
  if (oldView !== newView) {
    if (oldView) bump(M.view, oldView, -1);
    if (newView) {
      bump(M.view, newView, 1);
      const c = ensureCoin(newView);
      if (c) c.lastTradeFetch = 0; // poll it now
    }
  }
}

export function ensureCoin(mint) {
  if (!isMint(mint)) return null;
  let c = M.coins.get(mint);
  if (!c) {
    c = blank(mint);
    M.coins.set(mint, c);
  }
  if (!c.meta && !c.blocked && !c.missing) queueDetail(mint);
  return c;
}

// ---------- Jupiter: one budget for every call ----------
// lite-api tolerates ~36 calls/min combined from one IP (a free key: 10 per 10 s). Steady load:
// prices every 3 s (20/min) + token stats every 6 s (10/min) + lists/details when pump.fun's api
// is blocked (~4/min). With a key, prices every 2 s and stats every 4 s.
export const JB = budget(JUP_KEY ? 56 : 36);
const PRICE_GAP = JUP_KEY ? 2000 : 3000;
const TOK_GAP = JUP_KEY ? 4000 : 6000;

async function jupGet(url, name, timeout = 4500) {
  if (!canSpend(JB)) return { ok: false, status: 0, skipped: true };
  spend(JB);
  const res = await getJSON(url, { headers: JUP_HEADERS, timeout });
  record(name, res);
  if (res.status === 429) blocked(JB, res.retryAfter || 10);
  return res;
}

// ---------- Jupiter prices ----------

function jupPick(now) {
  const want = new Map(); // mint -> [interval, weight]
  const add = (m, iv, w) => { const o = want.get(m); if (!o || iv < o[0]) want.set(m, [iv, w]); };
  for (const m of M.candidates.keys()) add(m, 15000, 1);
  for (const m of M.lists.rising) add(m, 7500, 1.5);
  for (const m of M.lists.bonding) add(m, 7500, 1.5);
  for (const m of M.ring.slice(0, NEW_LIST)) add(m, 5000, 2);
  for (const m of M.hold.keys()) add(m, 2500, 3);
  for (const m of M.view.keys()) add(m, 2500, 3);
  const due = [];
  for (const [m, [iv, w]] of want) {
    const c = M.coins.get(m);
    if (!c || c.blocked || c.missing) continue;
    const over = now - (c.jupAt + iv);
    if (over >= 0) due.push([c, (over + 1) * w]);
  }
  due.sort((a, b) => b[1] - a[1]);
  return due.slice(0, 49).map((d) => d[0]);
}

async function jupLoop() {
  for (;;) {
    const now = Date.now();
    const pick = jupPick(now);
    const res = await jupGet(JUP_URL + '?ids=' + [SOL_MINT, ...pick.map((c) => c.mint)].join(','), 'jup', 4000);
    if (res.skipped) { await sleep(500); continue; }
    if (!res.ok || !res.data || typeof res.data !== 'object') {
      M.gaps.jup = Math.min(M.gaps.jup * 2, 30000);
      logEvery('jup-fail', 30000, 'jup: failed', res.status, res.ms + 'ms', 'next in', M.gaps.jup);
    } else {
      M.gaps.jup = PRICE_GAP;
      const d = res.data;
      const solP = num(d[SOL_MINT]?.usdPrice);
      if (solP > 0) { M.solLive = solP; M.solAt = now; if (!M.sol) M.sol = solP; }
      for (const c of pick) {
        c.jupAt = now;
        // bonded coins: Jupiter's liquidity until DEX Screener answers (a phone needs it for slippage)
        const jl = num(d[c.mint]?.liquidity);
        if (c.complete && jl > 0 && (c.liq == null || now - c.dexAt > 60000)) { c.liq = jl; c.liqMax = Math.max(c.liqMax, jl); }
        const u = num(d[c.mint]?.usdPrice);
        if (!(u > 0) || !M.solLive) continue;
        if (c.pSrc === 'trade' && now - c.pAt < 4000) { c.conf = true; continue; }
        setPrice(c, u / M.solLive, 'jup', now);
      }
    }
    await sleep(M.gaps.jup);
  }
}

// ---------- Jupiter token stats (5 min buys/sells, holders, dev balance) ----------
// lite-api tokens/v2/search takes up to 100 mints and is fresh within seconds even for a
// coin 20 s old. It fills the numbers swap-api's ~20 calls/min can't cover for every row.

const JUP_TOK = (JUP_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag') + '/tokens/v2/search?query=';

function tokPick(now) {
  const want = new Map();
  const add = (m, iv, w) => { const o = want.get(m); if (!o || iv < o[0]) want.set(m, [iv, w]); };
  for (const m of M.candidates.keys()) add(m, 15000, 1);
  for (const m of M.lists.rising) add(m, 5000, 2);
  for (const m of M.lists.bonding) add(m, 5000, 2);
  for (const m of M.ring.slice(0, NEW_LIST)) add(m, 5000, 2);
  for (const m of M.hold.keys()) add(m, 5000, 3);
  for (const m of M.view.keys()) add(m, 5000, 3);
  // sweep the whole launch ring every 2 min: older launches that took off show up in bonding/rising
  for (const m of M.ring) add(m, 120000, 0.4);
  const due = [];
  for (const [m, [iv, w]] of want) {
    const c = M.coins.get(m);
    if (!c || c.blocked || c.missing) continue;
    const over = now - (c.tokAt + iv);
    if (over >= 0) due.push([c, (over + 1) * w]);
  }
  due.sort((a, b) => b[1] - a[1]);
  return due.slice(0, 100).map((d) => d[0]);
}

async function tokLoop() {
  let gap = TOK_GAP;
  for (;;) {
    await sleep(gap);
    const now = Date.now();
    const pick = tokPick(now);
    if (!pick.length) continue;
    const res = await jupGet(JUP_TOK + pick.map((c) => c.mint).join(','), 'jupTok', 5000);
    if (res.skipped) { gap = 1000; continue; }
    if (!res.ok || !Array.isArray(res.data)) { gap = Math.min(gap * 2, 60000); continue; }
    gap = TOK_GAP;
    const by = new Map();
    for (const t of res.data) if (t && typeof t.id === 'string') by.set(t.id, t);
    for (const c of pick) {
      c.tokAt = now;
      const t = by.get(c.mint);
      if (!t) continue;
      try { applyJupToken(c, t, now); } catch (e) { logEvery('tok-parse', 30000, 'jupTok: parse', e?.message); }
    }
  }
}

// Everything a Jupiter token object tells us about a coin: name, dev, age, bonded or not,
// picture, price, liquidity and the 5 m stats. Used for every coin; for coins we never saw
// launch (pump.fun's api blocked) it's the whole coin.
function applyJupToken(c, t, now) {
  if (!c.meta) setMeta(c, { name: t.name, symbol: t.symbol });
  if (c.blocked) return;
  // the launch stream also announces new pools on old non-pump tokens (a tokenized stock showed up as a
  // seconds-old $85B "launch"). Another launchpad, or a token that existed a day before we saw it, is out.
  const born = Date.parse(t.createdAt || t.firstPool?.createdAt || '');
  if ((t.launchpad && t.launchpad !== 'pump.fun') || (Number.isFinite(born) && c.created && c.created - born > 864e5)) {
    c.blocked = true;
    const before = M.lists.new.length;
    M.lists.new = M.lists.new.filter((m) => m !== c.mint);
    if (M.lists.new.length !== before) M.listsVer++;
    return;
  }
  if (typeof t.icon === 'string' && t.icon.startsWith('http')) c.icon = t.icon.slice(0, 300);
  if (!c.created) {
    const cr = Date.parse(t.firstPool?.createdAt || t.createdAt || '');
    if (Number.isFinite(cr)) c.created = cr;
  }
  if (t.graduatedPool) markComplete(c, c.complete === false);
  else if (c.complete == null && t.launchpad === 'pump.fun') c.complete = false;
  applyTok(c, t, now);
}

function applyTok(c, t, now) {
  const s5 = t.stats5m;
  // a 5 m window with no trades comes back as an empty object or without counts: that's a real zero
  // only when Jupiter has priced the coin at all, else unknown
  const priced = num(t.usdPrice) > 0;
  // a big buy between two polls (5 s apart): the 5 m buy volume jumped by >= 1 SOL with new buys.
  // Exact for coins under 5 minutes old; for older ones an old buy leaving the window can hide one.
  const bv = num(s5?.buyVolume), nb = num(s5?.numBuys);
  if (bv != null && c.bv5 != null && nb != null && M.solLive && bv - c.bv5 >= BIG_BUY * M.solLive && nb > (c.b5 || 0)) c.bigAt = now;
  c.bv5 = bv;
  c.b5 = s5 ? num(s5.numBuys) ?? (priced ? 0 : null) : priced ? 0 : null;
  c.s5 = s5 ? num(s5.numSells) ?? (priced ? 0 : null) : priced ? 0 : null;
  c.pc5 = s5 && num(s5.priceChange) != null ? fix(num(s5.priceChange), 1) : null;
  const h = num(t.holderCount);
  c.h = h != null && h >= 0 ? h : null;
  // devBalancePercentage is missing both when the dev sold out and when Jupiter hasn't looked: unknown stays unknown
  const dv = num(t.audit?.devBalancePercentage);
  c.dv = dv != null ? fix(dv, 2) : null;
  const u = num(t.usdPrice);
  if (u > 0 && M.solLive && now - c.pAt > 2000 && !(c.pSrc === 'trade' && now - c.pAt < 4000)) setPrice(c, u / M.solLive, 'jup', now);
  if (!c.dev && typeof t.dev === 'string') c.dev = t.dev;
  const liq = num(t.liquidity);
  if (c.complete) {
    if (liq > 0 && (c.liq == null || now - c.dexAt > 60000)) { c.liq = liq; c.liqMax = Math.max(c.liqMax, liq); }
  } else if (liq > 0) {
    // on the curve, Jupiter's liquidity ~ the curve's virtual SOL in USD (a progress cross-check, never shown)
    c.cliq = liq;
    c.cliqAt = now;
    if (c.p) c.prog = curveProg(c);
  }
  c.tokFresh = now;
}

// SOL shown to phones moves every 30 s, so market caps don't all twitch on every batch
async function solLoop() {
  for (;;) {
    await sleep(30000);
    if (M.solLive && Date.now() - M.solAt < 60000) { M.sol = M.solLive; continue; }
    const res = await jupGet(JUP_URL + '?ids=' + SOL_MINT, 'jup', 4000);
    const p = num(res.data?.[SOL_MINT]?.usdPrice);
    if (p > 0) { M.sol = M.solLive = p; M.solAt = Date.now(); continue; }
    const dx = await getJSON('https://api.dexscreener.com/tokens/v1/solana/' + SOL_MINT, { timeout: 4000 });
    record('dex', dx);
    if (Array.isArray(dx.data)) {
      const best = dx.data.filter((x) => x?.baseToken?.address === SOL_MINT && num(x.priceUsd) > 0).sort((a, b) => (num(b.liquidity?.usd) || 0) - (num(a.liquidity?.usd) || 0))[0];
      if (best) M.sol = M.solLive = num(best.priceUsd);
    }
  }
}

// ---------- pump.fun trades: one rotating queue on a per-minute budget ----------
// swap-api blocks an IP for a minute after a short burst and keeps doing it even at
// 10 calls/min (see util.budget). The trade tape is for the coin a phone has open; every
// list row gets its numbers from Jupiter's token stats instead. Calls are spread evenly;
// each slot goes to the most overdue coin, viewed coins first.

export const TB = budget(8, 10);
const CB = budget(6, 8); // candles have their own limit on swap-api

function tradePick(now) {
  let best = null, bestScore = -1;
  const consider = (m, iv, w) => {
    const c = M.coins.get(m);
    if (!c || c.blocked || c.missing) return;
    const over = now - (c.lastTradeFetch + iv);
    if (over < 0) return;
    const s = (over + 1) * w;
    if (s > bestScore) { bestScore = s; best = c; }
  };
  for (const m of M.view.keys()) consider(m, 4000, 8);
  for (const m of M.hold.keys()) consider(m, 60000, 2);
  // spare slots: the newest launches, so big buys can flash a row
  if (!M.view.size) for (const m of M.ring.slice(0, 3)) consider(m, 45000, 0.5);
  return best;
}

export async function fetchTrades(c) {
  if (!canSpend(TB)) return { ok: false, status: 0, skipped: true };
  spend(TB);
  c.lastTradeFetch = Date.now();
  const res = await getJSON(SWAP + c.mint + '/trades?limit=' + TRADES_LIMIT + '&cursor=0&minSolAmount=0', { headers: BROWSER_HEADERS, timeout: 4000 });
  record('trades', res);
  if (res.ok) {
    try { onTrades(c, res.data); } catch (e) { logEvery('trades-parse', 30000, 'trades: parse', e?.message); }
  } else if (res.status === 429) {
    blocked(TB, res.retryAfter);
    logEvery('trades-429', 30000, 'trades: 429, blocked for', res.retryAfter || 60, 's, budget now', TB.limit, '/min');
  } else if (res.status === 400 && TRADES_LIMIT !== 50) {
    TRADES_LIMIT = 50;
  }
  return res;
}
let TRADES_LIMIT = 100;

function onTrades(c, data) {
  const arr = Array.isArray(data?.trades) ? data.trades : [];
  const now = Date.now();
  const list = [];
  for (const t of arr) {
    const ts = Date.parse(t?.timestamp);
    const p = num(t?.priceSol);
    if (!Number.isFinite(ts) || !(p > 0)) continue;
    list.push({ ts, side: t.type === 'buy' ? 1 : 0, sol: num(t.amountSol) || 0, p, who: typeof t.userAddress === 'string' ? t.userAddress : '', tx: t.tx || t.slotIndexId || '', tok: num(t.baseAmount) || 0, prog: t.program });
  }
  list.sort((a, b) => b.ts - a.ts);
  const first = !c.tradesAt;
  const prev = c.txSet || new Set();
  const fresh = list.filter((t) => !prev.has(t.tx));
  c.txSet = new Set(list.map((t) => t.tx));
  if (list[0]?.prog && list[0].prog !== 'pump') markComplete(c, true);
  else if (list[0]?.prog === 'pump' && c.complete == null) c.complete = false;
  for (const t of fresh) if (t.p > c.athP) c.athP = t.p;
  if (fresh.length) M.events.onPrints(c, fresh);
  if (fresh.some((t) => t.side === 1 && t.sol >= BIG_BUY && t.ts >= now - (first ? 8000 : 30000))) c.bigAt = now;
  if (c.dev) for (const t of fresh) if (t.side === 0 && t.who === c.dev) { c.devSold = true; c.devSoldTok += t.tok; }
  c.trades = list.slice(0, 50);
  c.tradesAt = now;
  if (list.length) setPrice(c, list[0].p, 'trade', now);
  checkDev(c, now);
  const key = list[0]?.tx || '';
  if (key !== c.tradesKey) {
    c.tradesKey = key;
    if (M.view.has(c.mint)) M.events.onTrades(c);
  }
}

async function tradesLoop() {
  let last = 0;
  for (;;) {
    const now = Date.now();
    M.gaps.trades = Math.round(60000 / TB.limit);
    if (now - last < M.gaps.trades || !canSpend(TB, now)) { await sleep(150); continue; }
    const c = tradePick(now);
    if (!c) { await sleep(150); continue; }
    last = now;
    const res = await fetchTrades(c);
    if (!res.ok && res.status >= 500) c.lastTradeFetch = Date.now() + 5000;
  }
}

// ---------- candles ----------

const candleCache = new LRU(200);

export async function getCandles(c, ms = 1500) {
  // the candle store (candles.mjs) has real swap-api 1 m candles shared with /api/candles
  if (M.candleRows) {
    try { const rows = await M.candleRows(c.mint, ms); if (rows?.length) return rows; } catch {}
  }
  const hit = candleCache.get(c.mint);
  if (hit && Date.now() - hit.at < 60000) return hit.rows;
  if (hit && !canSpend(CB)) return hit.rows;
  let rows = null;
  let res = { ok: false };
  if (canSpend(CB)) {
    spend(CB);
    const created = c.created || Date.now() - 200 * 60000;
    const url = SWAP + c.mint + '/candles?interval=1m&limit=200&currency=SOL&createdTs=' + Math.floor(created);
    res = await getJSON(url, { headers: BROWSER_HEADERS, timeout: ms });
    record('candles', res);
    if (res.status === 429) blocked(CB, res.retryAfter);
  }
  if (res.ok && Array.isArray(res.data)) {
    rows = [];
    for (const k of res.data) {
      const t = num(k?.timestamp), o = num(k?.open), h = num(k?.high), l = num(k?.low), cl = num(k?.close), v = num(k?.volume);
      if (t == null || !(o > 0) || !(cl > 0)) continue;
      rows.push([t, sig(o), sig(h), sig(l), sig(cl), fix(v || 0, 3)]);
    }
    rows.sort((a, b) => a[0] - b[0]);
  }
  if (!rows || !rows.length) rows = candlesFrom(c);
  else candleCache.set(c.mint, { at: Date.now(), rows });
  return rows;
}

// 1 m candles from what we saw ourselves: the coin's trades plus our own price history
export function candlesFrom(c) {
  const pts = c.trades.map((t) => [t.ts, t.p, t.sol]);
  const oldestTrade = pts.length ? pts[pts.length - 1][0] : Infinity;
  for (const [t, p] of c.hist) if (t < oldestTrade || !pts.length) pts.push([t, p, 0]);
  pts.sort((a, b) => a[0] - b[0]);
  const by = new Map();
  for (const [ts, p, sol] of pts) {
    const b = Math.floor(ts / 60000) * 60000;
    const k = by.get(b);
    if (!k) by.set(b, [b, p, p, p, p, sol]);
    else { k[2] = Math.max(k[2], p); k[3] = Math.min(k[3], p); k[4] = p; k[5] += sol; }
  }
  return [...by.values()].map((k) => [k[0], sig(k[1]), sig(k[2]), sig(k[3]), sig(k[4]), fix(k[5], 3)]);
}

// ---------- coin details (pump.fun coins-v2): one in flight, paced ----------

const detailQ = [];
const detailWait = new Map();
const detailFail = new LRU(2000); // mint -> retry-after ms

function queueDetail(mint) {
  const until = detailFail.get(mint);
  if (until && Date.now() < until) return;
  if (detailQ.includes(mint)) return;
  if (detailQ.length >= 200) return;
  detailQ.push(mint);
}

export function waitDetail(mint, ms) {
  return new Promise((resolve) => {
    const list = detailWait.get(mint) || [];
    list.push(resolve);
    detailWait.set(mint, list);
    setTimeout(resolve, ms);
  });
}

function applyPumpCoin(c, d, now) {
  setMeta(c, { name: d.name, symbol: d.symbol });
  if (c.blocked) return;
  const cr = num(d.created_timestamp);
  if (cr) c.created = cr;
  if (typeof d.creator === 'string') c.dev = d.creator;
  // market_cap is in SOL on every curve (whatever the quote token); virtual_token_reserves is
  // the same scale everywhere, so p and k in SOL terms come from those two, never from
  // virtual_sol_reserves (that's in the curve's own quote token now)
  const dec = num(d.base_decimals) || 6;
  const mcSol = num(d.market_cap);
  const vT = num(d.virtual_token_reserves) > 0 ? num(d.virtual_token_reserves) / 10 ** dec : null;
  const curveP = mcSol > 0 ? mcSol / SUPPLY : null;
  // old coins can say complete:false long after they moved to Raydium: a pool or zero curve tokens left means bonded
  const bonded = d.complete === true || !!d.raydium_pool || num(d.real_token_reserves) === 0;
  if (curveP && vT && !bonded) { c.k = curveP * vT * vT; c.kAt = now; c.kSrc = 'pump'; }
  const ath = num(d.ath_market_cap);
  if (ath > 0) c.ath = Math.round(ath);
  if (typeof d.twitter === 'string' && d.twitter) c.twitter = d.twitter.slice(0, 200);
  if (typeof d.website === 'string' && d.website) c.website = d.website.slice(0, 200);
  const rep = num(d.reply_count);
  if (rep != null) c.replies = rep;
  if (bonded) markComplete(c, c.complete === false && d.complete === true);
  else if (d.complete === false && c.complete == null) c.complete = false;
  // curve price from pump.fun's own SOL market cap (a bonded coin's curve numbers are frozen, so not for those)
  if (!c.complete && curveP && now - c.pAt > 10000) setPrice(c, curveP, 'pump', now);
  else if (c.complete && !c.p) {
    const usd = num(d.usd_market_cap);
    if (usd > 0 && M.solLive) setPrice(c, usd / SUPPLY / M.solLive, 'pump', now);
  }
  if (c.p) c.prog = curveProg(c); // a freshly read k changes the progress even when the price didn't move
  c.detailAt = now;
}

async function detailLoop() {
  for (;;) {
    if (!detailQ.length) { await sleep(150); continue; }
    if (!pumpOk()) { await jupDetails(); continue; }
    const mint = detailQ.shift();
    const c = M.coins.get(mint);
    if (!c || (c.meta && Date.now() - c.detailAt < 20000)) { resolveDetail(mint); continue; }
    const res = await getJSON(PUMP + '/coins-v2/' + mint, { headers: BROWSER_HEADERS, timeout: 4000 });
    record('detail', res);
    pumpResult(res);
    if (res.status === 403) { detailQ.unshift(mint); continue; }
    if (res.ok && res.data && typeof res.data === 'object' && res.data.mint) {
      try { applyPumpCoin(c, res.data, Date.now()); } catch (e) { logEvery('detail-parse', 30000, 'detail: parse', e?.message); }
      M.gaps.detail = Math.max(1100, M.gaps.detail * 0.8);
    } else {
      detailFail.set(mint, Date.now() + 30000);
      if (res.status === 404 && !c.meta) c.missing = true;
      if (res.status === 429) M.gaps.detail = Math.min(Math.max(M.gaps.detail * 2, (res.retryAfter || 0) * 1000), 60000);
    }
    resolveDetail(mint);
    await sleep(M.gaps.detail);
  }
}

function resolveDetail(mint) {
  const w = detailWait.get(mint);
  if (w) { detailWait.delete(mint); w.forEach((r) => r()); }
}

// pump.fun's api blocked: coins we don't know yet (held after a restart, opened from a Jupiter
// list) come from one Jupiter search for up to 50 of them. Coins we already know get refreshed
// by the token-stats loop, so only nameless ones need this.
async function jupDetails() {
  const batch = [];
  while (detailQ.length && batch.length < 50) {
    const m = detailQ.shift();
    const c = M.coins.get(m);
    if (!c || c.meta || c.blocked || c.missing) { resolveDetail(m); continue; }
    batch.push(c);
  }
  if (!batch.length) return;
  const res = await jupGet(JUP_TOK + batch.map((c) => c.mint).join(','), 'jupDetail', 4000);
  if (res.skipped) {
    // out of Jupiter budget this second: put them back and wait a beat
    for (const c of batch.reverse()) detailQ.unshift(c.mint);
    await sleep(700);
    return;
  }
  const now = Date.now();
  const by = new Map();
  if (res.ok && Array.isArray(res.data)) for (const t of res.data) if (t && typeof t.id === 'string') by.set(t.id, t);
  for (const c of batch) {
    const t = by.get(c.mint);
    if (t) {
      try { applyJupToken(c, t, now); c.tokAt = now; c.detailAt = now; } catch (e) { logEvery('jupdetail-parse', 30000, 'jupDetail: parse', e?.message); }
    } else if (res.ok) {
      // Jupiter indexes a launch within seconds; twice unknown means there's no such coin
      if (++c.jupMiss >= 2 && !c.meta) c.missing = true;
      else detailFail.set(c.mint, now + 5000);
    } else detailFail.set(c.mint, now + 30000);
    resolveDetail(c.mint);
  }
  await sleep(1500);
}

// ---------- Jupiter lists: rising / bonding / boot seed while pump.fun's api is blocked ----------

const JUP_BASE = JUP_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag';

function takeJupList(arr, now, { curveOnly = false } = {}) {
  let n = 0;
  for (const t of Array.isArray(arr) ? arr : []) {
    try {
      if (!t || t.launchpad !== 'pump.fun' || !isMint(t.id)) continue;
      if (curveOnly && t.graduatedPool) continue;
      let c = M.coins.get(t.id);
      if (!c) { c = blank(t.id); M.coins.set(t.id, c); }
      applyJupToken(c, t, now);
      c.tokAt = now;
      if (c.blocked || !c.meta) continue;
      M.candidates.set(t.id, now);
      n++;
    } catch (e) { logEvery('jlist-parse', 30000, 'jupList: parse', e?.message); }
  }
  return n;
}

async function jupListsLoop() {
  let i = 0;
  for (;;) {
    await sleep(i === 0 ? 1500 : 30000);
    const now = Date.now();
    // recent launches on the curve, every 30 s, only while pump.fun's api is blocked (bonding
    // candidates as they grow); trending coins feed rising in both modes
    if (pumpBlocked()) {
      const rec = await jupGet(JUP_BASE + '/tokens/v2/recent', 'jupList', 5000);
      if (rec.ok) takeJupList(rec.data, now, { curveOnly: true });
    }
    // trending pump.fun coins (5 m, the 1 h list when 5 m has none), every 60 s
    if (i % 2 === 0) {
      const tr = await jupGet(JUP_BASE + '/tokens/v2/toptrending/5m?limit=50', 'jupList', 5000);
      const got = tr.ok ? takeJupList(tr.data, now) : 0;
      if (!got) {
        const tr1 = await jupGet(JUP_BASE + '/tokens/v2/toptrending/1h?limit=50', 'jupList', 5000);
        if (tr1.ok) takeJupList(tr1.data, now);
      }
    }
    i++;
  }
}

// ---------- pump.fun active list: seeds rising / bonding ----------

async function seedLoop() {
  for (;;) {
    if (!pumpOk()) { await sleep(30000); continue; }
    const res = await getJSON(PUMP + '/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false', { headers: BROWSER_HEADERS, timeout: 5000 });
    record('list', res);
    pumpResult(res);
    if (res.ok && Array.isArray(res.data)) {
      const now = Date.now();
      for (const d of res.data) {
        try {
          if (!d || !isMint(d.mint) || d.complete || d.raydium_pool || num(d.real_token_reserves) === 0 || d.nsfw) continue;
          const usd = num(d.usd_market_cap);
          if (!(usd > 0 && usd < 80000)) continue;
          let c = M.coins.get(d.mint);
          if (!c) { c = blank(d.mint); M.coins.set(d.mint, c); }
          if (c.complete == null) c.complete = false;
          applyPumpCoin(c, d, now);
          if (c.blocked) continue;
          M.candidates.set(d.mint, now);
        } catch (e) { logEvery('seed-parse', 30000, 'seed: parse', e?.message); }
      }
    }
    await sleep(res.status === 429 ? 60000 : 30000);
  }
}

// a fresh boot has no launches yet: fill the new list with the last few minutes of pump.fun
async function bootSeed() {
  for (let i = 0; i < 3; i++) {
    if (!pumpOk()) return bootSeedJup();
    const res = await getJSON(PUMP + '/coins?offset=0&limit=40&sort=created_timestamp&order=DESC&includeNsfw=false', { headers: BROWSER_HEADERS, timeout: 6000 });
    record('list', res);
    pumpResult(res);
    if (res.status === 403) return bootSeedJup();
    if (res.ok && Array.isArray(res.data)) {
      const now = Date.now();
      const rows = res.data.filter((d) => d && isMint(d.mint) && !d.complete && !d.nsfw && num(d.created_timestamp) > now - 900000);
      rows.sort((a, b) => num(a.created_timestamp) - num(b.created_timestamp));
      for (const d of rows) {
        if (M.coins.get(d.mint)?.meta) continue;
        const c = M.coins.get(d.mint) || blank(d.mint);
        c.complete = false;
        applyPumpCoin(c, d, now);
        if (c.blocked || !c.meta) continue;
        M.coins.set(d.mint, c);
        if (!M.ring.includes(d.mint)) M.ring.unshift(d.mint);
      }
      M.ring.sort((a, b) => (M.coins.get(b)?.created || 0) - (M.coins.get(a)?.created || 0));
      M.lists.new = M.ring.filter((m) => okForList(M.coins.get(m))).slice(0, NEW_LIST);
      M.listsVer++;
      return;
    }
    await sleep(5000);
  }
}

// the same from Jupiter's recent list (the last ~30 launches on any launchpad; pump.fun's kept)
async function bootSeedJup() {
  for (let i = 0; i < 3; i++) {
    const res = await jupGet(JUP_BASE + '/tokens/v2/recent', 'jupList', 6000);
    if (res.ok && Array.isArray(res.data)) {
      const now = Date.now();
      const rows = res.data.filter((t) => t && t.launchpad === 'pump.fun' && isMint(t.id) && !t.graduatedPool);
      for (const t of rows) {
        if (M.coins.get(t.id)?.meta) continue;
        const c = M.coins.get(t.id) || blank(t.id);
        c.complete = false;
        applyJupToken(c, t, now);
        c.tokAt = now;
        if (c.blocked || !c.meta || !c.created || c.created < now - 900000) continue;
        M.coins.set(t.id, c);
        if (!M.ring.includes(t.id)) M.ring.unshift(t.id);
      }
      M.ring.sort((a, b) => (M.coins.get(b)?.created || 0) - (M.coins.get(a)?.created || 0));
      M.lists.new = M.ring.filter((m) => okForList(M.coins.get(m))).slice(0, NEW_LIST);
      M.listsVer++;
      return;
    }
    await sleep(3000);
  }
}

// ---------- DEX Screener: bonded coins phones hold or view ----------

async function dexLoop() {
  for (;;) {
    await sleep(2000);
    // every bonded coin a phone holds or views, refreshed every 10 s (a new one within ~2 s)
    const want = [];
    const now0 = Date.now();
    for (const m of new Set([...M.hold.keys(), ...M.view.keys()])) {
      const c = M.coins.get(m);
      if (c && c.complete && now0 - c.dexAt > 10000) want.push(c);
    }
    for (const c of want) c.dexAt = now0;
    for (let i = 0; i < want.length; i += 30) {
      const batch = want.slice(i, i + 30);
      const res = await getJSON('https://api.dexscreener.com/tokens/v1/solana/' + batch.map((c) => c.mint).join(','), { timeout: 5000 });
      record('dex', res);
      if (!res.ok || !Array.isArray(res.data)) continue;
      const now = Date.now();
      const best = new Map();
      for (const pr of res.data) {
        const m = pr?.baseToken?.address;
        const liq = num(pr?.liquidity?.usd) || 0;
        if (!m) continue;
        if (!best.has(m) || liq > best.get(m).liq) best.set(m, { pr, liq });
      }
      for (const c of batch) {
        const b = best.get(c.mint);
        if (!b) continue;
        c.liq = b.liq;
        c.liqMax = Math.max(c.liqMax, b.liq);
        c.dexAt = now;
        let p = null;
        if (b.pr.quoteToken?.address === SOL_MINT) p = num(b.pr.priceNative);
        else if (num(b.pr.priceUsd) > 0 && M.solLive) p = num(b.pr.priceUsd) / M.solLive;
        if (p > 0 && !(c.pSrc === 'trade' && now - c.pAt < 4000) && now - c.pAt > 3000) setPrice(c, p, 'dex', now);
        checkLiq(c);
      }
    }
  }
}

// ---------- housekeeping ----------

function gc() {
  const now = Date.now();
  for (const [m, t] of M.candidates) if (now - t > 600000) M.candidates.delete(m);
  const keep = new Set(M.ring);
  for (const m of hotSet()) keep.add(m);
  for (const m of M.hold.keys()) keep.add(m);
  for (const m of M.view.keys()) keep.add(m);
  for (const m of M.candidates.keys()) keep.add(m);
  for (const m of M.coins.keys()) if (!keep.has(m)) M.coins.delete(m);
  // older launches stop moving; free their trade lists
  const hot = hotSet();
  for (const m of M.ring.slice(120)) {
    const c = M.coins.get(m);
    if (c && !M.hold.has(m) && !M.view.has(m) && !hot.has(m)) { c.trades = []; c.txSet = null; c.tradesAt = 0; }
  }
}

// ---------- /api/coin ----------

export async function coinDetail(mint) {
  const t0 = Date.now();
  let c = ensureCoin(mint);
  if (!c) return { status: 400 };
  const jobs = [];
  if (!c.meta && !c.blocked && !c.missing) jobs.push(waitDetail(mint, 1500));
  else if (Date.now() - c.detailAt > 20000) queueDetail(mint);
  if (Date.now() - c.tradesAt > 3000 && Date.now() - c.lastTradeFetch > 800) jobs.push(Promise.race([fetchTrades(c), sleep(1500)]));
  const candles = Promise.race([getCandles(c, 1500), sleep(1600).then(() => null)]);
  await Promise.all(jobs);
  let rows = await candles;
  c = M.coins.get(mint);
  if (!c || c.blocked || c.missing) return { status: 404 };
  if (!c.meta && !c.p) return { status: 503 };
  if (!rows || !rows.length) rows = candlesFrom(c);
  const now = Date.now();
  tuple(c, now);
  const coin = pub(c, now);
  coin.twitter = c.twitter;
  coin.website = c.website;
  coin.replies = c.replies;
  return { status: 200, body: { coin, trades: tradesOut(c), candles: rows }, ms: Date.now() - t0 };
}

// Jupiter's picture URL for a coin, if any (the /img proxy's fallback when images.pump.fun has none)
export function iconOf(mint) {
  return M.coins.get(mint)?.icon || null;
}

// ms since we first saw the coin launch (null if unknown): young coins' pictures aren't up yet, so misses retry soon
export function coinAge(mint) {
  const c = M.coins.get(mint);
  return c?.created ? Date.now() - c.created : null;
}

export function health() {
  const now = Date.now();
  const b = (x) => ({ limit: x.limit, used: x.calls.filter((t) => t > now - 60000).length, blockedFor: Math.max(0, Math.round((x.blockedUntil - now) / 1000)), blocks: x.blocks });
  return {
    coins: M.coins.size, ring: M.ring.length, candidates: M.candidates.size, hold: M.hold.size, view: M.view.size, detailQ: detailQ.length,
    gaps: { ...M.gaps }, trades: b(TB), candles: b(CB), jupiter: b(JB), sol: M.sol,
    pumpApi: { blocked: pumpBlocked(), forced: FORCE_BLOCKED, since: PB.since || null, nextProbeIn: PB.blocked && !FORCE_BLOCKED ? Math.max(0, Math.round((PB.probeAt - now) / 1000)) : null },
  };
}

export function startMarket(feed) {
  M.feed = feed;
  const guard = (name, fn) => fn().catch((e) => { console.error(name, 'crashed', e); setTimeout(() => guard(name, fn), 5000); });
  bootSeed().catch((e) => console.error('bootSeed', e));
  guard('jup', jupLoop);
  guard('sol', solLoop);
  guard('jupTok', tokLoop);
  guard('jupLists', jupListsLoop);
  guard('trades', tradesLoop);
  guard('detail', detailLoop);
  guard('seed', seedLoop);
  guard('dex', dexLoop);
  setInterval(() => { try { gc(); } catch (e) { console.error('gc', e); } }, 60000).unref?.();
}
