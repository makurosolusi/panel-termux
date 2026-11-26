import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";

/** Panel error codes plus the backup ones (409 `busy`, 400 `not_configured`). */
export const BACKUP_ERROR_CODES: Readonly<Record<string, string>> = { ...id.panel.errorCodes, ...id.backup.errorCodes };

/** `/api/panel/backups<path>?<query>`. */
export const backupUrl = (path = "", query?: Parameters<typeof panelUrl>[1]): string =>
  panelUrl(`/backups${path}`, query);

/** Download link of one item (302 to the stored object), used as a plain anchor. */
export const backupItemDownloadUrl = (runId: string, index: number): string =>
  backupUrl(`/${encodeURIComponent(runId)}/items/${index}/download`);
