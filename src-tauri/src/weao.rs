//! Roblox's versions across platforms, from WhatExpsAre.Online (WEAO): the current (LIVE),
//! future (deployed but not live yet) and past Windows and Mac builds, and the current Android
//! and iOS ones. `GET https://<host>/api/versions/{current,future,past}` with the user agent
//! `WEAO-3PService`, which WEAO requires; its domains are tried in turn. Answers are cached for a
//! minute, so the Roblox updates view can't hit WEAO's rate limit however often it asks.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

/// WEAO's domains, main first.
const HOSTS: [&str; 4] = ["weao.xyz", "whatexpsare.online", "weao.gg", "whatexploitsaretra.sh"];
const USER_AGENT: &str = "WEAO-3PService";
const CACHE: Duration = Duration::from_secs(60);

/// One platform's build and when Roblox put it out (WEAO's wording, e.g. "9/17/2025, 8:57:32 PM UTC").
#[derive(Serialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlatformVersion {
    pub version: String,
    pub date: Option<String>,
}

/// One of WEAO's lists: what it knows per platform (missing: not in that list).
#[derive(Serialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VersionSet {
    pub windows: Option<PlatformVersion>,
    pub mac: Option<PlatformVersion>,
    pub android: Option<PlatformVersion>,
    pub ios: Option<PlatformVersion>,
}

/// What the Roblox updates view shows.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RobloxVersions {
    /// LIVE now.
    pub current: Option<VersionSet>,
    /// Deployed, not live yet: what Roblox may update to next (Windows and Mac).
    pub future: Option<VersionSet>,
    /// The build before the current one (Windows and Mac), for downgrading.
    pub past: Option<VersionSet>,
    /// The Windows build installed here (Roblox's own, or a bootstrapper's).
    pub installed: Option<String>,
    /// Unix ms, when WEAO answered.
    pub checked_at: i64,
    /// Why a list is missing (WEAO unreachable or rate limiting), in English as WEAO's own text is.
    pub error: Option<String>,
}

static CACHED: Mutex<Option<(Instant, RobloxVersions)>> = Mutex::new(None);

/// One executor as WEAO lists it (`/api/status/exploits`): what Settings' picker and the Roblox
/// updates view show, and the Roblox build it works with (`rbx_version`), which Roblox is kept on
/// while it is the chosen one (`launcher::update::target_version`).
#[derive(Serialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Executor {
    pub title: String,
    pub version: String,
    pub updated_date: Option<String>,
    /// The Roblox build (`version-…`) it supports.
    pub rbx_version: Option<String>,
    /// Updated for the current Roblox.
    pub updated: bool,
    /// Detected by Hyperion.
    pub detected: bool,
    pub free: bool,
    /// WEAO's type: wexecutor, wexternal, mexecutor...
    pub kind: String,
    pub platform: String,
    pub sunc: Option<f64>,
    pub unc: Option<f64>,
    pub decompiler: Option<bool>,
    pub multi_inject: Option<bool>,
    pub keysystem: Option<bool>,
    pub cost: Option<String>,
    pub website: Option<String>,
    pub discord: Option<String>,
}

/// WEAO's executors, cached for 5 minutes (Settings and the launcher ask often).
static EXECUTORS: Mutex<Option<(Instant, Vec<Executor>)>> = Mutex::new(None);
const EXECUTORS_FOR: Duration = Duration::from_secs(5 * 60);

fn text(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
}

/// The listed, Windows executors from WEAO's answer (pure), in WEAO's order.
fn parse_executors(v: &Value) -> Vec<Executor> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter(|e| !e["hidden"].as_bool().unwrap_or(false))
        .filter_map(|e| {
            let title = text(e, "title")?;
            Some(Executor {
                version: text(e, "version").unwrap_or_default(),
                updated_date: text(e, "updatedDate"),
                rbx_version: text(e, "rbxversion").filter(|r| r.starts_with("version-")),
                updated: e["updateStatus"].as_bool().unwrap_or(false),
                detected: e["detected"].as_bool().unwrap_or(false),
                free: e["free"].as_bool().unwrap_or(false),
                kind: text(e, "extype").or_else(|| text(e, "type")).unwrap_or_default(),
                platform: text(e, "platform").unwrap_or_default(),
                sunc: e["suncPercentage"].as_f64(),
                unc: e["uncPercentage"].as_f64(),
                decompiler: e["decompiler"].as_bool(),
                multi_inject: e["multiInject"].as_bool(),
                keysystem: e["keysystem"].as_bool(),
                cost: text(e, "cost"),
                website: text(e, "websitelink"),
                discord: text(e, "discordlink"),
                title,
            })
        })
        .filter(|e| e.platform.eq_ignore_ascii_case("windows") || e.kind.starts_with('w'))
        .collect()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .https_only(true)
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client unavailable: {e}"))
}

