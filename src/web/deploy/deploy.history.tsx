import { useState } from "react";
import type { Deploy } from "@/shared/deploy.types";
import type { Page } from "@/shared/dev.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { StatusBadge } from "@/web/components/status-badge";
import { idDeploy } from "@/web/i18n/id.deploy";
import { formatBytes } from "@/web/shared/format";
import { useApiQuery } from "@/web/shared/use-api-query";
import { durationText } from "@/web/site/job.state";
import { jobPath, siteUrl } from "@/web/site/site.api";
import { DEPLOY_ERROR_CODES } from "./deploy.api";
import { shortSha } from "./deploy.state";
import { DEPLOY_STATUS_KEY } from "./deploy.status-key";

const t = idDeploy.history;
/** Rows per history page (PLAN/03 §5.4). */
const HISTORY_PAGE_SIZE = 10;

const durationOf = (d: Deploy) =>
  d.finishedAt ? durationText(new Date(d.finishedAt).getTime() - new Date(d.at).getTime()) : "–";

const COLUMNS: DataColumn<Deploy>[] = [
  { key: "at", header: t.columns.at, mobile: "title", cell: (d) => <RelativeTime at={d.at} /> },
  { key: "kind", header: t.columns.kind, cell: (d) => t.kinds[d.kind] },
  {
    key: "version",
    header: t.columns.version,
    cell: (d) => (
      <span className="inline-flex items-center gap-1.5">
        <code className="font-mono text-xs" title={d.sha256}>
          {shortSha(d.sha256)}
        </code>
        {d.active && <StatusBadge state="running" label={t.active} />}
      </span>
    ),
  },
  { key: "size", header: t.columns.size, align: "right", cell: (d) => formatBytes(d.sizeBytes) },
  { key: "runtime", header: t.columns.runtime, cell: (d) => idDeploy.runtimes[d.runtime] },
  { key: "actor", header: t.columns.actor, cell: (d) => d.actor?.name || t.unknownActor },
  { key: "duration", header: t.columns.duration, align: "right", cell: durationOf },
  {
    key: "status",
    header: t.columns.status,
    mobile: "badge",
    cell: (d) => <StatusBadge state={DEPLOY_STATUS_KEY[d.status]} />,
  },
];

/** Paged deploy history of a site; each row opens its job ("Lihat perubahan"). */
export function DeployHistory({ site }: { site: string }) {
  const [page, setPage] = useState(1);
  const query = useApiQuery<Page<Deploy>>(siteUrl(site, `/deploys?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`));
  return (
    <QueryView query={query} codes={DEPLOY_ERROR_CODES} empty={<EmptyState title={t.empty} />}>
      {(d) => (
        <DataTable
          label={t.label}
          columns={COLUMNS}
          rows={d.items}
          rowKey={(r) => r.id}
          rowHref={(r) => jobPath(r.jobId)}
          pagination={{
            page: d.page,
            pageCount: Math.max(1, Math.ceil(d.total / d.pageSize)),
            total: d.total,
            onPageChange: setPage,
          }}
        />
      )}
    </QueryView>
  );
}
