// Job row → API `Job`: legacy step mapping, coded error, actor, recover mode and follow-up actions.
import type { Job, JobNextAction, JobStatus, JobStep } from "../../shared/site.types";
import type { job } from "../db/schema";
import { decodeJobError, isLegacyStep, legacyStep, legacyStepKey } from "./job.legacy";

/** A persisted job row. */
export type JobRow = typeof job.$inferSelect;
/** Statuses that need a person (PLAN/02 `site_job_failed`, recover). */
export const NEEDS_ATTENTION: JobStatus[] = ["interrupted", "failed"];
const APP_LOG_STEPS = new Set(["app_restart", "health"]);

/** POST /jobs/:id/recover mode for a finished job; null = nothing to recover (PLAN/03 §3.5 rules). */
export function recoverModeOf(r: Pick<JobRow, "kind" | "status" | "resolvedBy" | "input">, steps: JobStep[]) {
  if (r.resolvedBy !== null || r.input === null || !NEEDS_ATTENTION.includes(r.status)) return null;
  if (r.kind === "hostname.remove") return "retry";
  if (r.kind === "site.delete") return steps.find((s) => s.key === "validate")?.status === "done" ? "retry" : null;
  return "cleanup";
}

/** API view of a job row; `app` = pm2 app of the target site (for `appLogApp`). */
export function toJob(r: JobRow, actorName: string | null, app: string | null): Job {
  const steps = r.steps.map((s) => (isLegacyStep(s) ? legacyStep(s, r.kind) : s));
  const recoverMode = recoverModeOf(r, steps);
  const failed = steps.find((s) => s.status === "failed");
  const appLogApp = failed && APP_LOG_STEPS.has(legacyStepKey(failed.key, r.kind)) ? (app ?? r.target) : null;
  const next: JobNextAction[] = [];
  if (recoverMode) next.push("recover");
  if (r.kind === "site.deploy" && r.status === "rolled_back") next.push("redeploy");
  if (appLogApp) next.push("app_log");
  if (r.kind === "site.create" && r.status === "succeeded") next.push("first_deploy");
  return {
    id: r.id,
    kind: r.kind,
    target: r.target,
    status: r.status,
    steps,
    error: decodeJobError(r.error),
    actor: r.actorId ? { id: r.actorId, name: actorName ?? "" } : null,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
    next,
    recoverMode,
    resolvedBy: r.resolvedBy,
    cleans: r.kind === "job.cleanup" && typeof r.input?.jobId === "string" ? r.input.jobId : null,
    appLogApp,
  };
}
