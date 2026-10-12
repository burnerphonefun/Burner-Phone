// The real wallet, main process only (D lifted the no-wallet rule for Burner on 2026-10-12; see app/shared/WALLET.md).
// The key is encrypted at rest with safeStorage (Windows DPAPI) and decrypted only for the moment it signs. The overlay page
// talks to this file through a whitelisted IPC channel and can never read the key: typing it in, revealing it, and confirming
// anything that moves or deletes money happen in a separate local window (secure.html) that loads nothing remote and is
// hidden from screen capture.
'use strict';
const { app, safeStorage, ipcMain, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const QR = require('qrcode');
const { Keypair, VersionedTransaction } = require('@solana/web3.js');
const S = require('./solana.cjs');
const T = require('./trader.cjs');

const BIG_BUY = 1;            // SOL: buys above this ask for a confirmation in the secure window
let address = null;           // the public key only; the secret is read from disk per signature
let lastBal = null, balAt = 0, pollTimer = null;
let getWin = () => null, onStatus = () => {}, getApi = () => null, chain = Promise.resolve(), queued = 0;
let confirmHook = null;       // self-test only (set from main code, never reachable over IPC)
const file = () => path.join(app.getPath('userData'), 'burner-wallet.bin');
const hasKeyFile = () => fs.existsSync(file());

// never let a secret reach a log, an error or the page by accident
function scrub(msg) {
  return String(msg ?? '').replace(/[1-9A-HJ-NP-Za-km-z]{80,}/g, '[redacted]').replace(/\[\s*(\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/g, '[redacted]').slice(0, 300);
}
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return { err: scrub(e?.message || 'something went wrong') }; } };

function send(ch, data) { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); }
function emitStatus() { send('wallet:status', statusSync()); try { onStatus(); } catch {} }

// ---------- storage ----------
function decrypt() { return S.keypairFromSecret(safeStorage.decryptString(fs.readFileSync(file()))); }
// the key exists only inside fn, then its bytes are wiped
async function withKey(fn) {
  if (!hasKeyFile()) throw new Error('no wallet on this burner');
  const kp = decrypt();
  try {
    if (kp.publicKey.toBase58() !== address) throw new Error('the saved key changed');
    return await fn(kp);
  } finally { S.wipeKeypair(kp); }
}
function unlock() {
  address = null;
  if (!hasKeyFile()) return;
  try { const kp = decrypt(); address = kp.publicKey.toBase58(); S.wipeKeypair(kp); }
  catch { console.error('wallet: the saved key could not be unlocked on this Windows account'); }
}
function persist(k) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't encrypt the key on this account, so it won't be stored");
  if (hasKeyFile()) throw new Error('this burner already has a wallet. forget it first (after exporting the key or emptying it)');
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, safeStorage.encryptString(S.secretToBase58(k)), { mode: 0o600 });
  fs.renameSync(tmp, file());
  // read it back: the stored key must sign for the same address
  const back = decrypt();
  const ok = back.publicKey.equals(k.publicKey) && Buffer.from(back.secretKey).equals(Buffer.from(k.secretKey));
  S.wipeKeypair(back);
  if (!ok) { wipe(); throw new Error('the key could not be stored correctly, nothing was saved'); }
}
function wipe() {
  const f = file();
  if (!fs.existsSync(f)) return;
  try { const n = fs.statSync(f).size; const fd = fs.openSync(f, 'r+'); fs.writeSync(fd, crypto.randomBytes(Math.max(n, 64)), 0, Math.max(n, 64), 0); fs.fsyncSync(fd); fs.closeSync(fd); } catch {}
  fs.unlinkSync(f);
}
function importSecret(secret) {
  if (typeof secret !== 'string' || secret.length > 1200) throw new Error('paste the private key as text');
  if (hasKeyFile()) throw new Error('this burner already has a wallet. forget it first (after exporting the key or emptying it)');
  const k = S.keypairFromSecret(secret);
  try { persist(k); address = k.publicKey.toBase58(); } finally { S.wipeKeypair(k); }
  lastBal = null; emitStatus(); startPoll(); refresh().catch(() => {});
  return { ok: true, address };
}

