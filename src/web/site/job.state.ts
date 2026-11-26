import type { Job, JobStepStatus } from "@/shared/site.types";
import type { Tone } from "@/web/panel/panel.status";

/** Poll interval of the job progress view. */
export const JOB_POLL_MS = 1_000;

/** Whether the job reached a terminal status (stop polling). */
export const isJobFinished = (job: Job): boolean => job.status !== "running";

const SETTLED: readonly JobStepStatus[] = ["done", "skipped", "failed", "rolled_back"];

/** Progress in percent: settled steps / all steps; a succeeded job is always 100. */
export function jobProgress(job: Job): number {
  if (job.status === "succeeded") return 100;
  if (job.steps.length === 0) return 0;
  const settled = job.steps.filter((s) => SETTLED.includes(s.status)).length;
  return Math.round((settled / job.steps.length) * 100);
}

const STEP_TONE: Record<JobStepStatus, Tone> = {
  pending: "muted",
  running: "warn",
  done: "ok",
  failed: "bad",
  rolled_back: "warn",
  skipped: "muted",
};

/** Color family of a step's status icon. */
export const stepTone = (status: JobStepStatus): Tone => STEP_TONE[status];

const JOB_TONE: Record<Job["status"], Tone> = { running: "warn", succeeded: "ok", failed: "bad", rolled_back: "bad" };

/** Color family of the job status badge (rolled back is still a failure for the user). */
export const jobTone = (job: Job): Tone => JOB_TONE[job.status];

/**
 * Where "done" leads: the site's detail, or the list when the site is gone (successful delete).
 * Assumes `target` is the site name for every job kind.
 */
export function jobResultLink(job: Job): string {
  if (job.kind === "site.delete" && job.status === "succeeded") return "/panel/sites";
  if (job.kind === "site.create" && job.status !== "succeeded") return "/panel/sites";
  return `/panel/sites/${encodeURIComponent(job.target)}`;
}
