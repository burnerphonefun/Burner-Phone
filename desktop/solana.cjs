// Solana plumbing for the real wallet: RPC (one node pinned per trade), key parsing, Jupiter Ultra / PumpPortal routes,
// and the guard every transaction passes before it is signed. No Electron here, so it runs under plain Node in tests.
//
// The guard, in order (fail closed at every step):
//   1. signers: exactly the wallet (Jupiter may add its own fee payer at index 0)
//   2. top-level instructions on an allowlist per route, with caps (no durable nonce, no authority changes, capped tips/priority fee)
//   3. lookup tables owned by the ALT program; the blockhash still valid on the pinned node
//   4. simulate the exact bytes (no blockhash replacement) on the pinned node and read its own pre/post balances
//   5. state checks: SOL out within budget (only the wallet's own losses count; increases are never credited except the wallet's
//      canonical wSOL account), value in (tokens received / SOL received vs an independent price), strict token-account layouts,
//      no other token leaves, no owner/delegate/close-authority changes, nothing else that names the wallet changes
'use strict';
const { Keypair, PublicKey, VersionedTransaction, Transaction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const CB = 'ComputeBudget111111111111111111111111111111';
const ALT_PROGRAM = 'AddressLookupTab1e1111111111111111111111111';
const MEMOS = ['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'];
// exchange programs, collected from live Ultra and PumpPortal transactions (2026-10-12): they run with the wallet's signature
// at the top level, so they are trusted code; every other top-level program is refused.
const JUP6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';      // Jupiter v6 (Ultra router "metis")
const DFLOW = 'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH';    // DFlow (Ultra router "dflow")
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';      // pump.fun bonding curve
const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';  // PumpSwap (graduated pump coins)
const PUMPPORTAL = 'FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe'; // PumpPortal's trade program (CPIs into pump.fun)
const ROUTE_PROGRAMS = { jupiter: [JUP6, DFLOW], pumpportal: [PUMPPORTAL, PUMP, PUMP_AMM], withdraw: [] };
const ULTRA_ROUTERS = { metis: JUP6, dflow: DFLOW };
const EXCHANGES = new Set([JUP6, DFLOW, PUMP, PUMP_AMM, PUMPPORTAL]);
// programs reached by CPI from the routers above whose own accounts may record the wallet (per-user volume / position
// accounts). Only used to excuse a change to such an account; they can never run at the top level.
const TRUSTED_OWNERS = new Set([...EXCHANGES,
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj', // Raydium LaunchLab
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG', // Meteora DAMM v2
  'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN', // Meteora DBC
]);

const LAMPORTS = 1e9;
const FEE_BUFFER = 0.01 * LAMPORTS;     // network + priority fees
const MAX_PRIORITY = 0.002 * LAMPORTS;   // compute-unit price × limit cap
const TIP_CAP = 0.002 * LAMPORTS;        // SOL a trade may send to plain wallets on top of the route's declared fee
const ATA_RENT = 2039280;                // a 165-byte token account
const ATA_RENT_MAX = 2500000;            // Token-2022 accounts with extensions cost a little more
const VALUE_MARGIN = 0.05;               // value-in tolerance on top of slippage (price moves between reference and fill)

// mainnet-beta answers everything (incl. token accounts); publicnode answers everything but indexed calls
const RPCS = [
  { url: 'https://api.mainnet-beta.solana.com', indexed: true },
  { url: 'https://solana-rpc.publicnode.com', indexed: false },
];
const INDEXED = new Set(['getTokenAccountsByOwner', 'getProgramAccounts', 'getTokenLargestAccounts']);
const JUP = 'https://lite-api.jup.ag/ultra/v1';
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

let fetchImpl = (...a) => fetch(...a);
function setFetch(f) { fetchImpl = f; } // tests stub the network

const isMint = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
function isAddress(s) { if (!isMint(s)) return false; try { new PublicKey(s); return true; } catch { return false; } }

// ---------- RPC ----------
let rpcHealth = { ok: null, at: 0, url: null };
async function rpcAt(node, method, params, timeout = 10000) {
  let res;
  // a rate limit on the pinned node: wait and ask the same node again (switching nodes mid-guard would mix two views)
  for (let attempt = 0; ; attempt++) {
    res = await fetchImpl(node.url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status !== 429 || attempt >= 2) break;
    await sleep(600 * (attempt + 1) ** 2);
  }
  if (res.status === 429 || res.status >= 500) { const e = new Error(node.url + ' ' + res.status); e.retry = true; throw e; }
  const j = await res.json();
  if (j.error) { const e = new Error(String(j.error.message || 'rpc error').slice(0, 200)); e.rpc = j.error; e.retry = !(j.error.code === -32602 || j.error.code === -32002 || j.error.code === -32003); throw e; }
  return j.result;
}
// any healthy node (balances, polling). A real error from a healthy node isn't retried elsewhere.
async function rpc(method, params, { timeout = 10000 } = {}) {
  const tried = [];
  for (const node of RPCS) {
    if (INDEXED.has(method) && !node.indexed) continue;
    try { const r = await rpcAt(node, method, params, timeout); rpcHealth = { ok: true, at: Date.now(), url: node.url }; return r; }
    catch (e) { if (!e.retry) { rpcHealth = { ok: true, at: Date.now(), url: node.url }; throw e; } tried.push(node.url + ' ' + (e.name === 'TimeoutError' ? 'timeout' : e.message.split(' ').pop())); }
  }
  rpcHealth = { ok: false, at: Date.now(), url: null };
  const err = new Error('solana rpc unavailable'); err.detail = tried; throw err;
}
// one node for everything a single guard reads, so the pre-state, the blockhash check and the simulation agree
async function pinNode() {
  // publicnode first: it answers every call a guard makes, and it keeps mainnet-beta's tighter limits for balance lookups
  for (const node of [RPCS[1], RPCS[0]]) {
    try { await rpcAt(node, 'getSlot', [{ commitment: 'processed' }], 5000); return node; } catch {}
  }
  throw new Error('solana rpc unavailable');
}
const rpcOk = () => rpcHealth.ok !== false;

// ---------- keys ----------
// base58 secret (64 bytes, Phantom/Solflare "export private key"), a 32-byte seed, or a JSON byte array (solana-keygen)
function keypairFromSecret(input) {
  if (typeof input !== 'string') throw new Error('paste the private key as text');
  const s = input.trim();
  if (!s || s.length > 1200) throw new Error("that doesn't look like a private key");
  let bytes;
  if (s.startsWith('[')) {
    let arr;
    try { arr = JSON.parse(s); } catch { throw new Error("that byte array isn't valid JSON"); }
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error('the byte array must be numbers 0-255');
    bytes = Uint8Array.from(arr);
  } else {
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) throw new Error('a private key is base58 (letters and numbers, no 0/O/I/l) or a [..] byte array');
    try { bytes = bs58.decode(s); } catch { throw new Error("that isn't valid base58"); }
  }
  const n = bytes.length;
  let kp = null;
  try {
    // Keypair keeps a reference to the array it's given: hand it a copy, then wipe ours
    if (n === 64) kp = Keypair.fromSecretKey(Uint8Array.from(bytes)); // checks the public half matches
    else if (n === 32) kp = Keypair.fromSeed(Uint8Array.from(bytes));
  } catch { kp = null; } finally { bytes.fill(0); }
  if (!kp && n !== 64 && n !== 32) throw new Error('a Solana private key is 64 bytes (or a 32-byte seed); this one is ' + n + ' bytes');
  if (!kp) throw new Error("this key's two halves don't match: it's corrupted or not a Solana key");
  return kp;
}
const secretToBase58 = (kp) => bs58.encode(kp.secretKey);
function wipeKeypair(kp) { try { kp?._keypair?.secretKey?.fill(0); } catch {} } // best effort; JS can't promise more

