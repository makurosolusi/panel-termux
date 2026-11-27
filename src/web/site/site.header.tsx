import {
  ActivityIcon,
  EllipsisIcon,
  HistoryIcon,
  PlayIcon,
  RotateCwIcon,
  ScrollTextIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { type JobAccepted, missingFromPm2, type SiteDetail } from "@/shared/site.types";
import { CodeText } from "@/web/components/code-text";
import { ConfirmAction } from "@/web/components/confirm-action";
import { PageHeader, type PageMeta } from "@/web/components/page-header";
import { RelativeTime } from "@/web/components/relative-time";
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
import { toast } from "@/web/shared/toast.lazy";
import { deployOutcomeSuffix } from "./job.status-key";
import { jobPath, siteUrl } from "./site.api";
import { canRestart, HostLink, SiteAppBadge } from "./site.card";
import { healthToast, siteBusy } from "./site-detail.state";

const t = idSiteDetail.header;

/**
 * "Mulai ulang" with its confirmation (job `site.restart` → progress page); disabled while busy or not deployed.
 * While pm2 does not run the app it is the primary "Jalankan lagi" (the same job loads it again, PLAN/06 §6.3).
 */
export function RestartAction({ site, codes, variant = "outline" }: RestartProps) {
  const navigate = useNavigate();
  const missing = missingFromPm2(site);
  const label = missing ? t.runAgain : t.restart;
  return (
    <ConfirmAction
      title={missing ? t.runAgainTitle(site.name) : t.restartTitle(site.name)}
      description={
        <>
          <span>{missing ? t.runAgainBody : t.restartBody}</span>
          <span>{t.restartAfter}</span>
        </>
      }
      confirmLabel={label}
      codes={codes}
      onConfirm={async () =>
        navigate(jobPath((await apiFetch<JobAccepted>("POST", siteUrl(site.name, "/restart"))).jobId))
      }
      trigger={
        <Button variant={missing ? "default" : variant} size="sm" disabled={siteBusy(site) || !canRestart(site)}>
          {missing ? <PlayIcon aria-hidden /> : <RotateCwIcon aria-hidden />}
          {label}
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
      status={<SiteAppBadge site={site} />}
      meta={props.meta}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {primary && <HostLink host={primary} />}
          <span>
            {last ? (
              <RelativeTime
                at={last.at}
                format={(rel) => t.lastDeploy(rel, last.actorName) + deployOutcomeSuffix(last.status)}
              />
            ) : (
              t.neverDeployed
            )}
          </span>
          {!site.managed && <span>{t.adopted}</span>}
          {site.appStatus === "unknown" && <span>{t.pm2Unknown}</span>}
          {missingFromPm2(site) && (
            <span className="text-danger">
              <CodeText>{site.managed ? t.missingFromPm2Help : t.missingFromPm2Adopted}</CodeText>
            </span>
          )}
        </span>
      }
      actions={
        <>
          <Button size="sm" variant={missingFromPm2(site) ? "outline" : "default"} asChild>
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
