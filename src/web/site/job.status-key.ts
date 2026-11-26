// Raw job and job-step states → canonical StatusKey (DECISIONS B12): "Dikembalikan"/"Terputus" are warnings (A10).
import type { JobStatus } from "@/shared/job.types";
import type { StatusKey } from "@/web/components/status.vocab";
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
