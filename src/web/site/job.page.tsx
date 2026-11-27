import { ArrowRightIcon, WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { Job, JobNextAction } from "@/shared/site.types";
import { ErrorState } from "@/web/components/error-state";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { RelativeTime } from "@/web/components/relative-time";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { Progress } from "@/web/components/ui/progress";
import { INFO_PROGRESS } from "@/web/deploy/upload.progress";
import { tJob } from "@/web/i18n/en.job";
import { panelUrl } from "@/web/panel/panel.api";
import { useApiQuery } from "@/web/shared/use-api-query";
import { JobFinal, RecoverButton, RollbackFromJob } from "./job.failure";
import {
  isJobFinished,
  JOB_POLL_MS,
  jobProgress,
  jobResultLink,
  liveAnnouncement,
  nextActions,
  pollErrorView,
} from "./job.state";
import { JOB_STATUS_KEY } from "./job.status-key";
import { JobSteps } from "./job.steps";
import { SITE_ERROR_CODES } from "./site.api";

const t = tJob;
const sitePath = (job: Job, hash = "") => `/panel/sites/${encodeURIComponent(job.target)}${hash}`;

/** Button of one follow-up action (PLAN/03 §4.9). */
function NextAction({ job, action }: { job: Job; action: JobNextAction }) {
  const link = (to: string) => (
    <Button asChild variant="outline">
      <Link to={to}>{t.next[action]}</Link>
    </Button>
  );
  switch (action) {
    case "recover":
      return <RecoverButton job={job} />;
    case "rollback":
      return <RollbackFromJob site={job.target} />;
    case "app_log":
      return job.appLogApp ? link(`/panel/apps/${encodeURIComponent(job.appLogApp)}/log?stream=err`) : null;
    case "open_site":
      return link(sitePath(job));
    default: // redeploy, first_deploy
      return link(sitePath(job, "#deploy"));
  }
}

function JobView({ job }: { job: Job }) {
  const pct = jobProgress(job);
  const done = jobResultLink(job);
  return (
    <div className="flex flex-col gap-6">
      {!isJobFinished(job) && (
        <div className="flex items-center gap-3">
          <Progress value={pct} aria-label={t.title} className={`flex-1 ${INFO_PROGRESS}`} />
          <span className="text-xs text-muted-foreground tabular-nums">{t.progress(pct)}</span>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {liveAnnouncement(job)}
      </p>
      {job.cleans && (
        <p className="text-sm text-muted-foreground">
          {t.recover.cleans}{" "}
          <Link className="underline underline-offset-2" to={`/panel/jobs/${encodeURIComponent(job.cleans)}`}>
            {t.recover.cleansLink}
          </Link>
        </p>
      )}
      <div className="rounded-lg border bg-card p-4">
        <JobSteps job={job} />
      </div>
      <JobFinal job={job} />
      {isJobFinished(job) && (
        <div className="flex flex-wrap gap-2">
          {nextActions(job).map((a) => (
            <NextAction key={a} job={job} action={a} />
          ))}
          <Button asChild variant="ghost">
            <Link to={done}>
              {done === "/panel/sites" ? t.allSites : t.next.open_site}
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

/** /panel/jobs/:id: live progress of one change (1 s poll while running), tolerant of the cloudflared blip. */
export function JobPage() {
  const { id: jobId = "" } = useParams();
  const url = panelUrl(`/jobs/${encodeURIComponent(jobId)}`);
  // polling stops once this job id was seen finished (a hook cannot depend on its own later result directly)
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const running = finishedId !== jobId;
  const query = useApiQuery<Job>(url, running ? JOB_POLL_MS : undefined);
  const ended = query.data?.id === jobId && isJobFinished(query.data);
  useEffect(() => {
    if (ended) setFinishedId(jobId);
  }, [ended, jobId]);
  const view = pollErrorView(query.data, Boolean(query.error), query.updatedAt?.getTime() ?? null, Date.now());
  const shown = view === "blip" ? { ...query, error: undefined } : query;
  const title = query.data ? `${t.kinds[query.data.kind]} · ${query.data.target}` : t.title;

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader
        title={title}
        back={{ to: "/panel/jobs", label: t.listTitle }}
        status={query.data && <StatusBadge state={JOB_STATUS_KEY[query.data.status]} />}
        description={
          query.data && (
            <>
              {t.meta.started} <RelativeTime at={query.data.startedAt} absolute />
              {query.data.actor?.name && ` · ${t.meta.by(query.data.actor.name)}`}
            </>
          )
        }
        meta={{
          updatedAt: query.updatedAt,
          live: running,
          stale: view === "stale",
          onRefresh: query.reload,
          refreshing: query.loading,
        }}
      />
      {view === "blip" && (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-md border border-info/25 bg-info-subtle px-3 py-2 text-sm"
        >
          <WifiOffIcon className="size-4 shrink-0 text-info" aria-hidden />
          {t.blip}
        </p>
      )}
      {view === "lost" ? (
        <ErrorState title={t.lostTitle} description={t.lostBody} onRetry={query.reload} retrying={query.loading} />
      ) : (
        <QueryView query={shown} codes={SITE_ERROR_CODES} empty={null}>
          {(j) => <JobView job={j} />}
        </QueryView>
      )}
    </div>
  );
}