// ---------- balances ----------
async function getBalances(owner) {
  const lamports = (await rpc('getBalance', [owner, { commitment: 'confirmed' }])).value;
  let tokens = null;
  try {
    const both = await Promise.all([TOKEN, TOKEN22].map((programId) => rpc('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }])));
    const byMint = new Map();
    for (const res of both) for (const a of res.value) {
      const info = a.account?.data?.parsed?.info;
      if (!info?.mint) continue;
      const amt = info.tokenAmount;
      const prev = byMint.get(info.mint);
      const raw = BigInt(amt.amount) + (prev ? BigInt(prev.raw) : 0n);
      byMint.set(info.mint, { mint: info.mint, raw: raw.toString(), decimals: amt.decimals, amount: Number(raw) / 10 ** amt.decimals });
    }
    tokens = [...byMint.values()];
  } catch {
    // indexed RPC down: Jupiter's balances endpoint knows every token too
    try {
      const j = await (await fetchImpl(JUP + '/balances/' + owner, { signal: AbortSignal.timeout(8000) })).json();
      tokens = Object.entries(j).filter(([k, v]) => k !== 'SOL' && isMint(k) && v && v.amount != null).map(([mint, v]) => ({ mint, raw: String(v.amount), decimals: v.decimals ?? null, amount: Number(v.uiAmount) }));
    } catch { tokens = []; }
  }
  tokens = tokens.filter((t) => t.mint !== SOL_MINT && BigInt(t.raw) > 0n);
  return { sol: lamports / LAMPORTS, lamports, tokens };
}
async function tokenRaw(owner, mint) {
  const b = await getBalances(owner);
  const t = b.tokens.find((x) => x.mint === mint);
  return t ? { raw: BigInt(t.raw), decimals: t.decimals } : { raw: 0n, decimals: null };
}

// ---------- routes ----------
async function jupOrder({ inputMint, outputMint, amount, taker, excludeRouters }) {
  let u = `${JUP}/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&taker=${taker}`;
  if (excludeRouters?.length) u += '&excludeRouters=' + excludeRouters.join(',');
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(12000) });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, ...j };
}
async function jupExecute(signedTransaction, requestId) {
  const res = await fetchImpl(JUP + '/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedTransaction, requestId }), signal: AbortSignal.timeout(60000) });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { httpStatus: res.status, ...j };
}
// "no route yet" is the only Jupiter answer worth falling back on (insufficient funds etc. are real answers)
function jupNoRoute(o) {
  if (o.transaction) return false;
  const m = String(o.errorMessage || o.error || '').toLowerCase();
  if (o.errorCode === 1 || m.includes('insufficient')) return false;
  return o.status >= 400 || m.includes('route') || m.includes('not tradable') || m.includes('no liquidity') || !o.outAmount;
}
async function pumpPortalTx({ publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee }) {
  const res = await fetchImpl(PUMPPORTAL_API, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey, action, mint, amount, denominatedInSol: denominatedInSol ? 'true' : 'false', slippage, priorityFee, pool: 'auto' }),
    signal: AbortSignal.timeout(12000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status !== 200 || buf.length < 100) throw new Error('pumpportal: ' + (buf.toString('utf8').slice(0, 120).replace(/[^ -~]/g, '') || res.status));
  return VersionedTransaction.deserialize(buf);
}

