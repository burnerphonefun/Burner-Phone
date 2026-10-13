// Which window is in front, for the PowerShell fallback detector (detect.ps1 compiles this with Add-Type).
// The app normally runs bin/burner-detect.exe (Rust, desktop/detect) for the same job; this is what runs when it can't.
// It only asks Windows for the foreground window, its title and its process name: no game memory, files or input.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class BurnerFg {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  // One record: "name|title". name is the process name without .exe (what main.cjs matches on); a '|' or a line
  // break in the title is flattened so a line is always exactly one record.
  public static string Line() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "|";
    StringBuilder title = new StringBuilder(512);
    GetWindowText(h, title, title.Capacity);
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    string name = "";
    if (pid != 0) {
      try { using (Process p = Process.GetProcessById((int)pid)) name = p.ProcessName; } catch (Exception) { }
    }
    return name.Replace('|', '/') + "|" + title.ToString().Replace('|', '/').Replace('\r', ' ').Replace('\n', ' ');
  }
}