const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
async function confirm(opts) {
  if (confirmHook) return confirmHook(opts);
  const r = await openSecure('confirm', opts);
  return r?.ok === true;
}

// ---------- the API the overlay page may call (every function returns plain JSON, errors as { err }) ----------
// Not here on purpose: importKey / exportKey (secure window only).
function statusSync() {
  return { kind: 'real', ready: !!address, address, sol: address && lastBal ? lastBal.sol : null, rpcOk: S.rpcOk(), encryption: safeStorage.isEncryptionAvailable() };
}
const api = {
  status: async () => statusSync(),
  createKey: safe(async () => {
    if (hasKeyFile()) return { err: 'this burner already has a wallet. forget it first' };
    if (!safeStorage.isEncryptionAvailable()) return { err: "Windows can't encrypt a key on this account" };
    if (!(await confirm({ title: 'create a new burner wallet?', lines: ['a fresh wallet is made on this PC and encrypted with your Windows account.', 'export its key from the wallet app so you can get back in if this PC dies.'], action: 'create it' }))) return { err: 'cancelled' };
    const k = Keypair.generate();
    try { persist(k); address = k.publicKey.toBase58(); } finally { S.wipeKeypair(k); }
    lastBal = null; emitStatus(); startPoll(); refresh().catch(() => {});
    return { ok: true, address };
  }),
  forget: safe(async () => {
    if (!hasKeyFile()) return { ok: true };
    const bal = lastBal?.sol;
    if (!(await confirm({ title: 'forget this wallet?', lines: ['the key is wiped from this PC. this can\'t be undone.', 'export the key first, or send everything out, if there\'s anything left.'], address, amount: bal != null ? bal.toFixed(4) + ' SOL (+ any tokens) still in it' : null, action: 'forget it', danger: true }))) return { err: 'cancelled' };
    wipe(); address = null; lastBal = null; stopPoll();
    emitStatus();
    return { ok: true };
  }),
  balances: safe(async () => {
    if (!address) return { err: 'no wallet on this burner' };
    return refresh(true);
  }),
  depositQr: safe(async () => {
    if (!address) return { err: 'no wallet on this burner' };
    const dataUrl = await QR.toDataURL('solana:' + address, { margin: 1, width: 280, errorCorrectionLevel: 'M', color: { dark: '#0b0a09', light: '#fff4e6' } });
    return { ok: true, address, dataUrl };
  }),
  trade: safe(async (o) => {
    if (!address) return { err: 'import a wallet first', stage: 'quote' };
    const side = o?.side;
    if (side !== 'buy' && side !== 'sell') return { err: 'unknown trade side', stage: 'quote' };
    if (!S.isAddress(o.mint)) return { err: "that isn't a coin address", stage: 'quote' };
    if (side === 'buy' && !(Number.isFinite(o.sol) && o.sol > 0 && o.sol <= 1000)) return { err: 'pick an amount of SOL', stage: 'quote' };
    if (side === 'sell' && !(Number.isFinite(o.pct) && o.pct > 0 && o.pct <= 1)) return { err: 'pick how much to sell', stage: 'quote' };
    const slippage = Math.min(50, Math.max(0.5, Number.isFinite(o.slippage) ? o.slippage : 15));
    if (queued >= 3) return { err: 'wait for your last trades to land', stage: 'quote' };
    if (side === 'buy' && o.sol > BIG_BUY && !(await confirm({ title: `buy ${o.sol} SOL of this coin?`, lines: ['that\'s a big one for a burner. real SOL, real coin.'], amount: o.sol + ' SOL', address: o.mint, addressLabel: 'coin', action: 'buy' }))) return { err: 'cancelled', stage: 'quote' };
    queued++;
    const run = chain.then(() => T.trade({ wallet: address, sign: signTx, side, mint: o.mint, sol: o.sol, pct: o.pct, slippage, api: getApi(), onTx: (e) => send('wallet:tx', { ...e, mint: o.mint, side }) }));
    chain = run.catch(() => {});
    try {
      const r = await run;
      if (r.ok) refresh().catch(() => {});
      return r;
    } finally { queued--; }
  }),
  withdraw: safe(async (o) => {
    if (!address) return { err: 'no wallet on this burner' };
    const all = o?.all === true;
    const to = typeof o?.to === 'string' ? o.to.trim() : '';
    if (!S.isAddress(to)) return { err: "that isn't a Solana address" };
    if (!all && !(Number.isFinite(o.sol) && o.sol > 0)) return { err: 'pick an amount' };
    const chk = await T.checkWithdraw({ wallet: address, to, sol: o.sol, all });
    if (!chk.ok) return chk;
    const amount = (chk.lamports / S.LAMPORTS).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') + ' SOL';
    if (!(await confirm({ title: `send ${amount}?`, lines: [chk.exists ? 'check every character of the address. sends can\'t be undone.' : 'this address has never been used on Solana. check every character, sends can\'t be undone.'], amount, address: to, addressLabel: 'to', action: 'send it', danger: true }))) return { err: 'cancelled' };
    const run = chain.then(() => T.withdraw({ wallet: address, sign: signTx, to, lamports: chk.lamports, node: chk.node, onTx: (e) => send('wallet:tx', { ...e, side: 'withdraw' }) }));
    chain = run.catch(() => {});
    const r = await run;
    if (r.ok) refresh().catch(() => {});
    return r;
  }),
  secureImport: safe(async () => (hasKeyFile() ? { err: 'this burner already has a wallet. forget it first' } : openSecure('import'))),
  secureExport: safe(async () => (address ? openSecure('export') : { err: 'no wallet on this burner' })),
};
async function signTx(tx) {
  return withKey((kp) => { if (tx instanceof VersionedTransaction) tx.sign([kp]); else tx.sign(kp); });
}

