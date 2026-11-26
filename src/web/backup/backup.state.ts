import type { BackupRunStatus, BackupStatus } from "@/shared/backup.types";
import type { Tone } from "@/web/panel/panel.status";

/** Poll interval of the backups page while a run is in progress. */
export const BACKUP_POLL_MS = 3_000;

const RUN_TONE: Record<BackupRunStatus, Tone> = { running: "warn", succeeded: "ok", failed: "bad", partial: "warn" };

/** Badge tone of a run status. */
export const runTone = (status: BackupRunStatus): Tone => RUN_TONE[status];

/** Headline of the status card: what state the backup setup is in, most urgent first. */
export type BackupSummary = "not_configured" | "running" | "last_failed" | "last_partial" | "never" | "ok";

/** Collapses the status into one headline + tone. */
export function backupSummary(s: BackupStatus): { summary: BackupSummary; tone: Tone } {
  if (!s.configured) return { summary: "not_configured", tone: "bad" };
  if (s.running) return { summary: "running", tone: "warn" };
  if (!s.lastRun) return { summary: "never", tone: "muted" };
  if (s.lastRun.status === "failed") return { summary: "last_failed", tone: "bad" };
  if (s.lastRun.status === "partial") return { summary: "last_partial", tone: "warn" };
  return { summary: "ok", tone: "ok" };
}

/** Whether the "Backup sekarang" button may be pressed. */
export const canRunBackup = (s: BackupStatus): boolean => s.configured && !s.running;
