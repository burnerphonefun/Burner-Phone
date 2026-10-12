# Burner: report the foreground window's process name and title every 2 s, one line each: name|title
# One long-lived process (started once by main.cjs), so we never spawn PowerShell every tick.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BurnerFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
while ($true) {
  try {
    $h = [BurnerFg]::GetForegroundWindow()
    [uint32]$procId = 0
    [void][BurnerFg]::GetWindowThreadProcessId($h, [ref]$procId)
    $sb = New-Object System.Text.StringBuilder 256
    [void][BurnerFg]::GetWindowText($h, $sb, 256)
    $name = ''
    if ($procId -gt 0) {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p) { $name = $p.ProcessName }
    }
    $title = $sb.ToString().Replace('|', '/')
    [Console]::Out.WriteLine($name + '|' + $title)
    [Console]::Out.Flush()
  } catch {}
  Start-Sleep -Milliseconds 2000
}
