import { ActivityIcon, ArrowRightIcon, ClockIcon, CpuIcon, HardDriveIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { DevHealth } from "@/shared/dev.types";
import type { SecurityStatus } from "@/shared/security.types";
import { KeyValue } from "@/web/components/key-value";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { RowsSkeleton } from "@/web/components/skeletons";
import { StatTile } from "@/web/components/stat-tile";
import { tDevHealth } from "@/web/i18n/en.dev.health";
import { AccessStatusRow } from "@/web/security/access.row";
import { DataKeyCard } from "@/web/security/data-key.card";
import { SECURITY_ERROR_CODES, SECURITY_STATUS_URL } from "@/web/security/security.api";
import { SessionsAdminCard } from "@/web/security/sessions.card";
import { formatBytes, formatClock, formatDateTime, formatNumber, formatUptime, usedPercent } from "@/web/shared/format";
import { useApiQuery } from "@/web/shared/use-api-query";
import { DISK_THRESHOLDS } from "./health.state";

const t = tDevHealth;

/** Four KPI tiles: Uptime, Memory, Storage (bar), Requests/min; 2×2 on phones. */
export function HealthTiles({ h }: { h: DevHealth }) {
  const used = usedPercent(h.dataDir.freeBytes, h.dataDir.totalBytes);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        icon={ClockIcon}
        label={t.uptime}
        value={formatUptime(h.uptimeSec)}
        hint={t.tiles.since(formatDateTime(h.startedAt))}
      />
      <StatTile
        icon={CpuIcon}
        label={t.tiles.memory}
        value={`${formatNumber(h.memory.rssMb)} MB`}
        hint={t.tiles.heap(h.memory.heapUsedMb)}
      />
      <StatTile
        icon={HardDriveIcon}
        label={t.tiles.disk}
        value={`${used}%`}
        progress={used}
        thresholds={DISK_THRESHOLDS}
        hint={t.tiles.diskFree(formatBytes(h.dataDir.freeBytes), formatBytes(h.dataDir.totalBytes))}
      />
      <StatTile
        icon={ActivityIcon}
        label={t.tiles.requests}
        value={formatNumber(h.requestsPerMinute)}
        hint={t.tiles.requests5xx(h.errorCount5m)}
        tone={h.errorCount5m > 0 ? "warning" : undefined}
      />
    </div>
  );
}

const when = (at: string | null | undefined, fallback: string): ReactNode =>
  at ? <RelativeTime at={at} /> : <span className="text-muted-foreground">{fallback}</span>;

/** "Proses latar": sampler, backup scheduler, next backup, running change. */
export function BackgroundSection({ h }: { h: DevHealth }) {
  const b = t.background;
  const job = h.runningJob ?? null;
  const next =
    h.backup === null ? (
      <span className="text-warning">{t.backupUnreadable}</span>
    ) : h.backup?.nextRunAt ? (
      <RelativeTime at={h.backup.nextRunAt} absolute />
    ) : (
      <span className="text-muted-foreground">{b.backupOff}</span>
    );
  return (
    <Section title={b.title} className="rounded-lg border bg-card p-4 shadow-xs">
      <KeyValue
        items={[
          { label: b.sampler, value: when(h.sampledAt, t.checks.sampler.waiting) },
          { label: b.scheduler, value: when(h.backupTickAt, b.never) },
          { label: b.nextBackup, value: next },
          {
            label: b.job,
            value: job ? (
              <Link
                to={`/panel/jobs/${encodeURIComponent(job.id)}`}
                className="text-brand-text underline-offset-4 hover:underline"
              >
                {job.kind} · {job.target} · <RelativeTime at={job.startedAt} />
              </Link>
            ) : (
              <span className="text-muted-foreground">{b.noJob}</span>
            ),
          },
        ]}
      />
    </Section>
  );
}

/** "Kesalahan terakhir": at most 5 error lines (time + message) and a link to the full error log. */
export function LastErrorsSection({ h }: { h: DevHealth }) {
  const items = h.lastErrors ?? [];
  const l = t.lastErrors;
  return (
    <Section
      title={l.title}
      className="rounded-lg border bg-card p-4 shadow-xs"
      action={
        <Link
          to="/dev/logs?level=error"
          className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-brand-text underline-offset-4 hover:underline pointer-coarse:min-h-11"
        >
          {l.all}
          <ArrowRightIcon className="size-3" aria-hidden />
        </Link>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{l.empty}</p>
      ) : (
        <ol className="flex flex-col gap-2 font-mono text-xs">
          {items.map((e) => (
            <li key={`${e.at}:${e.msg}`} className="flex min-w-0 gap-3">
              <time
                dateTime={e.at}
                title={formatDateTime(e.at, true)}
                className="shrink-0 text-muted-foreground tabular-nums"
              >
                {formatClock(e.at)}
              </time>
              <span className="min-w-0 break-words text-danger">{e.msg}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** "Detail": version, schema, mode, runtime, CPU cores, DB size, users · sessions. */
export function DetailSection({ h }: { h: DevHealth }) {
  const d = t.detail;
  const r = h.runtime;
  return (
    <Section title={d.title}>
      <KeyValue
        className="rounded-lg border bg-card p-4 shadow-xs"
        items={[
          { label: d.version, value: `v${h.version}`, mono: true },
          { label: d.schema, value: h.schemaVersion, mono: true },
          { label: d.mode, value: h.mode ? d.modes[h.mode] : "–" },
          { label: d.runtime, value: `Bun ${r.bun} · Node ${r.node} · ${r.platform}/${r.arch}`, mono: true },
          { label: d.cpuCores, value: formatNumber(h.cpuCores) },
          { label: d.db, value: formatBytes(h.db.sizeBytes) },
          { label: d.counts, value: t.countsDetail(h.counts.users, h.counts.sessions) },
        ]}
      />
    </Section>
  );
}

/** "Keamanan": PLAN/04's data key card, Access row and sign-everyone-out card; `onChanged` also refreshes onboarding. */
export function SecuritySection({ onChanged }: { onChanged: () => void }) {
  const query = useApiQuery<SecurityStatus>(SECURITY_STATUS_URL);
  const changed = () => {
    query.reload();
    onChanged();
  };
  return (
    <Section title={t.security.title} description={t.security.description}>
      <QueryView query={query} empty={null} codes={SECURITY_ERROR_CODES} skeleton={<RowsSkeleton rows={3} />}>
        {(s) => (
          <div className="flex flex-col gap-3">
            <AccessStatusRow access={s.access} />
            <div className="grid gap-3 lg:grid-cols-2">
              <DataKeyCard status={s} onChanged={changed} />
              <SessionsAdminCard status={s} onChanged={changed} />
            </div>
          </div>
        )}
      </QueryView>
    </Section>
  );
}
