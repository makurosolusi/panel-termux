import { ClockIcon, CpuIcon, DatabaseIcon, HardDriveIcon, TagIcon, UsersIcon } from "lucide-react";
import type { DevHealth } from "@/shared/dev.types";
import { Progress } from "@/web/components/ui/progress";
import { Skeleton } from "@/web/components/ui/skeleton";
import { id } from "@/web/i18n/id";
import { formatBytes, formatDateTime, formatUptime, usedPercent } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { StatCard } from "@/web/shared/stat.card";
import { useApiQuery } from "@/web/shared/use-api-query";
import { devUrl } from "./dev.api";

const HEALTH_REFRESH_MS = 15_000;
const t = id.dev.health;

const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

function HealthSkeleton() {
  return (
    <div className={GRID} aria-busy="true">
      {["a", "b", "c", "d", "e", "f"].map((k) => (
        <Skeleton key={k} className="h-28 w-full" />
      ))}
    </div>
  );
}

function HealthCards({ h }: { h: DevHealth }) {
  const used = usedPercent(h.dataDir.freeBytes, h.dataDir.totalBytes);
  return (
    <div className={GRID}>
      <StatCard icon={TagIcon} label={t.version} value={`v${h.version}`}>
        {t.schema(h.schemaVersion)}
      </StatCard>
      <StatCard icon={ClockIcon} label={t.uptime} value={formatUptime(h.uptimeSec)}>
        {t.since(formatDateTime(h.startedAt))}
      </StatCard>
      <StatCard icon={CpuIcon} label={t.memory} value={`${h.memory.rssMb} MB`}>
        {t.heap(h.memory.heapUsedMb)} · {t.runtime} Bun {h.runtime.bun} ({h.runtime.platform}/{h.runtime.arch})
      </StatCard>
      <StatCard icon={DatabaseIcon} label={t.db} value={formatBytes(h.db.sizeBytes)} />
      <StatCard icon={HardDriveIcon} label={t.disk} value={`${used}%`}>
        <Progress value={used} className="my-1" aria-label={t.disk} />
        {t.diskFree(formatBytes(h.dataDir.freeBytes), formatBytes(h.dataDir.totalBytes))}
      </StatCard>
      <StatCard icon={UsersIcon} label={t.counts} value={String(h.counts.users)}>
        {h.counts.users} {t.users} · {h.counts.sessions} {t.sessions}
      </StatCard>
    </div>
  );
}

/** /dev (index): server health cards, refreshed every 15 s. */
export function HealthPage() {
  const query = useApiQuery<DevHealth>(devUrl("/health"), HEALTH_REFRESH_MS);
  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t.refreshing}</p>
      <QueryView query={query} codes={id.dev.errorCodes} skeleton={<HealthSkeleton />}>
        {(h) => <HealthCards h={h} />}
      </QueryView>
    </section>
  );
}
