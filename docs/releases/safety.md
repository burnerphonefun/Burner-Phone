
---

### Is this safe?

- **Open source.** Every file here is built from the code in this repo. Read it, or build it yourself.
- **Built by GitHub, not on someone's PC.** The [release workflow](https://github.com/burnerphonefun/Burner-Phone/actions/workflows/release.yml) built these files on a GitHub runner from the tagged commit, and GitHub signed a build provenance certificate for both downloads. Check it with the [GitHub CLI](https://cli.github.com):
  ```
  gh attestation verify BurnerPhone-Setup.exe --repo burnerphonefun/Burner-Phone
  ```
- **Checksums.** `SHA256SUMS.txt` lists each file's SHA-256. In PowerShell: `Get-FileHash .\BurnerPhone-Setup.exe`.
- **Why Windows warns.** The app isn't code-signed yet (that's a paid certificate), so SmartScreen says "unknown publisher" once: More info → Run anyway.
- **What it does.** A transparent, click-through window over your games with the phone in it. It asks Windows which window is in front (to pick the phone) and gets live pump.fun data from the BurnerPhone server. It never reads game memory or files and needs no admin rights. A real wallet's key is encrypted on your PC and never sent anywhere ([SECURITY.md](https://github.com/burnerphonefun/Burner-Phone/blob/main/SECURITY.md)).
- **Uninstall.** Windows settings → Apps → BurnerPhone. Your encrypted wallet stays in `%APPDATA%\BurnerPhone` unless you use Wallet → forget first.
