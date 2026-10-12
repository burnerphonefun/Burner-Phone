// Live check of the burner server: connect like a phone, subscribe, and audit the numbers.
// usage: node scripts/server-probe.mjs [base=http://localhost:8787] [seconds=60]
import WebSocket from 'ws';
const BASE = process.argv[2] || 'http://localhost:8787';
const SECS = Number(process.argv[3] || 60);
const H = { 'user-agent': 'Mozilla/5.0', accept: 'application/json', origin: 'https://pump.fun', referer: 'https://pump.fun/' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (n) => (n == null ? 'null' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n));

const coins = new Map();
let sol = null, lists = null, stats = null;
const ev = { hello: 0, ticks: 0, tupleRows: 0, fullRows: 0, news: 0, trades: 0, rugs: [], grads: [], bytes: 0 };
let hold = [], view = null, lastTrades = null;
const t0 = Date.now();

const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws');
ws.onmessage = (e) => {
  ev.bytes += e.data.length;
  const d = JSON.parse(e.data);
  if (d.t === 'hello') {
    ev.hello++;
    sol = d.sol; lists = d.lists; stats = d.stats;
    for (const c of d.coins) coins.set(c.mint, c);
    console.log(`hello: sol=$${sol} coins=${d.coins.length} new=${lists.new.length} rising=${lists.rising.length} bonding=${lists.bonding.length} stats=${JSON.stringify(stats)}`);
    // hold the two newest, view the busiest coin we can see
    hold = lists.new.slice(0, 2);
    const pick = [...lists.rising, ...lists.bonding, ...lists.new].find((m) => !hold.includes(m));
    view = pick || null;
    ws.send(JSON.stringify({ t: 'sub', hold, view }));
    console.log('sub hold', hold.map((m) => coins.get(m)?.symbol), 'view', coins.get(view)?.symbol, view);
  } else if (d.t === 'tick') {
    ev.ticks++;
    if (d.sol) sol = d.sol;
    if (d.lists) lists = d.lists;
    if (d.stats) stats = d.stats;
    for (const c of d.coins || []) { coins.set(c.mint, c); ev.fullRows++; }
    for (const [mint, p, mc, b1, s1, u1, prog, flags, v1, b5, s5, h, dv, pc5] of d.c || []) {
      ev.tupleRows++;
      const c = coins.get(mint) || { mint };
      Object.assign(c, { p, mc, b1, s1, u1, prog, flags, v1, b5, s5, h, dv, pc5 });
      coins.set(mint, c);
    }
  } else if (d.t === 'new') {
    ev.news++;
    coins.set(d.coin.mint, d.coin);
  } else if (d.t === 'trades') {
    ev.trades++;
    lastTrades = d;
  } else if (d.t === 'rug') {
    ev.rugs.push(d);
    console.log('RUG', coins.get(d.mint)?.symbol, d.mint.slice(0, 6), 'drop', d.drop, d.reason);
  } else if (d.t === 'grad') {
    ev.grads.push(d);
    console.log('GRAD', coins.get(d.mint)?.symbol, d.mint.slice(0, 6));
  }
};
ws.onerror = (e) => console.log('ws error', e.message);

