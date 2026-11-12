//! Finding and starting the Roblox client (Windows).

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

use windows::Win32::System::Registry::{
    HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_SZ, RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW,
};
use windows::core::{HSTRING, PCWSTR};

use crate::error::{AppError, Result};
use crate::vault::Secret;

const PLAYER: &str = "RobloxPlayerBeta.exe";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ClientExe {
    pub path: PathBuf,
    /// The protocol handler is a bootstrapper (Bloxstrap, Fishstrap, ...), not RobloxPlayerBeta.exe.
    pub bootstrapper: bool,
    /// Words before and after the launch URI, as the program's `roblox-player` command line has
    /// them (`Bloxstrap.exe -player "%1"`: `["-player"]` before).
    pub pre: Vec<String>,
    pub post: Vec<String>,
}

/// The program chosen in Settings (`Settings.client_path`), used before anything `find` looks for.
static CUSTOM: std::sync::RwLock<Option<PathBuf>> = std::sync::RwLock::new(None);

/// Uses this program to launch (a bootstrapper or RobloxPlayerBeta.exe); "" goes back to finding one.
pub fn set_custom(path: &str) {
    let p = path.trim().trim_matches('"');
    *CUSTOM.write().unwrap_or_else(|e| e.into_inner()) = (!p.is_empty()).then(|| PathBuf::from(p));
}