// ---------- reference price (independent of the route) ----------
// SOL per whole token. Pump curve maths from the chain first (exact, and nobody's API), then our own server, then DEX Screener.
function curvePda(mint) { return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], new PublicKey(PUMP))[0].toBase58(); }
function parseCurve(buf) {
  if (!buf || buf.length < 49) return null;
  const vTok = buf.readBigUInt64LE(8), vSol = buf.readBigUInt64LE(16), complete = buf[48] === 1;
  // a SOL-quoted curve keeps 30..~120 SOL of virtual reserves; anything else isn't one we can price this way
  if (complete || vTok <= 0n || vSol < 20n * 1000000000n || vSol > 300n * 1000000000n) return null;
  return { vTok, vSol };
}
async function refQuote({ mint, side, lamports, tokensRaw, decimals, api, node }) {
  const dec = decimals ?? 6;
  // 1. the bonding curve, if the coin is still on one
  try {
    const info = await rpcAt(node, 'getAccountInfo', [curvePda(mint), { encoding: 'base64', commitment: 'processed' }]);
    if (info.value && info.value.owner === PUMP) {
      const c = parseCurve(Buffer.from(info.value.data[0], 'base64'));
      if (c) {
        const k = c.vSol * c.vTok;
        if (side === 'buy') {
          const s = (BigInt(lamports) * 99n) / 100n; // ~1% curve fee
          return { src: 'curve', tokensRaw: c.vTok - k / (c.vSol + s) };
        }
        const solOut = c.vSol - k / (c.vTok + BigInt(tokensRaw));
        return { src: 'curve', lamports: (solOut * 99n) / 100n };
      }
    }
  } catch {}
  // 2. DEX Screener's deepest SOL pair and our own server's price, both fetched now. A thief's transaction returns ~nothing,
  // so the more lenient of the two (the higher price for a buy, the lower for a sell) still catches it without refusing
  // honest trades when one source lags a fast coin.
  const [dex, burner] = await Promise.all([
    (async () => {
      try {
        const pairs = await (await fetchImpl('https://api.dexscreener.com/tokens/v1/solana/' + mint, { signal: AbortSignal.timeout(5000) })).json();
        const sol = (Array.isArray(pairs) ? pairs : []).filter((x) => x.baseToken?.address === mint && x.quoteToken?.address === SOL_MINT && Number(x.priceNative) > 0).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        return sol ? { src: 'dexscreener', p: Number(sol.priceNative) } : null;
      } catch { return null; }
    })(),
    (async () => {
      if (!api || !/^https?:\/\//.test(api)) return null;
      try { const j = await (await fetchImpl(api.replace(/\/+$/, '') + '/api/coin/' + mint, { signal: AbortSignal.timeout(5000) })).json(); return j?.coin?.p > 0 ? { src: 'burner', p: j.coin.p } : null; } catch { return null; }
    })(),
  ]);
  const prices = [dex, burner].filter(Boolean);
  if (!prices.length) return null;
  const p = prices.reduce((a, b) => (side === 'buy' ? (b.p > a.p ? b : a) : (b.p < a.p ? b : a)));
  if (side === 'buy') return { src: p.src, tokensRaw: BigInt(Math.floor((lamports / LAMPORTS / p.p) * 10 ** dec)) };
  return { src: p.src, lamports: BigInt(Math.floor((Number(tokensRaw) / 10 ** dec) * p.p * LAMPORTS)) };
}

// ---------- mint checks (before buying) ----------
// Token-2022 extensions that let the issuer take, freeze or trap your tokens; classic freeze authority
async function checkMint(mint, node) {
  const info = await rpcAt(node, 'getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!info.value) return { err: "that coin doesn't exist on chain" };
  const owner = info.value.owner, d = Buffer.from(info.value.data[0], 'base64');
  if (owner !== TOKEN && owner !== TOKEN22) return { err: "that address isn't a token" };
  if (d.length < 82) return { err: "that token's data is malformed" };
  const decimals = d[44];
  if (d.readUInt32LE(46) === 1) return { err: "this coin's issuer can freeze your tokens (freeze authority is set)", decimals };
  if (owner === TOKEN22 && d.length > 166 && d[165] === 1) {
    for (let o = 166; o + 4 <= d.length;) {
      const type = d.readUInt16LE(o), len = d.readUInt16LE(o + 2), v = d.subarray(o + 4, o + 4 + len);
      if (type === 0 && len === 0) break;
      if (type === 12) return { err: 'this coin has a permanent delegate: the issuer can take your tokens', decimals };
      if (type === 9) return { err: 'this coin is non-transferable', decimals };
      if (type === 14 && v.length >= 64 && !v.subarray(32, 64).every((b) => b === 0)) return { err: 'this coin runs a transfer hook (custom code on every transfer)', decimals };
      if (type === 6 && v[0] === 2) return { err: 'new holders of this coin start frozen', decimals };
      if (type === 1 && v.length >= 108 && Math.max(v.readUInt16LE(88), v.readUInt16LE(106)) > 1000) return { err: 'this coin charges over 10% on every transfer', decimals };
      o += 4 + len;
    }
  }
  return { ok: true, decimals, program: owner };
}

// ---------- the guard ----------
// SPL token account, strict: Tokenkeg exactly 165 bytes; Token-2022 165 bytes or an extended account (type byte 2),
// never 355 (a multisig); state initialized or frozen. Anything else is not a token account, whatever it contains.
function parseTokenAccount(buf, program) {
  if (!buf) return null;
  if (program === TOKEN) { if (buf.length !== 165) return null; }
  else if (program === TOKEN22) { if (!(buf.length === 165 || (buf.length > 165 && buf.length !== 355 && buf[165] === 2))) return null; }
  else return null;
  const state = buf[108];
  if (state !== 1 && state !== 2) return null;
  const pk = (o) => new PublicKey(buf.subarray(o, o + 32)).toBase58();
  return {
    mint: pk(0), owner: pk(32), amount: buf.readBigUInt64LE(64),
    delegate: buf.readUInt32LE(72) ? pk(76) : null, state,
    delegatedAmount: buf.readBigUInt64LE(121),
    closeAuthority: buf.readUInt32LE(129) ? pk(133) : null,
  };
}
const accBuf = (a) => (a ? Buffer.from(a.data[0], 'base64') : null);
function ataOf(owner, mint, program = TOKEN) {
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(program).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA))[0].toBase58();
}