function report() {
  const all = [...coins.values()];
  const listed = new Set([...(lists?.new || []), ...(lists?.rising || []), ...(lists?.bonding || [])]);
  const vis = all.filter((c) => listed.has(c.mint));
  const f = (k) => vis.filter((c) => c[k] != null).length;
  console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] sol=$${sol} lpm=${stats?.lpm} up=${JSON.stringify(stats?.up)} ticks=${ev.ticks} rows=${ev.tupleRows} full=${ev.fullRows} new=${ev.news} tradesMsgs=${ev.trades} rugs=${ev.rugs.length} grads=${ev.grads.length} kB=${(ev.bytes / 1024).toFixed(1)}`);
  console.log(`  listed=${vis.length} p=${f('p')} mc=${f('mc')} b1=${f('b1')} b5=${f('b5')} h=${f('h')} dv=${f('dv')} pc5=${f('pc5')} prog=${f('prog')}  lists new/rising/bonding=${lists?.new.length}/${lists?.rising.length}/${lists?.bonding.length}`);
  const show = (m) => { const c = coins.get(m); if (!c) return; console.log(`   ${String(c.symbol).padEnd(12)} mc=${usd(c.mc).padEnd(8)} prog=${c.prog} 1m b/s/u/v=${c.b1}/${c.s1}/${c.u1}/${c.v1} 5m b/s=${c.b5}/${c.s5} pc5=${c.pc5} holders=${c.h} dv=${c.dv} flags=${c.flags} devPct=${c.devPct}`); };
  console.log('  newest:'); (lists?.new || []).slice(0, 4).forEach(show);
  console.log('  rising:'); (lists?.rising || []).slice(0, 3).forEach(show);
  console.log('  bonding:'); (lists?.bonding || []).slice(0, 3).forEach(show);
  console.log('  held:'); hold.forEach(show);
  if (lastTrades) console.log(`  trades for ${coins.get(lastTrades.mint)?.symbol}: ${lastTrades.tr.length} rows, newest ${JSON.stringify(lastTrades.tr[0])} age ${lastTrades.tr[0] ? Math.round((Date.now() - lastTrades.tr[0][0]) / 1000) + 's' : '-'}`);
}

for (let s = 10; s <= SECS; s += 10) {
  await sleep(10000);
  report();
  const h = await (await fetch(BASE + '/health')).json();
  const m = h.meters;
  const line = Object.entries(m).map(([k, v]) => `${k}:${v.ok}/${v.calls} 429=${v.e429} err=${v.err} ${v.lastMs}ms`).join(' | ');
  console.log('  pump api:', JSON.stringify(h.market.pumpApi), '| jupiter budget', JSON.stringify(h.market.jupiter), '| downloads', h.downloads);
  console.log('  health:', line, '| trades budget', JSON.stringify(h.market.trades), 'candles', JSON.stringify(h.market.candles), 'detailQ', h.market.detailQ, 'feed', JSON.stringify({ c: h.feed.connected, l: h.feed.launches, d: h.feed.dropped, mig: h.feed.migrations }));
}
ws.close();

// /api/coin + /img
if (view) {
  let t = Date.now();
  const r = await fetch(BASE + '/api/coin/' + view);
  const j = await r.json();
  console.log(`\n/api/coin ${r.status} in ${Date.now() - t}ms: ${j.coin?.symbol} mc=${usd(j.coin?.mc)} trades=${j.trades?.length} candles=${j.candles?.length} first candle=${JSON.stringify(j.candles?.[0])} last=${JSON.stringify(j.candles?.at(-1))} twitter=${j.coin?.twitter}`);
  t = Date.now();
  const im = await fetch(BASE + '/img/' + view);
  console.log(`/img ${im.status} ${im.headers.get('content-type')} ${(await im.arrayBuffer()).byteLength}B in ${Date.now() - t}ms cors=${im.headers.get('access-control-allow-origin')}`);
  t = Date.now();
  const im2 = await fetch(BASE + '/img/' + view);
  console.log(`/img again ${im2.status} in ${Date.now() - t}ms`);
}

// audit: our market cap vs pump.fun's own numbers for the same coins
console.log('\naudit vs pump.fun coins-v2 (market_cap there is SOL):');
const sample = [...new Set([...(lists?.bonding || []).slice(0, 2), ...(lists?.rising || []).slice(0, 2), ...(lists?.new || []).slice(0, 2)])].slice(0, 5);
for (const m of sample) {
  await sleep(1300);
  const c = coins.get(m);
  const r = await fetch('https://frontend-api-v3.pump.fun/coins-v2/' + m, { headers: H });
  if (!r.ok) { console.log('  ', c?.symbol, 'pump.fun', r.status); continue; }
  const d = await r.json();
  const theirSol = d.market_cap, oursSol = c?.p * 1e9;
  const rT = d.real_token_reserves / 1e6;
  const theirProg = d.complete ? 1 : Math.max(0, Math.min(1, 1 - rT / 793100000));
  let dex = '';
  if (d.complete) {
    const dx = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + m)).json();
    const best = (Array.isArray(dx) ? dx : []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (best) dex = ` | dexscreener mc ${usd(best.marketCap)} liq ${usd(best.liquidity?.usd)}`;
  }
  console.log(`   ${String(c?.symbol).padEnd(12)} ours ${oursSol?.toFixed(2)} SOL (${usd(c?.mc)}) | pump.fun ${theirSol?.toFixed(2)} SOL (${usd(theirSol * sol)}) diff ${(((oursSol / theirSol) - 1) * 100).toFixed(1)}% | prog ours ${c?.prog} theirs(real tokens) ${theirProg.toFixed(3)} complete=${d.complete} quote=${String(d.quote_mint || '').slice(0, 6)}${dex}`);
}
const { progressFromPrice, V_SOL0, V_TOK0, REAL_TOK, K0 } = await import('../shared/curve.js');
const endP = (K0 / (V_TOK0 - REAL_TOK)) / (V_TOK0 - REAL_TOK);
console.log(`curve end: price ${endP.toExponential(4)} SOL -> mc ${(endP * 1e9).toFixed(1)} SOL = ${usd(endP * 1e9 * sol)} prog=${progressFromPrice(endP)}; launch mc ${(V_SOL0 / V_TOK0 * 1e9).toFixed(2)} SOL = ${usd(V_SOL0 / V_TOK0 * 1e9 * sol)}`);
process.exit(0);
