import { Trash2Icon } from "lucide-react";
import type { BackupRestore } from "@/shared/backup.types";
import type { Page } from "@/shared/dev.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { InlineCode } from "@/web/components/inline-code";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { tBackup } from "@/web/i18n/en.backup";
import type { ApiQuery } from "@/web/shared/use-api-query";
import { BACKUP_ERROR_CODES, dropRestoreDb } from "./backup.api";
import { ItemError } from "./backup.runs";
import { restoreStatusKey } from "./backup.status-key";

const t = tBackup.restores;

/** Failures before pg_restore ran: the target database was never created, so there is nothing to drop (QA #19). */
const NO_DATABASE_CODES: ReadonlySet<BackupRestore["errorCode"]> = new Set(["download_failed", "checksum_mismatch"]);

/** "Hapus database uji" is offered only for a finished, undropped restore that created a database no site uses. */
export const canDropRestore = (r: BackupRestore): boolean =>
  !r.droppedAt && !r.inUse && r.status !== "running" && !(r.status === "failed" && NO_DATABASE_CODES.has(r.errorCode));

function Result({ r }: { r: BackupRestore }) {
  if (r.droppedAt) return <span className="text-muted-foreground">{t.droppedAt}</span>;
  if (r.status === "succeeded")
    return <span>{r.tableCount === null ? tBackup.runs.noSize : t.done(r.tableCount)}</span>;
  if (r.status === "failed")
    return (
      <ItemError item={{ error: r.error, errorCode: null }} message={r.errorCode ? t.errors[r.errorCode] : t.failed} />
    );
  return null;
}

const columns: DataColumn<BackupRestore>[] = [
  { key: "at", header: t.at, mobile: "title", cell: (r) => <RelativeTime at={r.startedAt} /> },
  {
    key: "target",
    header: t.target,
    cell: (r) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        <InlineCode>{r.sourceName}</InlineCode>
        <span aria-hidden>→</span>
        <InlineCode>{r.targetDb}</InlineCode>
      </span>
    ),
  },
  { key: "state", header: t.state, mobile: "badge", cell: (r) => <StatusBadge state={restoreStatusKey(r)} /> },
  { key: "tables", header: t.tables, cell: (r) => <Result r={r} /> },
];

/** "Uji pemulihan": restores into new databases, newest first, with the typed "Hapus database uji". */
export function RestoresSection({ query, onChanged }: { query: ApiQuery<Page<BackupRestore>>; onChanged: () => void }) {
  const actions = (r: BackupRestore) => {
    if (r.inUse && !r.droppedAt) return <span className="text-xs text-muted-foreground">{t.inUse}</span>;
    if (!canDropRestore(r)) return null;
    return (
      <ConfirmAction
        tier="typed"
        typedValue={r.targetDb}
        destructive
        title={t.dropTitle(r.targetDb)}
        description={t.dropBody}
        confirmLabel={t.dropConfirm}
        codes={BACKUP_ERROR_CODES}
        successToast={t.dropped}
        onConfirm={async (typed) => {
          await dropRestoreDb(r.id, typed ?? "");
          onChanged();
        }}
        trigger={
          <Button variant="ghost" size="sm" className="text-danger">
            <Trash2Icon aria-hidden />
            {t.drop}
          </Button>
        }
      />
    );
  };
  return (
    <Section title={t.title} description={t.useHint}>
      <QueryView query={query} codes={BACKUP_ERROR_CODES} empty={<EmptyState title={t.empty} />}>
        {(d) => <DataTable label={t.label} columns={columns} rows={d.items} rowKey={(r) => r.id} actions={actions} />}
      </QueryView>
    </Section>
  );
}
