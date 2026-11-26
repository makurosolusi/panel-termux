// Job contract of the site API under /api/panel/jobs (PLAN/03 §3.1); re-exported by site.types.ts.
// Fields marked "0.3.0" are optional until their producers land, "0.2.x" ones go away; both settle in W7 (schedule §1.4).

/** 202 response of the job-starting endpoints. */
export type JobAccepted = { jobId: string };

/** What a job does. */
export type JobKind =
  | "site.create"
  | "site.delete"
  | "hostname.add"
  | "hostname.remove"
  | "site.deploy"
  | "site.rollback"
  | "site.restart"
  | "site.env"
  | "job.cleanup";
/** Job outcome; `interrupted` = the panel stopped while the job ran. */
export type JobStatus = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";
/** State of one job step. */
export type JobStepStatus = "pending" | "running" | "done" | "failed" | "rolled_back" | "skipped";

/** Stable step keys (i18n key part). */
export type JobStepKey =
  | "validate"
  | "inspect"
  | "folder"
  | "database"
  | "env_write"
  | "ingress"
  | "dns"
  | "tunnel_restart"
  | "domain_probe"
  | "apps_remove"
  | "app_remove"
  | "database_drop"
  | "folder_remove"
  | "stage"
  | "detect"
  | "chmod"
  | "swap"
  | "run_script"
  | "apps_entry"
  | "app_restart"
  | "health";

/** Full literal union in the implementation; values listed in PLAN 03 §3.4. */
export type JobOutcomeCode = string;
/** Interpolation values of a step/issue/error copy. */
export type JobParams = Record<string, string | number | boolean | null>;

/** One step of a job. */
export type JobStep = {
  /** 0.3.0 values are JobStepKey; 0.2.x rows hold free keys. */
  key: JobStepKey | (string & {});
  status: JobStepStatus;
  /** 0.2.x English label; 0.3.0 copy comes from `key`/`code`. */
  label?: string;
  /** 0.2.x free text; 0.3.0 uses `detail`. */
  message?: string | null;
  /** 0.3.0 */
  code?: JobOutcomeCode | null;
  /** 0.3.0 */
  params?: JobParams;
  /** 0.3.0. Technical detail (English allowed, copyable). Never secrets. */
  detail?: string | null;
  /** 0.3.0. Short technical lines (max 20 × 300 chars). Never secrets, never app output. */
  log?: string[];
  /** 0.3.0 */
  startedAt?: string | null;
  /** 0.3.0 */
  finishedAt?: string | null;
  /** Rows written before migration 0007 only. */
  legacyLabel?: string;
};

/** Why a job failed. */
export type JobError = { code: JobOutcomeCode; params: JobParams; detail: string | null };
/** Follow-up buttons offered after a job ends. */
export type JobNextAction = "recover" | "rollback" | "app_log" | "open_site" | "first_deploy" | "redeploy";

/** GET /jobs/:id; GET /jobs?page&pageSize returns Page<Job> (newest first). */
export type Job = {
  id: string;
  kind: JobKind;
  target: string;
  status: JobStatus;
  steps: JobStep[];
  error: JobError | null;
  /** 0.3.0 */
  actor?: { id: string; name: string } | null;
  startedAt: string;
  finishedAt: string | null;
  /** 0.3.0 */
  durationMs?: number | null;
  /** 0.3.0 */
  next?: JobNextAction[];
  /** 0.3.0. What POST /jobs/:id/recover will do; null = not recoverable (or already resolved). */
  recoverMode?: "cleanup" | "retry" | null;
  /** 0.3.0 */
  resolvedBy?: string | null;
  /** 0.3.0. job.cleanup only. */
  cleans?: string | null;
  /** 0.3.0. pm2 app whose stderr the failure box shows (null = none). */
  appLogApp?: string | null;
};
