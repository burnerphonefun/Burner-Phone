// One real trade, start to finish: mint check → quote (Jupiter Ultra; PumpPortal when Jupiter has no route) → independent price
// → guard (instruction allowlist + simulation + value-in) → sign → send → confirm → what actually changed.
// Electron-free: signing goes through sign(tx), which decrypts the key just for that signature (wallet.cjs withKey).
'use strict';
const { VersionedTransaction } = require('@solana/web3.js');
const S = require('./solana.cjs');

const LAMPORTS = S.LAMPORTS;
const KEEP = 0.003 * LAMPORTS;            // left in the wallet for fees + a token account's rent on a buy
const PP_PRIORITY = 0.0005;               // PumpPortal priority fee (SOL)
const PP_FEE_BPS = 50;                    // PumpPortal local-api fee (0.5%)

const fail = (err, stage, extra) => ({ err, stage, ...extra });
const floor = (x) => BigInt(Math.max(0, Math.floor(x)));

async function decimalsOf(mint, node) {
  try { const i = await S.rpcAt(node, 'getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]); if (i.value) return Buffer.from(i.value.data[0], 'base64')[44]; } catch {}
  return null;
}

async function trade({ wallet, sign, side, mint, sol, pct, slippage = 15, api = null, onTx = () => {} }) {
  const slip = Math.min(50, Math.max(0.5, Number(slippage) || 15)) / 100;
  let node;
  try { node = await S.pinNode(); } catch { return fail("can't reach the solana network right now", 'quote'); }
  let tx, route, requestId = null, feeBps = 0, lastValidBlockHeight = null;
  let gOpts;

  if (side === 'buy') {
    const lamports = Math.round(sol * LAMPORTS);
    const mc = await S.checkMint(mint, node).catch((e) => ({ err: "couldn't read the coin (" + e.message.slice(0, 50) + ')' }));
    if (!mc.ok) return fail('refused: ' + mc.err, 'quote');
    let bal;
    try { bal = (await S.rpcAt(node, 'getBalance', [wallet, { commitment: 'confirmed' }])).value; } catch { return fail("can't reach the solana network right now", 'quote'); }
    if (bal < lamports + KEEP) return fail(`not enough SOL: you have ${(bal / LAMPORTS).toFixed(4)}, a ${sol} SOL buy needs ~${((lamports + KEEP) / LAMPORTS).toFixed(4)} with fees`, 'quote');
    const ref = await S.refQuote({ mint, side: 'buy', lamports, decimals: mc.decimals, api, node });
    if (!ref) return fail("can't check this coin's price right now, so the buy wasn't sent", 'quote');
    let minTokens = Number(ref.tokensRaw) * (1 - slip - S.VALUE_MARGIN);
    const q = await quote({ wallet, inputMint: S.SOL_MINT, outputMint: mint, amount: String(lamports) });
    if (q.err) return q;
    if (q.tx) {
      ({ tx, requestId, feeBps } = q); route = 'jupiter';
      if (q.outAmount) minTokens = Math.max(minTokens, Number(q.outAmount) * (1 - slip));
    } else {
      try { tx = await S.pumpPortalTx({ publicKey: wallet, action: 'buy', mint, amount: sol, denominatedInSol: true, slippage: slip * 100, priorityFee: PP_PRIORITY }); }
      catch (e) { return fail('no route for this coin yet (' + e.message.slice(0, 80) + ')', 'quote'); }
      route = 'pumpportal'; feeBps = PP_FEE_BPS;
    }
    gOpts = { side, maxOutLamports: lamports * (1 + slip) + S.FEE_BUFFER, minTokensRaw: floor(minTokens), amountLamports: lamports, feeBps };
  } else if (side === 'sell') {
    let held;
    try { held = await S.tokenRaw(wallet, mint); } catch { return fail("can't reach the solana network right now", 'quote'); }
    if (held.raw <= 0n) return fail('you hold none of this coin', 'quote');
    const decimals = held.decimals ?? (await decimalsOf(mint, node));
    const frac = BigInt(Math.round(Math.min(1, pct) * 1e6));
    const amountRaw = pct >= 0.999 ? held.raw : (held.raw * frac) / 1000000n;
    if (amountRaw <= 0n) return fail('that slice is too small to sell', 'quote');
    const ref = await S.refQuote({ mint, side: 'sell', tokensRaw: amountRaw, decimals, api, node });
    if (!ref) return fail("can't check this coin's price right now, so the sell wasn't sent", 'quote');
    const expected = Number(ref.lamports);
    // a dust sell may net below zero after fees; never more than the fee buffer
    let minSol = expected * (1 - slip - S.VALUE_MARGIN) - S.FEE_BUFFER;
    const q = await quote({ wallet, inputMint: mint, outputMint: S.SOL_MINT, amount: amountRaw.toString() });
    if (q.err) return q;
    if (q.tx) {
      ({ tx, requestId, feeBps } = q); route = 'jupiter';
      if (q.outAmount) minSol = Math.max(minSol, Number(q.outAmount) * (1 - slip) - S.FEE_BUFFER);
    } else {
      const ui = decimals != null ? Number(amountRaw) / 10 ** decimals : null;
      if (ui == null && pct < 0.999) return fail("can't size this sell", 'quote');
      try { tx = await S.pumpPortalTx({ publicKey: wallet, action: 'sell', mint, amount: pct >= 0.999 ? '100%' : ui, denominatedInSol: false, slippage: slip * 100, priorityFee: PP_PRIORITY }); }
      catch (e) { return fail('no route to sell this coin right now (' + e.message.slice(0, 80) + ')', 'quote'); }
      route = 'pumpportal'; feeBps = PP_FEE_BPS;
    }
    gOpts = { side, maxOutLamports: S.FEE_BUFFER, sellRaw: amountRaw, minSolIn: BigInt(Math.floor(minSol)), amountLamports: expected, feeBps };
  } else return fail('unknown trade side', 'quote');

  // PumpPortal: our own fresh blockhash, so we know exactly when it expires (and it can't be a stale or nonce one)
  if (route === 'pumpportal') {
    try { const bh = await S.freshBlockhash(node); tx.message.recentBlockhash = bh.blockhash; lastValidBlockHeight = bh.lastValidBlockHeight; }
    catch { return fail("can't reach the solana network right now", 'quote'); }
  }
  // nothing is signed until the guard says the wallet only gives what was asked and gets fair value back
  const g = await S.guard(tx, { wallet, mint, route, node, ...gOpts });
  if (!g.ok) return fail(g.err, g.stage || 'guard');

  try { await sign(tx); } catch (e) { return fail("couldn't sign (" + String(e.message || '').slice(0, 60) + ')', 'send'); }
  let sig;
  if (route === 'jupiter') {
    const signed = Buffer.from(tx.serialize()).toString('base64');
    onTx({ status: 'sent', route });
    let ex;
    try { ex = await S.jupExecute(signed, requestId); } catch (e) { return fail("jupiter didn't answer while sending (" + e.message.slice(0, 60) + '). check your wallet before retrying', 'send'); }
    sig = ex.signature || null;
    if (ex.status !== 'Success') {
      onTx({ sig, status: 'failed', err: ex.error || 'failed' });
      return fail('the trade failed: ' + String(ex.error || ex.code || 'unknown').slice(0, 120), 'confirm', { sig });
    }
    onTx({ sig, status: 'confirmed' });
    const d = await S.txDeltas(sig, wallet, mint);
    if (d) return { ok: true, sig, route, solDelta: d.solDelta, tokenDelta: d.tokenDelta, fee: { bps: feeBps, network: d.fee } };
    return { ok: true, sig, route, solDelta: null, tokenDelta: null, fee: { bps: feeBps } }; // the chain hasn't served it yet: balances will catch up
  }
  let r;
  try { r = await S.sendAndConfirm(tx.serialize(), { lastValidBlockHeight, node, onSent: (s) => onTx({ sig: s, status: 'sent', route }) }); }
  catch (e) { return fail("couldn't send the trade (" + e.message.slice(0, 60) + ')', 'send'); }
  sig = r.sig;
  if (r.status !== 'confirmed') { onTx({ sig, status: 'failed', err: r.err }); return fail(r.err, 'confirm', { sig }); }
  onTx({ sig, status: 'confirmed' });
  const d = await S.txDeltas(sig, wallet, mint);
  return { ok: true, sig, route, solDelta: d?.solDelta ?? null, tokenDelta: d?.tokenDelta ?? null, fee: { bps: feeBps, network: d?.fee ?? null } };
}

// Jupiter first, only through routers whose programs are on the allowlist. { tx } on success, { tx: null } when only
// "no route" (→ PumpPortal), { err } for real refusals.
async function quote({ wallet, inputMint, outputMint, amount }) {
  let o;
  try { o = await S.jupOrder({ inputMint, outputMint, amount, taker: wallet }); } catch { return { tx: null }; }
  if (o.transaction && !S.ULTRA_ROUTERS[o.router]) {
    // a router we haven't vetted: ask again without it (and the other unvetted ones)
    try { o = await S.jupOrder({ inputMint, outputMint, amount, taker: wallet, excludeRouters: ['okx', 'jupiterz', 'hashflow', o.router].filter((v, i, a) => v && a.indexOf(v) === i) }); } catch { return { tx: null }; }
    if (o.transaction && !S.ULTRA_ROUTERS[o.router]) return { tx: null };
  }
  if (o.transaction) {
    try { return { tx: VersionedTransaction.deserialize(Buffer.from(o.transaction, 'base64')), requestId: o.requestId, feeBps: Number(o.feeBps) || 0, outAmount: o.outAmount || null }; }
    catch { return fail('jupiter sent a transaction we could not read', 'quote'); }
  }
  if (S.jupNoRoute(o)) return { tx: null };
  const m = String(o.errorMessage || o.error || 'no quote');
  return fail(/insufficient/i.test(m) ? 'not enough SOL (or tokens) for this trade plus fees' : 'jupiter: ' + m.slice(0, 100), 'quote');
}

// checks only (used before asking the user to confirm a withdraw)
async function checkWithdraw({ wallet, to, sol, all }) {
  if (to === wallet) return fail("that's this wallet", 'quote');
  let node;
  try { node = await S.pinNode(); } catch { return fail("can't reach the solana network right now", 'quote'); }
  const rc = await S.checkRecipient(to, node).catch(() => ({ err: "can't check that address right now" }));
  if (!rc.ok) return fail(rc.err, 'quote');
  let bal;
  try { bal = (await S.rpcAt(node, 'getBalance', [wallet, { commitment: 'confirmed' }])).value; } catch { return fail("can't reach the solana network right now", 'quote'); }
  const FEE = 5000;
  let lamports;
  if (all) lamports = bal - FEE;
  else {
    lamports = Math.round(sol * LAMPORTS);
    if (bal - lamports - FEE < 0.002 * LAMPORTS) return fail(`leave at least 0.002 SOL (you have ${(bal / LAMPORTS).toFixed(4)}), or send all`, 'quote');
  }
  if (!(lamports > 0)) return fail('nothing to send', 'quote');
  return { ok: true, lamports, node, exists: rc.exists };
}

async function withdraw({ wallet, sign, to, lamports, node, onTx = () => {} }) {
  let built;
  try { built = await S.buildWithdraw({ from: wallet, to, lamports, node }); } catch { return fail("can't reach the solana network right now", 'quote'); }
  const g = await S.guard(built.tx, { wallet, mint: null, side: 'withdraw', route: 'withdraw', node, maxOutLamports: lamports + S.FEE_BUFFER, transfer: { to, lamports } });
  if (!g.ok) return fail(g.err, g.stage || 'guard');
  try { await sign(built.tx); } catch (e) { return fail("couldn't sign (" + String(e.message || '').slice(0, 60) + ')', 'send'); }
  const r = await S.sendAndConfirm(built.tx.serialize(), { lastValidBlockHeight: built.lastValidBlockHeight, node, onSent: (s) => onTx({ sig: s, status: 'sent', route: 'transfer' }) });
  if (r.status !== 'confirmed') { onTx({ sig: r.sig, status: 'failed', err: r.err }); return fail(r.err, 'confirm', { sig: r.sig }); }
  onTx({ sig: r.sig, status: 'confirmed' });
  return { ok: true, sig: r.sig, sol: lamports / LAMPORTS };
}

module.exports = { trade, withdraw, checkWithdraw, quote, KEEP };
