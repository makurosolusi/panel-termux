import {
  ActivityIcon,
  EllipsisIcon,
  HistoryIcon,
  InfoIcon,
  RotateCwIcon,
  ScrollTextIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import type { Job, JobAccepted, SiteDetail } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { PageHeader, type PageMeta } from "@/web/components/page-header";
import { RelativeTime } from "@/web/components/relative-time";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch, type ErrorCodes } from "@/web/shared/api.client";
import { jobPath, siteUrl } from "./site.api";
import { HostLink, siteStatusKey } from "./site.card";
import { healthToast, type SiteBanner, siteBanners, siteBusy } from "./site-detail.state";

const t = idSiteDetail.header;
const b = idSiteDetail.banner;

/** "Mulai ulang" with its confirmation (job `site.restart` → progress page); disabled while busy or not deployed. */
export function RestartAction({ site, codes, variant = "outline" }: RestartProps) {
  const navigate = useNavigate();
  return (
    <ConfirmAction
      title={t.restartTitle(site.name)}
      description={
        <>
          <span>{t.restartBody}</span>
          <span>{t.restartAfter}</span>
        </>
      }
      confirmLabel={t.restart}
      codes={codes}
      onConfirm={async () =>
        navigate(jobPath((await apiFetch<JobAccepted>("POST", siteUrl(site.name, "/restart"))).jobId))
      }
      trigger={
        <Button variant={variant} size="sm" disabled={siteBusy(site) || site.appStatus === "not_deployed"}>
          <RotateCwIcon aria-hidden />
          {t.restart}
        </Button>
      }
    />
  );
}
type RestartProps = { site: SiteDetail; codes: ErrorCodes; variant?: "outline" | "default" };

async function checkHealth(name: string) {
  try {
    const r = healthToast(await apiFetch("GET", siteUrl(name, "/health")));
    if (r.ok) toast.success(r.text);
    else toast.warning(r.text, { duration: ERROR_TOAST_MS });
  } catch (err) {
    toast.error(apiErrorMessage(err, { not_found: t.healthFailed }), { duration: ERROR_TOAST_MS });
  }
}

/** Title row of the site detail: name, app status, primary domain, last deploy, Deploy / Mulai ulang / ⋯ menu. */
export function SiteHeader(props: { site: SiteDetail; meta: PageMeta; codes: ErrorCodes; onDelete: () => void }) {
  const { site } = props;
  const [primary] = site.hostnames;
  const last = site.lastDeploy;
  return (
    <PageHeader
      title={site.name}
      back={{ to: "/panel/sites", label: idSiteDetail.back }}
      status={<StatusBadge state={siteStatusKey(site.appStatus)} />}
      meta={props.meta}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {primary && <HostLink host={primary} />}
          <span>
            {last ? <RelativeTime at={last.at} format={(rel) => t.lastDeploy(rel, last.actorName)} /> : t.neverDeployed}
          </span>
          {!site.managed && <span>{t.adopted}</span>}
          {site.appStatus === "unknown" && <span>{t.pm2Unknown}</span>}
        </span>
      }
      actions={
        <>
          <Button size="sm" asChild>
            <a href="#deploy">
              <UploadIcon aria-hidden />
              {t.deploy}
            </a>
          </Button>
          <RestartAction site={site} codes={props.codes} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t.more(site.name)}>
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => void checkHealth(site.name)}>
                <ActivityIcon aria-hidden />
                {t.health}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/panel/apps/${encodeURIComponent(site.app ?? site.name)}/log`}>
                  <ScrollTextIcon aria-hidden />
                  {t.appLog}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/panel/jobs?target=${encodeURIComponent(site.name)}`}>
                  <HistoryIcon aria-hidden />
                  {t.jobs}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={siteBusy(site)} onSelect={props.onDelete}>
                <Trash2Icon aria-hidden />
                {t.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}

const BANNER = {
  info: { Icon: InfoIcon, box: "border-info/25 bg-info-subtle", icon: "text-info" },
  warning: { Icon: TriangleAlertIcon, box: "border-warning/25 bg-warning-subtle", icon: "text-warning" },
};
const linkCls = "font-medium underline underline-offset-4";
type BannersProps = { site: SiteDetail; interrupted: Job | null; codes: ErrorCodes };

/** Running / interrupted change, restart pending and deploy blocker notices of one site. */
export function SiteBanners({ site, interrupted, codes }: BannersProps) {
  const job = site.activeJob;
  const link = (to: string, label: string) => (
    <Link className={linkCls} to={to}>
      {label}
    </Link>
  );
  const view = (kind: SiteBanner): [tone: "info" | "warning", text: ReactNode, action: ReactNode] => {
    if (kind === "running" || kind === "busy_other")
      return [
        "info",
        kind === "running" ? b.running : b.busyOther(job?.target ?? ""),
        job && link(jobPath(job.id), b.viewJob),
      ];
    if (kind === "interrupted")
      return ["warning", b.interrupted, interrupted && link(jobPath(interrupted.id), b.openJob)];
    if (kind === "restart_pending")
      return ["warning", b.restartPending, <RestartAction key="restart" site={site} codes={codes} />];
    const blocker = site.deployBlocker;
    return ["warning", blocker && b.blockers[blocker], blocker === "integration" && link("/panel/sites", b.toSites)];
  };
  return siteBanners(site, interrupted).map((kind) => {
    const [tone, text, action] = view(kind);
    const { Icon, box, icon } = BANNER[tone];
    return (
      <div
        key={kind}
        role="status"
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm ${box}`}
      >
        <Icon className={`size-4 shrink-0 ${icon}`} aria-hidden />
        <span className="min-w-0 flex-1">{text}</span>
        {action}
      </div>
    );
  });
}
