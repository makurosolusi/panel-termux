import type { BackupItem, BackupLastGood, BackupRun, BackupStatus } from "@/shared/backup.types";

/** Poll interval of the backups page while a run or a restore is in progress (PLAN/04 §5.1). */
export const BACKUP_POLL_MS = 3_000;

/** An item whose last good copy is older than this is shown as stale (same threshold as `backup_item_stale`). */
export const STALE_AFTER_MS = 36 * 3_600_000;

/** Characters of the sha256 shown in the history (the copy button copies all of it). */
export const SHA_PREVIEW_CHARS = 12;

/** Why "Cadangkan sekarang" is disabled. */
export type RunBlock = "not_configured" | "key_mismatch" | "running" | "restoring";

/** First reason the run button is disabled, or null when a run may start. */
export function runBlock(s: BackupStatus): RunBlock | null {
  if (!s.configured) return "not_configured";
  if (s.keyMismatch) return "key_mismatch";
  if (s.running) return "running";
  if (s.restoring) return "restoring";
  return null;
}

/** The page polls (and announces) while a run or a restore is going. */
export const isBackupBusy = (s: BackupStatus | undefined): boolean => Boolean(s?.running || s?.restoring);

/** Top-of-page notices, most urgent first (PLAN/04 §5.1 item 2). `noKeyCopy` needs the super_admin data key state. */
export type BackupBanner = "key_mismatch" | "not_configured" | "secrets_included" | "no_key_copy";

/** Which notices apply. `keyExportedAt` is undefined when unknown (admin role or still loading): no `no_key_copy`. */
export function backupBanners(s: BackupStatus, keyExportedAt: string | null | undefined): BackupBanner[] {
  const out: BackupBanner[] = [];
  if (s.keyMismatch) out.push("key_mismatch");
  if (!s.configured) out.push("not_configured");
  if (s.includeSecrets) out.push("secrets_included");
  else if (keyExportedAt === null) out.push("no_key_copy");
  return out;
}

/** Item kinds of the last run, in first-seen order, without the bookkeeping files. */
export function contentKinds(run: BackupRun | null): BackupItem["kind"][] {
  const kinds = (run?.items ?? []).map((i) => i.kind).filter((k) => k !== "checksums" && k !== "manifest");
  return [...new Set(kinds)];
}

/** One row of "Cadangan terakhir per item": a last good copy, or an item of the last run that never succeeded. */
export type LastGoodRow = { kind: BackupLastGood["kind"]; name: string; good: BackupLastGood | null; stale: boolean };

/** Rows of the per-item table: every last good copy (stale flag), then failed items of the last run with none. */
export function lastGoodRows(s: BackupStatus, now: Date): LastGoodRow[] {
  const good = s.lastGood ?? [];
  const rows: LastGoodRow[] = good.map((g) => ({
    kind: g.kind,
    name: g.name,
    good: g,
    stale: now.getTime() - new Date(g.at).getTime() > STALE_AFTER_MS,
  }));
  const has = new Set(good.map((g) => `${g.kind}:${g.name}`));
  for (const item of s.lastRun?.items ?? []) {
    if (item.ok || item.kind === "checksums" || item.kind === "manifest") continue;
    const key = `${item.kind}:${item.name}`;
    if (has.has(key)) continue;
    has.add(key);
    rows.push({ kind: item.kind, name: item.name, good: null, stale: false });
  }
  return rows;
}

/** A run or restore that a panel restart cut off ("Terputus", warning, not a failure). */
export const isInterrupted = (x: { errorCode?: string | null }): boolean => x.errorCode === "interrupted";

/** The item behind a last good copy, looked up in the runs already loaded (for its restore command). */
export function findItem(runs: readonly BackupRun[], runId: string, index: number): BackupItem | null {
  return runs.find((r) => r.id === runId)?.items[index] ?? null;
}

/** Who may download what on this page. */
export type DownloadAccess = { keyMismatch: boolean; superAdmin: boolean };

/** Download is offered for ok, non-pruned items while the key matches; `secrets` only for super_admin (F4). */
export function canDownload(item: Pick<BackupItem, "kind" | "ok" | "pruned">, access: DownloadAccess): boolean {
  if (!item.ok || item.pruned || access.keyMismatch) return false;
  return item.kind !== "secrets" || access.superAdmin;
}

/** Only database items can be restored into a new database, and not while the key mismatches or something runs. */
export const canRestore = (kind: BackupItem["kind"], s: BackupStatus): boolean =>
  kind === "database" && !s.keyMismatch && !isBackupBusy(s);