/// WEAO's executors (cached 5 min unless `refresh`); Err with why when none could be read.
pub async fn executors(refresh: bool) -> Result<Vec<Executor>, String> {
    if !refresh && let Some((at, list)) = EXECUTORS.lock().unwrap_or_else(|e| e.into_inner()).clone() && at.elapsed() < EXECUTORS_FOR {
        return Ok(list);
    }
    let http = client()?;
    let mut last = String::from("WEAO didn't answer");
    for host in HOSTS {
        match http.get(format!("https://{host}/api/status/exploits")).send().await {
            Ok(r) if r.status().as_u16() == 429 => last = format!("WEAO is rate limiting ({host})"),
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(v) => {
                    let list = parse_executors(&v);
                    if list.is_empty() {
                        last = format!("WEAO listed no executors ({host})");
                        continue;
                    }
                    *EXECUTORS.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), list.clone()));
                    return Ok(list);
                }
                Err(e) => last = format!("WEAO's answer was unreadable ({host}): {}", e.without_url()),
            },
            Ok(r) => last = format!("WEAO answered HTTP {} ({host})", r.status().as_u16()),
            Err(e) => last = format!("WEAO unreachable ({host}): {}", e.without_url()),
        }
    }
    // An old list beats none: the executor's Roblox version rarely changes within the hour.
    if let Some((_, list)) = EXECUTORS.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        log::info!("executors: {last}; using the last list");
        return Ok(list);
    }
    Err(last)
}

/// The Roblox build `name` (WEAO's title, any case) supports, when WEAO lists it with one.
pub async fn executor_rbx_version(name: &str) -> Option<String> {
    let list = executors(false).await.inspect_err(|e| log::info!("executor {name}: {e}")).ok()?;
    list.into_iter().find(|e| e.title.eq_ignore_ascii_case(name)).and_then(|e| e.rbx_version)
}

#[tauri::command]
pub async fn executors_list(refresh: bool) -> crate::error::Result<Vec<Executor>> {
    executors(refresh).await.map_err(crate::error::AppError::Network)
}

fn platform(v: &Value, key: &str) -> Option<PlatformVersion> {
    let version = v[key].as_str().map(str::trim).filter(|s| !s.is_empty())?.to_owned();
    let date = v[format!("{key}Date")].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
    Some(PlatformVersion { version, date })
}

/// One list from WEAO's answer (pure).
fn parse(v: &Value) -> Option<VersionSet> {
    let set = VersionSet { windows: platform(v, "Windows"), mac: platform(v, "Mac"), android: platform(v, "Android"), ios: platform(v, "iOS") };
    (set != VersionSet::default()).then_some(set)
}

async fn fetch(http: &reqwest::Client, route: &str) -> Result<VersionSet, String> {
    let mut last = String::from("WEAO didn't answer");
    for host in HOSTS {
        let url = format!("https://{host}/api/versions/{route}");
        match http.get(&url).send().await {
            Ok(r) if r.status().as_u16() == 429 => last = format!("WEAO is rate limiting ({host})"),
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(v) => return parse(&v).ok_or_else(|| format!("WEAO's {route} list was empty")),
                Err(e) => last = format!("WEAO's answer was unreadable ({host}): {}", e.without_url()),
            },
            Ok(r) => last = format!("WEAO answered HTTP {} ({host})", r.status().as_u16()),
            Err(e) => last = format!("WEAO unreachable ({host}): {}", e.without_url()),
        }
    }
    Err(last)
}

