import { ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { type JobAccepted, missingFromPm2, type Site, type SiteAppStatus, type SiteDetail } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import type { DataColumn } from "@/web/components/data-table";
import { RelativeTime } from "@/web/components/relative-time";
import type { StatusTone } from "@/web/components/status.tone";
import type { StatusKey } from "@/web/components/status.vocab";
import { StatusBadge } from "@/web/components/status-badge";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { idSite } from "@/web/i18n/id.site";
import { apiFetch } from "@/web/shared/api.client";
import { deployOutcomeSuffix } from "./job.status-key";
import { jobPath, SITE_ERROR_CODES, siteUrl } from "./site.api";

const t = idSite.list;

const APP_STATUS_KEY: Readonly<Record<SiteAppStatus, StatusKey>> = {
  online: "running",
  launching: "starting",
  errored: "errored",
  stopped: "stopped",
  unknown: "unknown",
  not_deployed: "not_deployed",
};

/** Canonical status of a site's pm2 app ("unknown" when pm2 is unavailable). */
export const siteStatusKey = (status: SiteAppStatus): StatusKey => APP_STATUS_KEY[status];

const ROW_TONE: Partial<Record<SiteAppStatus, StatusTone>> = {
  errored: "danger",
  stopped: "warning",
  launching: "warning",
};

type StatusFacts = Pick<Site, "appStatus" | "managed" | "lastDeploy"> & Partial<Pick<SiteDetail, "binary">>;

/** Restart has an app to act on: pm2 knows it, or a managed site's entry can be (re)loaded from apps.json. */
export const canRestart = (s: StatusFacts): boolean =>
  s.appStatus !== "not_deployed" || (s.managed && missingFromPm2(s));

/** Row edge tone: only sites whose app needs a look get one. */
export const siteRowTone = (s: StatusFacts): StatusTone | undefined =>
  missingFromPm2(s) ? "danger" : ROW_TONE[s.appStatus];

/** pm2 status badge of a site's app: "Tidak berjalan di pm2" (danger) when it should be there. */
export function SiteAppBadge({ site }: { site: StatusFacts }) {
  return missingFromPm2(site) ? (
    <StatusBadge state="down" label={t.missingFromPm2} />
  ) : (
    <StatusBadge state={siteStatusKey(site.appStatus)} />
  );
}

/** Hostname as an external link. */
export function HostLink({ host }: { host: string }) {
  return (
    <a
      href={`https://${host}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.openHost(host)}
      className="relative z-10 inline-flex min-w-0 items-center gap-1 hover:underline"
    >
      <span className="truncate">{host}</span>
      <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

/** Columns of the Situs list (phone card: name + status, then domain · deploy · port). */
export const SITE_COLUMNS: readonly DataColumn<Site>[] = [
  {
    key: "name",
    header: t.cols.name,
    mobile: "title",
    cell: (s) => (
      <span className="inline-flex items-center gap-2">
        <span className="font-medium">{s.name}</span>
        {!s.managed && <Badge variant="secondary">{t.adopted}</Badge>}
      </span>
    ),
  },
  { key: "status", header: t.cols.status, mobile: "badge", cell: (s) => <SiteAppBadge site={s} /> },
  {
    key: "domain",
    header: t.cols.domain,
    cell: (s) => (
      <span className="inline-flex min-w-0 items-center gap-1">
        {s.hostnames[0] && <HostLink host={s.hostnames[0]} />}
        {s.hostnames.length > 1 && <span className="text-muted-foreground">{t.more(s.hostnames.length - 1)}</span>}
      </span>
    ),
  },
  {
    key: "deploy",
    header: t.cols.deploy,
    cell: (s) => {
      const d = s.lastDeploy;
      return d ? <RelativeTime at={d.at} format={(rel) => rel + deployOutcomeSuffix(d.status)} /> : t.neverDeployed;
    },
  },
  { key: "port", header: t.cols.port, align: "right", cell: (s) => t.port(s.port), className: "font-mono" },
];

/** "⋯" menu of one site (open, deploy, restart → job page, app log), plus a Deploy button on phone cards. */
export function SiteRowActions({ site }: { site: Site }) {
  const navigate = useNavigate();
  const [restarting, setRestarting] = useState(false);
  const host = site.hostnames[0];
  const app = site.app ?? site.name;
  const restart = async () => {
    const { jobId } = await apiFetch<JobAccepted>("POST", siteUrl(site.name, "/restart"));
    navigate(jobPath(jobId));
  };
  const deployTo = `/panel/sites/${encodeURIComponent(site.name)}#deploy`;
  return (
    <>
      {/* phone card footer: the common next step, so the row is not just a lone "⋯" (QA N6) */}
      {site.managed && (
        <Button asChild variant="outline" size="sm" className="md:hidden">
          <Link to={deployTo}>{t.deploy}</Link>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t.actions(site.name)} className="ml-auto">
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {host && (
            <DropdownMenuItem asChild>
              <a href={`https://${host}`} target="_blank" rel="noopener noreferrer">
                {t.open}
                <ExternalLinkIcon className="ml-auto" aria-hidden />
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to={deployTo}>{t.deploy}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canRestart(site)} onSelect={() => setRestarting(true)}>
            {t.restart}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/panel/apps/${encodeURIComponent(app)}/log`}>{t.appLog}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={restarting}
        onOpenChange={setRestarting}
        title={t.restartTitle(site.name)}
        description={t.restartBody}
        confirmLabel={t.restart}
        codes={SITE_ERROR_CODES}
        onConfirm={restart}
      />
    </>
  );
}
