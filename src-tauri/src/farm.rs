//! Farming: accounts marked Farming or Done (`FarmState`), and what happens around them.
//!
//! - `sweep`: a Farming account whose cookie stopped working (`Settings.replace_dead`) or that
//!   Roblox wants a human check from (`replace_challenged`) is taken off the farm, and a spare
//!   takes its place: signed in, not farming or done, not MAIN, no client. The spare is launched
//!   into the game the dead account last played, when one is known.
//! - `on_level`: the Progress script reports a level; a Farming account at or over
//!   `Settings.farm_done_level` is marked Done (`farm_done_at`).
//! - `set`: by hand, from Accounts; Done closes the account's clients when `close_when_done`.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::App;
use crate::error::Result;
use crate::model::{AccountPatch, AccountStatus, AccountSummary, FarmState, InstanceState, LaunchTarget};

/// One sweep at a time: two would pick the same spare.
static SWEEPING: Mutex<()> = Mutex::new(());

fn changed(app: &AppHandle) {
    let _ = app.emit("accounts://changed", ());
}

fn name(a: &AccountSummary) -> String {
    crate::launcher::bulk::name_of(a)
}

/// Sets `ids` to `state`; Done closes their clients when the setting says so.
pub async fn set(app: &AppHandle, ids: &[i64], state: FarmState) -> Result<()> {
    let s = app.state::<App>();
    for &id in ids {
        s.db.update_account(id, &AccountPatch { farm: Some(state), ..Default::default() })?;
    }
    changed(app);
    if state == FarmState::Done && s.db.settings()?.close_when_done {
        close_clients(app, ids).await;
    }
    Ok(())
}

/// Ends every live client of these accounts (gracefully).
async fn close_clients(app: &AppHandle, ids: &[i64]) {
    let s = app.state::<App>();
    let targets: Vec<(u32, Option<u64>)> = s
        .tracker
        .list()
        .into_iter()
        .filter(|i| ids.contains(&i.account_id) && i.state != InstanceState::Exited)
        .filter_map(|i| {
            s.tracker.end_relaunch(&i.id);
            s.tracker.mark_closing(&i.id)
        })
        .collect();
    if targets.is_empty() {
        return;
    }
    log::info!("farm: closing {} client(s) of accounts marked done", targets.len());
    if let Err(e) = crate::commands::close_all(targets, false, crate::commands::grace(&s)).await {
        log::warn!("farm: closing done clients failed: {e}");
    }
}

/// Needs replacing under these settings (pure).
fn dead(a: &AccountSummary, replace_dead: bool, replace_challenged: bool) -> bool {
    a.farm == FarmState::Farming
        && match a.status {
            AccountStatus::Invalid => replace_dead,
            AccountStatus::Challenged => replace_challenged,
            _ => false,
        }
}

/// The spare to farm next: the first in the list order that is signed in, not farming or done,
/// not MAIN, without a client (pure).
fn spare<'a>(accounts: &'a [AccountSummary], running: &dyn Fn(i64) -> bool) -> Option<&'a AccountSummary> {
    accounts.iter().find(|a| a.status == AccountStatus::Valid && a.farm == FarmState::None && !a.main && !running(a.id))
}

/// Replaces every farming account that died (see the module docs). Runs in the background.
pub fn sweep(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_sweep(&app).await {
            log::warn!("farm: replacing accounts failed: {e}");
        }
    });
}

