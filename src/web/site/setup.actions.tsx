import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import type { FixBackup, Pm2RestartResult } from "@/shared/fix.types";
import type { Integration } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import { toast } from "@/web/shared/toast.lazy";
import { UndoRow } from "./setup.undo";
import { pm2Pending } from "./site.adopt";
import { FIX_ERROR_CODES, restartPm2, restoreFix } from "./site.api";

const t = idSite.setup;
/** The restart's 404 means runit has no pm2 service, not a missing backup. */
const RESTART_CODES = { ...FIX_ERROR_CODES, not_found: t.restartNotFound };

/** Restart dialog text: who stops briefly, plus the panel's ecosystem change taking effect now. */
export const restartDescription = (i: Integration): string =>
  i.lastFixes?.some((b) => b.file === "ecosystem")
    ? `${t.restartPm2Body(i.appNames ?? [])} ${t.restartPm2FileNote}`
    : t.restartPm2Body(i.appNames ?? []);

/** Warning after a checked restart where apps did not come back; offers restore + restart when the fix is to blame. */
function RestartFailed({
  result,
  backup,
  onResult,
  focusCard,
}: {
  result: Pm2RestartResult;
  backup: FixBackup | null;
  onResult: (r: Pm2RestartResult | null) => void;
  focusCard: () => HTMLElement | null;
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
          focusAfter={focusCard}
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
export function SetupActions({
  integration,
  onChange,
  focusCard,
  restartWanted = false,
  onRestarted,
}: {
  integration: Integration;
  onChange: () => void;
  /** The Persiapan card: focus lands there once undo / restart removed the button that was pressed. */
  focusCard: () => HTMLElement | null;
  /** A fix just applied takes effect when pm2 starts again: show the restart like a pending one. */
  restartWanted?: boolean;
  onRestarted?: () => void;
}) {
  const [failed, setFailed] = useState<Pm2RestartResult | null>(null);
  const backups = integration.lastFixes ?? [];
  const eco = backups.find((b) => b.file === "ecosystem") ?? null;
  const pending = pm2Pending(integration) || restartWanted;
  if (!backups.length && !pending && !failed) return null;

  const onResult = (r: Pm2RestartResult | null) => {
    if (r) onRestarted?.();
    if (r?.ok) toast.success(t.restartOk);
    setFailed(r && !r.ok ? r : null);
    onChange();
  };

  const restart = (
    <ConfirmAction
      title={t.restartPm2Title}
      description={restartDescription(integration)}
      confirmLabel={t.restartPm2}
      codes={RESTART_CODES}
      focusAfter={focusCard}
      onConfirm={async () => onResult(await restartPm2())}
      trigger={
        // pending: the restart is what makes the change take effect, so it is a visible button (QA fix-04 MINOR-4)
        <Button
          variant={pending ? "outline" : "link"}
          size="sm"
          className={pending ? "w-fit" : "h-auto p-0 pointer-coarse:py-3"}
        >
          {t.restartPm2}
        </Button>
      }
    />
  );

  return (
    <>
      {failed && <RestartFailed result={failed} backup={eco} onResult={onResult} focusCard={focusCard} />}
      {pending && restart}
      {backups.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground pointer-coarse:py-3">{t.more}</summary>
          <div className="mt-2 flex flex-col items-start gap-2 pl-4">
            {backups.map((b) => (
              <UndoRow key={b.id} backup={b} onChange={onChange} focusCard={focusCard} />
            ))}
            {!pending && restart}
          </div>
        </details>
      )}
    </>
  );
}
