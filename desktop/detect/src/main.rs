//! burner-detect: which window is in front, so BurnerPhone can hand you the phone that matches the game.
//!
//! Prints `name|title` for the foreground window every 2 s, one line each, UTF-8. `name` is the process's
//! executable name without `.exe` (main.cjs matches on it), `title` is the window title with `|` and line
//! breaks flattened so every line is exactly one record.
//!
//! It only asks Windows which window is in front, what it's called and which program owns it. It never opens
//! a game's memory, files or input. When the app closes the pipe, the next write fails and the helper exits.
//!
//! `--once` prints a single line and exits (tests, CI).

use std::io::{self, Write};
use std::thread::sleep;
use std::time::Duration;

#[cfg(windows)]
mod win;

const EVERY: Duration = Duration::from_secs(2);

fn main() {
    let once = std::env::args().skip(1).any(|a| a == "--once");
    let stdout = io::stdout();
    loop {
        let (exe, title) = front();
        let mut out = stdout.lock();
        if writeln!(out, "{}", line(process_name(&exe), &title))
            .and_then(|()| out.flush())
            .is_err()
        {
            return; // the app is gone: nobody is reading any more
        }
        drop(out);
        if once {
            return;
        }
        sleep(EVERY);
    }
}

/// The foreground window's executable path and title, or empty strings when there's nothing to ask about.
#[cfg(windows)]
fn front() -> (String, String) {
    win::front()
}

#[cfg(not(windows))]
fn front() -> (String, String) {
    (String::new(), String::new())
}

/// `C:\Games\GTA5.EXE` → `GTA5`: the file name without a trailing `.exe` (any case), the same name
/// PowerShell's `Process.ProcessName` gives, so the fallback detector and this one agree.
fn process_name(exe_path: &str) -> &str {
    let file = exe_path.rsplit(['\\', '/']).next().unwrap_or(exe_path);
    match file.len().checked_sub(4) {
        Some(i) if file.is_char_boundary(i) && file[i..].eq_ignore_ascii_case(".exe") => &file[..i],
        _ => file,
    }
}

/// One record. A `|` anywhere becomes `/` and line breaks become spaces, so the parser can split on the first `|`
/// and on newlines without ever mis-reading a title.
fn line(name: &str, title: &str) -> String {
    let flat = |s: &str| -> String {
        s.chars()
            .map(|c| match c {
                '|' => '/',
                '\r' | '\n' => ' ',
                c => c,
            })
            .collect()
    };
    format!("{}|{}", flat(name), flat(title))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_exe_in_any_case() {
        assert_eq!(process_name(r"C:\Games\Racer5.EXE"), "Racer5");
        assert_eq!(
            process_name(r"C:\Program Files\Java\bin\javaw.exe"),
            "javaw"
        );
        assert_eq!(process_name("PartyPlayerBeta.Exe"), "PartyPlayerBeta");
    }

    #[test]
    fn keeps_names_that_are_not_exe() {
        assert_eq!(process_name("/usr/bin/javaw"), "javaw");
        assert_eq!(process_name(r"C:\tools\run.exe.bak"), "run.exe.bak");
        assert_eq!(process_name(""), "");
        assert_eq!(process_name(".exe"), "");
    }

    #[test]
    fn non_ascii_paths_never_panic() {
        assert_eq!(process_name(r"C:\ゲーム\ゲーム.exe"), "ゲーム");
        assert_eq!(process_name("é"), "é");
        assert_eq!(process_name("aé.ex"), "aé.ex");
    }

    #[test]
    fn one_record_per_line() {
        assert_eq!(
            line("javaw", "Blocks 1.21 | Singleplayer\r\nnext"),
            "javaw|Blocks 1.21 / Singleplayer  next"
        );
        assert_eq!(line("a|b", "t"), "a/b|t");
    }

    #[test]
    fn nothing_in_front_is_an_empty_record() {
        assert_eq!(line(process_name(""), ""), "|");
    }
}
