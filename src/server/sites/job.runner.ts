import { and, count, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { Page } from "../../shared/dev.types";
import type { ActiveJob, Job, JobError, JobKind, JobStatus, JobStep } from "../../shared/site.types";
import type { Db } from "../db/client";
import { deploy, job, site, user } from "../db/schema";
import { log } from "../log.service";
import type { Monitor } from "../monitor/monitor.contract";
import { ApiError, type Paging } from "../routes/http.error";
import { encodeJobError, legacyStepKey } from "./job.legacy";
import { errMsg, failStep, type JobSpec, pendingStep, record, type StepDef, stepContext } from "./job.step";
import { type JobRow, NEEDS_ATTENTION, toJob } from "./job.view";

export type { JobSpec, StepContext, StepDef, StepOutcome, StepResult } from "./job.step";
export { StepError } from "./job.step";

/** Optional runner deps: the monitor is told about restarts the runner causes (not counted as crashes). */
export type JobRunnerDeps = { monitor?: Pick<Monitor, "noteIntentionalRestart"> };

/** Services locked while any job runs (D28: one global job lock). */
const LOCKED_SERVICES = new Set(["cloudflared", "pm2", "postgres"]);

const nowIso = () => new Date().toISOString();
type Current = { id: string; spec: JobSpec; steps: JobStep[]; active: ActiveJob; app: string };

/**
 * Runs site jobs one at a time (they all edit the same apps.json/config.yml): a second `start` while one
 * runs fails with 409 `busy`. Every step change is persisted to table `job`; a failed write is logged and the
 * state kept in memory (`get` still shows it) so a DB hiccup never kills a half-done job.
 * ponytail: single global lock; per-file locks only if jobs ever become frequent.
 */
export function createJobRunner(db: Db, deps: JobRunnerDeps = {}) {
  let running: Promise<void> | null = null;
  let current: Current | null = null;
  const unsaved = new Map<string, Partial<JobRow>>();

  // Jobs still "running" were cut off by a panel stop; their state is unknown → interrupted (D11), no auto-undo.
  const left = db.select({ id: job.id, steps: job.steps }).from(job).where(eq(job.status, "running")).all();
  const now = new Date();
  db.transaction((tx) => {
    for (const r of left) {
      const steps = r.steps.map((s) => (s.status === "running" ? { ...s, code: "interrupted" } : s));
      tx.update(job)
        .set({
          status: "interrupted",
          steps,
          finishedAt: now,
          error: encodeJobError({ code: "interrupted", params: {}, detail: null }),
        })
        .where(eq(job.id, r.id))
        .run();
    }
    tx.update(deploy).set({ status: "interrupted", finishedAt: now }).where(eq(deploy.status, "running")).run();
  });
  if (left.length)
    log.warn(
      `[sites] ${left.length} job(s) cut off by the last stop marked interrupted: ${left.map((r) => r.id).join(", ")}`,
    );

  function save(id: string, set: Partial<JobRow>): void {
    try {
      db.update(job).set(set).where(eq(job.id, id)).run();
      unsaved.delete(id);
    } catch (e) {
      unsaved.set(id, { ...unsaved.get(id), ...set });
      log.error(`[sites] saving job ${id} (status ${set.status ?? "?"}) failed: ${errMsg(e)}`);
    }
  }

  function noteRestart(cur: Current, def: StepDef): void {
    const key = legacyStepKey(def.key, cur.spec.kind);
    if (key === "app_restart") deps.monitor?.noteIntentionalRestart({ kind: "app", name: cur.app });
    if (key === "tunnel_restart") deps.monitor?.noteIntentionalRestart({ kind: "service", name: "cloudflared" });
  }

  async function execute(cur: Current): Promise<void> {
    const { id, spec, steps } = cur;
    const persist = (status: JobStatus, error: JobError | null = null) =>
      save(id, { steps, status, error: encodeJobError(error), finishedAt: status === "running" ? null : new Date() });
    const done: number[] = [];
    let failure: JobError | null = null;
    for (const [i, def] of spec.steps.entries()) {
      const st = steps[i] as JobStep;
      Object.assign(st, { status: "running", startedAt: nowIso() });
      persist("running");
      try {
        noteRestart(cur, def);
        record(st, def, await def.run(stepContext(st)));
        if (st.status === "done") done.push(i);
      } catch (e) {
        failure = failStep(st, def, e);
      }
      st.finishedAt = nowIso();
      if (failure) break;
    }
    if (failure === null) {
      try {
        spec.onSuccess?.();
        persist("succeeded");
        for (const r of spec.resolves ?? []) save(r, { resolvedBy: id });
        log.info(`[sites] job ${id} ${spec.kind} ${spec.target} succeeded`);
        return;
      } catch (e) {
        failure = { code: "unexpected", params: {}, detail: `saving records: ${errMsg(e)}` };
      }
    }
    persist("running", failure);
    let clean = true;
    for (const i of done.reverse()) {
      const def = spec.steps[i] as StepDef;
      const st = steps[i] as JobStep;
      if (def.irreversible) {
        clean = false;
        continue;
      }
      try {
        if (def.undo) noteRestart(cur, def);
        await def.undo?.();
        st.status = "rolled_back";
      } catch (e) {
        clean = false;
        st.detail = `undo failed: ${errMsg(e)}`;
        if (def.label !== undefined) st.message = st.detail;
        log.error(`[sites] job ${id} undo of ${def.key} failed: ${errMsg(e)}`);
      }
      persist("running", failure);
    }
    try {
      await spec.afterRollback?.();
    } catch (e) {
      clean = false;
      log.error(`[sites] job ${id} post-rollback repair failed: ${errMsg(e)}`);
    }
    persist(clean ? "rolled_back" : "failed", failure);
    log.warn(
      `[sites] job ${id} ${spec.kind} ${spec.target} ${clean ? "rolled back" : "failed"}: ${failure.code} ${failure.detail ?? ""}`,
    );
  }

  const select = () =>
    db
      .select({ j: job, actorName: user.name, app: site.app })
      .from(job)
      .leftJoin(user, eq(user.id, job.actorId))
      .leftJoin(site, eq(site.name, job.target));
  const view = (r: { j: JobRow; actorName: string | null; app: string | null }) =>
    toJob({ ...r.j, ...unsaved.get(r.j.id) }, r.actorName, r.app);

  return {
    busy: () => running !== null,

    /** The job running now, or null. */
    active: (): ActiveJob | null => current?.active ?? null,

    /** D28: while a job runs, cloudflared/pm2/postgres and the target's pm2 app are locked. */
    isLocked({ kind, name }: { kind: "service" | "app"; name: string }): boolean {
      if (!current) return false;
      return kind === "service" ? LOCKED_SERVICES.has(name) : name === current.app;
    },

    /** Throws 409 `busy` (extra `job`: the running one) when a job runs. */
    assertIdle(): void {
      if (current)
        throw new ApiError(409, "busy", "another site job is running; try again when it finished", {
          job: current.active,
        });
    },

    /** Persists the job (with its input journal) and starts it in the background; returns its id. */
    start(spec: JobSpec): string {
      this.assertIdle();
      const id = crypto.randomUUID();
      const startedAt = new Date();
      const steps = spec.steps.map(pendingStep);
      db.insert(job)
        .values({
          id,
          kind: spec.kind,
          target: spec.target,
          status: "running",
          steps,
          actorId: spec.actorId,
          startedAt,
          input: spec.input ?? null,
        })
        .run();
      const app = db.select({ app: site.app }).from(site).where(eq(site.name, spec.target)).get()?.app ?? spec.target;
      const cur: Current = {
        id,
        spec,
        steps,
        app,
        active: { id, kind: spec.kind, target: spec.target, startedAt: startedAt.toISOString() },
      };
      current = cur;
      running = execute(cur)
        .catch((e) => {
          log.error(`[sites] job ${id} crashed: ${errMsg(e)}`);
          save(id, {
            steps,
            status: "failed",
            finishedAt: new Date(),
            error: encodeJobError({ code: "unexpected", params: {}, detail: errMsg(e) }),
          });
        })
        .finally(() => {
          running = null;
          current = null;
        });
      return id;
    },

    /** Resolves when no job is running (tests, shutdown). */
    idle: async () => {
      while (running) await running;
    },

    get(id: string): Job {
      const r = select().where(eq(job.id, id)).get();
      if (!r) throw new ApiError(404, "not_found", `unknown job ${id}`);
      return view(r);
    },

    /** Newest first; optional filters (values validated by the route). */
    list(paging: Paging, filter: { target?: string; kind?: JobKind; status?: JobStatus } = {}): Page<Job> {
      const conds: SQL[] = [];
      if (filter.target) conds.push(eq(job.target, filter.target));
      if (filter.kind) conds.push(eq(job.kind, filter.kind));
      if (filter.status) conds.push(eq(job.status, filter.status));
      const where = and(...conds);
      const rows = select()
        .where(where)
        .orderBy(desc(job.startedAt))
        .limit(paging.pageSize)
        .offset(paging.offset)
        .all();
      const total = db.select({ n: count() }).from(job).where(where).get()?.n ?? 0;
      return { items: rows.map(view), total, page: paging.page, pageSize: paging.pageSize };
    },

    /** Latest job per target that is interrupted/failed and unresolved (PLAN/02 problem `site_job_failed`). */
    needsAttention(): Job[] {
      const latest = sql`${job.startedAt} = (SELECT max(j2.started_at) FROM job j2 WHERE j2.target = ${job.target})`;
      return select()
        .where(and(inArray(job.status, NEEDS_ATTENTION), isNull(job.resolvedBy), latest))
        .all()
        .map(view);
    },

    /** Recover hook for POST /jobs/:id/recover: the job and its mode, or 404 / 409 `already_resolved`/`not_recoverable`. */
    recoverable(id: string): { job: Job; mode: "cleanup" | "retry" } {
      const j = this.get(id);
      if (j.resolvedBy)
        throw new ApiError(409, "already_resolved", `job ${id} was resolved by ${j.resolvedBy}`, {
          resolvedBy: j.resolvedBy,
        });
      if (!j.recoverMode)
        throw new ApiError(409, "not_recoverable", `job ${id} (${j.status}) has nothing to recover`, {
          status: j.status,
        });
      return { job: j, mode: j.recoverMode };
    },
  };
}

/** The job runner instance type. */
export type JobRunner = ReturnType<typeof createJobRunner>;
