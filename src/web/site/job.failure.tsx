import { cn } from "cn";
import { useNavigate } from "react-router";
import type { LogChunk } from "@/shared/log.types";
import type { Job, JobAccepted, SiteDetail } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { LogViewer } from "@/web/components/log-viewer";
import type { StatusTone } from "@/web/components/status.tone";
import { TONE_CLASS } from "@/web/components/status.tone";
import { Button } from "@/web/components/ui/button";
import { RollbackAction } from "@/web/deploy/deploy.rollback";
import { idJob } from "@/web/i18n/id.job";
import { panelUrl } from "@/web/panel/panel.api";
import { runApiAction } from "@/web/shared/api.action";
import { apiFetch } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { outcomeText, recoverAction } from "./job.state";
import { jobPath, siteUrl } from "./site.api";

const t = idJob;

/** Tone of the end-of-job panel; undone and cut-off jobs are warnings (A10, B12). */
const FINAL_TONE: Record<Exclude<Job["status"], "running">, StatusTone> = {
  succeeded: "success",
  rolled_back: "warning",
  failed: "danger",
  interrupted: "warning",
};

/** Error codes of POST /jobs/:id/recover. */
const RECOVER_CODES = t.errorCodes;

/** "Pulihkan" button: plain for cleanup, confirmed for retrying a delete; opens the new job. */
export function RecoverButton({ job }: { job: Job }) {
  const navigate = useNavigate();
  const action = recoverAction(job);
  if (!action) return null;
  const recover = async () => {
    const res = await apiFetch<JobAccepted>("POST", panelUrl(`/jobs/${encodeURIComponent(job.id)}/recover`));
    navigate(jobPath(res.jobId));
  };
  if (!action.confirm) {
    return <Button onClick={() => void runApiAction(recover, t.recover.started, RECOVER_CODES)}>{action.label}</Button>;
  }
  return (
    <ConfirmAction
      trigger={<Button>{action.label}</Button>}
      title={t.recover.retryTitle(job.target)}
      description={t.recover.retryBody}
      confirmLabel={action.label}
      destructive
      codes={RECOVER_CODES}
      onConfirm={recover}
    />
  );
}

/** Rollback offered from a failed job: needs the site's binaries for the Dari → Ke dialog. */
export function RollbackFromJob({ site }: { site: string }) {
  const query = useApiQuery<SiteDetail>(siteUrl(site));
  return query.data ? <RollbackAction site={query.data} variant="default" /> : null;
}

/** Last 50 stderr lines of the app that failed to start (redacted server side). */
function AppLog({ app }: { app: string }) {
  const query = useApiQuery<LogChunk>(panelUrl(`/apps/${encodeURIComponent(app)}/log`, { stream: "err", lines: 50 }));
  const lines = (query.data?.lines ?? []).map((l, i) => ({ ...l, seq: i + 1 }));
  return (
    <LogViewer
      label={t.appLog}
      size="inline"
      lines={lines}
      loading={query.loading && !query.data}
      error={query.error ? t.appLogMissing : undefined}
      empty={t.appLogEmpty}
    />
  );
}

/** End-of-job panel: what the final status means, the coded reason, technical detail and the failing app's stderr. */
export function JobFinal({ job }: { job: Job }) {
  if (job.status === "running") return null;
  const tone = job.resolvedBy ? "info" : FINAL_TONE[job.status];
  const reason = job.error ? outcomeText(job.error.code, job.error.params) : null;
  return (
    <div className="flex flex-col gap-3">
      <div role="status" className={cn("flex flex-col gap-1 rounded-lg border p-3 text-sm", TONE_CLASS[tone])}>
        <p className="font-medium">{job.resolvedBy ? t.final.resolved : t.final[job.status]}</p>
        {reason && <p className="text-foreground">{reason}</p>}
      </div>
      {job.error?.detail && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t.technical}</summary>
          <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap break-all">{job.error.detail}</pre>
        </details>
      )}
      {job.appLogApp && (
        <section className="flex flex-col gap-2" aria-labelledby="why-failed">
          <h2 id="why-failed" className="text-base font-semibold">
            {t.whyFailed}
          </h2>
          <AppLog app={job.appLogApp} />
        </section>
      )}
    </div>
  );
}
