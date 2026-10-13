// The amount sheet: type any SOL to buy, or any % to sell, on a keypad inside the phone. No OS keyboard pops up on a
// phone; on a real keyboard digits, Backspace, Enter and Escape work, and they don't reach the page while it's open.
// Resolves with the number (SOL, or % 0-100), or null when dismissed.
import { el, sol, usd, tick } from './fmt.js';
import { sfx } from './sound.js';

const BUY_PICKS = [0.05, 0.1, 0.25, 0.5, 1, 2];
const SELL_PICKS = [10, 25, 50, 75, 100];

// o = { side: 'buy' | 'sell' | 'size', coin?, value?, balance? (SOL), held? (the bag's SOL value), solUsd? }
export function askAmount(screen, o) {
  const pctMode = o.side === 'sell';
  let text = o.value > 0 ? String(+(+o.value).toFixed(4)) : '';
  let selected = !!text; // a prefilled value acts like selected text: the first key replaces it
  return new Promise((done) => {
    const shown = el('b.bp-amt-v'), note = el('small.bp-amt-note');
    const go = el('button.bp-btn1.bp-amt-go' + (pctMode ? '.bp-amt-sell' : '.bp-amt-buy'), { on: { click: () => { if (!go.disabled) close(value()); } } });
    const picks = el('div.bp-amt-picks');
    for (const v of pctMode ? SELL_PICKS : BUY_PICKS) {
      picks.append(el('button', { text: pctMode ? v + '%' : String(v), data: { v: String(v) }, on: { click: () => { sfx.tap(); text = String(v); selected = false; paint(); } } }));
    }
    const pad = el('div.bp-amt-pad');
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']) {
      pad.append(el('button', { text: k === 'del' ? '⌫' : k, data: { k }, on: { click: () => press(k) } }));
    }
    const title = o.side === 'size' ? 'buy size for every launch' : o.side + ' ' + (o.coin ? tick(o.coin.symbol) : '');
    const card = el('div.bp-sheet-card.bp-amt', { on: { click: (e) => e.stopPropagation() } },
      el('div.bp-amt-hd', null, el('span', { text: title }), el('button.bp-amt-x', { text: 'cancel', on: { click: () => close(null) } })),
      el('div.bp-amt-show', null, shown, el('span.bp-amt-u', { text: pctMode ? '%' : 'SOL' })),
      note, picks, pad, go);
    const sheet = el('div.bp-sheet.bp-amt-sheet', { on: { click: () => close(null) } }, card);

    function value() { const v = parseFloat(text); return Number.isFinite(v) ? v : null; }
    function problem(v) {
      if (!(v > 0)) return pctMode ? 'type a %' : 'type an amount';
      if (pctMode && v > 100) return 'you can sell up to 100%';
      if (o.side === 'buy' && o.balance != null && v > o.balance) return 'you have ' + sol(o.balance) + ' SOL';
      if (!pctMode && v > 1000) return 'too big';
      return null;
    }
    function press(k) {
      sfx.tap();
      if (selected) { text = ''; selected = false; if (k === 'del') return paint(); }
      if (k === 'del') text = text.slice(0, -1);
      else if (k === '.') { if (!text.includes('.')) text = (text || '0') + '.'; }
      else {
        const next = text === '0' ? k : text + k;
        const [whole, dec = ''] = next.split('.');
        if (whole.length > 4 || dec.length > (pctMode ? 1 : 4)) return; // up to 9999 SOL / 4 decimals, % to one decimal
        text = next;
      }
      paint();
    }
    function paint() {
      const v = value(), bad = problem(v);
      shown.textContent = text || '0';
      shown.classList.toggle('bp-amt-empty', !text);
      shown.classList.toggle('bp-amt-sel', selected);
      go.disabled = !!bad;
      go.textContent = bad || (o.side === 'size' ? 'use ' + text + ' SOL' : o.side === 'buy' ? 'buy ' + text + ' SOL' : 'sell ' + text + '%');
      const bal = o.balance != null ? 'balance ' + sol(o.balance) + ' SOL' : '';
      note.textContent = pctMode
        ? (o.held != null ? (v > 0 ? '≈ ' + sol((o.held * Math.min(v, 100)) / 100) + ' SOL of your ' : 'your bag: ') + sol(o.held) + ' SOL' : '')
        : [v > 0 && o.solUsd ? '≈ ' + usd(v * o.solUsd) : '', bal].filter(Boolean).join(' · ');
      for (const b of picks.children) b.classList.toggle('bp-on', b.dataset.v === text);
    }
    function onKey(e) {
      const k = e.key;
      if (/^[0-9]$/.test(k)) press(k);
      else if (k === '.' || k === ',') press('.');
      else if (k === 'Backspace') press('del');
      else if (k === 'Enter') { if (!go.disabled) close(value()); }
      else if (k === 'Escape') close(null);
      else return; // everything else (the phone's hotkey too) still works
      e.preventDefault(); e.stopImmediatePropagation();
    }
    let closed = false;
    function close(v) {
      if (closed) return;
      closed = true;
      removeEventListener('keydown', onKey, true);
      sheet.classList.remove('bp-on');
      setTimeout(() => sheet.remove(), 260);
      done(v);
    }
    addEventListener('keydown', onKey, true);
    screen.append(sheet);
    paint();
    requestAnimationFrame(() => sheet.classList.add('bp-on'));
  });
}
