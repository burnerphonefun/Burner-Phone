// Bags: open positions (entry vs now, PnL), swipe a row left to sell it all, closed trades below.
import { el, tick, usd, sol, pct, age, mult, setText } from '../fmt.js';
import { Ticker } from '../motion.js';
import { sfx } from '../sound.js';

export function bagsApp(ctx) {
  const { net, wallet } = ctx;
  const totB = el('b'), totS = el('small');
  const totT = new Ticker(totB, (v) => sol(v) + ' SOL', { k: 90, d: 20 });
  const open = el('div.bp-bags');
  const closed = el('div.bp-hist');
  const empty = el('div.bp-bags-empty', null,
    el('b', { text: 'no bags yet' }),
    el('small', { text: 'ape something on pump. it\'s paper SOL, you can\'t lose real money here' }),
    el('button.bp-btn1', { text: 'open pump', on: { click: () => { sfx.tap(); ctx.open('pump'); } } }));
  const v = el('section.bp-bagsapp', null,
    el('header.bp-hd', null, el('h1', { text: 'Bags' }), el('div.bp-hd-r', null, totB, totS)),
    empty, open, el('h3.bp-sub', { text: 'closed' }), closed);
  const rows = new Map();

  function row(b) {
    const mint = b.p.mint;
    const nm = el('b'), sub = el('small'), big = el('b.bp-bg-big'), small = el('small');
    const front = el('div.bp-bg-front', null, ctx.pfp(b.c || { mint, symbol: b.p.sym }, 40), el('div.bp-bg-nm', null, nm, sub), el('div.bp-bg-r', null, big, small));
    const back = el('div.bp-bg-back', { text: 'sell all' });
    const r = el('div.bp-bg', null, back, front);
    const T = new Ticker(big, (x) => pct(x - 1), { k: 90, d: 20 });
    // swipe left to sell all; a tap opens the chart
    let x0 = null, dx = 0, moved = false;
    front.addEventListener('pointerdown', (e) => { x0 = e.clientX; dx = 0; moved = false; front.setPointerCapture(e.pointerId); front.style.transition = 'none'; });
    front.addEventListener('pointermove', (e) => { if (x0 == null) return; dx = Math.min(0, e.clientX - x0); if (dx < -6) moved = true; front.style.transform = `translateX(${dx}px)`; back.style.opacity = Math.min(1, -dx / 120); });
    const end = (e) => {
      if (x0 == null) return;
      const cancelled = e.type === 'pointercancel';
      x0 = null; front.style.transition = ''; front.style.transform = ''; back.style.opacity = '';
      if (cancelled) return;
      if (dx < -120) ctx.trade('sell', net.coin(mint), 1, front);
      else if (!moved) { sfx.tap(); ctx.open('chart', mint); }
    };
    front.addEventListener('pointerup', end); front.addEventListener('pointercancel', end);
    return { el: r, update(b2) {
      setText(nm, tick(b2.p.sym));
      setText(sub, sol(b2.p.cost) + ' → ' + sol(b2.value) + ' SOL · ' + age(Date.now() - b2.p.opened));
      T.set(b2.x); big.dataset.dir = b2.x >= 1 ? 'up' : 'dn';
      setText(small, usd(b2.p.entryMc) + ' → ' + usd(b2.mc));
      r.classList.toggle('bp-rugged', !!b2.c?.rugged || !!b2.p.wasted);
    } };
  }

  function paint() {
    const bags = wallet.bags();
    empty.style.display = bags.length ? 'none' : '';
    const keys = new Set(bags.map((b) => b.p.mint));
    for (const [k, r] of rows) if (!keys.has(k)) { r.el.remove(); rows.delete(k); }
    bags.forEach((b, i) => {
      let r = rows.get(b.p.mint);
      if (!r) { r = row(b); rows.set(b.p.mint, r); }
      if (open.children[i] !== r.el) open.insertBefore(r.el, open.children[i] || null);
      r.update(b);
    });
    const val = bags.reduce((a, b) => a + b.value, 0), cost = bags.reduce((a, b) => a + b.p.cost, 0);
    totT.set(val);
    setText(totS, bags.length ? (val - cost >= 0 ? '+' : '') + sol(val - cost) + ' SOL open' : 'nothing open');
    totS.dataset.dir = val >= cost ? 'up' : 'dn';
  }
  function paintHist() {
    const h = wallet.state.hist.slice(0, 12);
    closed.replaceChildren(...(h.length ? h.map((t) => el('div.bp-hrow', null,
      el('b', { text: tick(t.sym) + (t.part ? ' (part)' : '') }),
      el('em', { text: (t.got - t.cost >= 0 ? '+' : '') + sol(t.got - t.cost) + ' SOL', data: { dir: t.got >= t.cost ? 'up' : 'dn' } }),
      el('span', { text: t.rugged ? 'rugged' : mult(t.x) }),
      el('time', { text: age(Date.now() - t.closed) }))) : [el('div.bp-hrow.bp-hnone', { text: 'your closed trades land here' })]));
  }
  return {
    el: v,
    enter() { paint(); paintHist(); },
    leave() {},
    tick() { paint(); },
    onWallet() { if (ctx.phone?.view() === 'bags') { paint(); paintHist(); } },
    second() { paint(); },
  };
}