function messageOf(tx) { return tx instanceof VersionedTransaction ? tx.message : tx.compileMessage(); }
function staticKeys(m) { return (m.staticAccountKeys || m.accountKeys).map((k) => k.toBase58()); }

// lookup tables: owned by the ALT program, initialized; returns the resolved writable + readonly keys in order
async function resolveLookups(m, node) {
  const writable = [], readonly = [];
  const refuse = (msg) => { const e = new Error(msg); e.refusal = true; return e; }; // a verdict, not a network hiccup
  for (const l of m.addressTableLookups || []) {
    const info = await rpcAt(node, 'getAccountInfo', [l.accountKey.toBase58(), { encoding: 'base64', commitment: 'processed' }]);
    if (!info.value) throw refuse('lookup table missing');
    if (info.value.owner !== ALT_PROGRAM) throw refuse('a "lookup table" not owned by the lookup-table program');
    const data = Buffer.from(info.value.data[0], 'base64');
    if (data.length < 56 || data.readUInt32LE(0) !== 1) throw refuse('lookup table not initialized');
    const addrs = [];
    for (let o = 56; o + 32 <= data.length; o += 32) addrs.push(new PublicKey(data.subarray(o, o + 32)).toBase58());
    for (const i of l.writableIndexes) { if (!addrs[i]) throw refuse('lookup index out of range'); writable.push(addrs[i]); }
    for (const i of l.readonlyIndexes) { if (!addrs[i]) throw refuse('lookup index out of range'); readonly.push(addrs[i]); }
  }
  return { writable, readonly };
}