async function refresh(force) {
  if (!address) return null;
  if (!force && Date.now() - balAt < 3000 && lastBal) return lastBal;
  const owner = address;
  const b = await S.getBalances(owner);
  if (address !== owner) return null; // the wallet changed while we were asking
  const next = { sol: b.sol, tokens: b.tokens.map((t) => ({ mint: t.mint, amount: t.amount, decimals: t.decimals, raw: t.raw })) };
  const changed = JSON.stringify(next) !== JSON.stringify(lastBal);
  lastBal = next; balAt = Date.now();
  if (changed) { send('wallet:balances', lastBal); try { onStatus(); } catch {} }
  return lastBal;
}
function startPoll() { stopPoll(); pollTimer = setInterval(() => { if (address) refresh(true).catch(() => {}); }, 15000); }
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

// ---------- secure window ----------
let secureWin = null, secureDone = null, secureCtx = null;
function openSecure(mode, ctx = null) {
  if (secureWin && !secureWin.isDestroyed()) { secureWin.focus(); return Promise.resolve({ err: 'the wallet window is already open' }); }
  const d = screen.getPrimaryDisplay().workArea;
  const W = 480, H = mode === 'confirm' ? 330 : mode === 'import' ? 360 : 380;
  secureCtx = { mode, ...(ctx || {}) };
  secureWin = new BrowserWindow({
    width: W, height: H, x: Math.round(d.x + (d.width - W) / 2), y: Math.round(d.y + (d.height - H) / 2),
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: false,
    title: { import: 'Burner · import wallet', export: 'Burner · your private key', confirm: 'Burner · confirm' }[mode], backgroundColor: '#0b0a09', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'secure-preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: false, devTools: false },
  });
  secureWin.setContentProtection(true); // invisible to OBS, Discord, screenshots and our own screen capture
  secureWin.setAlwaysOnTop(true, 'screen-saver');
  secureWin.setMenu(null);
  secureWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  secureWin.webContents.on('will-navigate', (e) => e.preventDefault());
  secureWin.loadFile(path.join(__dirname, 'secure.html'));
  secureWin.once('ready-to-show', () => { secureWin.show(); secureWin.focus(); });
  return new Promise((resolve) => {
    secureDone = (r) => { secureDone = null; resolve(r); };
    secureWin.on('closed', () => { secureWin = null; secureCtx = null; secureDone?.({ err: 'cancelled' }); });
  });
}
function fromSecure(e) { return secureWin && !secureWin.isDestroyed() && e.sender === secureWin.webContents; }
function closeSecure(result) { const done = secureDone; secureDone = null; try { secureWin?.close(); } catch {} done?.(result); }

