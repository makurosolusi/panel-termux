// Contract of the backup API under /api/panel/backups and /api/dev/backup (PLAN/04 §3.1). Dates are ISO-8601 strings.
// Fields marked "0.3.0" are optional until their producers land; they become required in W7 (schedule §1.4).

/** What started a run. */
export type BackupTrigger = "schedule" | "manual";

/** Run outcome; `partial` = at least one item failed and at least one succeeded. */
export type BackupRunStatus = "running" | "succeeded" | "failed" | "partial";

/** What one uploaded object holds. `checksums` = sha256sum file; `manifest` = run index (uploaded last). */
export type BackupItemKind =
  | "database"
  | "globals"
  | "panel"
  | "sites"
  | "cloudflared"
  | "secrets"
  | "checksums"
  | "manifest";

/** Why an item failed. */
export type BackupItemErrorCode =
  | "produce_failed"
  | "check_failed"
  | "too_large"
  | "insufficient_space"
  | "upload_failed"
  | "upload_mismatch"
  | "key_mismatch";

/** Non-fatal note on an ok item. */
export type BackupItemWarning = "file_changed" | "outside_sites_dir" | "retention_denied";

/** One uploaded (or failed) object of a run. */
export type BackupItem = {
  kind: BackupItemKind;
  name: string;
  key: string;
  sizeBytes: number | null;
  ok: boolean;
  /** Short masked technical detail, shown under the Indonesian message. */
  error: string | null;
  /** 0.3.0 */
  errorCode?: BackupItemErrorCode | null;
  /** 0.3.0 */
  warning?: BackupItemWarning | null;
  /** 0.3.0. Hex sha256 of the uploaded bytes; null for rows from before 0.3.0. */
  sha256?: string | null;
  /** 0.3.0. Local structure check passed before upload; null = not checked (old rows). */
  checked?: boolean | null;
  /** 0.3.0. Deleted by retention: no download. */
  pruned?: boolean;
  /** Non-destructive command for a new phone (absolute paths); "" for checksums/manifest. */
  restoreHint: string;
};

/** Item of GET /api/panel/backups (paged). */
export type BackupRun = {
  id: string;
  trigger: BackupTrigger;
  status: BackupRunStatus;
  startedAt: string;
  finishedAt: string | null;
  items: BackupItem[];
  error: string | null;
  /** 0.3.0 */
  includesSecrets?: boolean;
  /** 0.3.0 */
  panelVersion?: string | null;
  /** 0.3.0 */
  prunedAt?: string | null;
};

/** Newest ok, non-pruned item per (kind, name), newest = insert order. Excludes checksums/manifest. */
export type BackupLastGood = {
  kind: Exclude<BackupItemKind, "checksums" | "manifest">;
  name: string;
  runId: string;
  itemIndex: number;
  at: string;
  sizeBytes: number | null;
  checked: boolean | null;
};

/** Plain-words reason something is never backed up. */
export type BackupExcluded = "site_binaries" | "cloudflared_cert" | "secrets_off";

/**
 * GET /api/panel/backups/status. Never throws because of the data key (keyMismatch instead). `missing` = unset
 * required setting keys; `hourLocal` null = schedule off.
 */
export type BackupStatus = {
  configured: boolean;
  missing: string[];
  /** 0.3.0 */
  keyMismatch?: boolean;
  hourLocal: number | null;
  nextRunAt: string | null;
  retentionDays: number;
  /** 0.3.0 */
  keepMinRuns?: number;
  /** 0.3.0 */
  maxItemMb?: number;
  /** 0.3.0 */
  includeSecrets?: boolean;
  running: boolean;
  /** 0.3.0. A restore is in progress (shares the lock with runs). */
  restoring?: boolean;
  lastRun: BackupRun | null;
  /** 0.3.0 */
  lastGood?: BackupLastGood[];
  /** 0.3.0. What is never backed up (e.g. site binaries, cert.pem). */
  excluded?: BackupExcluded[];
  /** 0.3.0. Newest succeeded "Pulihkan ke database baru"; null if never. */
  lastRestoreTest?: { at: string; sourceName: string } | null;
};

/** 202 body of POST /api/panel/backups/run. */
export type BackupRunStarted = { runId: string };

/** `<stem>manifest.json`; never holds secret values. */
export type BackupManifest = {
  format: 1;
  runId: string;
  createdAt: string;
  panelVersion: string;
  schemaVersion: string;
  /** `psql -At -c 'show server_version'`; pg_restore must be >= this major. */
  postgresVersion: string | null;
  appBaseUrl: string;
  includesSecrets: boolean;
  paths: { panelDir: string; dataDir: string; sitesDir: string; cloudflaredDir: string };
  /** `tunnel:` value of config.yml and the basename of its credentials-file (no contents). */
  tunnel: { ref: string; credentialsFile: string } | null;
  sites: { name: string; database: string | null; needsBinary: boolean }[];
  items: { kind: BackupItemKind; name: string; file: string; sizeBytes: number; sha256: string }[];
  excluded: string[];
  restoreOrder: Exclude<BackupItemKind, "checksums" | "manifest">[];
  /** Same text as README "Pulihkan ke HP baru", filled with this run's names. */
  restoreSteps: string[];
};

/**
 * Body of POST /api/dev/backup/verify (DECISIONS B7). Optional unsaved draft fields; missing fields fall back to the
 * stored settings. No `list` step: retention never lists the bucket (PLAN/04 K3).
 */
export type BackupVerifyInput = Partial<{
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}>;

/** One step of the S3 connection test, in order. */
export type BackupVerifyStep = "write" | "read" | "delete";

/** Outcome code of the S3 connection test. */
export type BackupVerifyCode =
  | "ok"
  | "not_configured"
  | "unreadable"
  | "unreachable"
  | "bucket_not_found"
  | "write_denied"
  | "read_failed"
  | "delete_denied"
  | "timeout"
  | "s3_error";

/** 200 response of POST /api/dev/backup/verify (also when the test failed). */
export type BackupVerify = {
  ok: boolean;
  code: BackupVerifyCode;
  failedStep: BackupVerifyStep | null;
  /** Every step in order; steps after the failed one are `{ ok: false, code: "skipped" }`. */
  steps: { step: BackupVerifyStep; ok: boolean; code: BackupVerifyCode | "skipped" }[];
  ms: number;
  /** Technical message (keys masked). */
  detail: string | null;
};

/** State of a "Pulihkan ke database baru" run. */
export type BackupRestoreStatus = "running" | "succeeded" | "failed";

/** Item of GET /api/panel/backups/restores (paged, newest first). */
export type BackupRestore = {
  id: string;
  runId: string;
  itemIndex: number;
  sourceName: string;
  targetDb: string;
  status: BackupRestoreStatus;
  error: string | null;
  errorCode: "checksum_mismatch" | "insufficient_space" | "download_failed" | "restore_failed" | null;
  tableCount: number | null;
  startedAt: string;
  finishedAt: string | null;
  droppedAt: string | null;
  /** A site uses targetDb (site.database): "Hapus database uji" is hidden and refused (409 in_use). */
  inUse: boolean;
  actor: { id: string; name: string } | null;
};

/** 202 body of POST /api/panel/backups/:id/items/:index/restore. */
export type BackupRestoreStarted = { restoreId: string; targetDb: string };
