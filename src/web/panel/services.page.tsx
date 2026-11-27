import { ServerIcon } from "lucide-react";
import type { Service } from "@/shared/panel.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { STATUS_META } from "@/web/components/status.vocab";
import { StatusBadge } from "@/web/components/status-badge";
import { tPanel } from "@/web/i18n/en.panel";
import { formatDuration } from "@/web/shared/format";
import { useApiQuery } from "@/web/shared/use-api-query";
import { CodeText } from "./code.text";
import { PANEL_REFRESH_MS, panelUrl } from "./panel.api";
import { serviceKey } from "./panel.status-key";
import { RestartOverlay } from "./restart.overlay";
import { UnitActions } from "./unit.actions";
import { usePanelControl } from "./use-panel-control";

const t = tPanel.services;
const CODES = { ...tPanel.errorCodes, system_error: t.error };

const TONE_RANK = { danger: 0, warning: 1, info: 2, neutral: 3, accent: 3, success: 4 } as const;

/** Problems first (danger, warning, …), then by name. */
export const sortServices = (list: readonly Service[]): Service[] =>
  [...list].sort(
    (a, b) =>
      TONE_RANK[STATUS_META[serviceKey(a)].tone] - TONE_RANK[STATUS_META[serviceKey(b)].tone] ||
      a.name.localeCompare(b.name),
  );

/** Whole minutes only (content guide: no seconds): the row is polled, so a ticking "1 dtk" would freeze (QA #20). */
const minutes = (sec: number): string | null => (sec < 60 ? null : formatDuration(sec - (sec % 60)));

/** "aktif 3 jam" / "mati 33 jam" / "baru mulai" / "baru berhenti" (under a minute) / "–". */
export function serviceSince(s: Service): string {
  if (s.state === "run" && s.uptimeSec !== null) {
    const d = minutes(s.uptimeSec);
    return d ? t.upFor(d) : t.upJustNow;
  }
  if (s.state === "down" && s.downSec != null) {
    const d = minutes(s.downSec);
    return d ? t.downFor(d) : t.downJustNow;
  }
  return tPanel.dash;
}

const columns: DataColumn<Service>[] = [
  {
    key: "name",
    header: t.cols.name,
    mobile: "title",
    cell: (s) => (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono">{s.name}</span>
        {s.protected && (
          <span className="rounded border px-1 text-[0.6875rem] font-normal text-muted-foreground">
            {tPanel.coreBadge}
          </span>
        )}
      </span>
    ),
  },
  { key: "status", header: t.cols.status, mobile: "badge", cell: (s) => <StatusBadge state={serviceKey(s)} /> },
  { key: "since", header: t.cols.since, cell: serviceSince },
  {
    key: "pid",
    header: t.cols.pid,
    align: "right",
    mobile: "hidden",
    cell: (s) => <span className="font-mono text-muted-foreground">{s.pid ?? tPanel.dash}</span>,
  },
];

/** /panel/services: runit services, problems first, with start/restart/stop by tier and the panel reconnect overlay. */
export function ServicesPage() {
  const query = useApiQuery<Service[]>(panelUrl("/services"), PANEL_REFRESH_MS);
  const control = usePanelControl("services", query.reload);
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{
          updatedAt: query.updatedAt,
          onRefresh: query.reload,
          refreshing: query.loading,
          live: true,
          stale: !!query.error,
        }}
      />
      <QueryView
        query={query}
        codes={CODES}
        empty={<EmptyState icon={ServerIcon} title={t.emptyTitle} description={<CodeText text={t.emptyBody} />} />}
      >
        {(list) => (
          <DataTable
            label={t.label}
            columns={columns}
            rows={sortServices(list)}
            rowKey={(s) => s.name}
            rowTone={(s) => {
              const tone = STATUS_META[serviceKey(s)].tone;
              return tone === "danger" || tone === "warning" ? tone : undefined;
            }}
            actions={(s) => (
              <UnitActions
                target={{ kind: "services", item: s }}
                control={control}
                logTo={`/panel/services/${encodeURIComponent(s.name)}/log`}
              />
            )}
          />
        )}
      </QueryView>
      {control.restart && (
        <RestartOverlay
          restart={control.restart}
          onDone={() => {
            control.endRestart();
            query.reload();
          }}
        />
      )}
    </>
  );
}
