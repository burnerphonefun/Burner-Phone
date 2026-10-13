# Contributing

Thanks for wanting to make the burner better. Bug reports, ideas and pull requests are all welcome.

## Run it

Needs Node 24.

```bash
npm install
npm start                           # api + built site on :8787 (PORT=8790 npm start to move it)
API=http://localhost:8787 npx vite  # dev site with hot reload on :5173, proxies /api /ws /img to the api
```

`?world=city` (or `blocky`, `toon`, `tactical`, `obby`, `survival`) opens a world directly; `?debug` puts `net`, `wallet`, `phone` and `getWorld()` on `window`.

The Windows app: `cd desktop && npm install && npm start` (builds the overlay page, then opens Electron against your local api).

## Before you open a PR

```bash
npm run build
node scripts/wallet-test.mjs
node scripts/wallet-real-test.mjs --offline --no-electron
```

CI runs the same three on every push.

## House rules

- **The phone is DOM, not WebGL.** Only `transform` and `opacity` animate, and the motion loop must be able to sleep: the overlay shares the GPU with a game.
- **Unknown numbers are `null` and show as `–`**, never 0 and never a value borrowed from somewhere else.
- **No game names, logos, fonts or assets** anywhere in the UI, copy or art. Skins are our own take on a genre.
- **The wallet guard (`desktop/solana.cjs`) only gets stricter.** Any change to it, to `wallet.cjs`, `trader.cjs` or the IPC bridge needs a test case in `scripts/wallet-real-test.mjs` and a careful review. Security problems go through [SECURITY.md](SECURITY.md), not public issues.
- **The website stays paper.** It never asks for a key or a wallet connection.
- Read [`shared/PROTOCOL.md`](shared/PROTOCOL.md) before touching the server or `net.js`, and [`shared/WALLET.md`](shared/WALLET.md) before touching anything wallet.
- Keep copy plain and short, like a person typing. Lowercase is fine.

## Good first things

- A phone skin for a genre we don't cover yet (`shared/phone/skins.css` + `hands.js`, a world in `web/src/scene/`).
- Better rug and bond detection in `server/market.mjs`, with numbers to back it.
- Translations of the phone's few words.