async fn run_sweep(app: &AppHandle) -> Result<()> {
    let s = app.state::<App>();
    let v = s.db.settings()?;
    if !v.replace_dead && !v.replace_challenged {
        return Ok(());
    }
    let mut launches = Vec::new();
    {
        let Ok(_one) = SWEEPING.try_lock() else { return Ok(()) };
        let accounts = s.db.accounts()?;
        let clients = s.tracker.list();
        let mut taken: Vec<i64> = Vec::new();
        for gone in accounts.iter().filter(|a| dead(a, v.replace_dead, v.replace_challenged)) {
            s.db.update_account(gone.id, &AccountPatch { farm: Some(FarmState::None), ..Default::default() })?;
            let running = |id: i64| taken.contains(&id) || s.tracker.has_live_client(id);
            let Some(next) = spare(&accounts, &running) else {
                crate::commands::notice(app, true, tr!("{name} stopped working and was taken off the farm. No spare account is left to replace it.", name = name(gone)));
                continue;
            };
            taken.push(next.id);
            s.db.update_account(next.id, &AccountPatch { farm: Some(FarmState::Farming), ..Default::default() })?;
            log::info!("farm: account {} replaced by {}", gone.id, next.id);
            crate::commands::notice(app, false, tr!("{old} stopped working: {new} farms in its place.", old = name(gone), new = name(next)));
            // Its last game, from its newest client.
            let place = clients.iter().filter(|i| i.account_id == gone.id).max_by_key(|i| i.started_at).and_then(|i| i.place_id);
            if let Some(place_id) = place {
                launches.push((next.id, place_id));
            }
        }
        changed(app);
    }
    for (id, place_id) in launches {
        let target = LaunchTarget::Place { place_id, launch_data: None };
        if let Err(e) = crate::commands::launch_tracked(app, &s, id, target, None, None, None, true).await {
            log::warn!("farm: launching the spare {id} failed: {e}");
            crate::commands::notice(app, true, e.message());
        }
    }
    Ok(())
}

/// The Progress script reported `level` for `user_id`.
pub fn on_level(app: &AppHandle, user_id: i64, level: f64) {
    let s = app.state::<App>();
    let Ok(v) = s.db.settings() else { return };
    if !v.farm_done_at || level < f64::from(v.farm_done_level) {
        return;
    }
    let Ok(accounts) = s.db.accounts() else { return };
    let ids: Vec<i64> = accounts.iter().filter(|a| a.user_id == user_id && a.farm == FarmState::Farming).map(|a| a.id).collect();
    if ids.is_empty() {
        return;
    }
    if let Some(a) = accounts.iter().find(|a| a.id == ids[0]) {
        log::info!("farm: account {} reached level {level}: done", a.id);
        crate::commands::notice(app, false, tr!("{name} reached level {level}: farming done.", name = name(a), level = level));
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = set(&app, &ids, FarmState::Done).await {
            log::warn!("farm: marking done failed: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc(id: i64, status: AccountStatus, farm: FarmState, main: bool) -> AccountSummary {
        AccountSummary {
            id,
            user_id: id,
            username: format!("u{id}"),
            display_name: String::new(),
            alias: String::new(),
            notes: String::new(),
            color: None,
            favourite: false,
            sort_order: id,
            group_ids: Vec::new(),
            status,
            status_checked_at: None,
            created_at: 0,
            allow_disconnect: false,
            launch_args: None,
            discord_muted: false,
            fps_cap: None,
            full_quality: false,
            main,
            custom_flags: Default::default(),
            farm,
        }
    }

    #[test]
    fn only_farming_accounts_die_and_only_as_set() {
        use AccountStatus::*;
        let f = FarmState::Farming;
        assert!(dead(&acc(1, Invalid, f, false), true, false));
        assert!(!dead(&acc(1, Invalid, f, false), false, true));
        assert!(dead(&acc(1, Challenged, f, false), false, true));
        assert!(!dead(&acc(1, Valid, f, false), true, true));
        assert!(!dead(&acc(1, Invalid, FarmState::None, false), true, true));
        assert!(!dead(&acc(1, Invalid, FarmState::Done, false), true, true));
    }

    #[test]
    fn the_spare_is_the_first_free_signed_in_account() {
        use AccountStatus::*;
        let list = [
            acc(1, Valid, FarmState::None, true),
            acc(2, Invalid, FarmState::None, false),
            acc(3, Valid, FarmState::Done, false),
            acc(4, Valid, FarmState::Farming, false),
            acc(5, Valid, FarmState::None, false),
            acc(6, Valid, FarmState::None, false),
        ];
        assert_eq!(spare(&list, &|_| false).map(|a| a.id), Some(5));
        assert_eq!(spare(&list, &|id| id == 5).map(|a| a.id), Some(6));
        assert_eq!(spare(&list, &|_| true).map(|a| a.id), None);
    }

    #[test]
    fn farm_state_round_trips() {
        for f in [FarmState::None, FarmState::Farming, FarmState::Done] {
            assert_eq!(FarmState::parse(f.as_str()), f);
        }
    }
}