fn custom() -> Option<PathBuf> {
    CUSTOM.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// A program to launch with: the words its `roblox-player` command line puts around the URI when
/// it is the handler; for another bootstrapper, `-player` before it (Bloxstrap's, which its forks
/// keep); none for RobloxPlayerBeta.exe.
fn client_exe(path: PathBuf) -> ClientExe {
    let bootstrapper = !is_player(&path);
    let (pre, post) = handler_lines()
        .find(|(exe, _)| exe.as_os_str().eq_ignore_ascii_case(path.as_os_str()))
        .map(|(_, line)| handler_args(&line))
        .unwrap_or_else(|| (if bootstrapper { vec!["-player".to_owned()] } else { Vec::new() }, Vec::new()));
    ClientExe { path, bootstrapper, pre, post }
}

/// Where Roblox records its install: per user (HKCU) or for all users (HKLM, 64- and 32-bit views).
const ENVIRONMENTS: [(HKEY, &str); 3] = [
    (HKEY_CURRENT_USER, r"Software\ROBLOX Corporation\Environments\roblox-player"),
    (HKEY_LOCAL_MACHINE, r"SOFTWARE\ROBLOX Corporation\Environments\roblox-player"),
    (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\ROBLOX Corporation\Environments\roblox-player"),
];

/// The first that exists of:
/// 1. Roblox's own `clientExe` (`ENVIRONMENTS`, quotes trimmed);
/// 2. the `roblox-player` protocol handler (`HKCU\Software\Classes\roblox-player\shell\open\command`,
///    then HKCR), parsed out of its command line (how a bootstrapper is found);
/// 3. `Versions\<version>\RobloxPlayerBeta.exe` from the registry's `version`;
/// 4. the newest `RobloxPlayerBeta.exe` under a `Roblox\Versions` folder (`%LOCALAPPDATA%`,
///    Program Files (x86), Program Files): the registry can still name a version folder Roblox
///    deleted when it updated itself.
///
/// `bootstrapper` = its file name isn't RobloxPlayerBeta.exe. Nothing found → `AppError::Invalid`.
pub fn find() -> Result<ClientExe> {
    if let Some(p) = custom() {
        if p.is_file() {
            return Ok(client_exe(p));
        }
        log::warn!("the client chosen in Settings ({}) doesn't exist; finding Roblox instead", p.display());
    }
    let own = ENVIRONMENTS.into_iter().filter_map(|(root, key)| reg_string(root, key, Some("clientExe")).map(unquote));
    let named = ENVIRONMENTS
        .into_iter()
        .filter_map(|(root, key)| reg_string(root, key, Some("version")))
        .flat_map(|v| versions_dirs().into_iter().map(move |d| d.join(&v).join(PLAYER)));
    // Automatic is Roblox's own client: a bootstrapper is used only when chosen in Settings, or
    // when Roblox itself isn't installed.
    let (own, named): (Vec<PathBuf>, Vec<PathBuf>) = (own.collect(), named.collect());
    let vanilla = |p: &&PathBuf| p.is_file() && is_player(p) && !in_bootstrapper_folder(p) && !in_store(p);
    if let Some(p) = own.iter().chain(&named).find(vanilla).cloned().or_else(|| newest(roblox_dirs().iter().flat_map(|d| players_in(d)).filter(|(p, _)| !in_store(p)))) {
        return Ok(client_exe(p));
    }
    let path = own
        .into_iter()
        .chain(handlers())
        .chain(named)
        .find(|p| p.is_file() && !in_store(p))
        .or_else(|| newest(versions_dirs().iter().flat_map(|d| players_in(d)).filter(|(p, _)| !in_store(p))));
    let path = path.ok_or_else(|| {
        log::warn!("no Roblox client: none in the registry (clientExe, roblox-player handler, version) or under {} (Store builds excluded)", versions_dirs().iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join("; "));
        AppError::Invalid(tr!(
            "Roblox isn't installed. Install it from roblox.com, then try again. (The Microsoft Store version can't be used: install the one from roblox.com.)"
        ))
    })?;
    Ok(client_exe(path))
}

/// The `roblox-player` protocol handlers' programs (HKCU, then HKCR). Roblox's own launcher or
/// installer there (older installs) stands for the RobloxPlayerBeta.exe beside it, so it is never
/// taken for a bootstrapper.
fn handlers() -> impl Iterator<Item = PathBuf> {
    handler_lines().map(|(h, _)| h).map(|h| {
        let player = h.with_file_name(PLAYER);
        if is_roblox_launcher(&h) && player.is_file() { player } else { h }
    })
}

/// Each `roblox-player` handler's program with its whole command line (HKCU, then HKCR).
fn handler_lines() -> impl Iterator<Item = (PathBuf, String)> {
    [
        (HKEY_CURRENT_USER, r"Software\Classes\roblox-player\shell\open\command"),
        (HKEY_CLASSES_ROOT, r"roblox-player\shell\open\command"),
    ]
    .into_iter()
    .filter_map(|(root, key)| reg_string(root, key, None))
    .filter_map(|line| Some((handler_exe(&line)?, line)))
}

/// The words a handler's command line puts before and after `%1` (pure): `"C:\B.exe" -player "%1"`
/// → `(["-player"], [])`. Quotes are dropped (the URI has no spaces); `%*` and the like go.
fn handler_args(line: &str) -> (Vec<String>, Vec<String>) {
    let line = line.trim();
    let rest = match line.strip_prefix('"') {
        Some(r) => r.split_once('"').map_or("", |(_, after)| after),
        None => match line.to_ascii_lowercase().find(".exe") {
            Some(i) => &line[i + 4..],
            None => line.split_once(char::is_whitespace).map_or("", |(_, after)| after),
        },
    };
    let mut words = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    for c in rest.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
            }
            c => word.push(c),
        }
    }
    if !word.is_empty() {
        words.push(word);
    }
    let (mut pre, mut post, mut seen) = (Vec::new(), Vec::new(), false);
    for w in words {
        if w == "%1" || w == "%L" || w == "%l" {
            seen = true;
        } else if !w.contains('%') {
            if seen { post.push(w) } else { pre.push(w) }
        }
    }
    (pre, post)
}

/// The program opening `roblox-player:` links now, for the log.
pub fn handler() -> Option<PathBuf> {
    handlers().find(|p| p.is_file())
}

/// RobloxPlayerLauncher.exe or RobloxPlayerInstaller.exe: Roblox's, not a bootstrapper (pure).
fn is_roblox_launcher(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|n| ["RobloxPlayerLauncher.exe", "RobloxPlayerInstaller.exe"].iter().any(|r| n.eq_ignore_ascii_case(r)))
}

/// The Microsoft Store build (under `WindowsApps`), which can't be started with a launch URI (pure).
fn in_store(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str().eq_ignore_ascii_case("WindowsApps"))
}

