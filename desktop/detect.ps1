# Burner: the fallback game detector, for when bin/burner-detect.exe (Rust) is missing or keeps failing.
# Reports the foreground window's process name and title every 2 s, one line each: name|title (see detect.cs).
# One long-lived process (started once by main.cjs), so we never spawn PowerShell every tick.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -Path (Join-Path $PSScriptRoot 'detect.cs')
while ($true) {
  try {
    [Console]::Out.WriteLine([BurnerFg]::Line())
    [Console]::Out.Flush()
  } catch {}
  Start-Sleep -Milliseconds 2000
}
