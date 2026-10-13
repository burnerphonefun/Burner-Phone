// node scripts/wallet-real-test.mjs [--offline] [--no-electron]   (CI runs both flags: no network, no app window)
// Real-wallet checks that need no funds. Every attack from the security review has a case here:
//   state-level (crafted pre/post account states), instruction-level (crafted transactions through the allowlist),
//   signers, mint extensions, live mainnet simulations against a funded public address (never signed or sent),
//   key import/export/sign round trips, the Electron storage + bridge self-test, and static checks of the shipped files.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const APP = resolve(import.meta.dirname, '..');
const DESK = join(APP, 'desktop');
const S = require(join(DESK, 'solana.cjs'));
const T = require(join(DESK, 'trader.cjs'));
const W3 = require(join(DESK, 'node_modules/@solana/web3.js'));
const { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, VersionedTransaction, TransactionMessage, MessageV0, ComputeBudgetProgram, StakeProgram, StakeAuthorizationLayout } = W3;
const bs58 = require(join(DESK, 'node_modules/bs58'));
const offline = process.argv.includes('--offline');
const noElectron = process.argv.includes('--no-electron');

let pass = 0, failN = 0;
const ok = (name, cond, info = '') => { if (cond) pass++; else failN++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '  · ' + String(info).slice(0, 170) : '')); };
const section = (s) => console.log('\n' + s);

// ---------- state-level (crafted account states through checkStates) ----------
section('guard: state checks');
const WK = Keypair.generate(), W = WK.publicKey.toBase58();
const ATTACKER = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const tokData = ({ mint, owner, amount = 0n, delegate = null, delegatedAmount = 0n, closeAuth = null, state = 1, len = 165, typeByte = null }) => {
  const b = Buffer.alloc(len);
  new PublicKey(mint).toBuffer().copy(b, 0);
  new PublicKey(owner).toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64);
  if (delegate) { b.writeUInt32LE(1, 72); new PublicKey(delegate).toBuffer().copy(b, 76); }
  b[108] = state;
  b.writeBigUInt64LE(BigInt(delegatedAmount), 121);
  if (closeAuth) { b.writeUInt32LE(1, 129); new PublicKey(closeAuth).toBuffer().copy(b, 133); }
  if (typeByte != null) b[165] = typeByte;
  return b;
};
const acc = (owner, lamports, data = Buffer.alloc(0), executable = false) => ({ owner, lamports, executable, data: [data.toString('base64'), 'base64'] });
const sysAcc = (l) => acc(S.SYSTEM, l);
const tok = (l, o, program = S.TOKEN) => acc(program, l, tokData(o));
const RENT = 2039280;
const ATA_MINT = S.ataOf(W, MINT), ATA_OTHER = S.ataOf(W, OTHER), WSOL = S.ataOf(W, S.SOL_MINT);
const buyOpts = (sol, extra = {}) => ({ wallet: W, mint: MINT, side: 'buy', route: 'jupiter', maxOutLamports: sol * 1e9 * 1.15 + S.FEE_BUFFER, minTokensRaw: 900n, sysCap: BigInt(S.TIP_CAP + sol * 1e9 * 160 / 10000), ...extra });
const C = (keys, pre, post, opts) => S.checkStates({ keys, pre, post, ...opts });