/// The three lists (cached a minute unless `refresh`), with the build installed here.
pub async fn versions(refresh: bool) -> RobloxVersions {
    if !refresh && let Some((at, v)) = CACHED.lock().unwrap_or_else(|e| e.into_inner()).clone() && at.elapsed() < CACHE {
        return v;
    }
    let installed = tauri::async_runtime::spawn_blocking(installed).await.ok().flatten();
    let mut out = RobloxVersions { installed, checked_at: crate::commands::now_ms(), ..Default::default() };
    let http = match client() {
        Ok(h) => h,
        Err(e) => {
            out.error = Some(e);
            return out;
        }
    };
    let (current, future, past) = tokio::join!(fetch(&http, "current"), fetch(&http, "future"), fetch(&http, "past"));
    let mut errors = Vec::new();
    for (slot, got) in [(&mut out.current, current), (&mut out.future, future), (&mut out.past, past)] {
        match got {
            Ok(set) => *slot = Some(set),
            Err(e) => errors.push(e),
        }
    }
    errors.dedup();
    out.error = (!errors.is_empty()).then(|| errors.join("; "));
    if out.error.is_some() {
        log::info!("roblox versions: {}", out.error.as_deref().unwrap_or_default());
    }
    *CACHED.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), out.clone()));
    out
}

/// The Windows build Roblox (or the bootstrapper) has installed here.
fn installed() -> Option<String> {
    let exe = crate::launcher::client::find().ok()?;
    if exe.bootstrapper {
        crate::launcher::client::bootstrapper_version(&exe)
    } else {
        crate::launcher::update::installed_version(&exe.path)
    }
}

#[tauri::command]
pub async fn roblox_versions(refresh: bool) -> RobloxVersions {
    versions(refresh).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_weao() {
        let current = json!({
            "Windows": "version-31fc142272764f02", "WindowsDate": "9/17/2025, 8:57:32 PM UTC", "WindowsResponse": {},
            "Mac": "version-3360cc788ced462d", "MacDate": "9/17/2025, 8:57:32 PM UTC",
            "Android": "2.690.721", "AndroidDate": "9/21/2025, 6:46:57 PM UTC",
            "iOS": "2.690.721", "iOSDate": "9/12/2025, 4:59:14 PM UTC"
        });
        let set = parse(&current).unwrap();
        assert_eq!(set.windows, Some(PlatformVersion { version: "version-31fc142272764f02".into(), date: Some("9/17/2025, 8:57:32 PM UTC".into()) }));
        assert_eq!(set.ios.unwrap().version, "2.690.721");
        let future = parse(&json!({ "Windows": "version-2a06298afe3947ab", "Mac": "version-774691dc93a947ef" })).unwrap();
        assert_eq!((future.android, future.windows.unwrap().date), (None, None));
        assert_eq!(parse(&json!({ "error": "rate limited" })), None);
    }

    #[test]
    fn reads_executors() {
        let list = json!([
            { "title": "Potassium", "version": "1.7.9", "updatedDate": "07/24/2025 at 3:47 PM UTC", "free": false, "detected": true,
              "rbxversion": "version-2a06298afe3947ab", "updateStatus": true, "platform": "Windows", "extype": "wexecutor",
              "suncPercentage": 100, "uncPercentage": 99, "decompiler": true, "multiInject": true, "cost": "$20 Lifetime" },
            { "title": "Macsploit", "platform": "Mac", "extype": "mexecutor", "rbxversion": "version-774691dc93a947ef" },
            { "title": "Hidden one", "platform": "Windows", "hidden": true },
            { "title": "Xeno", "free": true, "rbxversion": "", "platform": "Windows", "extype": "wexecutor", "keysystem": true }
        ]);
        let got = parse_executors(&list);
        assert_eq!(got.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["Potassium", "Xeno"], "Windows only, hidden ones left out");
        assert_eq!(got[0].rbx_version.as_deref(), Some("version-2a06298afe3947ab"));
        assert_eq!((got[0].sunc, got[0].multi_inject, got[0].updated), (Some(100.0), Some(true), true));
        assert_eq!((got[1].rbx_version.as_deref(), got[1].keysystem), (None, Some(true)), "no Roblox version without one");
    }
}