// Top-level instruction allowlist. Returns { err } or { rentAccounts, priorityLamports }.
function checkInstructions(m, { wallet, route, keys, amountLamports = 0, feeBps = 0, transfer = null }) {
  const allowedExchanges = new Set(ROUTE_PROGRAMS[route] || []);
  const ixs = m.compiledInstructions || m.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: ix.accounts, data: bs58.decode(ix.data) }));
  if (ixs.length > 16) return { err: 'too many instructions to check' };
  const wsolAtas = new Set([ataOf(wallet, SOL_MINT, TOKEN), ataOf(wallet, SOL_MINT, TOKEN22)]);
  let cuLimit = null, cuPrice = 0n, nonCb = 0, sysOut = 0n;
  const tipCap = BigInt(Math.floor(TIP_CAP + (amountLamports * (feeBps + 150)) / 10000)); // declared route fee + pump's ~1% + creator fee + tips
  for (const ix of ixs) {
    const pid = keys[ix.programIdIndex];
    const d = Buffer.from(ix.data);
    const acct = (i) => keys[ix.accountKeyIndexes[i]];
    if (pid === CB) {
      if (d[0] === 2 && d.length >= 5) cuLimit = d.readUInt32LE(1);
      else if (d[0] === 3 && d.length >= 9) cuPrice = d.readBigUInt64LE(1);
      else if (d[0] !== 1 && d[0] !== 4) return { err: 'unknown compute-budget instruction' };
      continue;
    }
    nonCb++;
    if (pid === SYSTEM) {
      const kind = d.length >= 4 ? d.readUInt32LE(0) : -1;
      if (kind === 2 && d.length >= 12) { // Transfer
        if (acct(0) !== wallet) return { err: 'a transfer from an account that isn\'t yours' };
        const lam = d.readBigUInt64LE(4);
        // wrapping SOL into your own wSOL account is fine; a withdraw's one declared transfer is fine; anything else is capped
        if (transfer && route === 'withdraw' && acct(1) === transfer.to && lam <= BigInt(transfer.lamports)) continue;
        if (!wsolAtas.has(acct(1))) sysOut += lam;
        continue;
      }
      if (kind === 0 && d.length >= 52) { // CreateAccount: only token accounts, rent-sized
        const lam = d.readBigUInt64LE(4), space = d.readBigUInt64LE(12), owner = new PublicKey(d.subarray(20, 52)).toBase58();
        if (acct(0) !== wallet || (owner !== TOKEN && owner !== TOKEN22) || space > 400n || lam > BigInt(ATA_RENT_MAX)) return { err: 'it creates an account that isn\'t a token account' };
        continue;
      }
      if (kind === 4) return { err: 'it uses a durable nonce (it could be held and sent later)' };
      return { err: 'a system instruction that isn\'t a plain transfer (' + kind + ')' };
    }
    if (pid === TOKEN || pid === TOKEN22) {
      const t = d[0];
      if (t === 17) continue; // SyncNative
      if (t === 9) { if (acct(1) !== wallet) return { err: 'it closes a token account into someone else\'s wallet' }; continue; } // CloseAccount → wallet
      if (t === 18 && d.length >= 33) { if (new PublicKey(d.subarray(1, 33)).toBase58() !== wallet) return { err: 'it opens a token account for someone else' }; continue; } // InitializeAccount3
      return { err: 'a token instruction that isn\'t allowed (' + t + ')' }; // Approve, SetAuthority, Transfer, multisig init, mint/burn...
    }
    if (pid === ATA) {
      if (d.length > 1 || (d.length === 1 && d[0] > 1)) return { err: 'an associated-token instruction that isn\'t allowed' };
      if (acct(0) !== wallet) return { err: 'someone else pays for a token account here' };
      if (acct(2) !== wallet) return { err: 'it opens a token account for someone else' };
      continue;
    }
    if (MEMOS.includes(pid)) continue;
    if (allowedExchanges.has(pid)) continue;
    return { err: 'an unknown program (' + pid.slice(0, 8) + '…) would run with your signature' };
  }
  if (sysOut > tipCap) return { err: `it sends ${(Number(sysOut) / LAMPORTS).toFixed(4)} SOL to other wallets, more than the route's fee` };
  const limit = BigInt(cuLimit ?? Math.min(1400000, 200000 * Math.max(1, nonCb)));
  const priority = (cuPrice * limit) / 1000000n;
  if (priority > BigInt(MAX_PRIORITY)) return { err: `its priority fee (${(Number(priority) / LAMPORTS).toFixed(4)} SOL) is above the 0.002 SOL cap` };
  return { ok: true, priorityLamports: Number(priority), sysOut: Number(sysOut) };
}

