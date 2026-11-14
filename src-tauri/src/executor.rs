//! The executor panel: the user's executor program (`Settings.executor_exe`), started, restarted
//! and kept open from here, and the scripts in its autoexec folder.
//!
//! - Running: any process with the program's file name.
//! - Kept open (`executor_keep_open`): seen running, then gone → started again (at most every 30 s).
//! - Opened with MTwin Manager (`executor_auto_open`): once, at start, when it isn't running.
//! - Autoexec folder: `<exe folder>\autoexec`, else `%LOCALAPPDATA%\<exe name>\autoexec` when that
//!   exists (where some executors keep it). Only plain script files directly in it are listed or
//!   touched: `.lua`, `.luau`, `.txt`, at most 1 MB each.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::App;
use crate::error::{AppError, Result};
use crate::instances::process;

const MAX_SCRIPT: u64 = 1_000_000;
const EXTS: [&str; 3] = ["lua", "luau", "txt"];
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Windows' "The requested operation requires elevation".
const NEEDS_ADMIN: i32 = 740;
/// The scheduled task that starts the executor with admin rights without asking each time
/// (`executor_task_setup`): Windows asks once, when it is made.
const TASK: &str = "MTwin Manager Executor";

#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScriptFile {
    pub name: String,
    pub size: u64,
}

#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExecutorStatus {
    /// The program, as set; "" for none.
    pub path: String,
    pub found: bool,
    pub running: bool,
    /// Where its autoexec scripts go (None without a program).
    pub autoexec_dir: Option<String>,
    /// The scheduled task for this program is set up: it starts with admin rights, no prompt.
    pub no_prompt: bool,
    pub files: Vec<ScriptFile>,
}

fn exe(s: &App) -> Result<PathBuf> {
    let p = s.db.settings()?.executor_exe;
    if p.trim().is_empty() {
        return Err(AppError::Invalid(tr!("Choose your executor's program first.")));
    }
    Ok(PathBuf::from(p))
}

fn file_name(exe: &Path) -> Option<String> {
    exe.file_name().map(|n| n.to_string_lossy().into_owned())
}

fn running(exe: &Path) -> Vec<process::ProcInfo> {
    file_name(exe).map(|n| process::named(&n)).unwrap_or_default()
}

/// Its autoexec folder (see the module docs); it may not exist yet.
fn autoexec_dir(exe: &Path) -> Option<PathBuf> {
    let beside = exe.parent()?.join("autoexec");
    if beside.is_dir() {
        return Some(beside);
    }
    let stem = exe.file_stem()?.to_string_lossy().into_owned();
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        // Its own name, or the name without a version or suffix ("Potassium-1.2" → "Potassium").
        let short: String = stem.chars().take_while(|c| c.is_alphanumeric()).collect();
        for name in [stem.as_str(), short.as_str()] {
            let d = local.join(name).join("autoexec");
            if !name.is_empty() && d.is_dir() {
                return Some(d);
            }
        }
    }
    Some(beside)
}

/// A script's name as given, when it is a plain file name with an allowed extension (pure).
fn script_name(name: &str) -> Option<&str> {
    let ok_chars = !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        && !name.contains("..");
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    (ok_chars && ext.is_some_and(|e| EXTS.contains(&e.as_str()))).then_some(name)
}

fn script_path(s: &App, name: &str) -> Result<PathBuf> {
    let name = script_name(name).ok_or_else(|| AppError::Invalid(tr!("Use a plain file name ending in .lua, .luau or .txt.")))?;
    let dir = autoexec_dir(&exe(s)?).ok_or_else(|| AppError::Invalid(tr!("Choose your executor's program first.")))?;
    Ok(dir.join(name))
}

fn status(s: &App) -> Result<ExecutorStatus> {
    let path = s.db.settings()?.executor_exe;
    if path.trim().is_empty() {
        return Ok(ExecutorStatus { path, found: false, running: false, autoexec_dir: None, files: Vec::new(), no_prompt: false });
    }
    let exe = PathBuf::from(&path);
    let dir = autoexec_dir(&exe);
    let mut files: Vec<ScriptFile> = dir
        .as_deref()
        .and_then(|d| std::fs::read_dir(d).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            script_name(&name)?;
            Some(ScriptFile { name, size: meta.len() })
        })
        .collect();
    files.sort_by_key(|f| f.name.to_lowercase());
    Ok(ExecutorStatus {
        no_prompt: task_for(&exe),
        found: exe.is_file(),
        running: !running(&exe).is_empty(),
        autoexec_dir: dir.map(|d| d.to_string_lossy().into_owned()),
        files,
        path,
    })
}