/// The `Versions` folders clients live in: Roblox's own (per user first), then every
/// bootstrapper's copy, whatever it is called: any `%LOCALAPPDATA%\<name>\Versions` (Bloxstrap,
/// Fishstrap, Froststrap, Voidstrap and the rest keep theirs there), and the one beside the
/// program chosen in Settings or opening `roblox-player:` links.
/// Roblox's own `Versions` folders (never a bootstrapper's).
fn roblox_dirs() -> Vec<PathBuf> {
    ["LOCALAPPDATA", "ProgramFiles(x86)", "ProgramFiles"].iter().filter_map(std::env::var_os).map(|d| PathBuf::from(d).join("Roblox").join("Versions")).filter(|d| d.is_dir()).collect()
}

pub(super) fn versions_dirs() -> Vec<PathBuf> {
    let roblox = ["LOCALAPPDATA", "ProgramFiles(x86)", "ProgramFiles"].iter().filter_map(std::env::var_os).map(|d| PathBuf::from(d).join("Roblox"));
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let strap = local
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flatten()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|d| !d.file_name().is_some_and(|n| n.eq_ignore_ascii_case("Roblox")) && d.join("Versions").is_dir());
    let beside = custom()
        .into_iter()
        .chain(handlers())
        .chain(bootstrappers().into_iter().map(|b| b.path))
        .filter(|p| !is_player(p))
        .filter_map(|p| p.parent().map(Path::to_path_buf));
    let mut out: Vec<PathBuf> = Vec::new();
    for d in roblox.chain(strap).chain(beside).map(|d| d.join("Versions")) {
        if !out.iter().any(|o| o.as_os_str().eq_ignore_ascii_case(d.as_os_str())) {
            out.push(d);
        }
    }
    out
}

/// The installed client of Roblox version `version` (`version-…`), whatever `find` picks: in the
/// usual `Versions` folders or beside the client `find` names (Roblox installed somewhere else).
pub fn installed_build(version: &str) -> Option<PathBuf> {
    let mut dirs = versions_dirs();
    dirs.extend(find().ok().and_then(|e| versions_dir_of(&e.path)));
    build_in(&dirs, version)
}

/// The `Versions` folder a `Versions\<version>\RobloxPlayerBeta.exe` sits in (pure).
pub(crate) fn versions_dir_of(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?.parent()?;
    dir.file_name()?.eq_ignore_ascii_case("Versions").then(|| dir.to_path_buf())
}

fn build_in(dirs: &[PathBuf], version: &str) -> Option<PathBuf> {
    dirs.iter().map(|d| d.join(version).join(PLAYER)).find(|p| p.is_file())
}

/// Every `<dir>\<version>\RobloxPlayerBeta.exe` with its last-write time.
fn players_in(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries
        .filter_map(|e| {
            let exe = e.ok()?.path().join(PLAYER);
            let modified = std::fs::metadata(&exe).ok()?.modified().ok()?;
            Some((exe, modified))
        })
        .collect()
}

/// The most recently written (pure).
fn newest(found: impl IntoIterator<Item = (PathBuf, SystemTime)>) -> Option<PathBuf> {
    found.into_iter().max_by_key(|(_, t)| *t).map(|(p, _)| p)
}

/// A registry path without the quotes some installs keep around it (pure).
fn unquote(s: String) -> PathBuf {
    PathBuf::from(s.trim().trim_matches('"'))
}

/// Starts the client with the URI as its first argument, then `extra` (`launcher::launch_args`),
/// all raw: no quoting, none contains spaces or quotes. In its own folder; the process handle
/// is closed at once (Roblox's anti-cheat has flagged long-held handles). Returns the PID and
/// its start time, read while our handle still reserves the PID (0: already gone). The URI
/// and the arguments are never logged.
pub fn start(exe: &ClientExe, uri: &Secret, extra: &[String]) -> Result<(u32, u64)> {
    let dir = exe.path.parent().ok_or_else(|| AppError::Internal(tr!("Roblox's folder is unknown.")))?;
    let mut cmd = Command::new(&exe.path);
    // A bootstrapper gets its own words around the URI (`-player`); then the user's extra ones.
    for a in &exe.pre {
        cmd.raw_arg(a);
    }
    cmd.raw_arg(uri.expose());
    for a in exe.post.iter().chain(extra) {
        cmd.raw_arg(a);
    }
    let child = cmd
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::Internal(tr!("Could not start Roblox: {why}", why = e)))?;
    let started = crate::instances::process::start_time(child.id()).unwrap_or_else(|| {
        log::warn!("Roblox client pid {} start time unreadable; tracking it without one", child.id());
        0
    });
    // Dropping the Child closes its process and thread handles; the process keeps running.
    Ok((child.id(), started))
}