// The whole guard. side: 'buy' | 'sell' | 'withdraw'. route: 'jupiter' | 'pumpportal' | 'withdraw'.
// maxOutLamports: SOL the wallet may lose (before new-token-account rent, which is allowed on top).
// minTokensRaw (buy) / minSolIn (sell, lamports): the value that must come back.
async function guard(tx, { wallet, mint, side, route, maxOutLamports, sellRaw = 0n, minTokensRaw = null, minSolIn = null, amountLamports = 0, feeBps = 0, transfer = null, node }) {
  if (!isAddress(wallet)) return { err: 'bad wallet', stage: 'guard' };
  const m = messageOf(tx);
  const sk = staticKeys(m);
  const nSig = m.header.numRequiredSignatures;
  const signers = sk.slice(0, nSig);
  const signersOk = route === 'jupiter'
    ? (nSig === 1 && signers[0] === wallet) || (nSig === 2 && signers[1] === wallet && signers[0] !== wallet)
    : nSig === 1 && signers[0] === wallet;
  if (!signersOk) return { err: 'refused: the transaction asks for signatures it shouldn\'t (' + nSig + ' signers)', stage: 'guard' };
  let first;
  try { first = node || (await pinNode()); } catch { return { err: "couldn't reach the solana network, so the trade wasn't sent", stage: 'simulate' }; }
  const raw = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
  // every read of one guard comes from one node; if that node fails part-way, the whole sequence starts over on the next
  let lookups = null, keys = null, pre = null, sim = null, lastErr = null;
  for (const nd of [first, ...RPCS.filter((n) => n.url !== first.url)]) {
    try {
      const lk = await resolveLookups(m, nd);
      const ins = checkInstructions(m, { wallet, route, keys: [...sk, ...lk.writable, ...lk.readonly], amountLamports, feeBps, transfer });
      if (!ins.ok) return { err: 'refused: ' + ins.err, stage: 'guard' };
      // every account the transaction may write
      const writable = [];
      sk.forEach((k, i) => { if (m.isAccountWritable(i)) writable.push(k); });
      writable.push(...lk.writable);
      const ks = [...new Set(writable)];
      if (!ks.includes(wallet)) ks.unshift(wallet);
      if (ks.length > 64) return { err: 'refused: it touches too many accounts to check', stage: 'guard' };
      const valid = await rpcAt(nd, 'isBlockhashValid', [m.recentBlockhash, { commitment: 'processed' }]);
      if (!valid?.value) return { err: 'the quote expired before it was checked, try again', stage: 'simulate' };
      const p = (await rpcAt(nd, 'getMultipleAccounts', [ks, { encoding: 'base64', commitment: 'processed' }])).value;
      const s = (await rpcAt(nd, 'simulateTransaction', [raw, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'processed', accounts: { encoding: 'base64', addresses: ks } }])).value;
      lookups = lk; keys = ks; pre = p; sim = s;
      break;
    } catch (e) {
      if (e.refusal) return { err: 'refused: ' + e.message, stage: 'guard' };
      lastErr = e;
    }
  }
  if (!lookups) return { err: "couldn't simulate the trade, so it wasn't sent (" + String(lastErr?.message || 'network').slice(0, 80) + ')', stage: 'simulate' };
  if (!sim || !Array.isArray(sim.accounts)) return { err: "the network didn't return a simulation, so the trade wasn't sent", stage: 'simulate' };
  if (sim.err) return { err: simError(sim), stage: 'simulate', logs: (sim.logs || []).slice(-6) };
  // the simulation's own pre-balances are from the same instant as its post-state; use them for lamports and token amounts
  const preLamports = new Map(), preAmounts = new Map();
  if (Array.isArray(sim.preBalances) && sim.loadedAddresses) {
    const lw = sim.loadedAddresses.writable || [], lr = sim.loadedAddresses.readonly || [];
    if (lw.join() !== lookups.writable.join() || lr.join() !== lookups.readonly.join()) return { err: 'refused: the lookup tables changed between reading and simulating', stage: 'guard' };
    const full = [...sk, ...lw, ...lr];
    full.forEach((k, i) => { if (sim.preBalances[i] != null) preLamports.set(k, BigInt(sim.preBalances[i])); });
    for (const tb of sim.preTokenBalances || []) { const k = full[tb.accountIndex]; if (k) preAmounts.set(k, BigInt(tb.uiTokenAmount.amount)); }
  }
  return checkStates({ keys, pre, post: sim.accounts, wallet, mint, side, route, maxOutLamports, sellRaw, minTokensRaw, minSolIn, preLamports, preAmounts, transfer, sysCap: BigInt(Math.floor(TIP_CAP + (amountLamports * (feeBps + 150)) / 10000)) });
}