/// Starts the program from its folder; asks Windows for admin rights when it needs them.
fn start(exe: &Path) -> Result<()> {
    if !exe.is_file() {
        return Err(AppError::Invalid(tr!("The executor's program isn't there any more. Choose it again.")));
    }
    let dir = exe.parent().unwrap_or(Path::new("."));
    match std::process::Command::new(exe).current_dir(dir).spawn() {
        Ok(_) => Ok(()),
        // Set up to start without the prompt (the auto-reopen depends on it: nobody is there to answer).
        Err(e) if e.raw_os_error() == Some(NEEDS_ADMIN) && task_for(exe) => {
            log::info!("executor needs admin rights: starting it through its scheduled task");
            let out = std::process::Command::new("schtasks.exe").args(["/run", "/tn", TASK]).creation_flags(CREATE_NO_WINDOW).output()?;
            if out.status.success() {
                Ok(())
            } else {
                Err(AppError::Internal(tr!("Couldn't start the executor: {why}", why = String::from_utf8_lossy(&out.stderr).trim().to_owned())))
            }
        }
        Err(e) if e.raw_os_error() == Some(NEEDS_ADMIN) => {
            log::info!("executor needs admin rights: asking Windows");
            let quoted = exe.to_string_lossy().replace('\'', "''");
            let wd = dir.to_string_lossy().replace('\'', "''");
            std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", &format!("Start-Process -FilePath '{quoted}' -WorkingDirectory '{wd}' -Verb RunAs")])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(|_| ())
                .map_err(|e| AppError::Internal(tr!("Couldn't start the executor: {why}", why = e)))
        }
        Err(e) => Err(AppError::Internal(tr!("Couldn't start the executor: {why}", why = e))),
    }
}

/// The scheduled task exists and starts this program (its XML names it).
fn task_for(exe: &Path) -> bool {
    let Ok(out) = std::process::Command::new("schtasks.exe").args(["/query", "/tn", TASK, "/xml"]).creation_flags(CREATE_NO_WINDOW).output() else {
        return false;
    };
    // The XML comes as UTF-16 with a BOM, or as text.
    let text = match out.stdout.as_slice() {
        [0xFF, 0xFE, rest @ ..] => String::from_utf16_lossy(&rest.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>()),
        b => String::from_utf8_lossy(b).into_owned(),
    };
    out.status.success() && text.to_lowercase().contains(&exe.to_string_lossy().to_lowercase())
}

/// Standard base64 (for PowerShell's `-EncodedCommand`).
fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The PowerShell that registers `TASK` for `exe` (pure): this user, interactive, highest rights,
/// no time limit, one at a time.
fn task_script(exe: &Path, user: &str) -> String {
    let q = |s: &str| s.replace('\'', "''");
    let dir = exe.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    format!(
        "$ErrorActionPreference = 'Stop'\n\
         $a = New-ScheduledTaskAction -Execute '{exe}' -WorkingDirectory '{dir}'\n\
         $p = New-ScheduledTaskPrincipal -UserId '{user}' -LogonType Interactive -RunLevel Highest\n\
         $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew\n\
         Register-ScheduledTask -TaskName '{task}' -Action $a -Principal $p -Settings $s -Force | Out-Null\n",
        exe = q(&exe.to_string_lossy()),
        dir = q(&dir),
        user = q(user),
        task = q(TASK),
    )
}

fn stop(exe: &Path) {
    for p in running(exe) {
        if let Err(e) = process::close(p.pid, Some(p.start_time), true, Duration::from_secs(3)) {
            log::warn!("executor: closing {} failed: {e}", p.pid);
        }
    }
}

