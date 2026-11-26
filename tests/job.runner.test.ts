import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { deploy, job, site, user } from "@/server/db/schema";
import { ApiError, type ApiErrorStatus } from "@/server/routes/http.error";
import { createJobRunner, type JobSpec, StepError } from "@/server/sites/job.runner";
import type { JobKind, JobStatus, JobStep } from "@/shared/site.types";

const root = mkdtempSync(join(tmpdir(), "panel-job-runner-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let seq = 0;

/** Fresh migrated DB with an admin and a site "blog" whose pm2 app is "blog-app" (adopted). */
function freshDb(): Db {
  const dir = join(root, String(++seq));
  mkdirSync(dir);
  const db = openDb(dir);
  runMigrations(db);
  db.insert(user).values({ id: "u1", email: "a@x.io", name: "Admin", role: "admin" }).run(); // test-only
  db.insert(site)
    .values({ name: "blog", port: 3001, app: "blog-app", runtime: "native", managed: false, dir: "/s/blog" })
    .run();
  return db;
}

const spec = (over: Partial<JobSpec> = {}): JobSpec => ({
  kind: "site.restart",
  target: "blog",
  actorId: "u1",
  steps: [{ key: "app_restart", run: async () => ({ code: "app_restarted", params: { name: "blog-app" } }) }],
  ...over,
});

/** Step run that rejects with `e`. */
const throws = (e: Error) => async (): Promise<never> => {
  throw e;
};
/** Persisted step record (test-only fixture). */
const rec = (key: string, status: JobStep["status"], code: string | null = null): JobStep => ({
  key,
  status,
  code,
  params: {},
  detail: null,
  log: [],
  startedAt: null,
  finishedAt: null,
});

const AT = new Date(Date.now() - 60_000);
/** Job row inserted directly (test-only fixture). */
const row = (
  id: string,
  kind: JobKind,
  target: string,
  status: JobStatus,
  extra: Partial<typeof job.$inferInsert> = {},
): typeof job.$inferInsert => ({ id, kind, target, status, steps: [], startedAt: AT, ...extra });

function expectApiError(fn: () => unknown, status: ApiErrorStatus, code: string): ApiError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect({ status: (e as ApiError).status, code: (e as ApiError).code }).toEqual({ status, code });
    return e as ApiError;
  }
  throw new Error(`expected ApiError ${status} ${code}`);
}

describe("coded steps", () => {
  test("outcome code/params/log are persisted, no English label; actor + duration in the view", async () => {
    const db = freshDb();
    const jobs = createJobRunner(db);
    const id = jobs.start(
      spec({
        kind: "site.env",
        input: { site: "blog", set: ["A"], unset: [] },
        steps: [
          {
            key: "env_write",
            run: async (ctx) => {
              ctx.log("wrote .env");
              ctx.log("x".repeat(400));
              return { code: "env_updated", params: { set: 1, unset: 0 } };
            },
          },
          { key: "app_restart", run: async () => ({ code: "app_restarted", params: { name: "blog-app" } }) },
          { key: "health", run: async () => ({ code: "skipped_here", skipped: true }) },
        ],
      }),
    );
    await jobs.idle();
    const j = jobs.get(id);
    expect(j.status).toBe("succeeded");
    expect(j.error).toBeNull();
    expect(j.actor).toEqual({ id: "u1", name: "Admin" });
    expect(j.durationMs).toBeGreaterThanOrEqual(0);
    expect(j.steps.map((s) => [s.key, s.status, s.code])).toEqual([
      ["env_write", "done", "env_updated"],
      ["app_restart", "done", "app_restarted"],
      ["health", "skipped", "skipped_here"],
    ]);
    const first = j.steps[0] as JobStep;
    expect(first.params).toEqual({ set: 1, unset: 0 });
    expect(first.log).toEqual(["wrote .env", "x".repeat(300)]);
    expect(first.startedAt).toBeString();
    expect(first.finishedAt).toBeString();
    expect(j.steps.some((s) => "label" in s || "message" in s)).toBe(false);
    // job.input is the recovery journal
    expect(db.select({ input: job.input }).from(job).where(eq(job.id, id)).get()?.input).toEqual({
      site: "blog",
      set: ["A"],
      unset: [],
    });
  });

  test("StepError → coded job error; generic error → unexpected with detail; undo runs", async () => {
    const db = freshDb();
    const jobs = createJobRunner(db);
    const undone: string[] = [];
    const id = jobs.start(
      spec({
        kind: "site.deploy",
        steps: [
          { key: "swap", run: async () => ({ code: "swap_first" }), undo: async () => void undone.push("swap") },
          {
            key: "health",
            run: throws(new StepError("health_timeout", { seconds: 60, last: "refused", path: "/" }, "GET / refused")),
          },
        ],
      }),
    );
    await jobs.idle();
    const j = jobs.get(id);
    expect(j.status).toBe("rolled_back");
    expect(j.error).toEqual({
      code: "health_timeout",
      params: { seconds: 60, last: "refused", path: "/" },
      detail: "GET / refused",
    });
    expect(undone).toEqual(["swap"]);
    expect(j.steps.map((s) => s.status)).toEqual(["rolled_back", "failed"]);
    expect(j.appLogApp).toBe("blog-app");
    expect(j.next).toEqual(["redeploy", "app_log"]);

    const id2 = jobs.start(
      spec({
        steps: [
          {
            key: "app_restart",
            run: throws(new Error("boom")),
          },
        ],
      }),
    );
    await jobs.idle();
    expect(jobs.get(id2).error).toEqual({ code: "unexpected", params: {}, detail: "boom" });
  });
});