let r = C([W, ATA_MINT], [sysAcc(2e9), null], [sysAcc(2e9 - 0.5e9 - RENT - 5000), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], buyOpts(0.5));
ok('normal buy (new token account, enough tokens) passes', r.ok, r.err);
// C1: the reviewer's PoC. A 355-byte Token-2022 "account" (a multisig) whose signer list puts the wallet at bytes 32..64,
// pre-funded by the attacker, while the wallet's SOL goes to the attacker. The old guard credited M's lamports back.
const M = Keypair.generate().publicKey.toBase58();
const msig = (withWallet) => { const b = Buffer.alloc(355); b[0] = 1; b[1] = 1; b[2] = 1; if (withWallet) new PublicKey(W).toBuffer().copy(b, 32); new PublicKey(ATTACKER).toBuffer().copy(b, 32 * 5 + 3); return b; };
r = C([W, ATTACKER, M], [sysAcc(2e9), sysAcc(0), acc(S.TOKEN22, 1.99e9, Buffer.alloc(355))], [sysAcc(0.01e9 - 5000), sysAcc(1.99e9), acc(S.TOKEN22, 1.99e9, msig(true))], buyOpts(0.01, { minTokensRaw: 1n }));
ok('C1 forged multisig "token account" credit is refused', !r.ok, r.err);
// the same with a 165-byte Token-2022 account whose state byte is 0 (uninitialized) and a 166-byte one typed as a mint
r = C([W, M], [sysAcc(2e9), null], [sysAcc(0.01e9), acc(S.TOKEN22, 1.99e9, tokData({ mint: S.SOL_MINT, owner: W, amount: 1990000000n, state: 0 }))], buyOpts(0.01, { minTokensRaw: 1n }));
ok('C1 uninitialized (state 0) look-alike is not a token account', !r.ok && /more than/.test(r.err), r.err);
r = C([W, M], [sysAcc(2e9), null], [sysAcc(0.01e9), acc(S.TOKEN22, 1.99e9, tokData({ mint: S.SOL_MINT, owner: W, amount: 1990000000n, len: 200, typeByte: 1 }))], buyOpts(0.01, { minTokensRaw: 1n }));
ok('C1 Token-2022 account typed as a mint (byte 165 = 1) is not a token account', !r.ok, r.err);
// even a real token account of yours that appears with a fortune in it is never credited beyond rent
r = C([W, WSOL], [sysAcc(2e9), null], [sysAcc(0.01e9), tok(1.99e9, { mint: S.SOL_MINT, owner: W, amount: 1987960720n })], buyOpts(0.01, { minTokensRaw: 0n }));
ok('a new account of yours holding lots of SOL is not credited (only rent)', !r.ok && /more than/.test(r.err), r.err);
r = C([W, ATA_MINT], [sysAcc(2e9), null], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: MINT, owner: W, amount: 0n })], buyOpts(0.5));
ok('H1 buy that gives no tokens is refused', !r.ok && /no tokens/.test(r.err), r.err);
r = C([W, ATA_MINT], [sysAcc(2e9), null], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: MINT, owner: W, amount: 100n })], buyOpts(0.5));
ok('H1 buy that gives far fewer tokens than the price is refused', !r.ok && /fewer tokens/.test(r.err), r.err);
r = C([W], [sysAcc(2e9)], [sysAcc(2e9 - 0.5e9)], buyOpts(0.5));
ok('H1 a buy that is just a transfer is refused', !r.ok, r.err);
const sellOpts = (extra = {}) => ({ wallet: W, mint: MINT, side: 'sell', route: 'jupiter', maxOutLamports: S.FEE_BUFFER, sellRaw: 500n, minSolIn: BigInt(0.3e9), ...extra });
r = C([W, ATA_MINT], [sysAcc(2e9), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], [sysAcc(2e9 - 5000), tok(RENT, { mint: MINT, owner: W, amount: 500n })], sellOpts());
ok('H1 sell that gives the bag away for no SOL is refused', !r.ok && /no SOL/.test(r.err), r.err);
r = C([W, ATA_MINT], [sysAcc(2e9), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], [sysAcc(2e9 + 0.1e9), tok(RENT, { mint: MINT, owner: W, amount: 500n })], sellOpts());
ok('H1 sell for far less SOL than the price is refused', !r.ok && /far less/.test(r.err), r.err);
r = C([W, ATA_MINT], [sysAcc(2e9), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], [sysAcc(2e9 + 0.4e9), tok(RENT, { mint: MINT, owner: W, amount: 500n })], sellOpts());
ok('a normal half sell passes', r.ok, r.err);
r = C([W, ATA_MINT], [sysAcc(2e9), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], [sysAcc(2e9 + 0.4e9), tok(RENT, { mint: MINT, owner: W, amount: 0n })], sellOpts());
ok('selling more than asked is refused', !r.ok && /more tokens/.test(r.err), r.err);
r = C([W, ATA_MINT, ATTACKER], [sysAcc(2e9), null, sysAcc(1e6)], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: MINT, owner: W, amount: 1000n }), sysAcc(1e6 + 0.05e9)], buyOpts(0.5));
ok('H1 SOL to plain wallets above the route fee is refused', !r.ok && /other wallets/.test(r.err), r.err);
r = C([W, ATTACKER], [sysAcc(2e9), sysAcc(0)], [sysAcc(2e9 - 0.5e9 - 0.3e9), sysAcc(0.3e9)], buyOpts(0.5));
ok('extra SOL to a third address is refused', !r.ok, r.err);
const stakeData = () => { const b = Buffer.alloc(200); b.writeUInt32LE(2, 0); new PublicKey(W).toBuffer().copy(b, 12); new PublicKey(W).toBuffer().copy(b, 44); return b; };
const stakeAfter = () => { const b = stakeData(); new PublicKey(ATTACKER).toBuffer().copy(b, 12); return b; };
const S1 = Keypair.generate().publicKey.toBase58();
r = C([W, ATA_MINT, S1], [sysAcc(2e9), null, acc(STAKE_PROGRAM, 5e9, stakeData())], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: MINT, owner: W, amount: 1000n }), acc(STAKE_PROGRAM, 5e9, stakeAfter())], buyOpts(0.5));
ok('H2 stake authority change is refused', !r.ok && /names your wallet/.test(r.err), r.err);
const nonceData = (auth) => { const b = Buffer.alloc(80); b.writeUInt32LE(1, 0); b.writeUInt32LE(1, 4); new PublicKey(auth).toBuffer().copy(b, 8); return b; };
r = C([W, ATA_MINT, S1], [sysAcc(2e9), null, acc(S.SYSTEM, 1.5e6, nonceData(W))], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: MINT, owner: W, amount: 1000n }), acc(S.SYSTEM, 1.5e6, nonceData(ATTACKER))], buyOpts(0.5));
ok('H2 nonce authority change is refused', !r.ok && /names your wallet/.test(r.err), r.err);
const mintData = (auth) => { const b = Buffer.alloc(82); b.writeUInt32LE(1, 0); new PublicKey(auth).toBuffer().copy(b, 4); b[44] = 6; b[45] = 1; return b; };
r = C([W, ATA_MINT, OTHER], [sysAcc(2e9), null, acc(S.TOKEN, 1.5e6, mintData(W))], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: MINT, owner: W, amount: 1000n }), acc(S.TOKEN, 1.5e6, mintData(ATTACKER))], buyOpts(0.5));
ok('H2 mint authority change on your own token is refused', !r.ok && /names your wallet/.test(r.err), r.err);
const volData = (n) => { const b = Buffer.alloc(64); new PublicKey(W).toBuffer().copy(b, 8); b.writeUInt32LE(n, 40); return b; };
r = C([W, ATA_MINT, S1], [sysAcc(2e9), null, acc(S.PUMP, 1e6, volData(1))], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: MINT, owner: W, amount: 1000n }), acc(S.PUMP, 1e6, volData(2))], buyOpts(0.5));
ok("pump.fun's per-user volume account changing is allowed", r.ok, r.err);
r = C([W, ATA_OTHER], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n })], [sysAcc(2e9 - 0.5e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n, delegate: ATTACKER, delegatedAmount: 500n })], buyOpts(0.5, { minTokensRaw: 0n }));
ok('delegate approval on another token is refused', !r.ok && /spend your tokens/.test(r.err), r.err);
r = C([W, ATA_OTHER], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n, delegate: ATTACKER, delegatedAmount: 1n })], [sysAcc(2e9 - 0.5e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n, delegate: ATTACKER, delegatedAmount: 500n })], buyOpts(0.5, { minTokensRaw: 0n }));
ok('L1 raising an existing delegate\'s allowance is refused', !r.ok && /spend your tokens/.test(r.err), r.err);
r = C([W, ATA_OTHER], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n })], [sysAcc(2e9 - 0.5e9), tok(RENT, { mint: OTHER, owner: W, amount: 100n })], buyOpts(0.5, { minTokensRaw: 0n }));
ok("moving a token you didn't pick is refused", !r.ok && /didn't pick/.test(r.err), r.err);
const A2 = Keypair.generate().publicKey.toBase58();
r = C([W, ATA_OTHER, A2, ATA_MINT], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n }), tok(RENT, { mint: OTHER, owner: W, amount: 0n }), null], [sysAcc(2e9 - 0.5e9 - RENT), tok(RENT, { mint: OTHER, owner: W, amount: 200n }), tok(RENT, { mint: OTHER, owner: W, amount: 300n }), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], buyOpts(0.5));
ok('L1 tokens moving between two of your own accounts (same mint) passes', r.ok, r.err);
r = C([W], [sysAcc(2e9)], [acc(ATTACKER, 2e9 - 0.5e9)], buyOpts(0.5));
ok('handing the wallet account to another program is refused', !r.ok && /another program/.test(r.err), r.err);
r = C([W, ATA_OTHER], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n })], [sysAcc(2e9 - 0.5e9), tok(RENT, { mint: OTHER, owner: ATTACKER, amount: 500n })], buyOpts(0.5, { minTokensRaw: 0n }));
ok('giving away a token account is refused', !r.ok && /give away/.test(r.err), r.err);
r = C([W, ATA_OTHER], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n })], [sysAcc(2e9 - 0.5e9 + RENT), null], buyOpts(0.5, { minTokensRaw: 0n }));
ok('closing a token account that holds tokens is refused', !r.ok && /still holds/.test(r.err), r.err);
r = C([W, ATA_OTHER], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 500n })], [sysAcc(2e9 - 0.5e9 + RENT), sysAcc(0)], buyOpts(0.5, { minTokensRaw: 0n }));
ok('...also when the simulation shows it as an empty System account', !r.ok && /still holds/.test(r.err), r.err);
r = C([W, WSOL, ATA_MINT], [sysAcc(2e9), tok(RENT, { mint: S.SOL_MINT, owner: W, amount: 0n }), null], [sysAcc(2e9 - 0.5e9 - 5000), sysAcc(0), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], buyOpts(0.5));
ok('your wSOL account closed back into the wallet (shown as an empty System account) passes', r.ok, r.err);
r = C([W, ATA_OTHER], [sysAcc(2e9), tok(RENT, { mint: OTHER, owner: W, amount: 0n })], [sysAcc(2e9 - 0.5e9), tok(RENT, { mint: OTHER, owner: W, amount: 0n, closeAuth: ATTACKER })], buyOpts(0.5, { minTokensRaw: 0n }));
ok('changing who can close your account is refused', !r.ok && /close your token account/.test(r.err), r.err);
r = C([W, WSOL, ATA_MINT], [sysAcc(2e9), null, null], [sysAcc(2e9 - 0.5e9 - 5000 - RENT), null, tok(RENT, { mint: MINT, owner: W, amount: 1000n })], buyOpts(0.5));
ok('wrapped-SOL route (wSOL account opened and closed inside) passes', r.ok, r.err);
r = C([W, WSOL], [sysAcc(2e9), tok(RENT + 0.6e9, { mint: S.SOL_MINT, owner: W, amount: 600000000n })], [sysAcc(2e9), null], buyOpts(0.1, { minTokensRaw: 0n }));
ok('an existing wSOL account drained elsewhere counts as SOL out', !r.ok && r.outLamports >= 0.6e9, r.err);
r = C([W, WSOL, ATA_MINT], [sysAcc(2e9), tok(RENT, { mint: S.SOL_MINT, owner: W, amount: 0n }), tok(RENT, { mint: MINT, owner: W, amount: 1000n })], [sysAcc(2e9 - 5000), tok(RENT + 0.4e9, { mint: S.SOL_MINT, owner: W, amount: 400000000n }), tok(RENT, { mint: MINT, owner: W, amount: 500n })], sellOpts());
ok('a sell paid into your own wSOL account counts as SOL in', r.ok, r.err);
const W2 = Keypair.generate().publicKey.toBase58();
r = C([W, W2], [sysAcc(2e9), null], [sysAcc(1.9e9 - 5000), sysAcc(0.1e9)], { wallet: W, mint: null, side: 'withdraw', route: 'withdraw', maxOutLamports: 0.1e9 + S.FEE_BUFFER, transfer: { to: W2, lamports: 0.1e9 } });
ok('a declared withdraw passes', r.ok, r.err);
r = C([W, W2], [sysAcc(2e9), null], [sysAcc(1.9e9 - 5000), sysAcc(0.1e9)], { wallet: W, mint: null, side: 'withdraw', route: 'withdraw', maxOutLamports: 0.1e9 + S.FEE_BUFFER, transfer: { to: ATTACKER, lamports: 0.1e9 } });
ok('a withdraw to an address that wasn\'t confirmed is refused', !r.ok && /other wallets/.test(r.err), r.err);