function register(opts) {
  getWin = opts.getWin;
  if (opts.onStatus) onStatus = opts.onStatus;
  if (opts.getApi) getApi = opts.getApi;
  ipcMain.handle('wallet', async (e, req) => {
    const w = getWin();
    if (!w || e.sender !== w.webContents) return { err: 'not allowed' };
    const fn = req && typeof req.fn === 'string' && Object.prototype.hasOwnProperty.call(api, req.fn) ? api[req.fn] : null;
    if (!fn) return { err: 'unknown wallet call' };
    return fn(req.arg);
  });
  ipcMain.handle('secure', async (e, req) => {
    if (!fromSecure(e)) return { err: 'not allowed' };
    const ctx = secureCtx || {};
    if (req?.fn === 'context') return { mode: ctx.mode, title: ctx.title || null, lines: ctx.lines || [], amount: ctx.amount || null, address: ctx.mode === 'confirm' ? ctx.address || null : address, addressLabel: ctx.addressLabel || null, action: ctx.action || 'confirm', danger: !!ctx.danger };
    if (req?.fn === 'import' && ctx.mode === 'import') {
      let r;
      try { r = importSecret(req.arg); } catch (err) { return { err: scrub(err.message) }; }
      closeSecure(r);
      return r;
    }
    if (req?.fn === 'reveal' && ctx.mode === 'export') {
      if (!address) return { err: 'no wallet' };
      return withKey((kp) => ({ ok: true, secret: S.secretToBase58(kp) }));
    }
    if (req?.fn === 'answer' && ctx.mode === 'confirm') { closeSecure({ ok: req.arg === true }); return { ok: true }; }
    if (req?.fn === 'close') { closeSecure(ctx.mode === 'confirm' ? { ok: false } : { err: 'cancelled' }); return { ok: true }; }
    return { err: 'unknown' };
  });
  unlock();
  if (address) { startPoll(); refresh().catch(() => {}); }
}

