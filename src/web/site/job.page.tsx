import { AlertCircleIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { Job } from "@/shared/site.types";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Progress } from "@/web/components/ui/progress";
import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";
import { StatusBadge } from "@/web/panel/status.badge";
import { formatDateTime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { isJobFinished, JOB_POLL_MS, jobErrorMessage, jobProgress, jobResultLink, jobTone } from "./job.state";
import { JobSteps } from "./job.steps";
import { SITE_ERROR_CODES } from "./site.api";

const t = id.site.job;

function JobView({ job }: { job: Job }) {
  const finished = isJobFinished(job);
  const pct = jobProgress(job);
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-4 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto font-mono text-sm">
            {t.kinds[job.kind] ?? job.kind} · {job.target}
          </span>
          <StatusBadge tone={jobTone(job)} label={t.statuses[job.status]} />
        </div>
        <div className="flex items-center gap-3">
          <Progress value={pct} aria-label={t.title} className="flex-1" />
          <span className="text-xs tabular-nums text-muted-foreground">{t.progress(pct)}</span>
        </div>
        <JobSteps steps={job.steps} />
        {(job.status === "failed" || job.status === "rolled_back" || job.status === "interrupted") && (
          <div
            role="alert"
            className={
              job.status === "failed"
                ? "flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                : "flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
            }
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              <span className="font-medium">{t.outcome[job.status]}</span>
              {job.error && <span className="break-words">{jobErrorMessage(job.error, t.errors)}</span>}
              {job.error?.detail && <code className="text-xs break-words">{job.error.detail}</code>}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t.startedAt(formatDateTime(job.startedAt, true))}
          {job.finishedAt && ` · ${t.finishedAt(formatDateTime(job.finishedAt, true))}`}
        </p>
        {finished && (
          <Button asChild className="self-start">
            <Link to={jobResultLink(job)}>
              {jobResultLink(job) === "/panel/sites" ? t.allSites : t.openSite}
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** /panel/jobs/:id: live progress of one site change, polled every second until it finishes. */
export function JobPage() {
  const { id: jobId = "" } = useParams();
  const [live, setLive] = useState(true);
  const query = useApiQuery<Job>(panelUrl(`/jobs/${encodeURIComponent(jobId)}`), live ? JOB_POLL_MS : undefined);
  const finished = query.data ? isJobFinished(query.data) : false;
  useEffect(() => {
    if (finished) setLive(false);
  }, [finished]);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-lg font-semibold">{t.title}</h1>
      {live && !finished && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t.running}
        </p>
      )}
      <QueryView query={query} codes={SITE_ERROR_CODES}>
        {(job) => <JobView job={job} />}
      </QueryView>
    </div>
  );
}
