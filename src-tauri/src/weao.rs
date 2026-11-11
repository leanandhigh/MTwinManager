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
    let http = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .https_only(true)
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .build();
    let mut out = RobloxVersions { installed, checked_at: crate::commands::now_ms(), ..Default::default() };
    let http = match http {
        Ok(h) => h,
        Err(e) => {
            out.error = Some(format!("HTTP client unavailable: {e}"));
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
}
