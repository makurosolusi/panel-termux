import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Job, SiteDetail } from "@/shared/site.types";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import type { ErrorCodes } from "@/web/shared/api.client";
import { ServiceStartButton } from "@/web/shared/service-start";
import { jobPath } from "./site.api";
import { RestartAction } from "./site.header";
import { type SiteBanner, siteBanners } from "./site-detail.state";

const b = idSiteDetail.banner;

const BANNER = {
  info: { Icon: InfoIcon, box: "border-info/25 bg-info-subtle", icon: "text-info" },
  warning: { Icon: TriangleAlertIcon, box: "border-warning/25 bg-warning-subtle", icon: "text-warning" },
};
const linkCls = "font-medium underline underline-offset-4";
type BannersProps = { site: SiteDetail; interrupted: Job | null; codes: ErrorCodes; onChanged?: () => void };

/** Running / interrupted change, restart pending and deploy blocker notices of one site (pm2 down: "Jalankan pm2"). */
export function SiteBanners({ site, interrupted, codes, onChanged }: BannersProps) {
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
    const action =
      blocker === "integration" ? (
        link("/panel/sites", b.toSites)
      ) : blocker === "pm2_not_running" ? (
        <ServiceStartButton service="pm2" onStarted={onChanged} />
      ) : null;
    return ["warning", blocker && b.blockers[blocker], action];
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
