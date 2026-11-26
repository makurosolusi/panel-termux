// Backup raw states → canonical status keys (DECISIONS B12, PLAN/04 §3.9 item 1). Labels/tones live in status.vocab.
import type { BackupRestore, BackupRun, BackupStatus } from "@/shared/backup.types";
import type { StatusKey } from "@/web/components/status.vocab";
import { idBackup } from "@/web/i18n/id.backup";
import { isInterrupted } from "./backup.state";

const RUN_KEY: Record<BackupRun["status"], StatusKey> = {
  running: "processing",
  succeeded: "succeeded",
  partial: "partial",
  failed: "failed",
};

/** Status key of a run; a run cut off by a panel restart is `interrupted` ("Terputus"). */
export const runStatusKey = (run: Pick<BackupRun, "status" | "errorCode">): StatusKey =>
  isInterrupted(run) ? "interrupted" : RUN_KEY[run.status];

const RESTORE_KEY: Record<BackupRestore["status"], StatusKey> = {
  running: "processing",
  succeeded: "succeeded",
  failed: "failed",
};

/** Status key of a "Pulihkan ke database baru" entry. */
export const restoreStatusKey = (r: Pick<BackupRestore, "status" | "errorCode">): StatusKey =>
  isInterrupted(r) ? "interrupted" : RESTORE_KEY[r.status];

/** Header badge of the page: most urgent state first; `label` overrides the vocabulary text where it is too generic. */
export function backupHeadline(s: BackupStatus): { state: StatusKey; label?: string } {
  const t = idBackup.headline;
  if (s.keyMismatch) return { state: "key_mismatch" };
  if (!s.configured) return { state: "not_configured" };
  if (s.running) return { state: "processing", label: t.running };
  if (s.restoring) return { state: "processing", label: t.restoring };
  if (!s.lastRun) return { state: "unchecked", label: t.never };
  return { state: runStatusKey(s.lastRun) };
}
