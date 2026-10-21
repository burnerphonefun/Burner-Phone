# Burner data contract (server ⇄ phone)

One Node server (`server/index.mjs`) holds every upstream connection and pushes to all phones (site demo + desktop overlay). Phones never call pump.fun / Jupiter themselves.

Prices are **SOL per token** (`p`). Market cap in USD = `p * 1e9 * sol` (supply is always 1B). Curve maths in `shared/curve.js`.

## WebSocket `/ws` (JSON text frames, permessage-deflate on)

Server → phone:

```js
{ t: 'hello', v: 1, now, sol,                     // sol = SOL/USD
  coins: [Coin, ...],                             // every coin any list below references
  lists: { new: [mint...], rising: [mint...], bonding: [mint...] },
  stats: { lpm, up } }                            // lpm = launches in the last minute; up = upstream health {stream, jup, trades} booleans
{ t: 'new', coin: Coin }                          // a launch, seconds old (also goes to the top of lists.new)
{ t: 'tick', now, sol,                            // ~1 s, only coins whose numbers moved
  c: [[mint, p, mc, b1, s1, u1, prog, flags, v1, b5, s5, h, dv, pc5, liq], ...],
  coins?: [Coin],                                 // coins this phone hasn't seen yet
  lists?, stats? }                                // lists/stats only when changed; held/open coins come every tick their price was re-checked
{ t: 'trades', mint, tr: [[ts, side, sol, p, who], ...] }   // newest first, for the coin a phone views (side 1 = buy, 0 = sell; who = wallet first 4 chars)
{ t: 'rug', mint, drop, reason }                  // drop 0..1 from the 5 min high; reason 'dump' | 'dev' | 'liq'
{ t: 'grad', mint }                               // bonded / migrated
```

Phone → server:

```js
{ t: 'sub', hold: [mint...], view: mint | null }  // coins this phone holds (prices every ~2 s) and the one it has open (trades every ~2 s)
```

### Coin

```js
{ mint, name, symbol, img,          // name may be null on a held coin before lookup: the phone keeps its copy. img = '/img/<mint>' (same-origin proxy, CORS *)
  created,                          // ms
  dev, devPct,                      // creator wallet, % of supply the dev bought at launch (0..100)
  devSold,                          // true once the dev was seen selling
  k,                                // curve constant from the launch message (vSol*vTok), else K0
  p, mc,                            // last price (SOL/token), market cap USD
  b1, s1, u1, v1,                   // last-60 s buys/sells/buyers/SOL volume: ONLY for coins a phone has open (~7.5 s) or holds (~60 s), else null
  b5, s5, h, dv, pc5,               // Jupiter: 5-min buys/sells, holders, dev balance % now, 5-min % change (percent units); null if unknown/stale
  prog,                             // 0..1 bonding progress (1 = complete), null until known
  complete,                         // graduated
  ath,                              // ATH market cap USD if known
  liq,                              // USD liquidity for graduated coins (DEX Screener), else null
  flags }                           // bitmask: 1 big buy just now (flash), 2 rugged, 4 graduated, 8 dev sold
```

Unknown numbers are `null`, never 0 and never a value borrowed from another field.

## HTTP

- `GET /health` → `{ ok, uptime, coins, clients, up }`
- `GET /api/snapshot` → the `hello` object (also used as a poll fallback when the socket can't connect)
- `GET /api/coin/:mint` → `{ coin, trades: [[ts, side, sol, p, who]...], candles: [[t, o, h, l, c, v]...] }` (candles = 1 m, prices in SOL/token)
- `GET /img/:mint` → coin picture (proxied from images.pump.fun, cached, `Access-Control-Allow-Origin: *`); 404 if none

## Phone-side rules

- A paper fill needs a price younger than 5 s (`now - priceAt`), else "price moving, try again".
- Fills on the curve use `curveBuy/curveSell(p, k)`, graduated coins `poolBuy/poolSell(p, liq, sol)`.
- WASTED: a held coin falls 70%+ from its high in under 5 minutes, or the server sends `rug` for it.
- MISSION PASSED: a sell that closes at 2x or better.

## Upstream limits (measured 2026-10-12)

- pump.fun swap-api trades: ~8 calls/min per IP before a fixed 60 s block; >50 trades per call = 400. Candles have their own limit.
- Jupiter lite-api: ~36 calls/min combined (price + tokens). Set JUP_API_KEY on the host (`fly secrets set`) for headroom.
- frontend-api-v3.pump.fun (coins list, coins-v2): 403 from datacenter IPs at times (seen on Railway). The server falls back to Jupiter.
- PumpPortal ws: works from Railway and Fly with the ws package (Node 20 has no global WebSocket; engines pins 24.x).
