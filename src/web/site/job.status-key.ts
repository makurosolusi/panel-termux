// Raw job and job-step states → canonical StatusKey (DECISIONS B12): "Dikembalikan"/"Terputus" are warnings (A10).
import type { JobStatus, JobStepStatus } from "@/shared/job.types";
import type { StatusKey } from "@/web/components/status.vocab";

/** Badge key of a job. */
export const JOB_STATUS_KEY = {
  running: "processing",
  succeeded: "succeeded",
  failed: "failed",
  rolled_back: "rolled_back",
  interrupted: "interrupted",
} as const satisfies Record<JobStatus, StatusKey>;

/** Icon/tone key of one stepper step. */
export const JOB_STEP_STATUS_KEY = {
  pending: "pending",
  running: "processing",
  done: "done",
  failed: "failed",
  rolled_back: "rolled_back",
  skipped: "skipped",
} as const satisfies Record<JobStepStatus, StatusKey>;