/// Opens it with MTwin Manager, and keeps it open (see the module docs).
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut first = true;
        let mut was_running = false;
        let mut last_start: Option<Instant> = None;
        loop {
            let s = app.state::<App>();
            if let Ok(v) = s.db.settings()
                && !v.executor_exe.trim().is_empty()
            {
                let exe = PathBuf::from(&v.executor_exe);
                let up = !running(&exe).is_empty();
                let recent = last_start.is_some_and(|t| t.elapsed() < Duration::from_secs(30));
                let want = (first && v.executor_auto_open) || (v.executor_keep_open && was_running);
                if !up && want && !recent && exe.is_file() {
                    log::info!("executor: starting it ({})", if first { "opened with MTwin Manager" } else { "it closed" });
                    match start(&exe) {
                        Ok(()) => last_start = Some(Instant::now()),
                        Err(e) => log::warn!("executor: {e}"),
                    }
                }
                was_running = up || (was_running && recent);
            }
            first = false;
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

// ---------- commands ----------

#[tauri::command(async)]
pub fn executor_status(s: State<'_, App>) -> Result<ExecutorStatus> {
    status(&s)
}

/// Starts it; `restart` closes a running one first. Running already (no restart): nothing to do.
#[tauri::command(async)]
pub fn executor_launch(s: State<'_, App>, restart: bool) -> Result<ExecutorStatus> {
    let exe = exe(&s)?;
    if restart {
        stop(&exe);
    } else if !running(&exe).is_empty() {
        return status(&s);
    }
    start(&exe)?;
    std::thread::sleep(Duration::from_millis(600));
    status(&s)
}

#[tauri::command(async)]
pub fn executor_script_read(s: State<'_, App>, name: String) -> Result<String> {
    let p = script_path(&s, &name)?;
    if std::fs::metadata(&p)?.len() > MAX_SCRIPT {
        return Err(AppError::Invalid(tr!("That script is over 1 MB.")));
    }
    Ok(String::from_utf8_lossy(&std::fs::read(p)?).into_owned())
}

/// Writes (or creates) a script in the autoexec folder.
#[tauri::command(async)]
pub fn executor_script_write(s: State<'_, App>, name: String, text: String) -> Result<ExecutorStatus> {
    if text.len() as u64 > MAX_SCRIPT {
        return Err(AppError::Invalid(tr!("That script is over 1 MB.")));
    }
    let p = script_path(&s, &name)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(p, text)?;
    status(&s)
}

/// Copies a script file the user picked into the autoexec folder (under its own name).
#[tauri::command(async)]
pub fn executor_script_add(s: State<'_, App>, from: String) -> Result<ExecutorStatus> {
    let from = PathBuf::from(from);
    let name = file_name(&from).unwrap_or_default();
    if std::fs::metadata(&from)?.len() > MAX_SCRIPT {
        return Err(AppError::Invalid(tr!("That script is over 1 MB.")));
    }
    let p = script_path(&s, &name)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::copy(&from, p)?;
    status(&s)
}

#[tauri::command(async)]
pub fn executor_script_delete(s: State<'_, App>, name: String) -> Result<ExecutorStatus> {
    match std::fs::remove_file(script_path(&s, &name)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
        _ => {}
    }
    status(&s)
}

/// Sets the executor up to start with admin rights without asking each time: a scheduled task for it,
/// made with one admin prompt now (Windows' own; it can't be answered for the user). Waits for it.
#[tauri::command(async)]
pub fn executor_task_setup(s: State<'_, App>) -> Result<ExecutorStatus> {
    let exe = exe(&s)?;
    let user = match (std::env::var("USERDOMAIN"), std::env::var("USERNAME")) {
        (Ok(d), Ok(u)) => format!("{d}\\{u}"),
        (_, Ok(u)) => u,
        _ => return Err(AppError::Internal("the Windows user name is unknown".into())),
    };
    let utf16: Vec<u8> = task_script(&exe, &user).encode_utf16().flat_map(u16::to_le_bytes).collect();
    let elevated = format!(
        "Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','{}'",
        base64(&utf16)
    );
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &elevated])
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;
    if !task_for(&exe) {
        let why = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        log::warn!("executor task setup failed: {why}");
        return Err(AppError::Invalid(tr!("It wasn't set up. Allow the admin prompt Windows shows to set it up.")));
    }
    log::info!("executor task set up for {}", exe.display());
    status(&s)
}

/// Opens the autoexec folder in Explorer (made if missing).
#[tauri::command(async)]
pub fn executor_folder_open(s: State<'_, App>) -> Result<()> {
    let dir = autoexec_dir(&exe(&s)?).ok_or_else(|| AppError::Invalid(tr!("Choose your executor's program first.")))?;
    std::fs::create_dir_all(&dir)?;
    std::process::Command::new("explorer.exe").arg(&dir).spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::script_name;

    #[test]
    fn base64_as_powershell_reads_it() {
        assert_eq!(super::base64(b""), "");
        assert_eq!(super::base64(b"f"), "Zg==");
        assert_eq!(super::base64(b"fo"), "Zm8=");
        assert_eq!(super::base64(b"foo"), "Zm9v");
        assert_eq!(super::base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn task_script_quotes_what_it_puts_in() {
        let s = super::task_script(std::path::Path::new(r"C:\Users\o'brien\Potassium\Potassium.exe"), r"PC\o'brien");
        assert!(s.contains(r"-Execute 'C:\Users\o''brien\Potassium\Potassium.exe'"), "{s}");
        assert!(s.contains("-RunLevel Highest") && s.contains(r"-UserId 'PC\o''brien'"), "{s}");
    }

    #[test]
    fn only_plain_script_names() {
        for ok in ["a.lua", "Auto Farm.luau", "x.TXT", "v1.2.lua"] {
            assert_eq!(script_name(ok), Some(ok), "{ok}");
        }
        for bad in ["", "a.exe", "../a.lua", "a/b.lua", "a\\b.lua", ".hidden.lua", "C:a.lua", "noext", "a..lua"] {
            assert_eq!(script_name(bad), None, "{bad}");
        }
    }
}
