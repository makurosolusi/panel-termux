import type { BackupRestoreStarted, BackupRunStarted } from "@/shared/backup.types";
import { tBackup } from "@/web/i18n/en.backup";
import { sensitiveFetch } from "@/web/security/security.api";
import { apiFetch, apiUrl } from "@/web/shared/api.client";

/** Backup error codes (409 `busy`, 400 `not_configured`, restore/drop codes) → Indonesian messages. */
export const BACKUP_ERROR_CODES: Readonly<Record<string, string>> = tBackup.errorCodes;

/** `/api/panel/backups<path>?<query>`. */
export const backupUrl = (path = "", query?: Parameters<typeof apiUrl>[2]): string =>
  apiUrl("/api/panel/backups", path, query);

const itemPath = (runId: string, index: number) => `/${encodeURIComponent(runId)}/items/${index}`;

/** Download link of one item (302 to the stored object), used as a plain anchor. */
export const backupItemDownloadUrl = (runId: string, index: number): string =>
  backupUrl(`${itemPath(runId, index)}/download`);

/** POST /run: starts a manual run (202). */
export const startBackupRun = () => apiFetch<BackupRunStarted>("POST", backupUrl("/run"));

/** POST …/items/:index/restore: "Pulihkan ke database baru" (202). */
export const startRestore = (runId: string, index: number) =>
  apiFetch<BackupRestoreStarted>("POST", backupUrl(`${itemPath(runId, index)}/restore`), {});

/** DELETE …/restores/:id/database with the typed database name (204). */
export const dropRestoreDb = (restoreId: string, confirm: string) =>
  apiFetch<void>("DELETE", backupUrl(`/restores/${encodeURIComponent(restoreId)}/database`), { confirm });

/**
 * Downloads the `secrets` item. The server answers 403 `reauth_required` on a stale session, which a plain link would
 * show as raw JSON, so the request is probed first (`redirect: "manual"`), then the browser follows the link.
 * ponytail: the probe and the navigation are two requests, so the audit log gets two `backup.download` rows; a JSON
 * "presigned URL" variant of the endpoint would make it one.
 */
export async function downloadSecretsItem(runId: string, index: number): Promise<void> {
  const url = backupItemDownloadUrl(runId, index);
  await sensitiveFetch("GET", url, undefined, "manual");
  window.location.assign(url);
}
