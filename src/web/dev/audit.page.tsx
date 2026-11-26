import { DownloadIcon, InfoIcon } from "lucide-react";
import { useSearchParams } from "react-router";
import type { DevAuditEntry, Page } from "@/shared/dev.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { KeyValue } from "@/web/components/key-value";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { Button } from "@/web/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/web/components/ui/dialog";
import { usePageParam } from "@/web/components/use-page-param";
import { idDevAudit } from "@/web/i18n/id.dev.audit";
import { useApiQuery } from "@/web/shared/use-api-query";
import {
  auditActor,
  auditExportUrl,
  auditListUrl,
  describeAudit,
  invalidDateRange,
  isAuditFiltered,
} from "./audit.describe";
import { AuditFilters } from "./audit.filters";

const t = idDevAudit;
const PAGE_SIZE = 20;

/** Raw detail of one row (meta as key/value, never a JSON blob). */
function AuditDetail({ e, text }: { e: DevAuditEntry; text: string }) {
  const L = t.detailLabels;
  const opt = (label: string, value: string | null | undefined, mono = true) => (value ? [{ label, value, mono }] : []);
  const meta = Object.entries(e.meta ?? {}).map(([k, v]) => ({
    label: k,
    value: typeof v === "string" ? v : JSON.stringify(v),
    mono: true,
  }));
  const items = [
    ...opt(L.action, e.action),
    ...opt(L.target, e.target),
    ...meta,
    ...opt(L.ip, e.ipMasked),
    ...opt(L.ua, e.userAgent, false),
    ...opt(L.requestId, e.requestId),
  ];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t.detailsOf(text)} title={t.details}>
          <InfoIcon aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text}</DialogTitle>
        </DialogHeader>
        <KeyValue items={items} />
      </DialogContent>
    </Dialog>
  );
}

/** /dev/audit?action&actorId&from&to&page: audit trail as sentences, filterable, exportable as CSV. */
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = usePageParam();
  const actorId = params.get("actorId");
  const badRange = invalidDateRange(params.get("from"), params.get("to"));
  const filtered = isAuditFiltered(params);
  const query = useApiQuery<Page<DevAuditEntry>>(auditListUrl(params, page, PAGE_SIZE), undefined, {
    enabled: !badRange,
    initial: !badRange,
  });

  const setFilter = (key: string, value: string | null) =>
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete("page");
      if (value) out.set(key, value);
      else out.delete(key);
      return out;
    });

  const columns: DataColumn<DevAuditEntry>[] = [
    { key: "text", header: t.action, mobile: "title", cell: (e) => describeAudit(e).text },
    {
      key: "actor",
      header: t.actor,
      cell: (e) =>
        e.actor && e.actor.id !== actorId ? (
          <button
            type="button"
            className="underline-offset-2 hover:underline focus-visible:underline pointer-coarse:py-2"
            title={t.filterActor(auditActor(e))}
            onClick={() => setFilter("actorId", e.actor?.id ?? null)}
          >
            {auditActor(e)}
          </button>
        ) : (
          auditActor(e)
        ),
    },
    { key: "time", header: t.time, cell: (e) => <RelativeTime at={e.at} className="whitespace-nowrap" /> },
    {
      key: "device",
      header: t.device,
      mobile: "hidden",
      className: "max-w-56",
      cell: (e) => (
        <span className="block truncate text-muted-foreground" title={e.userAgent ?? undefined}>
          {[e.ipMasked, e.userAgent].filter(Boolean).join(" · ") || "–"}
        </span>
      ),
    },
  ];

  const actorName = query.data?.items.find((e) => e.actor?.id === actorId)?.actor?.name ?? null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading }}
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={auditExportUrl(params)} download title={t.exportHint}>
              <DownloadIcon aria-hidden />
              {t.exportCsv}
            </a>
          </Button>
        }
      />
      <p className="-mt-3 mb-4 text-xs text-muted-foreground max-md:-mt-1">{t.exportHint}</p>
      <AuditFilters
        params={params}
        setFilter={setFilter}
        onClear={() => setParams(new URLSearchParams())}
        actorName={actorName}
        badRange={badRange}
      />
      {badRange ? (
        <p role="alert" className="rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-sm">
          {t.invalidDate}
        </p>
      ) : (
        <QueryView
          query={query}
          codes={t.errorCodes}
          isEmpty={(d) => d.items.length === 0 && !filtered}
          empty={<EmptyState title={t.empty} />}
        >
          {(d) => (
            <DataTable
              label={t.label}
              columns={columns}
              rows={d.items}
              rowKey={(e) => String(e.id)}
              rowTone={(e) => {
                const tone = describeAudit(e).tone;
                return tone === "neutral" ? undefined : tone;
              }}
              actions={(e) => <AuditDetail e={e} text={describeAudit(e).text} />}
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
      )}
    </div>
  );
}
