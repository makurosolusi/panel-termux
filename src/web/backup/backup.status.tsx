import type { ReactNode } from "react";
import { Link } from "react-router";
import type { BackupStatus } from "@/shared/backup.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { StatusBadge } from "@/web/panel/status.badge";
import { useMe } from "@/web/session/use-me";
import { formatDateTime } from "@/web/shared/format";
import { backupSummary, runTone } from "./backup.state";

const t = id.backup.status;

function MissingSettings({ keys }: { keys: string[] }) {
  const me = useMe();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <span>{t.missing}</span>
      <ul className="flex flex-wrap gap-1">
        {keys.map((k) => (
          <li key={k}>
            <code className="rounded bg-background px-1.5 py-0.5 text-xs">{k}</code>
          </li>
        ))}
      </ul>
      {me.role === "super_admin" ? (
        <Link to="/dev/settings" className="self-start font-medium underline">
          {t.settingsLink}
        </Link>
      ) : (
        <span className="text-muted-foreground">{t.askSuperAdmin}</span>
      )}
    </div>
  );
}

/** Status card: summary badge, missing settings, schedule, retention and last run. */
export function BackupStatusCard({ status, action }: { status: BackupStatus; action: ReactNode }) {
  const { summary, tone } = backupSummary(status);
  const last = status.lastRun;
  const rows: [string, ReactNode][] = [
    [t.schedule, status.hourLocal === null ? t.scheduleOff : t.scheduleAt(status.hourLocal)],
    [t.nextRun, formatDateTime(status.nextRunAt)],
    [t.retention, t.retentionDays(status.retentionDays)],
    [
      t.lastRun,
      last ? (
        <span key="last" className="inline-flex flex-wrap items-center gap-2">
          {formatDateTime(last.startedAt)}
          <StatusBadge tone={runTone(last.status)} label={id.backup.runs.statuses[last.status]} />
        </span>
      ) : (
        t.never
      ),
    ],
  ];
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-wrap items-center gap-2 px-4">
        <CardTitle className="mr-auto text-base">{t.title}</CardTitle>
        <StatusBadge tone={tone} label={t.summaries[summary]} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        {!status.configured && <MissingSettings keys={status.missing} />}
        {status.running && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t.running}
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {action}
      </CardContent>
    </Card>
  );
}