describe("lock", () => {
  test("active/isLocked/busy while a job runs, all clear afterwards", async () => {
    const jobs = createJobRunner(freshDb());
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    expect(jobs.active()).toBeNull();
    const id = jobs.start(spec({ steps: [{ key: "app_restart", run: () => gate.then(() => ({ code: "ok" })) }] }));
    expect(jobs.active()).toMatchObject({ id, kind: "site.restart", target: "blog" });
    for (const name of ["cloudflared", "pm2", "postgres"]) expect(jobs.isLocked({ kind: "service", name })).toBe(true);
    expect(jobs.isLocked({ kind: "service", name: "sshd" })).toBe(false);
    expect(jobs.isLocked({ kind: "app", name: "blog-app" })).toBe(true);
    expect(jobs.isLocked({ kind: "app", name: "other" })).toBe(false);
    const err = expectApiError(() => jobs.start(spec()), 409, "busy");
    expect(err.body.job).toMatchObject({ id });
    release();
    await jobs.idle();
    expect(jobs.active()).toBeNull();
    expect(jobs.isLocked({ kind: "service", name: "pm2" })).toBe(false);
  });

  test("monitor is told about app_restart (incl. undo) and tunnel_restart", async () => {
    const notes: string[] = [];
    const monitor = {
      noteIntentionalRestart: (r: { kind: string; name: string }) => void notes.push(`${r.kind}:${r.name}`),
    };
    const jobs = createJobRunner(freshDb(), { monitor });
    jobs.start(
      spec({
        kind: "site.deploy",
        steps: [
          { key: "app_restart", run: async () => ({ code: "app_restarted" }), undo: async () => {} },
          {
            key: "health",
            run: throws(new StepError("app_no_pid")),
          },
        ],
      }),
    );
    await jobs.idle();
    jobs.start(
      spec({
        kind: "hostname.add",
        steps: [{ key: "tunnel_restart", run: async () => ({ code: "tunnel_restarted" }) }],
      }),
    );
    await jobs.idle();
    // run, undo of the restart, then the tunnel
    expect(notes).toEqual(["app:blog-app", "app:blog-app", "service:cloudflared"]);
  });
});

