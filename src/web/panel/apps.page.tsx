import { PackageIcon } from "lucide-react";
import { Link } from "react-router";
import type { App } from "@/shared/panel.types";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { ErrorState } from "@/web/components/error-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { idPanel } from "@/web/i18n/id.panel";
import { formatDuration, formatMegabytes, formatNumber } from "@/web/shared/format";
import { useApiQuery } from "@/web/shared/use-api-query";
import { CodeText } from "./code.text";
import { PANEL_REFRESH_MS, panelUrl } from "./panel.api";
import { appKey } from "./panel.status-key";
import { UnitActions } from "./unit.actions";
import { usePanelControl } from "./use-panel-control";

const t = idPanel.apps;
const dash = idPanel.dash;

/** Restart count of a crash-looping or errored app is worth a warning colour. */
const restartsTone = (a: App) => (a.status === "errored" ? "text-warning font-medium" : undefined);

/** Columns without CPU: Android never reports it (App.cpu is always null). */
export const appColumns: DataColumn<App>[] = [
  { key: "name", header: t.cols.name, mobile: "title", cell: (a) => <span className="font-mono">{a.name}</span> },
  { key: "status", header: t.cols.status, mobile: "badge", cell: (a) => <StatusBadge state={appKey(a)} /> },
  {
    key: "site",
    header: t.cols.site,
    cell: (a) =>
      a.site ? (
        <Link
          to={`/panel/sites/${encodeURIComponent(a.site)}`}
          className="relative z-10 underline-offset-4 hover:underline"
        >
          {a.site}
        </Link>
      ) : (
        dash
      ),
  },
  {
    key: "memory",
    header: t.cols.memory,
    align: "right",
    cell: (a) => (a.memoryMb === null ? dash : formatMegabytes(a.memoryMb)),
  },
  {
    key: "uptime",
    header: t.cols.uptime,
    align: "right",
    cell: (a) => (a.uptimeSec === null ? dash : formatDuration(a.uptimeSec)),
  },
  {
    key: "restarts",
    header: t.cols.restarts,
    align: "right",
    cell: (a) => <span className={restartsTone(a)}>{t.restarts(formatNumber(a.restarts))}</span>,
  },
  {
    key: "port",
    header: t.cols.port,
    align: "right",
    mobile: "hidden",
    cell: (a) => <span className="font-mono text-muted-foreground">{a.port ?? dash}</span>,
  },
];

function Pm2Down({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <ErrorState
      title={t.pm2Down}
      description={t.pm2DownBody}
      onRetry={onRetry}
      retrying={retrying}
      action={
        <Button size="sm" asChild>
          <Link to="/panel/services">{t.openServices}</Link>
        </Button>
      }
    />
  );
}

/** /panel/apps: pm2 apps (modules folded away) with start/restart/stop; pm2 down gets its own state. */
export function AppsPage() {
  const query = useApiQuery<App[]>(panelUrl("/apps"), PANEL_REFRESH_MS);
  const control = usePanelControl("apps", query.reload);
  const pm2Down = query.error?.code === "pm2_unavailable";
  return (
    <>
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading, live: true }}
      />
      {pm2Down ? (
        <Pm2Down onRetry={query.reload} retrying={query.loading} />
      ) : (
        <QueryView
          query={query}
          codes={idPanel.errorCodes}
          empty={<EmptyState icon={PackageIcon} title={t.emptyTitle} description={<CodeText text={t.emptyBody} />} />}
        >
          {(list) => <AppList list={list} control={control} />}
        </QueryView>
      )}
    </>
  );
}

function AppList({ list, control }: { list: App[]; control: ReturnType<typeof usePanelControl> }) {
  const apps = list.filter((a) => !a.module);
  const modules = list.filter((a) => a.module);
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        label={t.label}
        columns={appColumns}
        rows={apps}
        rowKey={(a) => a.name}
        rowTone={(a) => (a.status === "errored" ? "danger" : undefined)}
        empty={<EmptyState icon={PackageIcon} title={t.emptyTitle} description={<CodeText text={t.emptyBody} />} />}
        actions={(a) => (
          <UnitActions
            target={{ kind: "apps", item: a }}
            control={control}
            logTo={`/panel/apps/${encodeURIComponent(a.name)}/log${a.status === "errored" ? "?stream=err" : ""}`}
          />
        )}
      />
      {modules.length > 0 && (
        <details className="rounded-lg border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium pointer-coarse:py-2">{t.modules(modules.length)}</summary>
          <DataTable
            className="mt-3"
            label={t.modules(modules.length)}
            columns={appColumns.filter((c) => c.key !== "site" && c.key !== "port")}
            rows={modules}
            rowKey={(a) => a.name}
          />
        </details>
      )}
    </div>
  );
}
