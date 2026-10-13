// node scripts/wasted-test.mjs — today's biggest WASTED only headlines real rugs: fake market caps (a bonded coin
// printing millions on a thin pool) are dropped once pump.fun's candles show how little actually traded.
// Runs server/wasted.mjs against a temp data dir and a stubbed fetch; no network.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'burner-wasted-'));
process.env.DATA_DIR = dir;
const volumes = { fake: 363000, real: 792000, small: null, down: 'fail', thin: 600000 }; // USD traded before the rug, per mint
let calls = 0;
globalThis.fetch = async (url) => {
  calls++;
  const mint = String(url).split('/coins/')[1].split('/')[0];
  if (volumes[mint] === 'fail') return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => [{ timestamp: Date.now() - 600000, volume: String(volumes[mint] / 2) }, { timestamp: Date.now() - 300000, volume: String(volumes[mint] / 2) }] };
};
const { recordRug, topWasted } = await import('../server/wasted.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const now = Date.now();
recordRug({ mint: 'fake', sym: 'IOF', peakMc: 17398927, rugMc: 170448, drop: 0.99, reason: 'dump', at: now, born: now - 200000 });
recordRug({ mint: 'real', sym: 'DEEZNUTS', peakMc: 2737252, rugMc: 811451, drop: 0.7, reason: 'dump', at: now, born: now - 3600e3 });
recordRug({ mint: 'small', sym: 'CURVE', peakMc: 64000, rugMc: 4000, drop: 0.94, reason: 'dump', at: now, born: now - 900000 });
recordRug({ mint: 'down', sym: 'UNKNOWN', peakMc: 900000, rugMc: 9000, drop: 0.99, reason: 'dump', at: now, born: now - 900000 });
// a bigger cap wiped than DEEZNUTS ($4.9M), but only $600K ever traded: less real money at stake, so it ranks below
recordRug({ mint: 'thin', sym: 'THIN', peakMc: 5000000, rugMc: 100000, drop: 0.98, reason: 'dump', at: now, born: now - 1800000 });

const before = topWasted(5).top.map((x) => x.sym);
assert.deepEqual(before, ['CURVE'], 'before verification only the in-curve rug can headline: ' + before);
await wait(8500); // four verifications, 1.5 s apart, the failing one tried once
const after = topWasted(5).top.map((x) => x.sym);
assert.deepEqual(after, ['DEEZNUTS', 'THIN', 'CURVE'], 'after: most real money first, the fake and the unverified are out: ' + after);
const real = topWasted(5).top[0];
assert.equal(real.traded, 792000, 'the verified volume is kept');
assert.ok(!('tries' in real), 'internal retry count stays internal');
assert.equal(topWasted(5).count, 5, 'every rug still counts in the day total');
assert.ok(calls === 4, 'one candle call per big rug (got ' + calls + ')');
console.log('wasted ok: fake market cap dropped, real rug leads, unverified waits (' + calls + ' candle calls)');
await wait(2500); // let the debounced save finish before removing the dir
rmSync(dir, { recursive: true, force: true });
process.exit(0);
