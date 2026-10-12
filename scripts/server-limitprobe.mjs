// node scripts/server-limitprobe.mjs <mint> [gapMs] [max] — measure swap-api's candles limit from this IP:
// calls the candles endpoint every gapMs until a 429 (or max calls), prints when it blocked and the retry-after,
// then checks whether the trades endpoint on the same host is blocked too, and the max candle `limit`.
const H = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'application/json', origin: 'https://pump.fun', referer: 'https://pump.fun/' };
const [mint, gapArg = '2000', maxArg = '40'] = process.argv.slice(2);
const gap = +gapArg, max = +maxArg;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = Date.now() - 6 * 3600e3;
async function call(url) { const t0 = Date.now(); const r = await fetch(url, { headers: H }); const txt = await r.text(); return { s: r.status, ms: Date.now() - t0, ra: r.headers.get('retry-after'), n: txt.startsWith('[') ? JSON.parse(txt).length : null, txt }; }

for (const lim of []) {
  const r = await call(`https://swap-api.pump.fun/v2/coins/${mint}/candles?interval=1s&limit=${lim}&currency=SOL&createdTs=${created}`);
  console.log('limit', lim, '->', r.s, 'rows', r.n, r.s !== 200 ? r.txt.slice(0, 160) : '');
  await sleep(gap);
}
const t0 = Date.now();
for (let i = 1; i <= max; i++) {
  const r = await call(`https://swap-api.pump.fun/v2/coins/${mint}/candles?interval=1m&limit=60&currency=SOL&createdTs=${created}`);
  if (r.s === 429) {
    console.log(`429 after ${i - 1} ok calls in ${((Date.now() - t0) / 1000).toFixed(1)} s (gap ${gap} ms), retry-after ${r.ra}`);
    const tr = await call(`https://swap-api.pump.fun/v2/coins/${mint}/trades?limit=10&cursor=0&minSolAmount=0`);
    console.log('trades endpoint while candles blocked:', tr.s);
    process.exit(0);
  }
  if (r.s !== 200) console.log('call', i, 'status', r.s, r.txt.slice(0, 120));
  await sleep(gap);
}
console.log(`no 429 in ${max} calls at ${gap} ms gap (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
