import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import type { Problem } from "@/shared/monitor.types";
import type { Domain, PanelOverview } from "@/shared/panel.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { STATUS_META } from "@/web/components/status.vocab";
import { StatusBadge } from "@/web/components/status-badge";
import { idHistory } from "@/web/i18n/id.history";
import { idPanel } from "@/web/i18n/id.panel";
import { formatNumber } from "@/web/shared/format";
import { useApiQuery } from "@/web/shared/use-api-query";
import { CodeText } from "./code.text";
import { DomainCheckButton } from "./domain.check";
import { HeartbeatStrip } from "./heartbeat.strip";
import { DOMAINS_REFRESH_MS, panelUrl } from "./panel.api";
import { domainHolder, domainVerdict, isWildcard, type Verdict } from "./panel.status-key";

const t = idPanel.domains;

/** "Situs blog · aplikasi blog-app" / "Panel Termux" / "Layanan lain (…)" / "Tanpa tujuan". */
export function domainTarget(d: Domain): string {
  const target = d.target ?? (d.app ? "app" : d.port === null ? "none" : "other");
  if (target === "app" && d.app) return t.target.app(d.site ?? null, d.app);
  if (target === "panel") return t.target.panel;
  if (target === "none") return t.target.none;
  return t.target.other(d.service);
}

type Row = Domain & { verdict: Verdict };

const columns: DataColumn<Row>[] = [
  {
    key: "domain",
    header: t.cols.domain,
    mobile: "title",
    cell: (d) => (
      <a
        href={`https://${d.hostname}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t.open(d.hostname)}
        className="relative z-10 inline-flex min-w-0 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
      >
        <span className="truncate">{d.hostname}</span>
        <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </a>
    ),
  },
  {
    key: "target",
    header: t.cols.target,
    cell: (d) => <span className="text-muted-foreground">{domainTarget(d)}</span>,
  },
  {
    key: "status",
    header: t.cols.status,
    mobile: "badge",
    cell: (d) => <StatusBadge state={d.verdict.key} />,
  },
  {
    key: "reason",
    header: t.cols.reason,
    cell: (d) => (d.verdict.reason ? <span className="text-xs text-muted-foreground">{d.verdict.reason}</span> : null),
  },
  {
    key: "response",
    header: t.cols.response,
    align: "right",
    cell: (d) => (d.health.ms === null ? idPanel.dash : t.ms(formatNumber(d.health.ms))),
  },
  {
    key: "recent",
    header: idHistory.heartbeat.column,
    cell: (d) => <HeartbeatStrip checks={d.recent} />,
  },
  {
    key: "checked",
    header: t.cols.checked,
    align: "right",
    cell: (d) => (d.health.checkedAt ? <RelativeTime at={d.health.checkedAt} /> : t.never),
  },
];

/** Domains with their verdict; app status and the holding problem come from the (cached) overview when loaded. */
export function domainRows(domains: readonly Domain[], o: PanelOverview | undefined): Row[] {
  const problems = (o?.problems ?? []) as Problem[]; // server sends the full monitor Problem (W7 aliases the type)
  return domains.map((d) => {
    const failing = d.health.status === null || d.health.status >= 500;
    const verdict = domainVerdict(d.health, {
      port: d.port,
      wildcard: isWildcard(d.hostname),
      appStatus: d.app ? (o?.apps.find((a) => a.name === d.app)?.status ?? null) : null,
      heldBy: failing ? domainHolder(d, problems) : null,
    });
    return { ...d, verdict };
  });
}

/** /panel/domains: cloudflared hostnames → port/app, verdict with a one-sentence reason, manual re-check. */
export function DomainsPage() {
  const query = useApiQuery<Domain[]>(panelUrl("/domains"), DOMAINS_REFRESH_MS);
  const context = useApiQuery<PanelOverview>(panelUrl("/overview"), DOMAINS_REFRESH_MS);
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading, live: true }}
      />
      <QueryView
        query={query}
        codes={idPanel.errorCodes}
        empty={<EmptyState icon={GlobeIcon} title={t.emptyTitle} description={<CodeText text={t.emptyBody} />} />}
      >
        {(domains) => (
          <DataTable
            label={t.label}
            columns={columns}
            rows={domainRows(domains, context.data)}
            rowKey={(d) => d.hostname}
            rowTone={(d) => {
              const tone = STATUS_META[d.verdict.key].tone;
              return tone === "danger" || tone === "warning" ? tone : undefined;
            }}
            actions={(d) =>
              isWildcard(d.hostname) ? null : <DomainCheckButton hostname={d.hostname} onChecked={query.reload} />
            }
          />
        )}
      </QueryView>
    </>
  );
}
