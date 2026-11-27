import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import type { BackupItem } from "@/shared/backup.types";
import { Button } from "@/web/components/ui/button";
import { tBackup } from "@/web/i18n/en.backup";
import { tSecurity } from "@/web/i18n/en.security";
import { isReauthRequired, reauthenticate } from "@/web/security/security.api";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage } from "@/web/shared/api.client";
import { toast } from "@/web/shared/toast.lazy";
import { BACKUP_ERROR_CODES, backupItemDownloadUrl, downloadSecretsItem } from "./backup.api";

const t = tBackup;

/**
 * "Unduh" for one stored item: a plain link (302 to the bucket), except `secrets`, which is probed first so a stale
 * session gets a "Masuk ulang" action instead of a raw 403 page. Callers decide visibility with `canDownload`.
 */
export function ItemDownload({ runId, index, kind }: { runId: string; index: number; kind: BackupItem["kind"] }) {
  const [busy, setBusy] = useState(false);
  const label = t.downloadAria(t.kinds[kind]);
  if (kind !== "secrets")
    return (
      <Button asChild variant="outline" size="sm">
        <a href={backupItemDownloadUrl(runId, index)} aria-label={label}>
          <DownloadIcon aria-hidden />
          {t.download}
        </a>
      </Button>
    );

  const download = async () => {
    setBusy(true);
    try {
      await downloadSecretsItem(runId, index);
    } catch (err) {
      if (isReauthRequired(err))
        toast.warning(t.reauthDownload, {
          duration: ERROR_TOAST_MS,
          action: { label: tSecurity.reauth.button, onClick: () => void reauthenticate() },
        });
      else toast.error(apiErrorMessage(err, BACKUP_ERROR_CODES), { duration: ERROR_TOAST_MS });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" aria-label={label} disabled={busy} onClick={() => void download()}>
      <DownloadIcon aria-hidden />
      {t.download}
    </Button>
  );
}
