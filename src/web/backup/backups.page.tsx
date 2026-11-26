import { ArchiveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { BackupRun, BackupRunStarted, BackupStatus } from "@/shared/backup.types";
import type { Page } from "@/shared/dev.types";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { DEV_PAGE_SIZE, parsePageParam } from "@/web/dev/dev.pagination";
import { Pager } from "@/web/dev/pager";
import { id } from "@/web/i18n/id";
import { runApiAction } from "@/web/shared/api.action";
import { apiFetch } from "@/web/shared/api.client";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { BACKUP_ERROR_CODES, backupUrl } from "./backup.api";
import { BackupRunRow } from "./backup.runs";
import { BACKUP_POLL_MS, canRunBackup } from "./backup.state";
import { BackupStatusCard } from "./backup.status";

const t = id.backup;

/** /panel/backups: status + "Backup sekarang", then the paged run history; both poll while a run is going. */
export function BackupsPage() {
  const [params] = useSearchParams();
  const page = parsePageParam(params.get("page"));
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const poll = running ? BACKUP_POLL_MS : undefined; // status drives polling of itself and of the run list
  const status = useApiQuery<BackupStatus>(backupUrl("/status"), poll);
  const runs = useApiQuery<Page<BackupRun>>(backupUrl("", { page, pageSize: DEV_PAGE_SIZE }), poll);
  const nowRunning = status.data?.running ?? false;
  const { reload: reloadRuns } = runs;

  useEffect(() => {
    if (nowRunning === running) return;
    setRunning(nowRunning);
    reloadRuns(); // a run started or finished: show it right away
  }, [nowRunning, running, reloadRuns]);

  const runNow = async () => {
    setStarting(true);
    await runApiAction(() => apiFetch<BackupRunStarted>("POST", backupUrl("/run")), t.run.started, BACKUP_ERROR_CODES);
    setStarting(false);
    status.reload();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-lg font-semibold">{t.title}</h1>
      <QueryView query={status} codes={BACKUP_ERROR_CODES}>
        {(s) => (
          <BackupStatusCard
            status={s}
            action={
              <Button className="self-start" disabled={starting || !canRunBackup(s)} onClick={() => void runNow()}>
                <ArchiveIcon aria-hidden />
                {t.run.button}
              </Button>
            }
          />
        )}
      </QueryView>
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">{t.runs.title}</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <QueryView query={runs} codes={BACKUP_ERROR_CODES} isEmpty={(d) => d.items.length === 0}>
            {(d) => (
              <>
                <div className="divide-y">
                  {d.items.map((run) => (
                    <BackupRunRow key={run.id} run={run} />
                  ))}
                </div>
                <Pager page={d} />
              </>
            )}
          </QueryView>
        </CardContent>
      </Card>
    </div>
  );
}
