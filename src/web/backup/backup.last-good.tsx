import { DatabaseBackupIcon, TerminalIcon } from "lucide-react";
import type { BackupRun, BackupStatus } from "@/shared/backup.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { InlineCode } from "@/web/components/inline-code";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/web/components/ui/sheet";
import { idBackup } from "@/web/i18n/id.backup";
import { formatBytes, formatDateTime } from "@/web/shared/format";
import { BACKUP_ERROR_CODES, startRestore } from "./backup.api";
import { ItemDownload } from "./backup.download";
import { CheckedBadge } from "./backup.runs";
import { canDownload, canRestore, type DownloadAccess, findItem, type LastGoodRow, lastGoodRows } from "./backup.state";

const t = idBackup.lastGood;

function CommandSheet({ name, command }: { name: string; command: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t.restoreCommandAria(name)} title={t.restoreCommand}>
          <TerminalIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-w-2xl gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]">
        <SheetHeader>
          <SheetTitle>{t.restoreCommand}</SheetTitle>
          <SheetDescription>{t.restoreCommandHelp}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <InlineCode copy>{command}</InlineCode>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const columns: DataColumn<LastGoodRow>[] = [
  {
    key: "item",
    header: t.item,
    mobile: "title",
    cell: (r) => (
      <span className="flex min-w-0 flex-col">
        <span>{idBackup.kinds[r.kind]}</span>
        <span className="truncate text-xs font-normal text-muted-foreground">{r.name}</span>
      </span>
    ),
  },
  {
    key: "at",
    header: t.at,
    mobile: "badge",
    cell: (r) =>
      !r.good ? (
        <StatusBadge state="failed" label={t.never} />
      ) : r.stale ? (
        <StatusBadge tone="warning" label={t.stale} />
      ) : (
        <RelativeTime at={r.good.at} />
      ),
  },
  {
    key: "size",
    header: t.size,
    align: "right",
    cell: (r) => (r.good?.sizeBytes == null ? idBackup.runs.noSize : formatBytes(r.good.sizeBytes)),
  },
  { key: "check", header: t.check, cell: (r) => (r.good ? <CheckedBadge checked={r.good.checked} /> : null) },
];

/** "Cadangan terakhir per item": newest good copy per item with download, restore test and restore command. */
export function LastGoodSection({
  status,
  runs,
  access,
  onRestoreStarted,
}: {
  status: BackupStatus;
  runs: readonly BackupRun[];
  access: DownloadAccess;
  onRestoreStarted: () => void;
}) {
  const rows = lastGoodRows(status, new Date());
  const actions = (r: LastGoodRow) => {
    const g = r.good;
    if (!g) return null;
    const hint = findItem(runs, g.runId, g.itemIndex)?.restoreHint;
    const size = g.sizeBytes == null ? idBackup.runs.noSize : formatBytes(g.sizeBytes);
    return (
      <>
        {canDownload({ kind: g.kind, ok: true }, access) && (
          <ItemDownload runId={g.runId} index={g.itemIndex} kind={g.kind} />
        )}
        {canRestore(g.kind, status) && (
          <ConfirmAction
            title={idBackup.restore.title(g.name)}
            description={idBackup.restore.body(idBackup.restore.newTarget(g.name), formatDateTime(g.at), size)}
            confirmLabel={idBackup.restore.button}
            codes={BACKUP_ERROR_CODES}
            successToast={idBackup.restore.started}
            onConfirm={async () => {
              await startRestore(g.runId, g.itemIndex);
              onRestoreStarted();
            }}
            trigger={
              <Button variant="outline" size="sm">
                <DatabaseBackupIcon aria-hidden />
                {idBackup.restore.button}
              </Button>
            }
          />
        )}
        {hint && <CommandSheet name={g.name} command={hint} />}
      </>
    );
  };
  return (
    <Section title={t.title} description={t.checkedTitle}>
      <DataTable
        label={t.label}
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.kind}:${r.name}`}
        rowTone={(r) => (!r.good ? "danger" : r.stale ? "warning" : undefined)}
        actions={actions}
        empty={<EmptyState title={t.empty} />}
      />
    </Section>
  );
}
