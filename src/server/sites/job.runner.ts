import { count, desc, eq } from "drizzle-orm";
import type { Page } from "../../shared/dev.types";
import type { Job, JobKind, JobStatus, JobStep } from "../../shared/site.types";
import type { Db } from "../db/client";
import { job } from "../db/schema";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";

/** What a step's `run` returns: a message for the step log, or `{ skipped }` to mark it skipped. */
export type StepResult = string | null | undefined | { skipped: string };

/**
 * One job step. `undo` reverses a completed step during rollback. A step with no `undo` and not
 * `irreversible` has no side effects (counts as rolled back); an `irreversible` one keeps the job "failed".
 */
export type StepDef = {
  key: string;
  label: string;
  run(): Promise<StepResult>;
  undo?(): Promise<void>;
  irreversible?: boolean;
};

/** Job definition handed to `start`. `onSuccess` commits DB records; `afterRollback` repairs shared state. */
export type JobSpec = {
  kind: JobKind;
  target: string;
  actorId: string;
  steps: StepDef[];
  onSuccess?(): void;
  afterRollback?(): Promise<void>;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toJob(r: typeof job.$inferSelect): Job {
  return {
    id: r.id,
    kind: r.kind,
    target: r.target,
    status: r.status,
    steps: r.steps,
    // 0.2.x rows store free text; the 0.3.0 runner (W1, wkr-sites-runner-01) writes coded errors.
    error: r.error === null ? null : { code: "unexpected", params: {}, detail: r.error },
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

/**
 * Runs site jobs one at a time (they all edit the same apps.json/config.yml): a second `start` while one
 * runs fails with 409 `busy`. Every step change is persisted to table `job`.
 * ponytail: single global lock; per-file locks only if jobs ever become frequent.
 */
export function createJobRunner(db: Db) {
  let running: Promise<void> | null = null;

  // Jobs still "running" in the DB were cut off by a panel restart; their state is unknown.
  db.update(job)
    .set({ status: "failed", error: "interrupted by panel restart", finishedAt: new Date() })
    .where(eq(job.status, "running"))
    .run();

  async function execute(id: string, spec: JobSpec, steps: JobStep[]): Promise<void> {
    const save = (status: JobStatus = "running", error: string | null = null) =>
      db
        .update(job)
        .set({ steps, status, error, finishedAt: status === "running" ? null : new Date() })
        .where(eq(job.id, id))
        .run();
    const done: number[] = [];
    let failure: string | null = null;
    for (const [i, def] of spec.steps.entries()) {
      const st = steps[i] as JobStep;
      st.status = "running";
      save();
      try {
        const res = await def.run();
        if (typeof res === "object" && res !== null) Object.assign(st, { status: "skipped", message: res.skipped });
        else {
          Object.assign(st, { status: "done", message: res ?? null });
          done.push(i);
        }
      } catch (e) {
        failure = `${def.label}: ${errMsg(e)}`;
        Object.assign(st, { status: "failed", message: errMsg(e) });
        break;
      }
    }
    if (failure === null) {
      try {
        spec.onSuccess?.();
        save("succeeded");
        log.info(`[sites] job ${id} ${spec.kind} ${spec.target} succeeded`);
        return;
      } catch (e) {
        failure = `saving records: ${errMsg(e)}`;
      }
    }
    save("running", failure);
    let clean = true;
    for (const i of done.reverse()) {
      const def = spec.steps[i] as StepDef;
      const st = steps[i] as JobStep;
      if (def.irreversible) {
        clean = false;
        continue;
      }
      try {
        await def.undo?.();
        st.status = "rolled_back";
      } catch (e) {
        clean = false;
        st.message = `undo failed: ${errMsg(e)}`;
        log.error(`[sites] job ${id} undo of ${def.key} failed: ${errMsg(e)}`);
      }
      save("running", failure);
    }
    try {
      await spec.afterRollback?.();
    } catch (e) {
      clean = false;
      log.error(`[sites] job ${id} post-rollback repair failed: ${errMsg(e)}`);
    }
    save(clean ? "rolled_back" : "failed", failure);
    log.warn(`[sites] job ${id} ${spec.kind} ${spec.target} ${clean ? "rolled back" : "failed"}: ${failure}`);
  }

  return {
    busy: () => running !== null,

    /** Throws 409 `busy` when a job runs. */
    assertIdle(): void {
      if (running) throw new ApiError(409, "busy", "another site job is running; try again when it finished");
    },

    /** Persists and starts the job in the background; returns its id. */
    start(spec: JobSpec): string {
      this.assertIdle();
      const id = crypto.randomUUID();
      const steps: JobStep[] = spec.steps.map((s) => ({
        key: s.key,
        label: s.label,
        status: "pending",
        message: null,
      }));
      db.insert(job)
        .values({
          id,
          kind: spec.kind,
          target: spec.target,
          status: "running",
          steps,
          actorId: spec.actorId,
          startedAt: new Date(),
        })
        .run();
      running = execute(id, spec, steps)
        .catch((e) => log.error(`[sites] job ${id} crashed: ${errMsg(e)}`))
        .finally(() => {
          running = null;
        });
      return id;
    },

    /** Resolves when no job is running (tests, shutdown). */
    idle: async () => {
      while (running) await running;
    },

    get(id: string): Job {
      const r = db.select().from(job).where(eq(job.id, id)).get();
      if (!r) throw new ApiError(404, "not_found", `unknown job ${id}`);
      return toJob(r);
    },

    list(paging: Paging): Page<Job> {
      const rows = db
        .select()
        .from(job)
        .orderBy(desc(job.startedAt))
        .limit(paging.pageSize)
        .offset(paging.offset)
        .all();
      const total = db.select({ n: count() }).from(job).get()?.n ?? 0;
      return { items: rows.map(toJob), total, page: paging.page, pageSize: paging.pageSize };
    },
  };
}

/** The job runner instance type. */
export type JobRunner = ReturnType<typeof createJobRunner>;