// The pure part of the guard (unit-tested with crafted states). keys = every writable account (wallet included).
function checkStates({ keys, pre, post, wallet, mint, side, route = 'jupiter', maxOutLamports, sellRaw = 0n, minTokensRaw = null, minSolIn = null, preLamports = new Map(), preAmounts = new Map(), sysCap = BigInt(TIP_CAP), transfer = null }) {
  const problems = [];
  const walletBytes = new PublicKey(wallet).toBuffer();
  const wsolAtas = new Set([ataOf(wallet, SOL_MINT, TOKEN), ataOf(wallet, SOL_MINT, TOKEN22)]);
  let out = 0n;          // SOL the wallet loses (its own lamports + its pre-existing token accounts' lamports going down)
  let solIn = 0n;        // SOL the wallet gains (its own lamports + its canonical wSOL account going up)
  let rentAllow = 0n, newAccounts = 0;
  let sysCredit = 0n;    // SOL landing in plain wallets other than ours (fees, tips… or a thief)
  const perMint = new Map(); // mint -> { before, after } over the wallet's verified token accounts
  keys.forEach((k, i) => {
    const a0 = pre[i], b = post[i];
    const a = a0 ? { ...a0, lamports: preLamports.has(k) ? preLamports.get(k) : BigInt(a0.lamports) } : null;
    const aL = a ? BigInt(a.lamports) : 0n, bL = b ? BigInt(b.lamports) : 0n;
    const aBuf = accBuf(a), bBuf = accBuf(b);
    if (k === wallet) {
      if (bL < aL) out += aL - bL; else solIn += bL - aL;
      if (b && (b.owner !== SYSTEM || (bBuf && bBuf.length) || b.executable)) problems.push('it would hand your wallet account to another program');
      return;
    }
    const preTok = a ? parseTokenAccount(aBuf, a.owner) : null;
    const postTok = b ? parseTokenAccount(bBuf, b.owner) : null;
    const mineBefore = preTok?.owner === wallet, mineAfter = postTok?.owner === wallet;
    // an account closed inside the transaction comes back from the simulation as 0 lamports, no data (not as missing)
    const closed = !b || (bL === 0n && (!bBuf || bBuf.length === 0));
    if (mineBefore || mineAfter) {
      if (mineBefore && aL > bL) out += aL - bL; // your token account losing lamports (wSOL spent, rent sent elsewhere)
      if (mineBefore && mineAfter && bL > aL && postTok.mint === SOL_MINT && wsolAtas.has(k)) solIn += bL - aL; // your own wSOL account filling up
      if (!mineBefore && mineAfter) { newAccounts++; rentAllow += bL < BigInt(ATA_RENT_MAX) ? bL : BigInt(ATA_RENT_MAX); }
      if (mineBefore && !closed && !postTok) { problems.push('it would turn one of your token accounts into something else'); return; }
      if (mineBefore && postTok && !mineAfter) { problems.push('it would give away one of your token accounts'); return; }
      if (mineBefore && closed) {
        if ((preAmounts.has(k) ? preAmounts.get(k) : preTok.amount) > 0n && preTok.mint !== SOL_MINT) problems.push('it would close a token account that still holds tokens');
        return;
      }
      const before = mineBefore ? (preAmounts.has(k) ? preAmounts.get(k) : preTok.amount) : 0n;
      if ((postTok.delegate || null) !== (mineBefore ? preTok.delegate || null : null)) problems.push('it would let another address spend your tokens');
      if (postTok.delegatedAmount > (mineBefore ? preTok.delegatedAmount : 0n)) problems.push('it would let another address spend your tokens');
      if ((postTok.closeAuthority || null) !== (mineBefore ? preTok.closeAuthority || null : null)) problems.push('it would change who can close your token account');
      const pm = perMint.get(postTok.mint) || { before: 0n, after: 0n };
      pm.before += before; pm.after += postTok.amount;
      perMint.set(postTok.mint, pm);
      return;
    }
    // a plain wallet that isn't ours gaining SOL: only fees and tips may land there
    if (b && b.owner === SYSTEM && (!bBuf || !bBuf.length) && bL > aL) {
      let gain = bL - aL;
      if (transfer && side === 'withdraw' && k === transfer.to) gain = gain > BigInt(transfer.lamports) ? gain - BigInt(transfer.lamports) : 0n;
      sysCredit += gain;
    }
    // anything else that names your wallet (stake/nonce/mint authorities, lookup tables, …) must not change,
    // unless it belongs to the exchange program running this route (e.g. pump.fun's per-user volume account)
    if (aBuf && aBuf.length && aBuf.indexOf(walletBytes) >= 0) {
      const changed = !b || !bBuf || !aBuf.equals(bBuf) || b.owner !== a.owner;
      if (changed && !(TRUSTED_OWNERS.has(a.owner) && b && b.owner === a.owner)) problems.push('it would change an account that names your wallet (' + (a.owner || '').slice(0, 8) + '…)');
    }
  });
  if (newAccounts > 3) problems.push('it opens too many token accounts');
  // tokens: only the traded one may go down (on a sell, by no more than asked); per mint across all your accounts
  for (const [m, v] of perMint) {
    if (m === SOL_MINT) continue;
    if (m === mint) {
      if (side === 'sell' && v.before - v.after > BigInt(sellRaw) + 1n) problems.push('it would sell more tokens than you asked');
      if (side === 'buy' && v.after < v.before) problems.push('a buy that takes tokens away');
      continue;
    }
    if (v.after < v.before) problems.push("it would move a token you didn't pick (" + m.slice(0, 6) + '…)');
  }
  const net = out - solIn; // what the wallet loses overall (negative = gains)
  const allowed = BigInt(Math.floor(maxOutLamports)) + rentAllow;
  if (net > allowed) problems.push(`it would take ${(Number(net) / LAMPORTS).toFixed(4)} SOL, more than the ${(Number(allowed) / LAMPORTS).toFixed(4)} SOL you allowed`);
  if (sysCredit > sysCap) problems.push(`it would send ${(Number(sysCredit) / LAMPORTS).toFixed(4)} SOL to other wallets, more than the fees`);
  // value in
  if (side === 'buy') {
    const got = mint && perMint.has(mint) ? perMint.get(mint).after - perMint.get(mint).before : 0n;
    if (minTokensRaw == null) problems.push('no price to check the buy against');
    else if (got < BigInt(minTokensRaw)) problems.push(got <= 0n ? 'the buy would give you no tokens' : 'the buy would give you far fewer tokens than the price says');
  }
  if (side === 'sell') {
    if (minSolIn == null) problems.push('no price to check the sell against');
    else if (-net < BigInt(minSolIn)) problems.push(-net <= 0n ? 'the sell would bring back no SOL' : 'the sell would bring back far less SOL than the price says');
  }
  if (problems.length) return { err: 'refused: ' + problems[0], stage: 'guard', problems, outLamports: Number(net) };
  return { ok: true, outLamports: Number(net), newAccounts };
}

const PUMP_PROGRAMS = [PUMP, PUMP_AMM];
function simError(sim) {
  const logs = (sim.logs || []).join('\n').toLowerCase();
  const e = JSON.stringify(sim.err);
  // pump.fun curve: 6002 too much SOL required, 6003 too little SOL received (both = slippage), 6005 curve complete
  const custom = sim.err?.InstructionError?.[1]?.Custom;
  const pumpFailed = PUMP_PROGRAMS.some((p) => logs.includes(p.toLowerCase() + ' failed'));
  if (pumpFailed && (custom === 6002 || custom === 6003)) return 'price moved past your slippage, try again';
  if (pumpFailed && custom === 6005) return 'this coin just left the curve, try again in a few seconds';
  if (/insufficientfunds|insufficient lamports|insufficient funds/i.test(e + logs)) return 'not enough SOL for this trade plus fees';
  if (logs.includes('slippage') || logs.includes('toomuchsolrequired') || logs.includes('toolittlesolreceived') || logs.includes('exceeds desired slippage')) return 'price moved past your slippage, try again';
  if (logs.includes('bondingcurvecomplete') || logs.includes('curve is complete')) return 'this coin just left the curve, try again in a few seconds';
  return 'the trade would fail on chain (' + e.slice(0, 80) + ')';
}

