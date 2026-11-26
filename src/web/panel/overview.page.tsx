import { AlertTriangleIcon, GlobeIcon, PackageIcon, ServerIcon } from "lucide-react";
import { Link } from "react-router";
import type { PanelOverview } from "@/shared/panel.types";
import { Skeleton } from "@/web/components/ui/skeleton";
import { id } from "@/web/i18n/id";
import { QueryView } from "@/web/shared/query.state";
import { StatCard } from "@/web/shared/stat.card";
import { useApiQuery } from "@/web/shared/use-api-query";
import { DeviceCards } from "./device.cards";
import { PANEL_REFRESH_MS, panelUrl } from "./panel.api";
import { countProblems } from "./panel.status";
import { StatusBadge } from "./status.badge";

const t = id.panel;
const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

function OverviewSkeleton() {
  return (
    <div className={GRID} aria-busy="true">
      {["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => (
        <Skeleton key={k} className="h-28 w-full" />
      ))}
    </div>
  );
}

function Overview({ o }: { o: PanelOverview }) {
  const problems = countProblems(o);
  const counts = [
    {
      to: "/panel/services",
      icon: ServerIcon,
      label: t.counts.services,
      total: o.services.length,
      bad: problems.services,
    },
    { to: "/panel/apps", icon: PackageIcon, label: t.counts.apps, total: o.apps.length, bad: problems.apps },
    { to: "/panel/domains", icon: GlobeIcon, label: t.counts.domains, total: o.domains.length, bad: problems.domains },
  ];
  return (
    <div className="flex flex-col gap-4">
      {o.mode === "fake" && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
          {t.fakeMode}
        </p>
      )}
      <div className={GRID}>
        {counts.map((c) => (
          <Link key={c.to} to={c.to} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard icon={c.icon} label={c.label} value={String(c.total)}>
              <StatusBadge tone={c.bad > 0 ? "bad" : "ok"} label={t.counts.problems(c.bad)} />
            </StatCard>
          </Link>
        ))}
        <DeviceCards d={o.device} />
      </div>
    </div>
  );
}

/** /panel (index): device metrics, service/app/domain counts with problems highlighted; refreshed every 10 s. */
export function OverviewPage() {
  const query = useApiQuery<PanelOverview>(panelUrl("/overview"), PANEL_REFRESH_MS);
  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t.refreshing}</p>
      <QueryView query={query} codes={t.errorCodes} skeleton={<OverviewSkeleton />}>
        {(o) => <Overview o={o} />}
      </QueryView>
    </section>
  );
}
