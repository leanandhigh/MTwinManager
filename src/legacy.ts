// What the app's data was called by the versions made before the rename to MTwin Manager, all in
// one place. Only ever read, so data those versions made still opens; nothing new uses these names.
export const LEGACY = {
  /** localStorage key prefix (migrateStorage moves these keys to "mtwin."). */
  storagePrefix: "roalt.",
  /** Performance share code prefix. */
  perfCode: "RoALT-PERF:",
  /** Backup file extension. */
  backupExt: "roalt",
} as const;