// BURNER_WALLET_SELFTEST=1: storage + bridge rules with throwaway keys in a temp userData, printed as JSON lines
async function selfTest() {
  const out = [];
  const check = (name, ok, extra) => { out.push({ name, ok: !!ok, ...(extra || {}) }); };
  const before = address;
  check('encryption available', safeStorage.isEncryptionAvailable());
  confirmHook = async () => false;
  const c0 = await api.createKey();
  check('createKey needs a confirmation', c0.err === 'cancelled' && !hasKeyFile());
  confirmHook = async () => true;
  const c = await api.createKey();
  check('createKey after confirming', c.ok && S.isAddress(c.address));
  const onDisk = fs.readFileSync(file());
  const exported = await withKey((kp) => S.secretToBase58(kp));
  check('file is not the key', !onDisk.toString('utf8').includes(exported) && !onDisk.includes(Buffer.from(exported)), { bytes: onDisk.length });
  check('stored key signs for its address', await withKey((kp) => {
    const msg = Buffer.from('burner'); const { sign, verify } = require('node:crypto');
    const pk = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.slice(0, 32))]), format: 'der', type: 'pkcs8' });
    const sig = sign(null, msg, pk);
    const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), kp.publicKey.toBuffer()]), format: 'der', type: 'spki' });
    return verify(null, msg, pub, sig);
  }));
  const dup = await api.createKey();
  check('createKey refuses while a wallet exists', !!dup.err && address === c.address, { err: dup.err });
  let dupImp; try { dupImp = importSecret(require('bs58').encode(Keypair.generate().secretKey)); } catch (e) { dupImp = { err: e.message }; }
  check('import refuses while a wallet exists', !!dupImp.err && address === c.address, { err: dupImp.err });
  check('the page bridge has no importKey/exportKey', !('importKey' in api) && !('exportKey' in api));
  confirmHook = async () => false;
  const f0 = await api.forget();
  check('forget needs a confirmation', f0.err === 'cancelled' && hasKeyFile());
  confirmHook = async () => true;
  await api.forget();
  // import a 64-byte key (base58 and JSON array) and check it signs and exports byte for byte (the zeroed-key bug)
  for (const fmt of ['base58', 'json']) {
    const k2 = Keypair.generate();
    const secret = fmt === 'base58' ? require('bs58').encode(k2.secretKey) : JSON.stringify(Array.from(k2.secretKey));
    const im = importSecret(secret);
    const back = await withKey((kp) => S.secretToBase58(kp));
    check('import ' + fmt + ': export after import is the same key', im.ok && back === require('bs58').encode(k2.secretKey));
    const signedOk = await withKey((kp) => { const t = new (require('@solana/web3.js').Transaction)({ feePayer: kp.publicKey, blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }); t.add(require('@solana/web3.js').SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 })); t.sign(kp); return t.verifySignatures(); });
    check('import ' + fmt + ': signs a valid signature', signedOk);
    unlock();
    check('import ' + fmt + ': unlocks from disk after restart', address === k2.publicKey.toBase58());
    await api.forget();
  }
  let bad; try { importSecret('not-a-key-0OIl'); } catch (e) { bad = e.message; }
  check('import garbage refused', !!bad, { err: bad });
  const k3 = Keypair.generate(); const mm = Uint8Array.from(k3.secretKey); mm[40] ^= 1;
  let mmErr; try { importSecret(require('bs58').encode(mm)); } catch (e) { mmErr = e.message; }
  check('import mismatched key refused', !!mmErr && !hasKeyFile(), { err: mmErr });
  check('scrub hides a key', !scrub('boom ' + require('bs58').encode(k3.secretKey)).includes(require('bs58').encode(k3.secretKey)));
  importSecret(require('bs58').encode(Keypair.generate().secretKey));
  const st = await api.status();
  check('status', st.ready && !!st.address);
  const tr = await api.trade({ side: 'buy', mint: 'not a mint', sol: 0.1 });
  check('trade validates mint', !!tr.err);
  const tr2 = await api.trade({ side: 'buy', mint: 'So11111111111111111111111111111111111111112', sol: -1 });
  check('trade validates amount', !!tr2.err);
  confirmHook = async () => false;
  const big = await api.trade({ side: 'buy', mint: 'So11111111111111111111111111111111111111112', sol: 2 });
  check('a buy over 1 SOL needs a confirmation', big.err === 'cancelled');
  const wd = await api.withdraw({ to: 'not an address', sol: 0.1 });
  check('withdraw validates the address', !!wd.err);
  const qr = await api.depositQr();
  check('deposit qr', qr.ok && qr.dataUrl.startsWith('data:image/png;base64,'));
  confirmHook = async () => true;
  const f = await api.forget();
  check('forget', f.ok && !hasKeyFile() && !address);
  confirmHook = null;
  address = before;
  return out;
}

// dev-only test hook (main.cjs calls it only when !app.isPackaged and BURNER_TEST_WALLET is set, with a temp profile)
function autoConfirmForTests(v) { confirmHook = v ? async () => true : null; }

module.exports = { register, selfTest, api, statusSync, autoConfirmForTests };