/// The program of a `shell\open\command` line: `"C:\...\RobloxPlayerBeta.exe" %1`,
/// `"C:\...\Bloxstrap.exe" -player "%1"`, or unquoted up to `.exe`.
fn handler_exe(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    let exe = match command.strip_prefix('"') {
        Some(rest) => rest.split_once('"')?.0,
        None => match command.to_ascii_lowercase().find(".exe") {
            Some(i) => &command[..i + 4],
            None => command.split_whitespace().next().unwrap_or(""),
        },
    };
    (!exe.is_empty()).then(|| PathBuf::from(exe))
}

/// A bootstrapper owns this install, so Roblox's installer must not run over it: `exe` is a
/// bootstrapper, sits in a `Versions` folder that isn't Roblox's own (they set `clientExe` to
/// their own copy), or the `roblox-player` protocol handler isn't RobloxPlayerBeta.exe.
pub fn managed_by_bootstrapper(exe: &ClientExe) -> bool {
    let handler = handlers().find(|p| p.is_file());
    exe.bootstrapper || in_bootstrapper_folder(&exe.path) || handler.is_some_and(|h| !is_player(&h))
}

/// The Roblox release channel this PC is on; None for the normal one (or a name that can't be
/// one, it goes into a URL).
pub fn channel() -> Option<String> {
    let c = reg_string(HKEY_CURRENT_USER, r"SOFTWARE\ROBLOX Corporation\Environments\RobloxPlayer\Channel", Some("www.roblox.com"))?;
    let usable = !c.is_empty() && !c.eq_ignore_ascii_case("production") && !c.eq_ignore_ascii_case("live");
    (usable && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')).then_some(c)
}

/// The Roblox version in a bootstrapper's state file (pure): Bloxstrap's `PlayerState.json` has it
/// at the top, Fishstrap's `RobloxState.json` under `Player`.
fn state_version(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json.trim_start_matches('\u{feff}')).ok()?;
    let version = v.get("VersionGuid").or_else(|| v.get("Player")?.get("VersionGuid"))?;
    version.as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

/// The Roblox version the bootstrapper at `exe` has installed; None when `exe` isn't one or its
/// state can't be read.
pub fn bootstrapper_version(exe: &ClientExe) -> Option<String> {
    if !exe.bootstrapper {
        return None;
    }
    let dir = exe.path.parent()?;
    ["PlayerState.json", "RobloxState.json"].iter().find_map(|f| state_version(&std::fs::read_to_string(dir.join(f)).ok()?))
}

fn in_bootstrapper_folder(path: &Path) -> bool {
    let parts: Vec<_> = path.components().map(|c| c.as_os_str().to_os_string()).collect();
    parts.windows(2).any(|w| w[1].eq_ignore_ascii_case("Versions") && !w[0].eq_ignore_ascii_case("Roblox"))
}

fn is_player(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.eq_ignore_ascii_case(PLAYER))
}

/// A `REG_SZ` (or expanded `REG_EXPAND_SZ`) value; `None` names the key's default value.
pub(crate) fn reg_string(root: HKEY, key: &str, value: Option<&str>) -> Option<String> {
    let (key, value) = (HSTRING::from(key), value.map(HSTRING::from));
    let name = value.as_ref().map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr()));
    let mut len = 0u32;
    // SAFETY: `key` and `name` are live NUL-terminated strings; this call only writes `len`.
    unsafe { RegGetValueW(root, &key, name, RRF_RT_REG_SZ, None, None, Some(&mut len)) }.ok().ok()?;
    let mut buf = vec![0u16; (len as usize).div_ceil(2)];
    // SAFETY: `buf` holds at least `len` bytes, the most the call writes.
    unsafe { RegGetValueW(root, &key, name, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut len)) }
        .ok()
        .ok()?;
    buf.truncate(len as usize / 2);
    let s = String::from_utf16_lossy(&buf);
    Some(s.trim_end_matches('\0').to_owned()).filter(|s| !s.is_empty())
}

