// node scripts/wallet-test.mjs — the paper numbers, checked before any styling (LESSONS)
import assert from 'node:assert/strict';
import { createWallet } from '../shared/phone/wallet.js';
import { curveBuy, curveSell, progressFromPrice, K0, V_SOL0, V_TOK0, mcapSol } from '../shared/curve.js';

const mem = () => { let v = null; return { load: () => v && JSON.parse(v), save: (s) => { v = JSON.stringify(s); } }; };
const coins = new Map();
const net = { st: { sol: 111, lastMsg: Date.now() }, coin: (m) => coins.get(m), priceFresh: (c) => c && c.p != null, mcOf: (c) => c?.p * 1e9 * 111 };

// curve sanity
const p0 = V_SOL0 / V_TOK0;
assert.ok(Math.abs(mcapSol(p0) * 111 - 3104) < 10, 'launch mcap ~$3.1K at $111');
const done = (K0 / 279_900_191) / 279_900_191;
assert.ok(Math.abs(progressFromPrice(done) - 1) < 1e-6, 'complete at the end of the curve');
assert.ok(Math.abs(mcapSol(done) * 111 - 45600) < 300, 'completes at ~$45.6K');
assert.equal(progressFromPrice(p0), 0);
const b = curveBuy(1, p0);
assert.ok(b.tokens > 34e6 && b.tokens < 34.5e6, '1 SOL at launch buys ~34.3M tokens: ' + b.tokens);
const s = curveSell(b.tokens, b.priceAfter);
assert.ok(s.sol > 0.97 && s.sol < 0.99, 'round trip loses ~2% to fees: ' + s.sol);

// wallet flow
coins.set('A', { mint: 'A', symbol: 'GRATIN', name: 'Gratin', p: p0, k: K0 });
const w = createWallet(net, mem());
assert.equal(w.state.sol, 10);
const r1 = w.buy(coins.get('A'), 1);
assert.ok(r1.ok, JSON.stringify(r1));
assert.equal(+w.state.sol.toFixed(6), 9);
// price runs 3x
coins.get('A').p = p0 * 3;
const m = w.mark(w.pos('A'));
assert.ok(m.x > 2.8 && m.x < 3.05, 'marked ~3x: ' + m.x);
const r2 = w.sell(coins.get('A'), 0.5);
assert.ok(r2.ok && r2.x > 2.6, 'half sold near 3x: ' + r2.x);
assert.ok(w.pos('A'), 'half still held');
const r3 = w.sell(coins.get('A'), 1);
assert.ok(r3.closed && !w.pos('A'), 'closed');
assert.ok(w.state.sol > 11.5, 'made money: ' + w.state.sol);
assert.equal(w.state.hist.length, 2);
// can't overspend, stale price refused
assert.ok(w.buy(coins.get('A'), 100).err);
const net2 = { ...net, priceFresh: () => false };
assert.ok(createWallet(net2, mem()).buy(coins.get('A'), 1).err.includes('price moving'));
// rug watch: buy, pump, dump 80% -> wasted once
const now = Date.now();
coins.set('R', { mint: 'R', symbol: 'RUG', p: p0 * 2, k: K0, hist: [[now - 60e3, p0 * 2], [now - 40e3, p0 * 4], [now - 30e3, p0 * 4]] });
w.buy(coins.get('R'), 1);
coins.get('R').p = p0 * 0.7;
const ev = w.watch();
assert.equal(ev.filter((e) => e.type === 'wasted').length, 1, 'wasted fires');
assert.equal(w.watch().filter((e) => e.type === 'wasted').length, 0, 'only once');
console.log('wallet + curve ok. sol after trades:', w.state.sol.toFixed(3));
