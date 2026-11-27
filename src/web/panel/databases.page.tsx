import { DatabaseIcon } from "lucide-react";
import { Link } from "react-router";
import type { DatabaseInfo } from "@/shared/panel.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { ErrorState } from "@/web/components/error-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { tPanel } from "@/web/i18n/en.panel";
import { formatBytes } from "@/web/shared/format";
import { ServiceStartButton } from "@/web/shared/service-start";
import { useApiQuery } from "@/web/shared/use-api-query";
import { panelUrl } from "./panel.api";
import { TOUCH_HIT } from "./panel.touch";

const t = tPanel.databases;

/** A database backup older than this is shown as a warning (same 36 h as the backup_stale rule). */
export const DB_BACKUP_STALE_MS = 36 * 3_600_000;

/** Whether the last good backup is older than 36 h (never backed up = neutral "Belum pernah"; backup setup has its own info row). */
export const isBackupStale = (at: string | null | undefined, now = Date.now()): boolean =>
  !!at && now - Date.parse(at) > DB_BACKUP_STALE_MS;

const columns: DataColumn<DatabaseInfo>[] = [
  { key: "name", header: t.cols.name, mobile: "title", cell: (d) => <span className="font-mono">{d.name}</span> },
  {
    key: "site",
    header: t.cols.site,
    // null when unlinked: the phone meta line skips it (QA #18), the table cell shows "–" via CSS.
    className: "empty:before:text-muted-foreground empty:before:content-['–']",
    cell: (d) =>
      d.site ? (
        <Link
          to={`/panel/sites/${encodeURIComponent(d.site)}`}
          className={`${TOUCH_HIT} z-10 underline-offset-4 hover:underline`}
        >
          {d.site}
        </Link>
      ) : null,
  },
  {
    key: "owner",
    header: t.cols.owner,
    cell: (d) => <span className="font-mono text-muted-foreground">{d.owner}</span>,
  },
  { key: "size", header: t.cols.size, align: "right", cell: (d) => formatBytes(d.sizeBytes) },
  {
    key: "backup",
    header: t.cols.backup,
    align: "right",
    cell: (d) => {
      const stale = isBackupStale(d.lastBackupAt);
      return (
        <span className={stale ? "font-medium text-warning" : undefined} title={stale ? t.staleBackup : undefined}>
          {d.lastBackupAt ? <RelativeTime at={d.lastBackupAt} /> : t.noBackup}
        </span>
      );
    },
  },
];

/** /panel/databases: PostgreSQL databases with site, owner, size and last good backup; loaded once + refresh button. */
export function DatabasesPage() {
  const query = useApiQuery<DatabaseInfo[]>(panelUrl("/databases"));
  const header = (
    <PageHeader
      title={t.title}
      description={t.description}
      meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading }}
    />
  );
  if (query.error?.code === "postgres_down") {
    return (
      <>
        {header}
        <ErrorState
          title={t.postgresDown}
          description={t.postgresDownBody}
          onRetry={query.reload}
          retrying={query.loading}
          action={<ServiceStartButton service="postgres" onStarted={query.reload} />}
        />
      </>
    );
  }
  return (
    <>
      {header}
      <QueryView
        query={query}
        codes={tPanel.errorCodes}
        empty={<EmptyState icon={DatabaseIcon} title={t.emptyTitle} description={t.emptyBody} />}
      >
        {(list) => (
          <DataTable
            label={t.label}
            columns={columns}
            rows={list}
            rowKey={(d) => d.name}
            rowTone={(d) => (isBackupStale(d.lastBackupAt) ? "warning" : undefined)}
          />
        )}
      </QueryView>
    </>
  );
}
