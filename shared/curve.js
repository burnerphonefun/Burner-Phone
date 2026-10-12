// pump.fun bonding curve maths, shared by the server and the phone.
// Constant product on virtual reserves. Units: SOL and whole tokens (not lamports / raw units).

export const SUPPLY = 1e9;               // every pump.fun coin: 1B tokens
export const V_SOL0 = 30;                // virtual SOL at launch
export const V_TOK0 = 1_073_000_191;     // virtual tokens at launch
export const REAL_TOK = 793_100_000;     // tokens sold off the curve before it completes
export const K0 = V_SOL0 * V_TOK0;
export const FEE = 0.01;                 // paper fee per side (pump.fun charges ~1%)

// reserves from a price (SOL per token) and the coin's own k
export function reservesFromPrice(price, k = K0) {
  if (!(price > 0)) return null;
  return { vSol: Math.sqrt(k * price), vTok: Math.sqrt(k / price) };
}

// 0..1, how far along the curve a coin is
export function progressFromPrice(price, k = K0) {
  const r = reservesFromPrice(price, k);
  if (!r) return 0;
  const offset = V_TOK0 - REAL_TOK;      // virtual tokens left when the curve completes
  const left = r.vTok - offset;
  return Math.max(0, Math.min(1, 1 - left / REAL_TOK));
}

export const mcapSol = (price) => price * SUPPLY;

// buy on the curve: SOL in -> tokens out, after the fee
export function curveBuy(solIn, price, k = K0) {
  const r = reservesFromPrice(price, k);
  if (!r || !(solIn > 0)) return null;
  const s = solIn * (1 - FEE);
  const tokens = r.vTok - k / (r.vSol + s);
  const after = (r.vSol + s) / (k / (r.vSol + s));
  return { tokens, avgPrice: solIn / tokens, priceAfter: after, impact: after / price - 1 };
}

// sell on the curve: tokens in -> SOL out, after the fee
export function curveSell(tokens, price, k = K0) {
  const r = reservesFromPrice(price, k);
  if (!r || !(tokens > 0)) return null;
  const gross = r.vSol - k / (r.vTok + tokens);
  const sol = Math.max(0, gross * (1 - FEE));
  const vTok2 = r.vTok + tokens;
  const after = (k / vTok2) / vTok2;
  return { sol, avgPrice: sol / tokens, priceAfter: after, impact: after / price - 1 };
}

// graduated coins: a constant-product pool sized from its liquidity (USD, both sides)
export function poolBuy(solIn, price, liqUsd, solUsd) {
  const poolSol = Math.max(1, (liqUsd || 0) / 2 / (solUsd || 100));
  const k = poolSol * (poolSol / price);
  const s = solIn * (1 - FEE * 0.25);
  const tokens = poolSol / price - k / (poolSol + s);
  return { tokens, avgPrice: solIn / tokens, impact: (poolSol + s) ** 2 / k / price - 1 };
}
export function poolSell(tokens, price, liqUsd, solUsd) {
  const poolSol = Math.max(1, (liqUsd || 0) / 2 / (solUsd || 100));
  const poolTok = poolSol / price;
  const k = poolSol * poolTok;
  const sol = (poolSol - k / (poolTok + tokens)) * (1 - FEE * 0.25);
  return { sol: Math.max(0, sol), avgPrice: sol / tokens };
}