// ---------- instruction-level (crafted transactions through the allowlist) ----------
section('guard: instruction allowlist');
const BH = bs58.encode(Buffer.alloc(32, 7));
const legacy = (ixs, payer = W) => { const t = new Transaction({ feePayer: new PublicKey(payer), blockhash: BH, lastValidBlockHeight: 1 }); ixs.forEach((ix) => t.add(ix)); return t; };
const keysOf = (m) => (m.staticAccountKeys || m.accountKeys).map((k) => k.toBase58());
const CI = (tx, route = 'jupiter', extra = {}) => { const m = S.messageOf(tx); return S.checkInstructions(m, { wallet: W, route, keys: keysOf(m), amountLamports: 0.5e9, feeBps: 10, ...extra }); };
const ix = (programId, data, keys = []) => new TransactionInstruction({ programId: new PublicKey(programId), data: Buffer.from(data), keys: keys.map(([k, s, w]) => ({ pubkey: new PublicKey(k), isSigner: !!s, isWritable: !!w })) });
const pk = (s) => new PublicKey(s);
const NONCE = Keypair.generate().publicKey;
const okBuy = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
  SystemProgram.transfer({ fromPubkey: pk(W), toPubkey: pk(WSOL), lamports: 0.5e9 }), ix(S.TOKEN, [17], [[WSOL, 0, 1]]),
  ix(S.ATA, [1], [[W, 1, 1], [ATA_MINT, 0, 1], [W, 0, 0], [MINT, 0, 0], [S.SYSTEM, 0, 0], [S.TOKEN, 0, 0]]),
  ix(S.JUP6, [1, 2, 3], [[W, 1, 1], [WSOL, 0, 1], [ATA_MINT, 0, 1]]), ix(S.TOKEN, [9], [[WSOL, 0, 1], [W, 0, 1], [W, 1, 0]]),
];
r = CI(legacy(okBuy()));
ok('a Jupiter-shaped buy passes the allowlist', r.ok, r.err);
r = CI(legacy(okBuy()), 'pumpportal', { feeBps: 50 });
ok('the Jupiter program is refused on the PumpPortal route', !r.ok && /unknown program/.test(r.err), r.err);
r = CI(legacy([SystemProgram.nonceAdvance({ noncePubkey: NONCE, authorizedPubkey: pk(W) }), ...okBuy()]));
ok('H3 durable nonce (AdvanceNonceAccount) is refused', !r.ok && /durable nonce/.test(r.err), r.err);
r = CI(legacy([SystemProgram.nonceAuthorize({ noncePubkey: NONCE, authorizedPubkey: pk(W), newAuthorizedPubkey: pk(ATTACKER) }), ...okBuy()]));
ok('H2 nonce authority change instruction is refused', !r.ok, r.err);
r = CI(legacy([SystemProgram.assign({ accountPubkey: pk(W), programId: pk(ATTACKER) }), ...okBuy()]));
ok('System Assign on the wallet is refused', !r.ok, r.err);
r = CI(legacy([...StakeProgram.authorize({ stakePubkey: Keypair.generate().publicKey, authorizedPubkey: pk(W), newAuthorizedPubkey: pk(ATTACKER), stakeAuthorizationType: StakeAuthorizationLayout.Staker }).instructions, ...okBuy()]));
ok('H2 stake authorize is refused (unknown program)', !r.ok && /unknown program/.test(r.err), r.err);
r = CI(legacy([ix('BPFLoaderUpgradeab1e11111111111111111111111', [4, 0, 0, 0], [[Keypair.generate().publicKey.toBase58(), 0, 1], [W, 1, 0]]), ...okBuy()]));
ok('H2 program upgrade-authority change is refused', !r.ok && /unknown program/.test(r.err), r.err);
r = CI(legacy([ix('AddressLookupTab1e1111111111111111111111111', [4, 0, 0, 0], [[Keypair.generate().publicKey.toBase58(), 0, 1], [W, 1, 0]]), ...okBuy()]));
ok('H2 lookup-table authority instruction is refused', !r.ok, r.err);
r = CI(legacy([ix(S.TOKEN, [6, 0, 1, ...pk(ATTACKER).toBuffer()], [[OTHER, 0, 1], [W, 1, 0]]), ...okBuy()]));
ok('Token SetAuthority is refused', !r.ok && /token instruction/.test(r.err), r.err);
r = CI(legacy([ix(S.TOKEN, [4, 1, 0, 0, 0, 0, 0, 0, 0], [[ATA_OTHER, 0, 1], [ATTACKER, 0, 0], [W, 1, 0]]), ...okBuy()]));
ok('Token Approve is refused', !r.ok && /token instruction/.test(r.err), r.err);
r = CI(legacy([ix(S.TOKEN22, [2, 1], [[M, 0, 1], [W, 0, 0], [ATTACKER, 0, 0]]), ...okBuy()]));
ok('C1 Token-2022 InitializeMultisig is refused', !r.ok && /token instruction/.test(r.err), r.err);
r = CI(legacy([ix(S.TOKEN22, [38], [[M, 0, 1], [ATTACKER, 0, 1], [ATTACKER, 0, 0]]), ...okBuy()]));
ok('C1 Token-2022 WithdrawExcessLamports is refused', !r.ok, r.err);
r = CI(legacy([...okBuy().slice(2), SystemProgram.transfer({ fromPubkey: pk(W), toPubkey: pk(ATTACKER), lamports: 0.05e9 })]));
ok('H1 a hidden 0.05 SOL transfer to another wallet is refused', !r.ok && /other wallets/.test(r.err), r.err);
r = CI(legacy([ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000000 }), ...okBuy().slice(2)]));
ok('H3 a priority fee above 0.002 SOL is refused', !r.ok && /priority fee/.test(r.err), r.err);
r = CI(legacy([ix(S.ATA, [1], [[W, 1, 1], [S.ataOf(ATTACKER, MINT), 0, 1], [ATTACKER, 0, 0], [MINT, 0, 0], [S.SYSTEM, 0, 0], [S.TOKEN, 0, 0]]), ...okBuy().slice(2)]));
ok('opening a token account for someone else is refused', !r.ok, r.err);
r = CI(legacy([...okBuy().slice(0, 6), ix(S.TOKEN, [9], [[WSOL, 0, 1], [ATTACKER, 0, 1], [W, 1, 0]])]));
ok('closing a token account into someone else\'s wallet is refused', !r.ok, r.err);
r = CI(legacy([ix(Keypair.generate().publicKey.toBase58(), [1], [[W, 1, 1]]), ...okBuy()]));
ok('H3 an unknown program is refused', !r.ok && /unknown program/.test(r.err), r.err);

