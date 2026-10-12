// Audit the server's numbers against pump.fun and Jupiter at the same moment.
// usage: node scripts/server-audit.mjs [base=http://localhost:8787]
import { progressFromPrice } from '../shared/curve.js';

const BASE = process.argv[2] || 'http://localhost:8787';
const H = { 'user-agent': 'Mozilla/5.0', accept: 'application/json', origin: 'https://pump.fun', referer: 'https://pump.fun/' };
const SOL = 'So11111111111111111111111111111111111111112';
const usd = (n) => (n == null || !Number.isFinite(n) ? '-' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n));

const snap = await (await fetch(BASE + '/api/snapshot')).json();
const pick = [...new Set([...snap.lists.bonding.slice(0, 4), ...snap.lists.rising.slice(0, 3), ...snap.lists.new.slice(0, 3)])];
const ours = new Map(snap.coins.map((c) => [c.mint, c]));
const [jup, ...pumps] = await Promise.all([
  fetch('https://lite-api.jup.ag/price/v3?ids=' + [SOL, ...pick].join(',')).then((r) => r.json()).catch(() => ({})),
  ...pick.map((m) => fetch('https://frontend-api-v3.pump.fun/coins-v2/' + m, { headers: H }).then((r) => (r.ok ? r.json() : null)).catch(() => null)),
]);
const solJ = jup[SOL]?.usdPrice;
console.log(`server sol $${snap.sol?.toFixed(2)} | jupiter sol $${solJ?.toFixed(2)}`);
let worst = 0, worstProg = 0, progNull = 0;
pick.forEach((m, i) => {
  const c = ours.get(m), d = pumps[i];
  const jp = jup[m]?.usdPrice && solJ ? jup[m].usdPrice / solJ : null;
  const pumpP = d?.market_cap ? d.market_cap / 1e9 : null;
  const rT = d ? d.real_token_reserves / 1e6 : null;
  const pumpProg = d ? (d.complete ? 1 : Math.max(0, 1 - rT / 793100000)) : null;
  const dp = pumpP ? (c.p / pumpP - 1) * 100 : null;
  const dj = jp ? (c.p / jp - 1) * 100 : null;
  if (dp != null && !d.complete) worst = Math.max(worst, Math.abs(dp));
  if (d && !d.complete) { if (c.prog == null) progNull++; else worstProg = Math.max(worstProg, Math.abs(c.prog - pumpProg)); }
  console.log(`${String(c.symbol).padEnd(12)} ours ${usd(c.mc).padEnd(7)} prog ${String(c.prog).padEnd(5)} | pump.fun ${usd(pumpP * 1e9 * snap.sol).padEnd(7)} prog ${pumpProg?.toFixed(3)} Δ ${dp?.toFixed(1)}% | jupiter Δ ${dj?.toFixed(1)}% | holders ${c.h} 5m ${c.b5}/${c.s5} pc5 ${c.pc5} dev ${c.dv} ${d?.complete ? '(bonded)' : ''}`);
});
console.log(`worst curve-coin price gap vs pump.fun: ${worst.toFixed(1)}% | worst progress gap ${worstProg.toFixed(3)} (unknown/null: ${progNull})`);
console.log(`curve end check: progressFromPrice(4.1088e-7) = ${progressFromPrice(4.1088e-7)}`);
