// Pure state of the job progress page (PLAN/03 §4.5, §5.5): stepper labels from coded keys, durations, live
// announcement, cloudflared-blip tolerance and recover/next-action decisions.

import type { Job, JobNextAction, JobParams, JobStep, JobStepKey, JobStepStatus } from "@/shared/job.types";
import { tJob } from "@/web/i18n/en.job";
import { formatDuration } from "@/web/shared/format";

/** Poll interval of the job progress view while it runs. */
export const JOB_POLL_MS = 1_000;
/** Failed polls during a cloudflared restart are hidden this long before the page gives up (PLAN/03 §4.5). */
export const BLIP_TOLERANCE_MS = 120_000;
/** Steps that restart cloudflared or probe domains: the panel itself may be unreachable meanwhile. */
const BLIP_STEPS: ReadonlySet<string> = new Set<JobStepKey>(["tunnel_restart", "domain_probe"]);

/** Whether the job reached a terminal status (stop polling). */
export const isJobFinished = (job: Pick<Job, "status">): boolean => job.status !== "running";

const SETTLED: readonly JobStepStatus[] = ["done", "skipped", "failed", "rolled_back"];

/** Progress in percent: settled steps / all steps; a finished job is always 100. */
export function jobProgress(job: Pick<Job, "status" | "steps">): number {
  if (isJobFinished(job)) return 100;
  if (job.steps.length === 0) return 0;
  const settled = job.steps.filter((s) => SETTLED.includes(s.status)).length;
  return Math.round((settled / job.steps.length) * 100);
}

/** Step label from its key; unknown keys (pre-0007 rows) fall back to the stored legacy label, then the key. */
export const stepLabel = (step: Pick<JobStep, "key" | "legacyLabel" | "label">): string =>
  tJob.steps[step.key as JobStepKey] ?? step.legacyLabel ?? step.label ?? step.key;

/** Sentence for an outcome code with its params; null code → null; unknown code → "Result: <code>". */
export function outcomeText(code: string | null | undefined, params: JobParams = {}): string | null {
  if (!code) return null;
  const fmt = (tJob.outcomes as Record<string, ((p: JobParams) => string) | undefined>)[code];
  return fmt ? fmt(params) : tJob.unknownOutcome(code);
}

/** "< 1 s", "12 s", "1 min 5 s" (page locale). */
export const durationText = (ms: number): string => (ms < 1_000 ? tJob.underSecond : formatDuration(ms / 1_000));

/** How long a step took (or has been running at `now`); null when it never started. */
export function stepDurationMs(step: Pick<JobStep, "startedAt" | "finishedAt">, now: number): number | null {
  if (!step.startedAt) return null;
  const end = step.finishedAt ? new Date(step.finishedAt).getTime() : now;
  return Math.max(0, end - new Date(step.startedAt).getTime());
}

/** Step status as shown; "interrupted" = the step was still running when its job ended (server keeps `running`, D11). */
export type ShownStepStatus = JobStepStatus | "interrupted";

/** A step left `running` in a finished job did not keep going: it was cut off there. */
export const shownStepStatus = (step: Pick<JobStep, "status">, job: Pick<Job, "status">): ShownStepStatus =>
  step.status === "running" && isJobFinished(job) ? "interrupted" : step.status;

/** Duration end for a step: its own finish, else the job's finish (cut-off steps stop counting), else `now`. */
export const stepEndMs = (job: Pick<Job, "finishedAt">, now: number): number =>
  job.finishedAt ? new Date(job.finishedAt).getTime() : now;

/** Index of the running step, else of the last step that settled, else 0. */
export function currentStepIndex(steps: readonly Pick<JobStep, "status">[]): number {
  const running = steps.findIndex((s) => s.status === "running");
  if (running !== -1) return running;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]?.status !== "pending") return i;
  return 0;
}

/** The one live-region sentence: "Step 4 of 8: Swapping the binary… done". */
export function liveAnnouncement(job: Pick<Job, "steps" | "status">): string {
  const i = currentStepIndex(job.steps);
  const step = job.steps[i];
  if (!step) return "";
  return tJob.liveStep(i + 1, job.steps.length, stepLabel(step), tJob.stepStatuses[shownStepStatus(step, job)]);
}

/**
 * How a failed poll shows: `none` (no error), `blip` (hidden: cloudflared restarts and the panel is briefly
 * unreachable), `stale` (normal stale notice), `lost` (no answer for over 120 s → ErrorState + Coba lagi).
 */
export function pollErrorView(
  job: Pick<Job, "status" | "steps"> | undefined,
  hasError: boolean,
  lastOkAt: number | null,
  now: number,
): "none" | "blip" | "stale" | "lost" {
  if (!hasError) return "none";
  if (lastOkAt !== null && now - lastOkAt > BLIP_TOLERANCE_MS) return "lost";
  if (!job || isJobFinished(job)) return "stale";
  const step = job.steps[currentStepIndex(job.steps)];
  return step && BLIP_STEPS.has(step.key) ? "blip" : "stale";
}

/** The recover button of a job: plain "Recover", or a confirmed "Retry site deletion/domain removal"; null = none. */
export type RecoverAction = { mode: "cleanup" | "retry"; label: string; confirm: boolean };

/** Decides the recover button from `recoverMode` (server rules, PLAN/03 §3.5) and the job kind. */
export function recoverAction(job: Pick<Job, "kind" | "recoverMode" | "resolvedBy">): RecoverAction | null {
  if (!job.recoverMode || job.resolvedBy) return null;
  if (job.recoverMode === "cleanup") return { mode: "cleanup", label: tJob.recover.cleanup, confirm: false };
  const label = job.kind === "site.delete" ? tJob.recover.retryDelete : tJob.recover.retryHostname;
  return { mode: "retry", label, confirm: true };
}

/** Follow-up actions to render after the job ended, in server order, without duplicates; running → none. */
export function nextActions(
  job: Pick<Job, "status" | "next" | "recoverMode" | "resolvedBy" | "kind">,
): JobNextAction[] {
  if (!isJobFinished(job)) return [];
  const out = [...new Set(job.next ?? [])];
  return recoverAction(job) ? out : out.filter((a) => a !== "recover");
}

/**
 * Where "done" leads: the site's detail, or the list when the site is gone (successful delete / failed create).
 * Assumes `target` is the site name for every job kind except job.cleanup of a removed site.
 */
export function jobResultLink(job: Pick<Job, "kind" | "status" | "target">): string {
  if (job.kind === "site.delete" && job.status === "succeeded") return "/panel/sites";
  if (job.kind === "site.create" && job.status !== "succeeded") return "/panel/sites";
  return `/panel/sites/${encodeURIComponent(job.target)}`;
}

/**
 * Reason under the final banner, or null when a step already says it: "interrupted" (headline + cut-off step) and a
 * reason whose code a step shows as its outcome (e.g. health_timeout on a rolled-back deploy) are not repeated.
 */
export function finalReason(job: Pick<Job, "error" | "steps">): string | null {
  const e = job.error;
  if (!e || e.code === "interrupted" || job.steps.some((s) => s.code === e.code)) return null;
  return outcomeText(e.code, e.params);
}