section('guard: signers (checked before anything touches the network)');
const two = legacy([SystemProgram.transfer({ fromPubkey: pk(W), toPubkey: pk(WSOL), lamports: 1 }), SystemProgram.transfer({ fromPubkey: pk(ATTACKER), toPubkey: pk(W), lamports: 1 })]);
r = await S.guard(two, { wallet: W, mint: MINT, side: 'buy', route: 'pumpportal', maxOutLamports: 1e9, minTokensRaw: 1n });
ok('H3 PumpPortal transaction needing a second signer is refused', !r.ok && /signatures/.test(r.err), r.err);
r = await S.guard(two, { wallet: W, mint: MINT, side: 'buy', route: 'jupiter', maxOutLamports: 1e9, minTokensRaw: 1n });
ok('H3 Jupiter transaction with the extra signer after the wallet is refused', !r.ok && /signatures/.test(r.err), r.err);
r = await S.guard(legacy([SystemProgram.transfer({ fromPubkey: pk(ATTACKER), toPubkey: pk(ATTACKER), lamports: 1 })], ATTACKER), { wallet: W, mint: MINT, side: 'buy', route: 'jupiter', maxOutLamports: 1e9, minTokensRaw: 1n });
ok("a transaction that isn't for this wallet is refused", !r.ok && /signatures/.test(r.err), r.err);

