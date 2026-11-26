import { XIcon } from "lucide-react";
import { useSearchParams } from "react-router";
import type { Page } from "@/shared/dev.types";
import type { Job, JobKind, JobStatus } from "@/shared/site.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { usePageParam } from "@/web/components/use-page-param";
import { idJob } from "@/web/i18n/id.job";
import { idStatus } from "@/web/i18n/id.status";
import { panelUrl } from "@/web/panel/panel.api";
import { useApiQuery } from "@/web/shared/use-api-query";
import { durationText } from "./job.state";
import { JOB_STATUS_KEY } from "./job.status-key";
import { jobPath, SITE_ERROR_CODES } from "./site.api";

const t = idJob.list;
const PAGE_SIZE = 20;
const ALL = "all";
const KINDS = Object.keys(idJob.kinds) as JobKind[];
const STATUSES = Object.keys(JOB_STATUS_KEY) as JobStatus[];

const COLUMNS: DataColumn<Job>[] = [
  {
    key: "change",
    header: t.columns.change,
    mobile: "title",
    cell: (j) => (
      <span>
        {idJob.kinds[j.kind]} <span className="text-muted-foreground">· {j.target}</span>
      </span>
    ),
  },
  {
    key: "status",
    header: t.columns.status,
    mobile: "badge",
    cell: (j) => <StatusBadge state={JOB_STATUS_KEY[j.status]} />,
  },
  { key: "actor", header: t.columns.actor, cell: (j) => j.actor?.name || t.system },
  { key: "started", header: t.columns.started, cell: (j) => <RelativeTime at={j.startedAt} /> },
  {
    key: "duration",
    header: t.columns.duration,
    align: "right",
    cell: (j) => (typeof j.durationMs === "number" ? durationText(j.durationMs) : "–"),
  },
];

function FilterSelect<T extends string>(props: {
  label: string;
  all: string;
  value: T | null;
  options: readonly T[];
  text: (v: T) => string;
  onChange: (v: T | null) => void;
}) {
  return (
    <Select value={props.value ?? ALL} onValueChange={(v) => props.onChange(v === ALL ? null : (v as T))}>
      <SelectTrigger size="sm" className="w-44" aria-label={props.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{props.all}</SelectItem>
        {props.options.map((o) => (
          <SelectItem key={o} value={o}>
            {props.text(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** /panel/jobs?target&kind&status&page: change history, newest first, filterable. */
export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = usePageParam();
  const target = params.get("target");
  const kind = KINDS.find((k) => k === params.get("kind")) ?? null;
  const status = STATUSES.find((s) => s === params.get("status")) ?? null;
  const filtered = Boolean(target || kind || status);
  const query = useApiQuery<Page<Job>>(panelUrl("/jobs", { page, pageSize: PAGE_SIZE, target, kind, status }));

  const setFilter = (key: string, value: string | null) =>
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete("page");
      if (value) out.set(key, value);
      else out.delete(key);
      return out;
    });

  const toolbar = (
    <>
      <FilterSelect
        label={t.filterKind}
        all={t.allKinds}
        value={kind}
        options={KINDS}
        text={(k) => idJob.kinds[k]}
        onChange={(v) => setFilter("kind", v)}
      />
      <FilterSelect
        label={t.filterStatus}
        all={t.allStatuses}
        value={status}
        options={STATUSES}
        text={(s) => idStatus[JOB_STATUS_KEY[s]]}
        onChange={(v) => setFilter("status", v)}
      />
      {filtered && (
        <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams())}>
          <XIcon aria-hidden />
          {t.clearFilters}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title={target ? t.forTarget(target) : idJob.listTitle}
        description={idJob.listDescription}
        meta={{
          updatedAt: query.updatedAt,
          onRefresh: query.reload,
          refreshing: query.loading,
          stale: Boolean(query.error),
        }}
      />
      <QueryView
        query={query}
        codes={{ ...SITE_ERROR_CODES, ...idJob.errorCodes }}
        isEmpty={(d) => d.items.length === 0 && !filtered}
        empty={<EmptyState title={t.empty} />}
      >
        {(d) => (
          <DataTable
            label={t.label}
            columns={COLUMNS}
            rows={d.items}
            rowKey={(j) => j.id}
            rowHref={(j) => jobPath(j.id)}
            toolbar={toolbar}
            empty={<EmptyState title={t.emptyFiltered} />}
            pagination={{
              page: d.page,
              pageCount: Math.max(1, Math.ceil(d.total / d.pageSize)),
              total: d.total,
              onPageChange: setPage,
            }}
          />
        )}
      </QueryView>
    </div>
  );
}
