# Security

BurnerPhone's Windows app can hold a real Solana private key. We take that seriously, and we'd much rather hear about a problem from you than from a drained wallet.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting: the **Security** tab of this repo → **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker gets.

We'll reply as fast as we can, fix it, ship a release, and credit you in the release notes if you'd like.

## In scope

- Anything that lets the key leave the user's PC, or lets code other than the main process read it.
- Getting the app to sign a transaction that loses more than the user asked for, or moves a token they didn't trade (a way around the guard in [`desktop/solana.cjs`](desktop/solana.cjs)).
- The overlay page reaching the wallet bridge in ways [`shared/WALLET.md`](shared/WALLET.md) doesn't allow, or loading code it shouldn't (CSP bypass, IPC abuse).
- The server sending data that makes a phone mislead the user about a price, a balance or a trade.

## How the key is handled

- Encrypted at rest with Electron `safeStorage` (Windows DPAPI), stored only on the user's PC.
- Decrypted only inside the main process, for the moment it signs, then wiped.
- Typed in and revealed only in a local window that loads nothing remote and is hidden from screen capture. There is no copy button.
- Never sent to any server, never logged, never put in a URL or crash report.
- Every transaction is simulated and checked before signing; any failed check refuses it. The checks are listed in [`shared/WALLET.md`](shared/WALLET.md).

## What we never do

The website never asks for a key or a wallet connection; it's paper only. Real trades go from the user's PC straight to Jupiter, PumpPortal and Solana RPCs, never through our server.

## Checking a download

Releases are built by GitHub Actions from the tagged commit ([release.yml](.github/workflows/release.yml)), not on anyone's PC, and GitHub signs a build provenance certificate for `BurnerPhone-Setup.exe` and the portable zip:

```bash
gh attestation verify BurnerPhone-Setup.exe --repo burnerphonefun/Burner-Phone
```

Each release also carries `SHA256SUMS.txt` (in PowerShell: `Get-FileHash .\BurnerPhone-Setup.exe`).

## Supported versions

Only the [latest release](https://github.com/burnerphonefun/Burner-Phone/releases/latest) gets fixes.
