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
        return Ok(ExecutorStatus { path, found: false, running: false, autoexec_dir: None, files: Vec::new() });
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
    fn only_plain_script_names() {
        for ok in ["a.lua", "Auto Farm.luau", "x.TXT", "v1.2.lua"] {
            assert_eq!(script_name(ok), Some(ok), "{ok}");
        }
        for bad in ["", "a.exe", "../a.lua", "a/b.lua", "a\\b.lua", ".hidden.lua", "C:a.lua", "noext", "a..lua"] {
            assert_eq!(script_name(bad), None, "{bad}");
        }
    }
}
