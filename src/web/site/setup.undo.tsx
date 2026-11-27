// "Undo change" rows of the Setup card (PLAN/06 §4.1): one per file the panel changed.
import { useState } from "react";
import type { FixBackup } from "@/shared/fix.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { RelativeTime } from "@/web/components/relative-time";
import { Button } from "@/web/components/ui/button";
import { tSite } from "@/web/i18n/en.site";
import { ApiError } from "@/web/shared/api.client";
import { formatDateTime } from "@/web/shared/format";
import { FIX_ERROR_CODES, restoreFix } from "./site.api";

const t = tSite.setup;

/** Consequence of restoring `b`, first: managed sites that stop surviving a reboot, then a later hand edit lost. */
export function undoDescription(b: FixBackup): string {
  const u = t.undoBody;
  const sites = b.affectedSites;
  const what =
    b.file === "pm2_run"
      ? u.pm2_run
      : b.file === "apps_json"
        ? sites.length
          ? u.appsJsonSites(sites)
          : u.apps_json
        : sites.length
          ? u.ecosystemSites(sites)
          : u.ecosystem;
  return b.changedSince ? `${what} ${t.undoChanged}` : what;
}

/**
 * Restore body of the undo: force once the file is known to be edited after the fix, either from the last check or
 * from the 409 `changed_since` of this very try (the cached GET /integration would still say false; QA fix-04 MAJOR-2).
 */
export const undoForce = (b: FixBackup, sawChangedSince: boolean): boolean => b.changedSince || sawChangedSince;

/** "Undo change" of one file: restores its newest backup; a 409 `changed_since` turns the button into force. */
function UndoButton({
  backup,
  onChange,
  focusCard,
}: {
  backup: FixBackup;
  onChange: () => void;
  focusCard: () => HTMLElement | null;
}) {
  const [sawChanged, setSawChanged] = useState(false);
  const force = undoForce(backup, sawChanged);
  return (
    <ConfirmAction
      title={t.undoTitle(formatDateTime(backup.at))}
      // the 409's own error line already says the file changed; the description adds it only when known beforehand
      description={undoDescription(backup)}
      confirmLabel={force ? t.undoForce : t.undoAction}
      destructive={backup.affectedSites.length > 0 || force}
      codes={FIX_ERROR_CODES}
      successToast={t.undone}
      focusAfter={focusCard}
      onConfirm={async () => {
        try {
          await restoreFix(backup.id, { force });
        } catch (err) {
          if (err instanceof ApiError && err.code === "changed_since") setSawChanged(true);
          throw err;
        }
        onChange();
      }}
      trigger={
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 pointer-coarse:py-3"
          aria-label={t.undoLabel[backup.file]}
        >
          {t.undoAction}
        </Button>
      }
    />
  );
}

/** "The panel changed the ecosystem file … Sites: blog. Undo change": one line per changed file. */
export function UndoRow({
  backup,
  onChange,
  focusCard,
}: {
  backup: FixBackup;
  onChange: () => void;
  focusCard: () => HTMLElement | null;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <RelativeTime at={backup.at} format={t.lastFix[backup.file]} />
      {backup.affectedSites.length > 0 && (
        <span className="text-muted-foreground">{t.lastFixSites(backup.affectedSites)}</span>
      )}
      <UndoButton backup={backup} onChange={onChange} focusCard={focusCard} />
    </p>
  );
}
