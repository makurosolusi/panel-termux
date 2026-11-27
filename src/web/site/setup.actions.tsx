import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import type { FixBackup, Pm2RestartResult } from "@/shared/fix.types";
import type { Integration } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { RelativeTime } from "@/web/components/relative-time";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import { ApiError } from "@/web/shared/api.client";
import { formatDateTime } from "@/web/shared/format";
import { toast } from "@/web/shared/toast.lazy";
import { pm2Pending } from "./site.adopt";
import { FIX_ERROR_CODES, restartPm2, restoreFix } from "./site.api";

const t = idSite.setup;
/** The restart's 404 means runit has no pm2 service, not a missing backup. */
const RESTART_CODES = { ...FIX_ERROR_CODES, not_found: t.restartNotFound };

/** Consequence of restoring `b`, first: managed sites that stop surviving a reboot, then a later hand edit lost. */
export function undoDescription(b: FixBackup): string {
  const what =
    b.file === "pm2_run"
      ? t.undoBody.pm2_run
      : b.affectedSites.length
        ? t.undoBody.ecosystemSites(b.affectedSites)
        : t.undoBody.ecosystem;
  return b.changedSince ? `${what} ${t.undoChanged}` : what;
}

/** Restart dialog text: who stops briefly, plus the panel's ecosystem change taking effect now. */
export const restartDescription = (i: Integration): string =>
  i.lastFixes?.some((b) => b.file === "ecosystem")
    ? `${t.restartPm2Body(i.appNames ?? [])} ${t.restartPm2FileNote}`
    : t.restartPm2Body(i.appNames ?? []);

/** "Batalkan perubahan" of one file: restores its newest backup; 409 `changed_since` reloads so the next try offers force. */
function UndoButton({ backup, onChange }: { backup: FixBackup; onChange: () => void }) {
  return (
    <ConfirmAction
      title={t.undoTitle(formatDateTime(backup.at))}
      description={undoDescription(backup)}
      confirmLabel={backup.changedSince ? t.undoForce : t.undoAction}
      destructive={backup.affectedSites.length > 0}
      codes={FIX_ERROR_CODES}
      successToast={t.undone}
      onConfirm={async () => {
        try {
          await restoreFix(backup.id, { force: backup.changedSince });
        } catch (err) {
          if (err instanceof ApiError && err.code === "changed_since") onChange();
          throw err;
        }
        onChange();
      }}
      trigger={
        <Button variant="link" size="sm" className="h-auto p-0" aria-label={t.undoLabel[backup.file]}>
          {t.undoAction}
        </Button>
      }
    />
  );
}

/** "File ecosystem diubah panel … Situs: blog. Batalkan perubahan": one line per changed file. */
function UndoRow({ backup, onChange }: { backup: FixBackup; onChange: () => void }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <RelativeTime at={backup.at} format={t.lastFix[backup.file]} />
      {backup.affectedSites.length > 0 && (
        <span className="text-muted-foreground">{t.lastFixSites(backup.affectedSites)}</span>
      )}
      <UndoButton backup={backup} onChange={onChange} />
    </p>
  );
}

/** Warning after a checked restart where apps did not come back; offers restore + restart when the fix is to blame. */
function RestartFailed({
  result,
  backup,
  onResult,
}: {
  result: Pm2RestartResult;
  backup: FixBackup | null;
  onResult: (r: Pm2RestartResult | null) => void;
}) {
  const offer = result.offerRestore;
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-warning/25 bg-warning-subtle p-3 text-sm"
    >
      <p className="flex items-start gap-2">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          {t.restartCheckFailed(result.missing)} {offer && t.restartFailedHint}
        </span>
      </p>
      {offer && (
        <ConfirmAction
          title={t.restoreAndRestartTitle}
          description={`${t.undoBody.ecosystem} ${t.restartPm2Body(result.integration.appNames ?? [])}`}
          confirmLabel={t.restoreAndRestart}
          codes={FIX_ERROR_CODES}
          onConfirm={async () => {
            const r = await restoreFix(offer, { restart: true, force: backup?.changedSince ?? false });
            toast.success(t.undone);
            onResult(r.restart);
          }}
          trigger={
            <Button size="sm" variant="outline" className="w-fit">
              {t.restoreAndRestart}
            </Button>
          }
        />
      )}
    </div>
  );
}

/**
 * Bottom of the Persiapan card (PLAN/06 §4.1): "Diperbaiki panel … Batalkan perubahan" and the checked "Mulai ulang
 * pm2 sekarang" inside <details>, plus the warning when apps did not come back. Nothing when there is nothing to undo
 * and no restart pending.
 */
export function SetupActions({ integration, onChange }: { integration: Integration; onChange: () => void }) {
  const [failed, setFailed] = useState<Pm2RestartResult | null>(null);
  const backups = integration.lastFixes ?? [];
  const eco = backups.find((b) => b.file === "ecosystem") ?? null;
  if (!backups.length && !pm2Pending(integration) && !failed) return null;

  const onResult = (r: Pm2RestartResult | null) => {
    if (r?.ok) toast.success(t.restartOk);
    setFailed(r && !r.ok ? r : null);
    onChange();
  };

  return (
    <>
      {failed && <RestartFailed result={failed} backup={eco} onResult={onResult} />}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t.more}</summary>
        <div className="mt-2 flex flex-col items-start gap-2 pl-4">
          {backups.map((b) => (
            <UndoRow key={b.id} backup={b} onChange={onChange} />
          ))}
          <ConfirmAction
            title={t.restartPm2Title}
            description={restartDescription(integration)}
            confirmLabel={t.restartPm2}
            codes={RESTART_CODES}
            onConfirm={async () => onResult(await restartPm2())}
            trigger={
              <Button variant="link" size="sm" className="h-auto p-0">
                {t.restartPm2}
              </Button>
            }
          />
        </div>
      </details>
    </>
  );
}
