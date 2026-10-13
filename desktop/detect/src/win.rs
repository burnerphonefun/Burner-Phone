//! The Windows side: four user32/kernel32 calls, declared by hand so the helper has no dependencies.

use std::ffi::c_void;

type Hwnd = *mut c_void;
type Handle = *mut c_void;

/// Enough to read a process's image name, and granted for almost any process the user can see.
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

#[link(name = "user32")]
extern "system" {
    fn GetForegroundWindow() -> Hwnd;
    fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max: i32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn QueryFullProcessImageNameW(
        process: Handle,
        flags: u32,
        name: *mut u16,
        size: *mut u32,
    ) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
}

/// The foreground window's executable path and title. Either is empty when Windows won't say.
pub fn front() -> (String, String) {
    // SAFETY: every call gets a valid out-pointer to a live local buffer with its true length; a null window or
    // process handle is checked before use, and the process handle is always closed.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return (String::new(), String::new());
        }

        let mut title = [0u16; 512];
        let n = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32)
            .clamp(0, title.len() as i32);
        let title = String::from_utf16_lossy(&title[..n as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut exe = String::new();
        if pid != 0 {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process.is_null() {
                let mut path = [0u16; 1024];
                let mut len = path.len() as u32;
                if QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut len) != 0 {
                    exe = String::from_utf16_lossy(&path[..(len as usize).min(path.len())]);
                }
                CloseHandle(process);
            }
        }
        (exe, title)
    }
}
