# Real wallet contract (desktop app only)

D lifted the no-wallet rule for Burner on 2026-10-12: in the Windows app a user can import their own wallet by private key and trade for real. The website stays paper.

Rules that never bend:
- The secret key lives only in the Electron **main process**, encrypted at rest with `safeStorage` (Windows DPAPI). The renderer (which loads remote pictures and data) never sees it: import and reveal happen in the app's own secure window.
- The key is never sent to any server, never logged, never put in a crash report or a URL.
- Every transaction is **simulated before signing** and refused if the wallet would lose more SOL than the user asked for (amount × (1 + slippage) + fees, ≤ 0.01 SOL of fees), or if any token other than the traded one leaves the wallet.
- Trades go straight from the user's PC to Jupiter / PumpPortal / a Solana RPC (the user's own IP), never through our server.

## Bridge: `window.burner.wallet` (preload → IPC → main), as hardened after the 2026-10-12 security review

All async, all return plain JSON. Errors are `{ err: 'short human text', stage? }`, never thrown. Calls that open a confirmation in the app's own secure window (create, forget, withdraw, buys over 1 SOL) return `{ err: 'cancelled' }` when the user declines: the phone shows nothing for that.

```js
status()                         // { kind: 'real', ready, address|null, sol|null, rpcOk, encryption }
secureImport()                   // opens the secure window to paste a key (base58 or JSON byte array) → { ok, address } | { err }
secureExport()                   // opens the secure window with hold-to-reveal (no copy button, hidden from screen capture)
createKey()                      // a fresh burner (confirmed) → { ok, address }
forget()                         // deletes the key from disk (confirmed) → { ok }
balances()                       // { sol, tokens: [{ mint, amount, decimals, raw }] }
depositQr()                      // { ok, address, dataUrl }
trade({ side, mint, sol, pct, slippage })
                                 // → { ok, sig, solDelta|null, tokenDelta|null, route: 'jupiter'|'pumpportal', fee: { bps, network? } } | { err, stage }
withdraw({ to, sol, all })       // (confirmed with the full address + amount) → { ok, sig } | { err }
on(event, cb)                    // 'balances', 'tx' ({ sig, status, route?, mint, side, err? }), 'status'
```

Import and create refuse while a key exists (forget first). There is no importKey/exportKey on the bridge: the overlay page never handles a key.

The guard (desktop/solana.cjs) before every signature: strict token-account parsing, never crediting SOL that arrives somewhere (only the wallet's own losses count), a minimum received on buys and sells from the stricter of Jupiter's quote and an independent price (the curve read from chain, else DEX Screener / our server), a per-route program allowlist (ComputeBudget, System transfer/create-account with caps, Token/Token-2022 SyncNative/CloseAccount-to-wallet/InitializeAccount3, ATA create, Memo; Jupiter: JUP6Lkb…, DF1ow4t…; PumpPortal: FAdo9NC…, 6EF8rre…, pAMMBay…), no durable nonces, a valid blockhash, one signer (Jupiter may add only a fee payer at index 0), priority fee ≤ 0.002 SOL, mint checks before buys (freeze authority, permanent delegate, transfer hook, non-transferable, default-frozen, transfer fee > 10%). The key is decrypted per signature and wiped.

## Phone side: `shared/phone/wallet-real.js`

`createRealWallet(net, bridge)` returns the **same interface as the paper wallet** (`shared/phone/wallet.js`), so every app works with either:

- `kind: 'real'` (paper wallet: `kind: 'paper'`)
- `state` → `{ sol, pos: { [mint]: { mint, sym, name, tokens, cost, opened, entryP, entryMc, high, low } }, hist, stats, ach }`: `sol` and `tokens` come from the chain; `cost`/`entryP` (cost basis) are tracked locally from confirmed trade results and saved in localStorage per address.
- `buy(c, amt)` / `sell(c, frac)` return a **Promise** of the same result shape as paper (`{ ok, got, cost, x, closed, sym }` / `{ ok, tokens }` / `{ err }`) plus `sig`. While pending, the wallet emits `{ type: 'pending', side, mint, amt }`, then `'buy'`/`'sell'` on confirm or `{ type: 'failed', mint, err }`.
- `bags()`, `worth()`, `mark(p)`, `watch()`, `award()`, `pos()`, `holds()`, `save()`, `on()` behave like paper. `reset()` doesn't exist on real (the UI hides "new burner").
- Extra: `bridge` (for the Wallet app's import/export/withdraw screens), `address`, `ready`.

The phone UI awaits `buy`/`sell` results (paper returns plain objects; `await` works on both).
