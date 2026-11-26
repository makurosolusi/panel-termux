import { cn } from "cn";
import { GlobeIcon, HistoryIcon, LoaderCircleIcon, PlusIcon, UnplugIcon } from "lucide-react";
import { Link } from "react-router";
import type { Page } from "@/shared/dev.types";
import type { ActiveJob, Discovered, Integration, Job, Site } from "@/shared/site.types";
import { DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import { PANEL_REFRESH_MS, panelUrl } from "@/web/panel/panel.api";
import { useApiQuery } from "@/web/shared/use-api-query";
import { discoveredRows, integrationReady } from "./site.adopt";
import { jobPath, SITE_ERROR_CODES } from "./site.api";
import { SITE_COLUMNS, SiteRowActions, siteRowTone } from "./site.card";
import { SiteDiscovered } from "./site.discovered";
import { SiteSetup } from "./site.setup";

const t = idSite.list;

/** Running change (info) or an interrupted one still to recover (warning), with a link to its job page. */
function JobBanner({ job, interrupted }: { job: Pick<Job, "id" | "kind" | "target">; interrupted?: boolean }) {
  const Icon = interrupted ? UnplugIcon : LoaderCircleIcon;
  const text = (interrupted ? t.interrupted : t.running)(idSite.job.kinds[job.kind], job.target);
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm",
        interrupted ? "border-warning/25 bg-warning-subtle" : "border-info/25 bg-info-subtle",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", interrupted ? "text-warning" : "text-info motion-safe:animate-spin")}
        aria-hidden
      />
      <span className="min-w-0 flex-1">{text}</span>
      <Button asChild size="sm" variant="outline">
        <Link to={jobPath(job.id)}>{t.viewJob}</Link>
      </Button>
    </div>
  );
}

/** Buat situs: disabled with the reason while pm2 is not ready for panel-built sites. */
function CreateButton({ ready }: { ready: boolean }) {
  if (ready) {
    return (
      <Button asChild>
        <Link to="/panel/sites/new">
          <PlusIcon aria-hidden />
          {t.create}
        </Link>
      </Button>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <Button disabled aria-describedby="create-blocked">
        <PlusIcon aria-hidden />
        {t.create}
      </Button>
      <span id="create-blocked" className="text-xs text-muted-foreground">
        {t.createBlocked}
      </span>
    </span>
  );
}

/** /panel/sites: Persiapan first, then the site list (problems first) and domains not managed yet. */
export function SitesPage() {
  const sites = useApiQuery<Site[]>(panelUrl("/sites"), PANEL_REFRESH_MS);
  const integration = useApiQuery<Integration>(panelUrl("/integration"));
  const discovered = useApiQuery<Discovered>(panelUrl("/sites/discovered"));
  const active = useApiQuery<{ job: ActiveJob | null }>(panelUrl("/jobs/active"), PANEL_REFRESH_MS);
  const interrupted = useApiQuery<Page<Job>>(panelUrl("/jobs", { status: "interrupted", pageSize: 5 }));
  const unresolved = interrupted.data?.items.find((j) => j.recoverMode && !j.resolvedBy);
  const ready = integration.data ? integrationReady(integration.data) : true;
  const adoptable = discovered.data ? discoveredRows(discovered.data).filter((r) => r.adoptable).length : 0;
  const refresh = () => {
    sites.reload();
    integration.reload();
    discovered.reload();
    active.reload();
    interrupted.reload();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{ updatedAt: sites.updatedAt, onRefresh: refresh, refreshing: sites.loading, live: true }}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/panel/jobs">
                <HistoryIcon aria-hidden />
                {t.jobs}
              </Link>
            </Button>
            <CreateButton ready={ready} />
          </>
        }
      />
      {active.data?.job && <JobBanner job={active.data.job} />}
      {unresolved && <JobBanner job={unresolved} interrupted />}
      {integration.data && (
        <SiteSetup integration={integration.data} adoptable={adoptable} onVerified={integration.reload} />
      )}
      <QueryView
        query={sites}
        codes={SITE_ERROR_CODES}
        empty={
          <EmptyState
            icon={GlobeIcon}
            title={t.empty}
            description={t.emptyBody}
            action={ready ? <CreateButton ready /> : undefined}
          />
        }
      >
        {(rows) => (
          <DataTable
            label={t.label}
            columns={SITE_COLUMNS}
            rows={rows}
            rowKey={(s) => s.name}
            rowHref={(s) => `/panel/sites/${encodeURIComponent(s.name)}`}
            rowTone={siteRowTone}
            actions={(s) => <SiteRowActions site={s} />}
          />
        )}
      </QueryView>
      <SiteDiscovered query={discovered} />
    </div>
  );
}