// ---------- keys ----------
section('keys (H5: imported keys must stay intact)');
const kp = Keypair.generate();
const b58 = bs58.encode(kp.secretKey);
const imp = S.keypairFromSecret(b58);
ok('H5 export after base58 import is the same key', S.secretToBase58(imp) === b58);
const impJ = S.keypairFromSecret(JSON.stringify(Array.from(kp.secretKey)));
ok('H5 export after JSON-array import is the same key', S.secretToBase58(impJ) === b58);
const signed = legacy([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 })], kp.publicKey.toBase58());
signed.sign(imp);
ok('H5 an imported key produces a valid signature', signed.verifySignatures());
ok('32-byte seed', S.keypairFromSecret(bs58.encode(kp.secretKey.slice(0, 32))).publicKey.equals(kp.publicKey));
const throws = (s) => { try { S.keypairFromSecret(s); return null; } catch (e) { return e.message; } };
ok('garbage refused', !!throws('hello world'), throws('hello world'));
const bad = Uint8Array.from(kp.secretKey); bad[50] ^= 1;
ok('mismatched halves refused', /don't match/.test(throws(bs58.encode(bad)) || ''), throws(bs58.encode(bad)));
ok('wrong length refused', /bytes/.test(throws(bs58.encode(kp.secretKey.slice(0, 40))) || ''));
ok('errors never echo the key', !String(throws(bs58.encode(bad))).includes(bs58.encode(bad).slice(0, 20)));

// ---------- static checks of the shipped files ----------
section('shipped files');
const preload = readFileSync(join(DESK, 'preload.cjs'), 'utf8');
ok("H4 the page bridge doesn't expose importKey/exportKey", !/importKey:|exportKey:/.test(preload));
const walletSrc = readFileSync(join(DESK, 'wallet.cjs'), 'utf8');
ok('M1 the secure window is hidden from screen capture', walletSrc.includes('setContentProtection(true)'));
ok('M2 no copy-key button', !readFileSync(join(DESK, 'secure.html'), 'utf8').includes('id="copy"') && !walletSrc.includes("'copy'"));
const mainSrc = readFileSync(join(DESK, 'main.cjs'), 'utf8');
ok('L4 devTools only in dev', /devTools: DEV/.test(mainSrc));
ok('L4 permission handlers installed', mainSrc.includes('setPermissionRequestHandler') && mainSrc.includes('setPermissionCheckHandler'));
ok('L4 env overrides gated on dev', /DEV \? process\.env\.BURNER_API/.test(mainSrc) && /DEV && process\.env\.BURNER_WALLET_E2E/.test(mainSrc) && /DEV && process\.env\.BURNER_LOG/.test(mainSrc));
const pkg = JSON.parse(readFileSync(join(DESK, 'package.json'), 'utf8'));
ok('L4 electron fuses set', pkg.build.electronFuses?.runAsNode === false && pkg.build.electronFuses?.onlyLoadAppFromAsar === true && pkg.build.electronFuses?.enableEmbeddedAsarIntegrityValidation === true);
const built = join(DESK, 'app-dist', 'overlay.html');
if (existsSync(built)) {
  const html = readFileSync(built, 'utf8');
  ok('H4 the built overlay has a CSP (no placeholder left)', /http-equiv="Content-Security-Policy"/.test(html) && !html.includes('__BURNER_CSP__') && /connect-src https?:\/\//.test(html), (html.match(/content="(default-src[^"]+)"/) || [])[1]);
}

if (!offline) try {
  section('live (mainnet; nothing signed or sent)');
  const WHALE = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'; // a big exchange hot wallet: funded, so simulations run end to end
  const node = await S.pinNode();
  const b = await S.getBalances(WHALE);
  ok('balances of a known address (SOL + tokens incl. Token-2022)', b.sol > 1000 && b.tokens.length > 10, b.sol.toFixed(0) + ' SOL, ' + b.tokens.length + ' tokens');
  const realFetch = globalThis.fetch;
  S.setFetch((url, o) => (o?.body && String(o.body).includes('getTokenAccountsByOwner') ? Promise.reject(new Error('down')) : realFetch(url, o)));
  const b2 = await S.getBalances(WHALE);
  S.setFetch(realFetch);
  ok('token balances fall back to Jupiter when the indexed RPC is down', b2.tokens.length > 10, b2.tokens.length + ' tokens');

  const snap = await (await fetch('https://burner-production-5f82.up.railway.app/api/snapshot')).json();
  const coins = snap.lists.rising.map((m) => snap.coins.find((c) => c.mint === m)).filter(Boolean);
  const fresh = snap.coins.find((c) => c.mint === snap.lists.new[0]);
  // L3 mint checks
  let mc = await S.checkMint('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', node);
  ok('L3 a mint with a freeze authority (USDC) is refused for buys', !mc.ok && /freeze/.test(mc.err), mc.err);
  mc = await S.checkMint('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', node);
  ok('L3 a Token-2022 mint with a permanent delegate / freeze (PYUSD) is refused', !mc.ok, mc.err);
  mc = await S.checkMint(fresh.mint, node);
  ok('L3 a fresh pump coin passes the mint check', mc.ok, mc.err || 'decimals ' + mc.decimals);

  // find a Jupiter-routable coin (metis/dflow) for the positive path
  let jtx = null, jcoin = null, jord = null;
  for (const c of [...coins, fresh]) {
    const o = await S.jupOrder({ inputMint: S.SOL_MINT, outputMint: c.mint, amount: '10000000', taker: WHALE });
    if (o.transaction && S.ULTRA_ROUTERS[o.router]) { jtx = VersionedTransaction.deserialize(Buffer.from(o.transaction, 'base64')); jcoin = c; jord = o; break; }
  }
  ok('jupiter ultra order through a vetted router', !!jtx, jord ? jord.router + ' ' + jcoin.symbol : 'none found');
  if (jtx) {
    const dec = (await S.checkMint(jcoin.mint, node)).decimals ?? 6;
    const ref = await S.refQuote({ mint: jcoin.mint, side: 'buy', lamports: 10000000, decimals: dec, api: 'https://burner-production-5f82.up.railway.app', node });
    ok('an independent reference price exists', !!ref, ref ? ref.src + ' → ' + ref.tokensRaw : '');
    const minTok = BigInt(Math.floor(Math.max(Number(ref?.tokensRaw || 0n) * 0.8, Number(jord.outAmount) * 0.85)));
    let g = await S.guard(jtx, { wallet: WHALE, mint: jcoin.mint, side: 'buy', route: 'jupiter', maxOutLamports: 0.01e9 * 1.15 + S.FEE_BUFFER, minTokensRaw: minTok, amountLamports: 0.01e9, feeBps: Number(jord.feeBps) || 0, node });
    ok('guard passes the real 0.01 SOL jupiter buy (allowlist, simulation, value-in)', g.ok, g.err || (g.outLamports / 1e9).toFixed(5) + ' SOL out');
    g = await S.guard(jtx, { wallet: WHALE, mint: jcoin.mint, side: 'buy', route: 'jupiter', maxOutLamports: 0.004e9, minTokensRaw: minTok, amountLamports: 0.01e9, feeBps: 10, node });
    ok('...refused with a smaller SOL allowance', !g.ok && /more than/.test(g.err), g.err);
    g = await S.guard(jtx, { wallet: WHALE, mint: jcoin.mint, side: 'buy', route: 'jupiter', maxOutLamports: 0.02e9, minTokensRaw: BigInt(jord.outAmount) * 3n, amountLamports: 0.01e9, feeBps: 10, node });
    ok('...refused when it returns fewer tokens than the reference', !g.ok && /fewer tokens/.test(g.err), g.err);
    g = await S.guard(jtx, { wallet: WHALE, mint: jcoin.mint, side: 'buy', route: 'pumpportal', maxOutLamports: 0.02e9, minTokensRaw: minTok, amountLamports: 0.01e9, feeBps: 10, node });
    ok('...refused on the wrong route (program not on its allowlist)', !g.ok && /unknown program/.test(g.err), g.err);
    // stale blockhash
    const stale = VersionedTransaction.deserialize(jtx.serialize());
    stale.message.recentBlockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
    g = await S.guard(stale, { wallet: WHALE, mint: jcoin.mint, side: 'buy', route: 'jupiter', maxOutLamports: 0.02e9, minTokensRaw: minTok, amountLamports: 0.01e9, feeBps: 10, node });
    ok('H3 a transaction with a stale/foreign blockhash is refused before simulating', !g.ok && /expired/.test(g.err), g.err);
  }
  // L2 lookup table owned by someone else
  const fakeAlt = new MessageV0({ header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 }, staticAccountKeys: [pk(WHALE), pk(S.JUP6)], recentBlockhash: BH, compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0, 2], data: Uint8Array.from([1]) }], addressTableLookups: [{ accountKey: pk(S.SOL_MINT), writableIndexes: [0], readonlyIndexes: [] }] });
  let g = await S.guard(new VersionedTransaction(fakeAlt), { wallet: WHALE, mint: MINT, side: 'buy', route: 'jupiter', maxOutLamports: 1e9, minTokensRaw: 1n, node });
  ok('L2 a "lookup table" not owned by the lookup-table program is refused', !g.ok && /lookup-table program/.test(g.err), g.err);

  // PumpPortal: our blockhash + the curve as the reference
  try {
    const pp = await S.pumpPortalTx({ publicKey: WHALE, action: 'buy', mint: fresh.mint, amount: 0.01, denominatedInSol: true, slippage: 15, priorityFee: 0.0005 });
    const bh = await S.freshBlockhash(node); pp.message.recentBlockhash = bh.blockhash;
    const ref = await S.refQuote({ mint: fresh.mint, side: 'buy', lamports: 0.01e9, decimals: 6, api: 'https://burner-production-5f82.up.railway.app', node });
    g = await S.guard(pp, { wallet: WHALE, mint: fresh.mint, side: 'buy', route: 'pumpportal', maxOutLamports: 0.01e9 * 1.15 + S.FEE_BUFFER, minTokensRaw: ref ? BigInt(Math.floor(Number(ref.tokensRaw) * 0.8)) : null, amountLamports: 0.01e9, feeBps: 50, node });
    ok('pumpportal buy (fresh blockhash, curve reference) passes', g.ok || (g.stage === 'simulate' && !/couldn't simulate|rpc|429/.test(g.err)), (ref ? 'ref ' + ref.src + '; ' : '') + (g.err || (g.outLamports / 1e9).toFixed(5) + ' SOL out'));
  } catch (e) { ok('pumpportal buy builds', false, e.message); }

  // live malicious transactions dressed up as a buy
  const lbh = await S.freshBlockhash(node);
  const live = (ixs) => { const t = new Transaction({ feePayer: pk(WHALE), blockhash: lbh.blockhash, lastValidBlockHeight: lbh.lastValidBlockHeight }); ixs.forEach((i) => t.add(i)); return t; };
  g = await S.guard(live([SystemProgram.transfer({ fromPubkey: pk(WHALE), toPubkey: pk(ATTACKER), lamports: 0.05e9 })]), { wallet: WHALE, mint: MINT, side: 'buy', route: 'jupiter', maxOutLamports: 0.0215e9, minTokensRaw: 1n, amountLamports: 0.01e9, feeBps: 10, node });
  ok('LIVE a "buy" that sends 0.05 SOL to a third address is refused', !g.ok, g.err);
  g = await S.guard(live([SystemProgram.nonceAdvance({ noncePubkey: NONCE, authorizedPubkey: pk(WHALE) })]), { wallet: WHALE, mint: MINT, side: 'buy', route: 'jupiter', maxOutLamports: 1e9, minTokensRaw: 1n, node });
  ok('LIVE a durable-nonce transaction is refused', !g.ok && /durable nonce/.test(g.err), g.err);
  const tokAcc = (await S.rpc('getTokenAccountsByOwner', [WHALE, { programId: S.TOKEN }, { encoding: 'jsonParsed' }])).value.find((a) => Number(a.account.data.parsed.info.tokenAmount.amount) > 0 && !a.account.data.parsed.info.delegate);
  if (tokAcc) {
    g = await S.guard(live([ix(S.TOKEN, [4, 0xe8, 3, 0, 0, 0, 0, 0, 0], [[tokAcc.pubkey, 0, 1], [ATTACKER, 0, 0], [WHALE, 1, 0]])]), { wallet: WHALE, mint: MINT, side: 'buy', route: 'jupiter', maxOutLamports: 0.02e9, minTokensRaw: 1n, node });
    ok('LIVE a hidden delegate approval is refused', !g.ok, g.err);
  }

  // M4 withdraw recipients
  const rc = async (to) => S.checkRecipient(to, node);
  let x = await rc(tokAcc ? tokAcc.pubkey : ATA_MINT);
  ok('M4 withdraw to a token account is refused', !x.ok, x.err);
  x = await rc(S.curvePda(fresh.mint));
  ok('M4 withdraw to a program-derived address is refused', !x.ok, x.err);
  x = await rc(S.JUP6);
  ok('M4 withdraw to a program is refused', !x.ok, x.err);
  x = await rc('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  ok('M4 withdraw to a mint is refused', !x.ok, x.err);
  x = await rc(Keypair.generate().publicKey.toBase58());
  ok('M4 withdraw to a normal (new) wallet is allowed', x.ok, x.err);
  const wd = await S.buildWithdraw({ from: WHALE, to: ATTACKER, lamports: 0.05e9, node });
  g = await S.guard(wd.tx, { wallet: WHALE, mint: null, side: 'withdraw', route: 'withdraw', maxOutLamports: 0.05e9 + S.FEE_BUFFER, transfer: { to: ATTACKER, lamports: 0.05e9 }, node });
  ok('a declared withdraw passes the guard live', g.ok, g.err);
  g = await S.guard(wd.tx, { wallet: WHALE, mint: null, side: 'withdraw', route: 'withdraw', maxOutLamports: 0.05e9 + S.FEE_BUFFER, transfer: { to: W2, lamports: 0.05e9 }, node });
  ok('...and is refused if the recipient differs from the confirmed one', !g.ok, g.err);

  // the whole trade() path with an empty wallet stops before quoting (sign is never called)
  const empty = Keypair.generate();
  let signedCalled = false;
  const tr = await T.trade({ wallet: empty.publicKey.toBase58(), sign: async () => { signedCalled = true; }, side: 'buy', mint: fresh.mint, sol: 0.01, api: 'https://burner-production-5f82.up.railway.app' });
  ok('empty wallet: trade() stops before quoting', !tr.ok && tr.stage === 'quote' && /not enough SOL|refused/.test(tr.err) && !signedCalled, tr.err);
  const tr2 = await T.trade({ wallet: empty.publicKey.toBase58(), sign: async () => { signedCalled = true; }, side: 'sell', mint: fresh.mint, pct: 1 });
  ok('empty wallet: sell says you hold none', !tr2.ok && /hold none/.test(tr2.err) && !signedCalled, tr2.err);
} catch (e) { ok('live section finished (public RPC limits?)', false, e.message); }

// ---------- Electron storage + bridge self-test ----------
if (!noElectron) {
section('electron storage + bridge (safeStorage, temp profile)');
const electron = join(DESK, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const run = spawnSync(electron, ['.'], { cwd: DESK, env: { ...process.env, BURNER_WALLET_SELFTEST: '1' }, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000 });
const lines = (run.stdout || '').split('\n').filter((l) => l.startsWith('[wallet-selftest] {'));
for (const l of lines) { const j = JSON.parse(l.slice(18)); ok(j.name, j.ok, j.err || (j.bytes ? j.bytes + ' bytes on disk' : '')); }
ok('electron self-test ran', lines.length >= 20, (run.stderr || '').slice(0, 160));
}

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
