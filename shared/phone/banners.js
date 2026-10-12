// Full-screen game-style banners over the game: WASTED, MISSION PASSED, Achievement get!
import { el, sol, mult } from './fmt.js';
import { tween, wait, ease } from './motion.js';
import { sfx } from './sound.js';

// each game gets its own words for the two big moments (our own phrasing, never a game's exact line)
export const WORDS = {
  city: ['WASTED', 'MISSION PASSED'], default: ['WASTED', 'MISSION PASSED'], blocky: ['WASTED', 'MISSION PASSED'],
  toon: ['ELIMINATED', 'VICTORY'], tactical: ['ROUND LOST', 'ROUND WON'], obby: ['FELL OFF', 'STAGE CLEARED'], survival: ['BLED OUT', 'SURVIVED'],
};

export function createBanners(host, { onFx, skin }) {
  const layer = el('div.bn-layer');
  host.append(layer);
  let sk = skin?.() || 'city';
  const toasts = el('div.bn-toasts');
  layer.append(toasts);

  async function wasted({ sym, loss, reason }) {
    onFx?.({ gray: 1, slow: 1, push: 1 });
    host.classList.add('bn-wasted-on', 'bn-any');
    const vig = el('div.bn-vig');
    const word = el('b', { text: (WORDS[sk] || WORDS.city)[0] });
    const line = el('small', { text: `${sym} ${reason === 'dev' ? 'dev dumped' : 'rugged'} · -${sol(Math.max(0, loss))} SOL` });
    const node = el('div.bn-wasted', null, word, line);
    layer.append(vig, node);
    requestAnimationFrame(() => vig.classList.add('bn-in'));
    await wait(450);
    sfx.wasted();
    node.classList.add('bn-slam');
    await wait(2600);
    node.classList.add('bn-out'); vig.classList.remove('bn-in');
    onFx?.({ gray: 0, slow: 0, push: 0 });
    host.classList.remove('bn-wasted-on');
    await wait(600);
    node.remove(); vig.remove();
    host.classList.remove('bn-any');
  }

  async function passed({ sym, profit, x }) {
    const word = el('b', { text: (WORDS[sk] || WORDS.city)[1] });
    const amt = el('strong', { text: '+0.00 SOL' });
    const line = el('small', { text: `sold ${sym} at ${mult(x)}` });
    const node = el('div.bn-passed', null, word, amt, line);
    layer.append(node);
    host.classList.add('bn-any');
    requestAnimationFrame(() => node.classList.add('bn-in'));
    sfx.cash();
    await wait(380);
    await tween(900, (k) => { amt.textContent = '+' + sol(profit * k) + ' SOL'; }, ease.out);
    await wait(1700);
    node.classList.add('bn-out');
    await wait(600);
    node.remove();
    host.classList.remove('bn-any');
  }

  async function achievement({ title, text }) {
    const node = el('div.bn-ach', null, el('i.bn-ach-ic'), el('div', null, el('b', { text: 'Achievement get!' }), el('span', { text: title + ': ' + text })));
    toasts.append(node);
    requestAnimationFrame(() => node.classList.add('bn-in'));
    await wait(4200);
    node.classList.remove('bn-in');
    await wait(500);
    node.remove();
  }

  function flash() {
    const f = el('div.bn-flash');
    layer.append(f);
    f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' }).onfinish = () => f.remove();
  }

  return { el: layer, wasted, passed, achievement, flash, setSkin(s) { sk = s; layer.dataset.skin = s; } };
}