describe("persistence", () => {
  test("a throwing save() does not kill the job: final status stays readable and the lock is released", async () => {
    const db = freshDb();
    const jobs = createJobRunner(db);
    const realUpdate = db.update.bind(db);
    let failWrites = false;
    db.update = ((t: Parameters<typeof realUpdate>[0]) => {
      if (failWrites && t === job) throw new Error("SQLITE_FULL: database or disk is full");
      return realUpdate(t);
    }) as typeof db.update;
    const id = jobs.start(
      spec({
        steps: [
          {
            key: "app_restart",
            run: async () => {
              failWrites = true;
              return { code: "app_restarted" };
            },
          },
          { key: "health", run: async () => ({ code: "healthy" }) },
        ],
      }),
    );
    await jobs.idle();
    expect(jobs.active()).toBeNull();
    const j = jobs.get(id);
    expect(j.status).toBe("succeeded");
    expect(j.steps.map((s) => s.status)).toEqual(["done", "done"]);
    // The DB itself still holds the last good write.
    expect(db.select({ s: job.status }).from(job).where(eq(job.id, id)).get()?.s).toBe("running");
    failWrites = false;
    db.update = realUpdate;
  });

  test("boot: running job + deploy → interrupted, running step coded; legacy rows stay readable", () => {
    const db = freshDb();
    const steps = [rec("stage", "done", "staged"), rec("swap", "running")];
    db.insert(job)
      .values(row("j-run", "site.deploy", "blog", "running", { steps, actorId: "u1", input: { site: "blog" } }))
      .run();
    db.insert(deploy)
      .values({
        id: "d1",
        siteName: "blog",
        kind: "deploy",
        status: "running",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        runtime: "native",
        jobId: "j-run",
        at: AT,
      })
      .run();
    // 0.2.x rows: English labels/messages, free-text errors.
    const legacySteps = [
      { key: "validate", label: "Validate", status: "done", message: null },
      { key: "apps", label: "Unregister pm2 app", status: "done", message: "apps.json updated" },
      { key: "pm2", label: "Stop and remove pm2 process", status: "failed", message: "pm2 delete failed" },
    ] as JobStep[];
    const legacyError = "Stop and remove pm2 process: pm2 delete failed";
    db.insert(job)
      .values([
        row("j-old", "site.delete", "gone", "failed", { steps: legacySteps, error: legacyError, finishedAt: AT }),
        row("j-old2", "site.restart", "gone2", "failed", { error: "interrupted by panel restart", finishedAt: AT }),
      ])
      .run();

    const jobs = createJobRunner(db);
    const j = jobs.get("j-run");
    expect(j.status).toBe("interrupted");
    expect(j.error?.code).toBe("interrupted");
    expect(j.finishedAt).toBeString();
    expect(j.steps.map((s) => [s.key, s.status, s.code])).toEqual([
      ["stage", "done", "staged"],
      ["swap", "running", "interrupted"],
    ]);
    expect(j.recoverMode).toBe("cleanup");
    expect(j.next).toContain("recover");
    expect(db.select({ s: deploy.status }).from(deploy).where(eq(deploy.id, "d1")).get()?.s).toBe("interrupted");

    const old = jobs.get("j-old");
    expect(old.error).toEqual({
      code: "unexpected",
      params: {},
      detail: "Stop and remove pm2 process: pm2 delete failed",
    });
    expect(old.steps.map((s) => [s.key, s.code, s.legacyLabel, s.detail])).toEqual([
      ["validate", null, "Validate", null],
      ["apps_remove", null, "Unregister pm2 app", "apps.json updated"],
      ["app_remove", null, "Stop and remove pm2 process", "pm2 delete failed"],
    ]);
    expect(old.recoverMode).toBeNull(); // no journal before 0007
    const old2 = jobs.get("j-old2");
    expect(old2.status).toBe("failed"); // 0.2.x "interrupted" rows are not converted
    expect(old2.error?.code).toBe("interrupted");
  });
});

describe("recover hooks", () => {
  test("recoverMode per kind, resolves → resolvedBy, already_resolved / not_recoverable", async () => {
    const db = freshDb();
    db.insert(job)
      .values([
        row("del", "site.delete", "x", "failed", {
          steps: [rec("validate", "done", "validated")],
          input: { name: "x" },
        }),
        row("hr", "hostname.remove", "blog", "interrupted", { input: { site: "blog" } }),
      ])
      .run();
    const jobs = createJobRunner(db);
    expect(jobs.get("del").recoverMode).toBe("retry");
    expect(jobs.recoverable("hr").mode).toBe("retry");
    expect(
      jobs
        .needsAttention()
        .map((j) => j.id)
        .sort(),
    ).toEqual(["del", "hr"]);

    const cleanup = jobs.start(
      spec({
        kind: "job.cleanup",
        input: { jobId: "hr" },
        resolves: ["hr"],
        steps: [{ key: "inspect", run: async () => ({ code: "inspect_nothing" }) }],
      }),
    );
    await jobs.idle();
    expect(jobs.get(cleanup).cleans).toBe("hr");
    expect(jobs.get("hr").resolvedBy).toBe(cleanup);
    expect(jobs.get("hr").recoverMode).toBeNull();
    expect(expectApiError(() => jobs.recoverable("hr"), 409, "already_resolved").body.resolvedBy).toBe(cleanup);
    expect(expectApiError(() => jobs.recoverable(cleanup), 409, "not_recoverable").body.status).toBe("succeeded");
    expectApiError(() => jobs.recoverable("nope"), 404, "not_found");
    // the newest blog job (the cleanup) succeeded, so blog no longer needs attention
    expect(jobs.needsAttention().map((j) => j.id)).toEqual(["del"]);
  });

  test("list filters by target/kind/status and pages", async () => {
    const jobs = createJobRunner(freshDb());
    for (let i = 0; i < 3; i++) {
      jobs.start(spec());
      await jobs.idle();
    }
    jobs.start(spec({ target: "shop", kind: "site.env" }));
    await jobs.idle();
    expect(jobs.list({ page: 1, pageSize: 2, offset: 0 }, { target: "blog" })).toMatchObject({ total: 3, pageSize: 2 });
    expect(jobs.list({ page: 1, pageSize: 2, offset: 0 }, { target: "blog" }).items).toHaveLength(2);
    expect(jobs.list({ page: 1, pageSize: 20, offset: 0 }, { kind: "site.env" }).items.map((j) => j.target)).toEqual([
      "shop",
    ]);
    expect(jobs.list({ page: 1, pageSize: 20, offset: 0 }, { status: "failed" }).total).toBe(0);
    expect(jobs.list({ page: 1, pageSize: 20, offset: 0 }).total).toBe(4);
  });
});
