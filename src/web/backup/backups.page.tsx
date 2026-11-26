import { ArchiveIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { BackupRestore, BackupRun, BackupStatus } from "@/shared/backup.types";
import type { Page } from "@/shared/dev.types";
import type { SecurityStatus } from "@/shared/security.types";
import { EmptyState } from "@/web/components/empty-state";
import { PageHeader } from "@/web/components/page-header";
import { PaginationFooter } from "@/web/components/pagination-footer";
import { QueryView } from "@/web/components/query-view";
import { Section } from "@/web/components/section";
import { HeaderSkeleton, RowsSkeleton } from "@/web/components/skeletons";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { usePageParam } from "@/web/components/use-page-param";
import { idBackup } from "@/web/i18n/id.backup";
import { SECURITY_STATUS_URL } from "@/web/security/security.api";
import { useMe } from "@/web/session/use-me";
import { runApiAction } from "@/web/shared/api.action";
import { useApiQuery } from "@/web/shared/use-api-query";
import { BACKUP_ERROR_CODES, backupUrl, startBackupRun } from "./backup.api";
import { LastGoodSection } from "./backup.last-good";
import { RestoresSection } from "./backup.restores";
import { BackupRunRow } from "./backup.runs";
import { BACKUP_POLL_MS, backupBanners, isBackupBusy, runBlock } from "./backup.state";
import { BackupBanners, BackupStatusSection } from "./backup.status";
import { backupHeadline } from "./backup.status-key";

const t = idBackup;

/** Newest restores shown in "Uji pemulihan" (older ones stay in the audit log). */
const RESTORES_SHOWN = 10;
/** Runs per history page (matches the API default). */
const RUNS_PAGE_SIZE = 20;

/** /panel/backups: status, last good copy per item, restore tests, run history; polls while a run or restore goes. */
export function BackupsPage() {
  const superAdmin = useMe().role === "super_admin";
  const [page, setPage] = usePageParam();
  const [busyPoll, setBusyPoll] = useState(false);
  const poll = busyPoll ? BACKUP_POLL_MS : undefined;
  const status = useApiQuery<BackupStatus>(backupUrl("/status"), poll);
  const runs = useApiQuery<Page<BackupRun>>(backupUrl("", { page, pageSize: RUNS_PAGE_SIZE }), poll);
  const restores = useApiQuery<Page<BackupRestore>>(backupUrl("/restores", { pageSize: RESTORES_SHOWN }), poll);
  // The data key state is super_admin only; an admin request would 403 and navigate to /login.
  const security = useApiQuery<SecurityStatus>(SECURITY_STATUS_URL, undefined, {
    enabled: superAdmin,
    initial: superAdmin,
  });
  const [starting, setStarting] = useState(false);
  const reasonId = useId();

  const busy = isBackupBusy(status.data);
  const wasBusy = useRef(busy);
  const { reload: reloadRuns } = runs;
  const { reload: reloadRestores } = restores;
  useEffect(() => {
    setBusyPoll(busy);
    if (wasBusy.current === busy) return;
    wasBusy.current = busy;
    reloadRuns(); // a run or restore started or finished: show it right away
    reloadRestores();
  }, [busy, reloadRuns, reloadRestores]);

  const reloadAll = () => {
    status.reload();
    runs.reload();
    restores.reload();
  };
  const runNow = async () => {
    setStarting(true);
    await runApiAction(startBackupRun, t.run.started, BACKUP_ERROR_CODES); // 409 busy → toast, status shows the run
    setStarting(false);
    status.reload();
  };

  const s = status.data;
  const block = s ? runBlock(s) : null;
  const headline = s && backupHeadline(s);
  const access = { keyMismatch: Boolean(s?.keyMismatch), superAdmin };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t.title}
        description={t.subtitle}
        status={headline && <StatusBadge state={headline.state} label={headline.label} />}
        meta={{ updatedAt: status.updatedAt, onRefresh: reloadAll, refreshing: status.loading, live: busy }}
        actions={
          <>
            <Button
              className="max-sm:w-full"
              disabled={!s || starting || block !== null}
              aria-describedby={block ? reasonId : undefined}
              onClick={() => void runNow()}
            >
              <ArchiveIcon aria-hidden />
              {t.run.button}
            </Button>
            {block && (
              <p id={reasonId} className="basis-full text-xs text-muted-foreground sm:text-right">
                {t.run.blocked[block]}
              </p>
            )}
          </>
        }
      />
      <p className="sr-only" aria-live="polite">
        {s?.running ? t.headline.running : s?.restoring ? t.headline.restoring : ""}
      </p>
      <QueryView
        query={status}
        codes={BACKUP_ERROR_CODES}
        empty={null}
        skeleton={
          <>
            <HeaderSkeleton />
            <RowsSkeleton />
          </>
        }
      >
        {(st) => (
          <div className="flex flex-col gap-6">
            <BackupBanners
              banners={backupBanners(st, superAdmin ? security.data?.dataKey.exportedAt : undefined)}
              status={st}
              superAdmin={superAdmin}
            />
            <BackupStatusSection status={st} />
            <LastGoodSection
              status={st}
              runs={[...(st.lastRun ? [st.lastRun] : []), ...(runs.data?.items ?? [])]}
              access={access}
              onRestoreStarted={reloadAll}
            />
          </div>
        )}
      </QueryView>
      <RestoresSection query={restores} onChanged={reloadAll} />
      <Section title={t.runs.title}>
        <QueryView query={runs} codes={BACKUP_ERROR_CODES} empty={<EmptyState title={t.runs.empty} />}>
          {(d) => (
            <div className="flex flex-col gap-3">
              <div className="divide-y rounded-lg border bg-card px-4">
                {d.items.map((run) => (
                  <BackupRunRow key={run.id} run={run} access={access} />
                ))}
              </div>
              <PaginationFooter
                p={{
                  page: d.page,
                  pageCount: Math.max(1, Math.ceil(d.total / Math.max(1, d.pageSize))),
                  total: d.total,
                  onPageChange: setPage,
                }}
              />
            </div>
          )}
        </QueryView>
      </Section>
    </div>
  );
}