// ---------- send + confirm (PumpPortal route and withdrawals): always with the blockhash's lastValidBlockHeight ----------
async function freshBlockhash(node) {
  const bh = (await rpcAt(node, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  return { blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight };
}
async function sendAndConfirm(rawBytes, { lastValidBlockHeight, timeoutMs = 60000, onSent, node } = {}) {
  if (!lastValidBlockHeight) throw new Error('missing lastValidBlockHeight');
  const b64 = Buffer.from(rawBytes).toString('base64');
  const send = () => (node ? rpcAt(node, 'sendTransaction', [b64, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]) : rpc('sendTransaction', [b64, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]));
  const sig = await send();
  onSent?.(sig);
  const t0 = Date.now();
  let lastSend = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1500);
    let st = null;
    try { st = (await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }])).value[0]; } catch {}
    if (st?.err) return { sig, status: 'failed', err: 'failed on chain (' + JSON.stringify(st.err).slice(0, 80) + ')' };
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { sig, status: 'confirmed' };
    try { const h = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]); if (h > lastValidBlockHeight) return { sig, status: 'failed', err: 'expired before it landed, try again' }; } catch {}
    if (Date.now() - lastSend > 2500) { lastSend = Date.now(); send().catch(() => {}); } // rebroadcast until it lands or expires
  }
  return { sig, status: 'failed', err: 'not confirmed in time (it may still land, check the explorer)' };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// what a confirmed transaction actually did to the wallet (SOL incl. fees, and the traded token)
async function txDeltas(sig, wallet, mint) {
  for (let i = 0; i < 6; i++) {
    let t = null;
    try { t = await rpc('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); } catch {}
    if (t?.meta) {
      const keys = [...t.transaction.message.accountKeys, ...(t.meta.loadedAddresses?.writable || []), ...(t.meta.loadedAddresses?.readonly || [])];
      const wi = keys.indexOf(wallet);
      const solDelta = wi >= 0 ? (t.meta.postBalances[wi] - t.meta.preBalances[wi]) / LAMPORTS : null;
      const sum = (arr) => (arr || []).filter((b) => b.owner === wallet && b.mint === mint).reduce((s, b) => s + Number(b.uiTokenAmount.uiAmountString || b.uiTokenAmount.uiAmount || 0), 0);
      return { solDelta, tokenDelta: mint ? sum(t.meta.postTokenBalances) - sum(t.meta.preTokenBalances) : 0, fee: t.meta.fee / LAMPORTS };
    }
    await sleep(1200);
  }
  return null;
}

// ---------- withdraw ----------
// only to a normal wallet: on the curve (not a PDA) and, if it exists, a plain System account (not a token account, mint or program)
async function checkRecipient(to, node) {
  if (!isAddress(to)) return { err: "that isn't a Solana address" };
  if (!PublicKey.isOnCurve(new PublicKey(to).toBuffer())) return { err: "that address can't hold SOL like a wallet (it's a program-derived address)" };
  const info = await rpcAt(node, 'getAccountInfo', [to, { encoding: 'base64', commitment: 'confirmed' }]);
  if (info.value && (info.value.owner !== SYSTEM || info.value.executable)) return { err: "that address isn't a wallet (it's a token account, a token or a program)" };
  return { ok: true, exists: !!info.value };
}
async function buildWithdraw({ from, to, lamports, node }) {
  const bh = await freshBlockhash(node);
  const tx = new Transaction({ feePayer: new PublicKey(from), blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
  tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports }));
  return { tx, lastValidBlockHeight: bh.lastValidBlockHeight };
}

module.exports = {
  SOL_MINT, SYSTEM, TOKEN, TOKEN22, ATA, CB, ALT_PROGRAM, JUP6, DFLOW, PUMP, PUMP_AMM, PUMPPORTAL, ROUTE_PROGRAMS, ULTRA_ROUTERS, EXCHANGES, TRUSTED_OWNERS,
  LAMPORTS, FEE_BUFFER, ATA_RENT, TIP_CAP, MAX_PRIORITY, VALUE_MARGIN, RPCS,
  setFetch, rpc, rpcAt, pinNode, rpcOk, isMint, isAddress, keypairFromSecret, secretToBase58, wipeKeypair,
  getBalances, tokenRaw, jupOrder, jupExecute, jupNoRoute, pumpPortalTx, refQuote, curvePda, parseCurve, checkMint,
  parseTokenAccount, ataOf, resolveLookups, checkInstructions, guard, checkStates, simError, freshBlockhash, sendAndConfirm, txDeltas,
  checkRecipient, buildWithdraw, messageOf,
  rpcHealth: () => rpcHealth,
};