/// The names of a registry key's subkeys (none when it can't be opened).
fn subkeys(root: HKEY, key: &str) -> Vec<String> {
    let key = HSTRING::from(key);
    let mut h = HKEY::default();
    // SAFETY: `key` is a live NUL-terminated string; on success `h` is closed below.
    if unsafe { RegOpenKeyExW(root, &key, None, KEY_READ, &mut h) }.is_err() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 0.. {
        let mut name = [0u16; 256];
        let mut len = name.len() as u32;
        // SAFETY: `name` holds `len` UTF-16 units, the most the call writes.
        let found = unsafe { RegEnumKeyExW(h, i, Some(windows::core::PWSTR(name.as_mut_ptr())), &mut len, None, None, None, None) };
        if found.is_err() {
            break;
        }
        out.push(String::from_utf16_lossy(&name[..len as usize]));
    }
    // SAFETY: `h` was opened above and isn't used after this.
    let _ = unsafe { RegCloseKey(h) };
    out
}

/// A bootstrapper installed on this PC (`bootstrappers`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bootstrapper {
    pub name: String,
    pub path: PathBuf,
}

const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

/// Every bootstrapper installed for this user, found the way Bloxstrap and its forks (Fishstrap,
/// Froststrap, Voidstrap, ExploitStrap...) install themselves: an `Uninstall\<Name>` entry whose
/// `InstallLocation` holds `<Name>.exe` (or the program its `DisplayIcon` names) and a `Versions`
/// folder; then any `%LOCALAPPDATA%\<Name>\<Name>.exe` beside a `Versions` folder (portable or
/// older installs); then the `roblox-player` handler when it isn't Roblox's. Deduplicated by path.
pub fn bootstrappers() -> Vec<Bootstrapper> {
    let mut found: Vec<Bootstrapper> = Vec::new();
    let mut add = |name: String, path: PathBuf| {
        if path.is_file() && !is_player(&path) && !is_roblox_launcher(&path) && !found.iter().any(|b| b.path.as_os_str().eq_ignore_ascii_case(path.as_os_str())) {
            found.push(Bootstrapper { name, path });
        }
    };
    for name in subkeys(HKEY_CURRENT_USER, UNINSTALL) {
        let key = format!(r"{UNINSTALL}\{name}");
        let Some(location) = reg_string(HKEY_CURRENT_USER, &key, Some("InstallLocation")).map(unquote) else { continue };
        if !location.join("Versions").is_dir() && !name.to_ascii_lowercase().ends_with("strap") {
            continue;
        }
        let icon = reg_string(HKEY_CURRENT_USER, &key, Some("DisplayIcon")).map(|i| unquote(i.rsplit_once(',').map_or(i.clone(), |(p, _)| p.to_owned())));
        let exe = Some(location.join(format!("{name}.exe"))).filter(|p| p.is_file()).or(icon.filter(|p| p.is_file()));
        if let Some(exe) = exe {
            let shown = reg_string(HKEY_CURRENT_USER, &key, Some("DisplayName")).unwrap_or(name);
            add(shown, exe);
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        for dir in std::fs::read_dir(&local).into_iter().flatten().filter_map(|e| e.ok().map(|e| e.path())) {
            let Some(name) = dir.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
            if name.eq_ignore_ascii_case("Roblox") || !dir.join("Versions").is_dir() {
                continue;
            }
            add(name.clone(), dir.join(format!("{name}.exe")));
        }
    }
    if let Some(h) = handler().filter(|h| !is_player(h)) {
        let name = h.file_stem().map_or_else(|| "Bootstrapper".to_owned(), |n| n.to_string_lossy().into_owned());
        add(name, h);
    }
    found
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn handler_words() {
        assert_eq!(handler_args(r#""C:\B\Bloxstrap.exe" -player "%1""#), (vec!["-player".to_owned()], vec![]));
        assert_eq!(handler_args(r#"C:\Program Files\Fishstrap\Fishstrap.EXE -player %1"#), (vec!["-player".to_owned()], vec![]));
        assert_eq!(handler_args(r#""C:\R\RobloxPlayerBeta.exe" %1"#), (vec![], vec![]));
        assert_eq!(handler_args(r#""C:\X\Some Strap.exe" --launch "%1" --quiet %*"#), (vec!["--launch".to_owned()], vec!["--quiet".to_owned()]));
        assert_eq!(handler_args(r#""C:\X\strap.exe""#), (vec![], vec![]));
    }

    #[test]
    fn reads_a_bootstrappers_version() {
        assert_eq!(state_version(r#"{"VersionGuid":"version-abc"}"#).as_deref(), Some("version-abc"), "Bloxstrap");
        assert_eq!(state_version(r#"{"Player":{"VersionGuid":"version-abc"},"Studio":{}}"#).as_deref(), Some("version-abc"), "Fishstrap");
        assert_eq!(state_version(r#"{"VersionGuid":""}"#), None);
        assert_eq!(state_version("not json"), None);
    }
    #[test]
    fn handler_command_lines() {
        let exe = |c: &str| handler_exe(c).map(|p| p.to_string_lossy().into_owned());
        let roblox = r"C:\Users\you\AppData\Local\Roblox\Versions\version-9ac8595712b447a7\RobloxPlayerBeta.exe";
        assert_eq!(exe(&format!("\"{roblox}\" %1")).as_deref(), Some(roblox));
        let bloxstrap = r"C:\Users\you\AppData\Local\Bloxstrap\Bloxstrap.exe";
        assert_eq!(exe(&format!("  \"{bloxstrap}\" -player \"%1\"")).as_deref(), Some(bloxstrap));
        let fishstrap = r"C:\Program Files\Fishstrap\Fishstrap.EXE";
        assert_eq!(exe(&format!("{fishstrap} -player %1")).as_deref(), Some(fishstrap));
        assert_eq!(exe(r"C:\x\launcher %1").as_deref(), Some(r"C:\x\launcher"));
        for bad in ["", "   ", "\"", "\"\" %1", "\"C:\\no-closing-quote.exe %1"] {
            assert_eq!(exe(bad), None, "{bad}");
        }

        assert!(is_player(Path::new(roblox)) && is_player(Path::new(r"D:\robloxplayerbeta.EXE")));
        assert!(!is_player(Path::new(bloxstrap)) && !is_player(Path::new(r"C:\RobloxPlayerInstaller.exe")));

        assert!(in_bootstrapper_folder(Path::new(r"C:\Users\you\AppData\Local\Bloxstrap\Versions\version-9ac8595712b447a7\RobloxPlayerBeta.exe")));
        assert!(in_bootstrapper_folder(Path::new(r"D:\FISHSTRAP\Versions\x\RobloxPlayerBeta.exe")));
        assert!(in_bootstrapper_folder(Path::new(r"C:\Users\you\AppData\Local\Froststrap\Versions\x\RobloxPlayerBeta.exe")));
        assert!(in_bootstrapper_folder(Path::new(r"C:\Users\you\AppData\Local\Voidstrap\Versions\x\RobloxPlayerBeta.exe")));
        assert!(!in_bootstrapper_folder(Path::new(roblox)));
        assert!(in_bootstrapper_folder(Path::new(r"C:\Users\you\AppData\Local\SomeNewStrap\Versions\x\RobloxPlayerBeta.exe")), "any bootstrapper's copy");
        assert!(!in_bootstrapper_folder(Path::new(r"C:\Program Files (x86)\Roblox\Versions\x\RobloxPlayerBeta.exe")));
    }

    #[test]
    fn picks_the_newest_client_and_trims_quotes() {
        let t = |s: u64| SystemTime::UNIX_EPOCH + Duration::from_secs(s);
        let found = vec![(PathBuf::from("old"), t(10)), (PathBuf::from("new"), t(30)), (PathBuf::from("mid"), t(20))];
        assert_eq!(newest(found), Some(PathBuf::from("new")));
        assert_eq!(newest(Vec::new()), None);
        let exe = r"C:\R\RobloxPlayerBeta.exe";
        assert_eq!(unquote(format!(" \"{exe}\" ")), PathBuf::from(exe));
        assert_eq!(unquote(exe.into()), PathBuf::from(exe));

        assert!(is_roblox_launcher(Path::new(r"C:\R\Versions\v\RobloxPlayerLauncher.exe")));
        assert!(is_roblox_launcher(Path::new(r"C:\R\Versions\v\robloxplayerinstaller.EXE")));
        assert!(!is_roblox_launcher(Path::new(r"C:\B\Bloxstrap.exe")) && !is_roblox_launcher(Path::new(exe)));
        assert!(in_store(Path::new(r"C:\Program Files\WindowsApps\ROBLOXCORPORATION.ROBLOX_2.6_x64\Windows10Universal.exe")));
        assert!(!in_store(Path::new(exe)));
    }

    #[test]
    fn finds_clients_in_a_versions_folder() {
        let dir = std::env::temp_dir().join(format!("roalt-test-{}", uuid::Uuid::new_v4()));
        for v in ["version-a", "version-b", "not-a-client"] {
            std::fs::create_dir_all(dir.join(v)).unwrap();
        }
        std::fs::write(dir.join("version-a").join(PLAYER), b"").unwrap();
        std::thread::sleep(Duration::from_millis(50));
        std::fs::write(dir.join("version-b").join(PLAYER), b"").unwrap();
        let found = players_in(&dir);
        let dirs = [dir.join("missing"), dir.clone()];
        let (a, none) = (build_in(&dirs, "version-a"), build_in(&dirs, "not-a-client"));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(found.len(), 2, "the folder without a client is skipped");
        assert_eq!(newest(found), Some(dir.join("version-b").join(PLAYER)));
        assert!(players_in(&dir.join("missing")).is_empty());
        assert_eq!(a, Some(dir.join("version-a").join(PLAYER)));
        assert_eq!(none, None);
    }

    #[test]
    fn missing_registry_values_are_none() {
        assert_eq!(reg_string(HKEY_CURRENT_USER, r"Software\RoALT-test-no-such-key", None), None);
        assert_eq!(reg_string(HKEY_CURRENT_USER, r"Software\Classes", Some("RoALT-test-no-such-value")), None);
    }

    /// `start` on a harmless system program (never the Roblox client): the raw argument
    /// reaches it untouched, quotes and all, it runs in its own folder, and a PID comes back.
    #[test]
    fn start_passes_the_raw_argument_in_the_exe_folder() {
        let system = std::env::var_os("SystemRoot").map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from);
        let exe = ClientExe { path: system.join(r"System32\cmd.exe"), bootstrapper: true, ..Default::default() };
        let out = std::env::temp_dir().join(format!("roalt-test-{}.txt", uuid::Uuid::new_v4()));
        // Kept alive a second so its start time is read before it exits. The extra arguments
        // follow the first one, space-separated.
        let arg = Secret::new(format!("/c cd > \"{}\" & ping -n", out.display()));

        let (pid, started) = start(&exe, &arg, &["2".into(), "127.0.0.1".into(), ">nul".into()]).unwrap();
        assert!(pid > 0 && started > 0);
        let deadline = Instant::now() + Duration::from_secs(10);
        let written = loop {
            match std::fs::read_to_string(&out) {
                Ok(s) if s.ends_with('\n') => break s,
                _ if Instant::now() > deadline => panic!("cmd.exe never wrote {}", out.display()),
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        };
        let _ = std::fs::remove_file(&out);
        assert!(written.trim().eq_ignore_ascii_case(&system.join("System32").to_string_lossy()), "{written}");

        let missing = ClientExe { path: system.join(r"System32\roalt-no-such.exe"), bootstrapper: false, ..Default::default() };
        assert!(matches!(start(&missing, &arg, &[]), Err(AppError::Internal(_))));
    }
}
