// node scripts/server-chartprobe.mjs — what the free chart sources return for a live pump.fun coin
// (shapes, units, intervals). Light on calls: run once, not in a loop.
const H = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'application/json', origin: 'https://pump.fun', referer: 'https://pump.fun/' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, h = H) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(8000) });
    const txt = await r.text();
    return { status: r.status, ms: Date.now() - t0, txt, ra: r.headers.get('retry-after'), lim: r.headers.get('x-ratelimit-remaining') };
  } catch (e) { return { status: 0, ms: Date.now() - t0, txt: e.message }; }
}

// a coin that's trading right now: from Jupiter's 5 m trending, pump.fun launchpad, on the curve if possible
const tr = JSON.parse((await get('https://lite-api.jup.ag/tokens/v2/toptrending/5m?limit=50', { accept: 'application/json' })).txt);
const pump = tr.filter((t) => t.launchpad === 'pump.fun');
const curve = pump.find((t) => !t.graduatedPool) || null;
const grad = pump.find((t) => t.graduatedPool) || null;
console.log('curve coin', curve?.symbol, curve?.id, 'mc', Math.round(curve?.mcap || 0), '| grad coin', grad?.symbol, grad?.id, 'mc', Math.round(grad?.mcap || 0));

for (const t of [curve, grad].filter(Boolean)) {
  const m = t.id;
  const created = Date.parse(t.firstPool?.createdAt || t.createdAt);
  console.log('\n=====', t.symbol, m, 'created', new Date(created).toISOString());
  for (const iv of ['1s', '5s', '15s', '1m', '5m']) {
    const r = await get(`https://swap-api.pump.fun/v2/coins/${m}/candles?interval=${iv}&limit=5&currency=SOL&createdTs=${created}`);
    console.log('swap candles', iv, r.status, r.ms + 'ms', r.txt.slice(0, 260));
    await sleep(1200);
  }
  const ru = await get(`https://swap-api.pump.fun/v2/coins/${m}/candles?interval=1m&limit=3&currency=USD&createdTs=${created}`);
  console.log('swap candles 1m USD', ru.status, ru.txt.slice(0, 260));
  await sleep(1200);
  const pools = await get(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${m}/pools?page=1`, { accept: 'application/json' });
  console.log('gecko pools', pools.status, pools.ms + 'ms', 'remaining', pools.lim);
  let pool = null;
  try {
    const j = JSON.parse(pools.txt);
    for (const p of j.data || []) console.log('   pool', p.attributes?.address, p.relationships?.dex?.data?.id, p.attributes?.name, 'vol24', p.attributes?.volume_usd?.h24, 'base_price', p.attributes?.base_token_price_native_currency);
    pool = j.data?.[0]?.attributes?.address;
  } catch { console.log(pools.txt.slice(0, 200)); }
  if (pool) {
    for (const [tf, agg] of [['minute', 1], ['minute', 5], ['second', 15], ['second', 1]]) {
      const r = await get(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=5&currency=token&token=base`, { accept: 'application/json' });
      console.log('gecko ohlcv', tf, agg, r.status, r.ms + 'ms', 'remaining', r.lim, r.txt.slice(0, 300));
      await sleep(2500);
    }
    const r2 = await get(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=3`, { accept: 'application/json' });
    console.log('gecko ohlcv usd default', r2.status, r2.txt.slice(0, 300));
    await sleep(2500);
    const r3 = await get(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades?trade_volume_in_usd_greater_than=0`, { accept: 'application/json' });
    console.log('gecko trades', r3.status, r3.ms + 'ms', r3.txt.slice(0, 400));
  }
  await sleep(2000);
}
