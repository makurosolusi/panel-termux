// Response types of the admin backup API under /api/panel/backups. Dates are ISO-8601 strings.

/** What started a run. */
export type BackupTrigger = "schedule" | "manual";

/** Run outcome; `partial` = at least one item failed and at least one succeeded. */
export type BackupRunStatus = "running" | "succeeded" | "failed" | "partial";

/** One uploaded (or failed) object of a run. `restoreHint` is a ready-to-copy restore command. */
export type BackupItem = {
  kind: "database" | "panel";
  name: string;
  key: string;
  sizeBytes: number | null;
  ok: boolean;
  error: string | null;
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
};

/** GET /api/panel/backups/status. `missing` = unset required setting keys; `hourLocal` null = schedule off. */
export type BackupStatus = {
  configured: boolean;
  missing: string[];
  hourLocal: number | null;
  nextRunAt: string | null;
  retentionDays: number;
  running: boolean;
  lastRun: BackupRun | null;
};

/** 202 body of POST /api/panel/backups/run. */
export type BackupRunStarted = { runId: string };
