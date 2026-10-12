// Wallet: paper SOL as a burner card on the website; in the desktop app, your own imported wallet
// (deposit QR, withdraw, transactions on Solscan, export, forget). The key never touches this screen:
// import/export open the desktop app's own local window (bridge.secureImport / secureExport).
import { el, tick, sol, mult, setText } from '../fmt.js';
import { Ticker } from '../motion.js';
import { sfx } from '../sound.js';
import { START_SOL } from '../wallet.js';

const ACH = {
  'first-buy': 'Ape mode', '2x': 'Two times', diamond: 'Diamond hands', wasted: 'Wasted', veteran: 'Burner veteran', paper: 'Paper hands', camera: 'Proof',
};
const solscan = (sig) => 'https://solscan.io/tx/' + sig;
const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '');

export function walletApp(ctx) {
  const { wallet, net } = ctx;
  const bridge = () => (typeof window !== 'undefined' ? window.burner?.wallet : null);
  const v = el('section.bp-walletapp');
  const txs = []; // recent real transactions this session: { sig, status, side, mint }
  let screen = 'main', qr = null, busy = false;

  bridge()?.on?.('tx', (e) => {
    if (!e?.sig) return;
    const i = txs.findIndex((t) => t.sig === e.sig);
    if (i >= 0) txs[i] = { ...txs[i], ...e }; else txs.unshift(e);
    txs.length = Math.min(txs.length, 8);
    if (ctx.phone?.view() === 'wallet') paint();
  });

  // ---------- pieces ----------
  function card(real) {
    const bal = el('b.bp-card-bal'), usdL = el('small.bp-card-usd');
    const T = new Ticker(bal, (x) => sol(x), { k: 90, d: 20 });
    T.set(wallet.state.sol);
    const s = wallet.state.sol;
    setText(usdL, net.st.sol && s != null ? '≈ $' + Math.round(s * net.st.sol).toLocaleString('en-US') + (real ? '' : ' (pretend)') : '');
    return el('div.bp-card' + (real ? '.bp-card-real' : ''), null,
      el('div.bp-card-top', null, el('span', { text: 'burner' }), el('em', { text: real ? 'REAL' : 'PAPER' })),
      el('small.bp-card-l', { text: real ? 'SOL in ' + short(wallet.address) : 'paper SOL' }), bal, usdL,
      el('div.bp-card-num', null, el('span', { text: real ? short(wallet.address) : '•••• •••• •••• burn' }), el('span.bp-card-chip')));
  }
  function stats() {
    const st = wallet.state.stats || {};
    const cell = (label, val, dir) => el('div.bp-wl-c', null, el('b', { text: val, data: dir ? { dir } : null }), el('small', { text: label }));
    return el('div.bp-wl-grid', null,
      cell('trades', String((st.buys || 0) + (st.sells || 0))),
      cell('win rate', st.sells ? Math.round((st.wins / st.sells) * 100) + '%' : '–'),
      cell('best', st.best ? mult(st.best.x) + ' ' + tick(st.best.sym) : '–', st.best ? 'up' : null),
      cell('worst', st.worst ? mult(st.worst.x) + ' ' + tick(st.worst.sym) : '–', st.worst && st.worst.x < 1 ? 'dn' : null),
      cell('rugged', String(st.rugs || 0), st.rugs ? 'dn' : null),
      cell('open bags', String(Object.keys(wallet.state.pos || {}).length)));
  }
  function achs() {
    const got = Object.keys(wallet.state.ach || {});
    return el('div.bp-achs', null, ...(got.length ? got.map((k) => el('span.bp-ach', { text: ACH[k] || k })) : [el('span.bp-ach.bp-ach-none', { text: 'none yet. buy something' })]));
  }
  function summary() {
    const w = wallet.worth();
    const start = wallet.kind === 'real' ? null : START_SOL;
    const d = start != null && w != null ? w - start : null;
    return el('div.bp-wl-sum', null,
      el('div', null, el('small', { text: 'worth' }), el('b', { text: w != null ? sol(w) + ' SOL' : '–' })),
      el('div', null, el('small', { text: start != null ? 'all time' : 'realized' }), el('b', {
        text: d != null ? (d >= 0 ? '+' : '') + sol(d) + ' SOL' : wallet.state.stats?.realized != null ? (wallet.state.stats.realized >= 0 ? '+' : '') + sol(wallet.state.stats.realized) + ' SOL' : '–',
        data: { dir: (d ?? wallet.state.stats?.realized ?? 0) >= 0 ? 'up' : 'dn' },
      })));
  }
  const btn = (cls, text, fn) => el('button.' + cls, { text, on: { click: async (e) => { if (busy) return; sfx.tap(); busy = true; try { await fn(e); } finally { busy = false; } } } });
  const swapNow = () => (typeof window !== 'undefined' && window.__burnerSwitchWallet ? window.__burnerSwitchWallet() : null);

  // ---------- screens ----------
  function main() {
    const real = wallet.kind === 'real';
    const B = bridge();
    const parts = [el('header.bp-hd', null, el('h1', { text: 'Wallet' }), el('span.bp-mode' + (real ? '.bp-mode-real' : ''), { text: real ? 'real' : 'paper' })), card(real), summary()];
    if (real) {
      parts.push(el('div.bp-wl-acts', null,
        btn('bp-btn1', 'deposit', async () => { qr = await B.depositQr?.().catch(() => null); screen = 'deposit'; paint(); }),
        btn('bp-btn2', 'withdraw', async () => { screen = 'withdraw'; paint(); })));
      if (txs.length) parts.push(el('h3.bp-sub', { text: 'transactions' }), el('div.bp-txs', null, ...txs.slice(0, 5).map((t) =>
        el('a.bp-tx', { href: solscan(t.sig), target: '_blank', rel: 'noopener', on: { click: (e) => { e.stopPropagation(); } } },
          el('span', { text: t.side || 'tx' }), el('b', { text: t.mint ? tick(net.coin(t.mint)?.symbol || short(t.mint)) : short(t.sig) }),
          el('em', { text: t.status || 'sent', data: { dir: t.status === 'confirmed' ? 'up' : t.status === 'failed' ? 'dn' : '' } })))));
      parts.push(stats(), el('div.bp-wl-row', null,
        btn('bp-btn2', 'export key', async () => { const r = await B.secureExport?.(); if (r?.err && r.err !== 'cancelled') ctx.say(r.err, '', 'dn'); }),
        forgetBtn()));
    } else if (B) {
      // desktop app on paper: offer to go real
      parts.push(el('div.bp-golive', null,
        el('b', { text: 'trade for real' }),
        el('small', { text: 'import your own wallet or make a fresh burner. the key stays encrypted on this pc, every trade is simulated before it is signed.' }),
        el('div.bp-wl-row', null,
          btn('bp-btn1', 'import wallet', async () => { const r = await B.secureImport?.(); if (r?.ok) { await swapNow(); ctx.say('wallet imported', short(r.address) + ' · fund it to trade', 'up'); } else if (r?.err && r.err !== 'cancelled') ctx.say(r.err, '', 'dn'); }),
          btn('bp-btn2', 'new burner', async () => { const r = await B.createKey?.(); if (r?.ok) { await swapNow(); ctx.say('burner created', 'deposit a little SOL to trade', 'up'); } else if (r?.err !== 'cancelled') ctx.say(r?.err || 'failed', '', 'dn'); }))));
      parts.push(stats(), el('h3.bp-sub', { text: 'achievements' }), achs(), resetBtn());
    } else {
      // the website: paper only, real trading lives in the app
      parts.push(stats(), el('h3.bp-sub', { text: 'achievements' }), achs(),
        el('a.bp-golive.bp-golive-link', { href: '#get', on: { click: () => sfx.tap() } },
          el('b', { text: 'trade for real in the app' }),
          el('small', { text: 'the windows app takes your own wallet. open source, the key never leaves your pc.' })),
        resetBtn());
    }
    return parts;
  }
  function deposit() {
    return [
      el('header.bp-hd', null, el('button.bp-backbtn.bp-wl-back', { text: '‹', on: { click: () => { screen = 'main'; paint(); } } }), el('h1', { text: 'Deposit' })),
      el('div.bp-qr', null, qr?.dataUrl ? el('img', { src: qr.dataUrl, alt: 'deposit address QR' }) : el('em', { text: 'QR unavailable' })),
      el('div.bp-addr', null, el('code', { text: wallet.address || '' }),
        btn('bp-btn2', 'copy address', async () => { try { await navigator.clipboard.writeText(wallet.address); ctx.say('address copied', '', 'up'); } catch { ctx.say('copy failed', '', 'dn'); } })),
      el('p.bp-fine', { text: 'send only SOL on solana to this address. keep it small: this is a burner.' }),
    ];
  }
  function withdraw() {
    const to = el('input.bp-in', { placeholder: 'to address', spellcheck: 'false', autocomplete: 'off' });
    const amt = el('input.bp-in', { placeholder: 'SOL', inputmode: 'decimal' });
    let all = false;
    amt.addEventListener('input', () => { all = false; }); // typing an amount always cancels "max"
    return [
      el('header.bp-hd', null, el('button.bp-backbtn.bp-wl-back', { text: '‹', on: { click: () => { screen = 'main'; paint(); } } }), el('h1', { text: 'Withdraw' })),
      el('label.bp-lbl', { text: 'to' }), to,
      el('label.bp-lbl', { text: 'amount' }), el('div.bp-wl-row', null, amt, btn('bp-btn2.bp-max', 'max', async () => { all = true; amt.value = sol(wallet.state.sol); })),
      btn('bp-btn1.bp-wd', 'send', async (e) => {
        const n = Number(amt.value);
        if (!to.value.trim() || (!all && !(n > 0))) { ctx.say('address and amount', '', 'dn'); return; }
        e.currentTarget.classList.add('bp-pending');
        const r = await bridge()?.withdraw?.({ to: to.value.trim(), sol: all ? undefined : n, all }).catch((er) => ({ err: String(er?.message || er) }));
        e.currentTarget.classList.remove('bp-pending');
        if (r?.ok) { ctx.say('sent', short(r.sig) + ' · on solscan in the wallet', 'up'); txs.unshift({ sig: r.sig, status: 'sent', side: 'withdraw' }); screen = 'main'; paint(); }
        else if (r?.err !== 'cancelled') ctx.say(r?.err || 'withdraw failed', 'nothing was sent', 'dn');
      }),
      el('p.bp-fine', { text: 'double-check the address. solana transfers can\'t be undone.' }),
    ];
  }
  function forgetBtn() {
    let armed = 0;
    const b = el('button.bp-btn2.bp-forget', { text: 'forget wallet', on: { click: async () => {
      sfx.tap();
      if (Date.now() - armed < 3000) {
        const r = await bridge()?.forget?.();
        if (r?.ok) { await swapNow(); ctx.say('wallet forgotten', 'back on paper SOL', 'up'); }
        else if (r?.err && r.err !== 'cancelled') ctx.say(r.err, '', 'dn');
        return;
      }
      armed = Date.now(); setText(b, 'tap again: removes the key from this pc');
      setTimeout(() => { if (Date.now() - armed >= 2900) setText(b, 'forget wallet'); }, 3000);
    } } });
    return b;
  }
  function resetBtn() {
    let armed = 0;
    const b = el('button.bp-reset', { text: 'new paper burner', on: { click: () => {
      sfx.tap();
      if (Date.now() - armed < 3000) { wallet.reset?.(); armed = 0; ctx.say('new burner', START_SOL + ' paper SOL, clean slate', 'up'); paint(); return; }
      armed = Date.now(); setText(b, 'tap again to wipe it');
      setTimeout(() => { if (Date.now() - armed >= 2900) setText(b, 'new paper burner'); }, 3000);
    } } });
    return b;
  }

  function paint() {
    const parts = screen === 'deposit' ? deposit() : screen === 'withdraw' ? withdraw() : main();
    v.replaceChildren(...parts);
  }
  return {
    el: v,
    enter() { screen = 'main'; paint(); },
    leave() {},
    tick() { if (ctx.phone?.view() === 'wallet' && screen === 'main') paint(); },
    onWallet(ev) { if (ev?.type === 'swap') screen = 'main'; if (ctx.phone?.view() === 'wallet' && screen === 'main') paint(); },
  };
}
