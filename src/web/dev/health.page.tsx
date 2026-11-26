import type { LucideIcon } from "lucide-react";
import { ClockIcon, CpuIcon, DatabaseIcon, HardDriveIcon, TagIcon, UsersIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { DevHealth } from "@/shared/dev.types";
import { Card, CardContent } from "@/web/components/ui/card";
import { Progress } from "@/web/components/ui/progress";
import { Skeleton } from "@/web/components/ui/skeleton";
import { id } from "@/web/i18n/id";
import { devUrl } from "./dev.api";
import { formatBytes, formatDateTime, formatUptime, usedPercent } from "./dev.format";
import { QueryView } from "./query.state";
import { useDevQuery } from "./use-dev-query";

const HEALTH_REFRESH_MS = 15_000;
const t = id.dev.health;

function Stat({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          {label}
        </span>
        <span className="truncate text-2xl font-semibold tabular-nums">{value}</span>
        {children && <div className="text-xs text-muted-foreground">{children}</div>}
      </CardContent>
    </Card>
  );
}

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
      <Stat icon={TagIcon} label={t.version} value={`v${h.version}`}>
        {t.schema(h.schemaVersion)}
      </Stat>
      <Stat icon={ClockIcon} label={t.uptime} value={formatUptime(h.uptimeSec)}>
        {t.since(formatDateTime(h.startedAt))}
      </Stat>
      <Stat icon={CpuIcon} label={t.memory} value={`${h.memory.rssMb} MB`}>
        {t.heap(h.memory.heapUsedMb)} · {t.runtime} Bun {h.runtime.bun} ({h.runtime.platform}/{h.runtime.arch})
      </Stat>
      <Stat icon={DatabaseIcon} label={t.db} value={formatBytes(h.db.sizeBytes)} />
      <Stat icon={HardDriveIcon} label={t.disk} value={`${used}%`}>
        <Progress value={used} className="my-1" aria-label={t.disk} />
        {t.diskFree(formatBytes(h.dataDir.freeBytes), formatBytes(h.dataDir.totalBytes))}
      </Stat>
      <Stat icon={UsersIcon} label={t.counts} value={String(h.counts.users)}>
        {h.counts.users} {t.users} · {h.counts.sessions} {t.sessions} · {h.counts.invites} {t.invites}
      </Stat>
    </div>
  );
}

/** /dev (index): server health cards, refreshed every 15 s. */
export function HealthPage() {
  const query = useDevQuery<DevHealth>(devUrl("/health"), HEALTH_REFRESH_MS);
  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t.refreshing}</p>
      <QueryView query={query} skeleton={<HealthSkeleton />}>
        {(h) => <HealthCards h={h} />}
      </QueryView>
    </section>
  );
}
