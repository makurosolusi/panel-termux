import { ListChecksIcon } from "lucide-react";
import { useState } from "react";
import type { DevHealth, DevSetup, SetupItemKey } from "@/shared/dev.types";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { StatTilesSkeleton } from "@/web/components/skeletons";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { tDevHealth } from "@/web/i18n/en.dev.health";
import { tDevSetup } from "@/web/i18n/en.dev.setup";
import { apiUrl } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { BackgroundSection, DetailSection, HealthTiles, LastErrorsSection, SecuritySection } from "./health.sections";
import { InfoSection, VerdictBadge, VerdictCard } from "./health.verdict";
import { OnboardingCard } from "./onboarding.card";
import {
  cardVisible,
  isComplete,
  ONBOARDING_ANCHOR,
  reopenNeedsPut,
  SETUP_URL,
  saveDismissed,
  saveManual,
} from "./onboarding.state";

/** Poll interval of GET /api/dev/health (F2.1); paused in hidden tabs by the poller. */
const HEALTH_REFRESH_MS = 15_000;
const HEALTH_URL = apiUrl("/api/dev", "/health");
const t = tDevHealth;

/** Onboarding state + actions of /dev: server-side dismiss, local "reopened" so a complete guide can be shown again. */
function useOnboarding() {
  const query = useApiQuery<DevSetup>(SETUP_URL);
  const [reopened, setReopened] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (save: () => Promise<boolean>, after?: () => void) => {
    setBusy(true);
    const ok = await save();
    setBusy(false);
    if (ok) after?.();
    query.reload();
  };
  const setup = query.data;
  return {
    setup,
    busy,
    visible: setup ? cardVisible(setup, reopened) : false,
    hide: () =>
      void run(
        () => saveDismissed(true),
        () => setReopened(false),
      ),
    reopen: () => {
      if (setup && reopenNeedsPut(setup))
        void run(
          () => saveDismissed(false),
          () => setReopened(true),
        );
      else setReopened(true);
    },
    toggle: (key: SetupItemKey, done: boolean) => void run(() => saveManual(key, done)),
    reload: query.reload,
  };
}

/** /dev System health: onboarding, verdict with checks, KPI tiles, background processes, errors, info, detail. */
export function HealthPage() {
  const query = useApiQuery<DevHealth>(HEALTH_URL, HEALTH_REFRESH_MS);
  const ob = useOnboarding();
  const h = query.data;
  const s = tDevSetup;
  const guideLink = ob.visible ? (
    <a
      href={`#${ONBOARDING_ANCHOR}`}
      className="mt-1 inline-flex text-xs font-medium text-brand-text underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:items-center"
    >
      {t.info.open}
    </a>
  ) : ob.setup && !isComplete(ob.setup) ? (
    <Button size="sm" variant="link" className="mt-1 h-auto px-0 text-xs" onClick={ob.reopen}>
      {t.info.open}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.title}
        description={t.description}
        status={
          <>
            {h && <VerdictBadge h={h} />}
            {h?.mode === "fake" && <StatusBadge tone="info" label={t.fakeMode} />}
          </>
        }
        meta={{
          updatedAt: query.updatedAt,
          onRefresh: query.reload,
          refreshing: query.loading,
          live: true,
          stale: !!query.error,
        }}
        actions={
          ob.setup && !ob.visible ? (
            <Button size="sm" variant="outline" onClick={ob.reopen} disabled={ob.busy}>
              <ListChecksIcon aria-hidden />
              {s.reopen}
            </Button>
          ) : null
        }
      />
      {ob.setup && ob.visible && (
        <OnboardingCard setup={ob.setup} busy={ob.busy} onToggle={ob.toggle} onHide={ob.hide} />
      )}
      <QueryView query={query} empty={null} skeleton={<StatTilesSkeleton count={4} />}>
        {(d) => (
          <div className="flex flex-col gap-6">
            <VerdictCard h={d} />
            <HealthTiles h={d} />
            <div className="grid gap-6 lg:grid-cols-2">
              <BackgroundSection h={d} />
              <LastErrorsSection h={d} />
            </div>
            <InfoSection h={d} guide={guideLink} />
            <SecuritySection onChanged={ob.reload} />
            <DetailSection h={d} />
          </div>
        )}
      </QueryView>
    </div>
  );
}
