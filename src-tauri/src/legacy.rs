//! What MTwin Manager's data was called by the versions made before the rename, all in one place.
//! Only ever read: data those versions saved still opens, and anything they left behind is still
//! found and cleaned up. Nothing new is written under these names.

/// The data folder's name (`%LOCALAPPDATA%\<DIR>`), moved to the new one once.
pub const DIR: &str = "RoALT";
/// The database files, in `crate::DB_FILES`' order: renamed to the new names once.
pub const DB_FILES: [&str; 4] = ["roalt.db", "roalt.db-wal", "roalt.db-shm", "roalt.db.key"];
/// DPAPI entropy of the database key file (`storage::cipher`).
pub const DB_ENTROPY: &[u8] = b"RoALT/db/v1";
/// DPAPI entropy of the vault's wrapped keys (`vault::dpapi`).
pub const VAULT_ENTROPY: &[u8] = b"RoALT/vault/v1";
/// First 8 bytes of a password-protected backup file.
pub const BACKUP_MAGIC: &[u8; 8] = b"ROALTBK1";
/// `format` of a performance settings file.
pub const PERFORMANCE_FORMAT: &str = "roalt-performance";
/// Roblox's own settings file, as saved before the FPS cap changed it.
pub const FLAGS_SAVED: &str = "ClientAppSettings.json.roalt-before";
/// Cookie export files.
pub const COOKIE_EXPORT_PREFIX: &str = "RoALT-cookies-";
/// The Windows QoS policy for the bandwidth limit.
pub const QOS_POLICY: &str = "RoALT-Roblox";
/// The mark in a WebView profile whose window is open.
pub const OPEN_MARK: &str = ".roalt-open";

/// Every AAD now starts `mtwin.`; it started `roalt.` before. The old form of `aad`, if it has one.
pub fn aad(aad: &[u8]) -> Option<Vec<u8>> {
    aad.strip_prefix(b"mtwin.").map(|rest| [b"roalt.".as_slice(), rest].concat())
}

#[cfg(test)]
mod tests {
    #[test]
    fn aad_maps_the_prefix_only() {
        assert_eq!(super::aad(b"mtwin.cookie:1").as_deref(), Some(b"roalt.cookie:1".as_slice()));
        assert_eq!(super::aad(b"other"), None);
    }
}
