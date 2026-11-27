import { Link } from "react-router";
import type { BackupStatus } from "@/shared/backup.types";
import { KeyValue, type KeyValueItem } from "@/web/components/key-value";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { tBackup } from "@/web/i18n/en.backup";
import { Notice } from "@/web/security/security.notice";
import { formatBytes, formatDateTime } from "@/web/shared/format";
import { type BackupBanner, contentKinds } from "./backup.state";
import { runStatusKey } from "./backup.status-key";

const t = tBackup.status;
const b = tBackup.banner;

/** Where the fixes live (Administrasi, super_admin only). */
const SETTINGS_PATH = "/dev/settings";
const DATA_KEY_PATH = "/dev/health#kunci-data";
const MB = 1024 * 1024;

function LinkButton({ to, children }: { to: string; children: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={to}>{children}</Link>
    </Button>
  );
}

/** Notices above the status, most urgent first; admins get "ask the Super Admin" instead of links. */
export function BackupBanners({
  banners,
  status,
  superAdmin,
}: {
  banners: readonly BackupBanner[];
  status: BackupStatus;
  superAdmin: boolean;
}) {
  if (banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {banners.map((banner) => {
        switch (banner) {
          case "key_mismatch":
            return (
              <Notice
                key={banner}
                tone="danger"
                actions={superAdmin && <LinkButton to={DATA_KEY_PATH}>{b.keyLink}</LinkButton>}
              >
                <p>{t.keyMismatch}</p>
                {!superAdmin && <p className="text-muted-foreground">{b.keyMismatchAdmin}</p>}
              </Notice>
            );
          case "not_configured":
            return (
              <Notice
                key={banner}
                tone="info"
                actions={superAdmin && <LinkButton to={SETTINGS_PATH}>{b.settingsLink}</LinkButton>}
              >
                <p>{b.notConfigured}</p>
                <ul className="flex flex-wrap gap-1">
                  {status.missing.map((k) => (
                    <li key={k}>
                      <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">{k}</code>
                    </li>
                  ))}
                </ul>
                {!superAdmin && <p className="text-muted-foreground">{b.askSuperAdmin}</p>}
              </Notice>
            );
          case "secrets_included":
            return (
              <Notice key={banner} tone="warning">
                <p>{t.secretsIncluded}</p>
              </Notice>
            );
          default:
            return (
              <Notice key={banner} tone="info" actions={<LinkButton to={DATA_KEY_PATH}>{b.keyLink}</LinkButton>}>
                <p>{t.noKeyCopy}</p>
              </Notice>
            );
        }
      })}
    </div>
  );
}

/** "Status": schedule, next run, retention, size limit, contents, what is never backed up, last run and test. */
export function BackupStatusSection({ status }: { status: BackupStatus }) {
  const last = status.lastRun;
  const kinds = contentKinds(last);
  const excluded = status.excluded ?? [];
  const items: KeyValueItem[] = [
    { label: t.schedule, value: status.hourLocal === null ? t.scheduleOff : t.scheduleAt(status.hourLocal) },
    { label: t.nextRun, value: status.nextRunAt ? formatDateTime(status.nextRunAt) : t.none },
    {
      label: t.retention,
      value:
        status.keepMinRuns === undefined
          ? t.retentionDays(status.retentionDays)
          : t.retentionValue(status.retentionDays, status.keepMinRuns),
    },
  ];
  if (status.maxItemMb !== undefined) items.push({ label: t.maxItem, value: formatBytes(status.maxItemMb * MB) });
  items.push({
    label: t.contents,
    value: kinds.length ? kinds.map((k) => tBackup.kinds[k]).join(", ") : t.none,
  });
  if (excluded.length)
    items.push({
      label: t.notBackedUp,
      value: (
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {excluded.map((x) => (
            <li key={x}>{tBackup.excluded[x]}</li>
          ))}
        </ul>
      ),
    });
  items.push({
    label: t.lastRun,
    value: last ? (
      <span className="inline-flex flex-wrap items-center gap-2">
        <RelativeTime at={last.startedAt} />
        <StatusBadge state={runStatusKey(last)} />
      </span>
    ) : (
      t.never
    ),
  });
  items.push({
    label: tBackup.restores.lastTest,
    value: status.lastRestoreTest ? (
      <span>
        <RelativeTime at={status.lastRestoreTest.at} /> · {status.lastRestoreTest.sourceName}
      </span>
    ) : (
      t.never
    ),
  });
  return (
    <Section title={t.title}>
      <div className="rounded-lg border bg-card p-4">
        <KeyValue items={items} />
      </div>
    </Section>
  );
}
