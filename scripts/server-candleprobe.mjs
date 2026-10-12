// node scripts/server-candleprobe.mjs [base] [seconds] [mint]
// Opens a coin like a phone would (WS sub view), reads /api/candles for 5s/1m/5m, prints candle pushes,
// then compares our 1 m candles with GeckoTerminal's for the same minutes (one pool + one ohlcv call).
const base = process.argv[2] || 'http://localhost:8794';
const secs = +(process.argv[3] || 120);
let mint = process.argv[4] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (k) => k ? `${new Date(k[0]).toISOString().slice(11, 19)} o${k[1].toExponential(3)} h${k[2].toExponential(3)} l${k[3].toExponential(3)} c${k[4].toExponential(3)} v${k[5]} est${k[6]}` : '-';

const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
const pushes = { candle: { '5s': 0, '1m': 0 }, candles: [], trades: 0 };
let lastK = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'hello' && !mint) {
    // the busiest coin we know: rising first
    mint = m.lists.rising[0] || m.lists.new[0];
    const c = m.coins.find((x) => x.mint === mint);
    console.log('coin', c?.symbol, mint, 'mc', c?.mc);
  }
  if (m.t === 'hello') ws.send(JSON.stringify({ t: 'sub', hold: [], view: mint }));
  if (m.t === 'candle' && m.mint === mint) { pushes.candle[m.tf]++; lastK[m.tf] = m.k; }
  if (m.t === 'candles' && m.mint === mint) { pushes.candles.push(m.tf + ':' + m.candles.length); }
  if (m.t === 'trades' && m.mint === mint) pushes.trades++;
};
while (!mint) await sleep(100);
await sleep(300);
const t0 = Date.now();
for (const tf of ['5s', '1m', '5m']) {
  const a = Date.now();
  const r = await (await fetch(`${base}/api/candles/${mint}?tf=${tf}`)).json();
  const real = r.candles.filter((k) => !k[6]).length;
  console.log(`/api/candles ${tf}: ${Date.now() - a} ms, ${r.candles.length} candles (${real} real, ${r.candles.length - real} est/fill), from ${r.from.join(',')}`);
  console.log('   last 3:', r.candles.slice(-3).map(fmt).join('\n           '));
}
let lastPrint = 0;
while (Date.now() - t0 < secs * 1000) {
  await sleep(1000);
  if (Date.now() - lastPrint > 15000) {
    lastPrint = Date.now();
    console.log(`+${Math.round((Date.now() - t0) / 1000)}s pushes: candle 5s ${pushes.candle['5s']}, 1m ${pushes.candle['1m']}, full ${pushes.candles.join(' ') || '-'}, trades ${pushes.trades} | open 5s ${fmt(lastK['5s'])} | open 1m ${fmt(lastK['1m'])}`);
  }
}
const h = await (await fetch(base + '/health')).json();
console.log('health.candles', JSON.stringify(h.candles));
console.log('meters', JSON.stringify({ candles: h.meters.candles, gecko: h.meters.gecko, trades: h.meters.trades }));

// accuracy: our 1 m candles vs GeckoTerminal's for the same closed minutes
const ours = (await (await fetch(`${base}/api/candles/${mint}?tf=1m`)).json()).candles.filter((k) => !k[6]);
const pools = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`, { headers: { accept: 'application/json' } })).json().catch(() => null);
const pool = pools?.data?.filter((x) => x?.relationships?.quote_token?.data?.id === 'solana_So11111111111111111111111111111111111111112').sort((a, b) => (+b.attributes.reserve_in_usd || 0) - (+a.attributes.reserve_in_usd || 0))[0]?.attributes?.address;
if (!pool) { console.log('gecko: no pool (or rate limited)'); process.exit(0); }
await sleep(3000);
const g = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=30&currency=token&token=base`, { headers: { accept: 'application/json' } })).json().catch(() => null);
const gl = g?.data?.attributes?.ohlcv_list || [];
const gm = new Map(gl.map((k) => [k[0] * 1000, k]));
let n = 0, sumC = 0, sumV = 0, nv = 0;
const now = Date.now();
for (const k of ours) {
  if (k[0] > now - 120000) continue; // closed minutes only
  const x = gm.get(k[0]);
  if (!x) continue;
  n++;
  const dc = Math.abs(k[4] / x[4] - 1);
  sumC += dc;
  if (k[5] > 0 && x[5] > 0) { sumV += Math.abs(k[5] / x[5] - 1); nv++; }
  if (n <= 6) console.log(`  ${new Date(k[0]).toISOString().slice(11, 16)} close ours ${k[4].toExponential(4)} gecko ${(+x[4]).toExponential(4)} (${(dc * 100).toFixed(2)}%)  vol ours ${k[5]} gecko ${(+x[5]).toFixed(4)}`);
}
console.log(`compared ${n} closed minutes: mean close diff ${n ? ((sumC / n) * 100).toFixed(2) : '-'}%, mean volume diff ${nv ? ((sumV / nv) * 100).toFixed(1) : '-'}% (${nv} minutes with volume)`);
process.exit(0);
