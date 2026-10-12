// The only bridge between the overlay page and Electron. No node, no filesystem. The wallet calls go to the main
// process, which holds the key; the page only ever gets addresses, balances and results (see app/shared/WALLET.md).
const { contextBridge, ipcRenderer } = require('electron');

const config = ipcRenderer.sendSync('config');
// events from main: toggle, skin, test, hotkey (the new accelerator), firstRun ({ hotkey }, once per install), display ({ id, bounds, scaleFactor })
const CHANNELS = new Set(['toggle', 'skin', 'test', 'hotkey', 'firstRun', 'display']);
const WALLET_EVENTS = new Set(['balances', 'tx', 'status']);
const w = (fn, arg) => ipcRenderer.invoke('wallet', { fn, arg });

contextBridge.exposeInMainWorld('burner', {
  config,
  hotkey: () => ipcRenderer.invoke('hotkey'), // read-only: the key that raises the phone right now
  setIgnore: (v) => ipcRenderer.send('mouse', !!v),
  setUp: (v) => ipcRenderer.send('up', !!v),
  ready: () => ipcRenderer.send('ready'),
  capture: (w, h) => ipcRenderer.invoke('capture', { w, h }),
  screenSource: () => ipcRenderer.invoke('screen-source'),
  on: (ch, fn) => { if (CHANNELS.has(ch)) ipcRenderer.on(ch, (_e, a) => fn(a)); },
  shot: (name) => ipcRenderer.invoke('test-shot', name),
  // no importKey / exportKey here: keys are typed and revealed only in the secure window (secureImport / secureExport);
  // createKey, forget, withdraw and big buys open a confirmation there too
  wallet: {
    status: () => w('status'),
    createKey: () => w('createKey'),
    forget: () => w('forget'),
    balances: () => w('balances'),
    depositQr: () => w('depositQr'),
    trade: (o) => w('trade', { side: o?.side, mint: o?.mint, sol: Number(o?.sol), pct: Number(o?.pct), slippage: o?.slippage == null ? undefined : Number(o.slippage) }),
    withdraw: (o) => w('withdraw', { to: String(o?.to ?? ''), sol: Number(o?.sol), all: o?.all === true }),
    secureImport: () => w('secureImport'),
    secureExport: () => w('secureExport'),
    on: (ev, fn) => { if (WALLET_EVENTS.has(ev)) ipcRenderer.on('wallet:' + ev, (_e, a) => fn(a)); },
  },
  log: (...a) => ipcRenderer.send('log', a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
});
