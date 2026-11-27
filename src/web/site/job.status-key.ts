// Raw job and job-step states → canonical StatusKey (DECISIONS B12): "Rolled back"/"Interrupted" are warnings (A10).
import type { JobStatus } from "@/shared/job.types";
import { type StatusKey, statusView } from "@/web/components/status.vocab";
import type { ShownStepStatus } from "./job.state";

/** Badge key of a job. */
export const JOB_STATUS_KEY = {
  running: "processing",
  succeeded: "succeeded",
  failed: "failed",
  rolled_back: "rolled_back",
  interrupted: "interrupted",
} as const satisfies Record<JobStatus, StatusKey>;

/** Icon/tone key of one stepper step; `interrupted` = still "running" in a job that ended (see shownStepStatus). */
export const JOB_STEP_STATUS_KEY = {
  pending: "pending",
  running: "processing",
  done: "done",
  failed: "failed",
  rolled_back: "rolled_back",
  skipped: "skipped",
  interrupted: "interrupted",
} as const satisfies Record<ShownStepStatus, StatusKey>;

/** " · Interrupted" after a last-deploy time that did not succeed (so a failed attempt never reads as a deploy); "" otherwise. */
export const deployOutcomeSuffix = (status: JobStatus): string =>
  status === "succeeded" || status === "running" ? "" : ` · ${statusView(JOB_STATUS_KEY[status]).label}`;
