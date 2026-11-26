import { lazy, Suspense } from "react";
import type { Problem } from "@/shared/monitor.types";
import type { DeviceInfo, PanelOverview } from "@/shared/panel.types";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { StatTilesSkeleton } from "@/web/components/skeletons";
import { StatusBadge } from "@/web/components/status-badge";
import { OnboardingBanner } from "@/web/dev/onboarding.banner";
import { idOverview } from "@/web/i18n/id.overview";
import { idPanel } from "@/web/i18n/id.panel";
import { useMe } from "@/web/session/use-me";
import { useApiQuery } from "@/web/shared/use-api-query";
import { DeviceTiles } from "./device.tiles";
import { ProblemStrip } from "./overview.problems";
import { AlertsLine, BackupSection, CountCards } from "./overview.sections";
import { PANEL_REFRESH_MS, panelUrl } from "./panel.api";

const t = idOverview;

// History blocks load in their own chunks after the first render, keeping /panel within its gzip budget (PLAN/01 §3.11).
const MetricTrends = lazy(() => import("./sparkline").then((m) => ({ default: m.MetricTrends })));
const ActivityList = lazy(() => import("./overview.activity").then((m) => ({ default: m.ActivityList })));
const RecentProblems = lazy(() => import("./problems.page").then((m) => ({ default: m.RecentProblems })));

function Overview({ o }: { o: PanelOverview }) {
  const { role } = useMe();
  // Transitional shared types (W7 tightens them): the server already sends full Problems and null for failed parts.
  const problems = o.problems as Problem[];
  const device = o.device as DeviceInfo | null;
  const backup = o.backup as PanelOverview["backup"] | null;
  return (
    <div className="flex flex-col gap-6">
      <ProblemStrip
        problems={problems}
        sampledAt={o.sampledAt ?? null}
        unavailable={o.unavailable ?? []}
        dataAt={o.dataAt ?? null}
      />
      <DeviceTiles device={device} baseline={o.loadBaseline} problems={problems} />
      {/* Phone: after the tiles so they stay above the bottom bar (PLAN/02 §6, QA N4); wider screens: first.
          empty:hidden drops the slot (and its gap) when the banner renders nothing. */}
      <div className="empty:hidden sm:order-first">
        <OnboardingBanner />
      </div>
      <Suspense fallback={null}>
        <MetricTrends />
      </Suspense>
      <CountCards o={o} problems={problems} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <BackupSection backup={backup} />
          <AlertsLine alerts={o.alerts} role={role} />
        </div>
        <div className="flex flex-col gap-6">
          <Suspense fallback={null}>
            <ActivityList entries={o.recentActivity} role={role} />
          </Suspense>
          <Suspense fallback={null}>
            <RecentProblems />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/** /panel (index): problem-first Ringkasan — problems, device tiles, counts, backup, notifications, activity. */
export function OverviewPage() {
  const query = useApiQuery<PanelOverview>(panelUrl("/overview"), PANEL_REFRESH_MS);
  const fake = query.data?.mode === "fake";
  return (
    <>
      <PageHeader
        title={t.title}
        status={fake && <StatusBadge tone="warning" label={idPanel.fakeMode} />}
        description={fake ? idPanel.fakeModeHelp : undefined}
        meta={{
          updatedAt: query.data?.dataAt ?? query.updatedAt,
          onRefresh: query.reload,
          refreshing: query.loading,
          live: true,
          stale: !!query.error,
        }}
      />
      <QueryView query={query} empty={null} isEmpty={() => false} skeleton={<StatTilesSkeleton />}>
        {(o) => <Overview o={o} />}
      </QueryView>
    </>
  );
}
