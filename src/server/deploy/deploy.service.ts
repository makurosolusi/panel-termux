import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ChunkReceived, Deploy, DeployKind, DeployStatus, UploadState } from "../../shared/deploy.types";
import type { Page } from "../../shared/dev.types";
import type { SiteRuntime } from "../../shared/site.types";
import { recordAudit } from "../audit.service";
import { deploy, site } from "../db/schema";
import { log } from "../log.service";
import type { Monitor } from "../monitor/monitor.contract";
import { ApiError, type Paging } from "../routes/http.error";
import type { JobRunner, JobSpec, StepDef } from "../sites/job.runner";
import { errMsg } from "../sites/job.step";
import { SITE_NAME_RE, type SiteCtx } from "../sites/site.checks";
import { identityOf, rowFor, siteBinaries } from "./binary.identity";
import { assertIntegration, assertRuntime, assertSiteSpace, scriptRuntime } from "./deploy.checks";
import { listDeploys } from "./deploy.history";
import { type CleanupOf, cleanupSteps } from "./deploy.recovery";
import { appRestartStep, healthStep, revertApp } from "./deploy.restart";
import {
  appName,
  appsEntryStep,
  binsOf,
  chmodStep,
  type DeployState,
  detectStep,
  newState,
  rollbackSwapStep,
  runScriptStep,
  type SiteRow,
  stageStep,
  swapStep,
} from "./deploy.steps";
import { BinaryError, detectRuntime } from "./elf.runtime";
import type { HealthTiming } from "./health.check";
import { sha256File } from "./swap";
import { createUploadStore, freeBytes } from "./upload.store";

/**
 * Deps: site context, the shared job runner (global lock), the panel data dir (uploads/ lives there). Optional:
 * monitor (restarts the deploy causes are not crashes), failing integration checks for a managed first deploy
 * (409 `integration_required`), health timing/timeout overrides (tests), free-space reader (tests).
 */
export type DeployDeps = SiteCtx & {
  jobs: JobRunner;
  dataDir: string;
  monitor?: Pick<Monitor, "noteIntentionalRestart">;
  integrationFailing?: () => Promise<string[]>;
  healthTiming?: HealthTiming;
  healthTimeoutMs?: number;
  freeBytes?: (path: string) => number;
};

/** Binary deploys behind /api/panel: resumable upload → site.deploy job, site.rollback job, cleanup, history. */
export function createDeployService(deps: DeployDeps) {
  const { db, jobs } = deps;
  const free = deps.freeBytes ?? freeBytes;
  const uploads = createUploadStore(join(deps.dataDir, "uploads"), { free });
  const health = (ctx: SiteCtx, s: SiteRow, st: DeployState) =>
    healthStep(ctx, s, st, deps.healthTiming, deps.healthTimeoutMs);

  const siteRow = (name: string): SiteRow => {
    if (!SITE_NAME_RE.test(name)) throw new ApiError(400, "invalid_name", `invalid site name ${JSON.stringify(name)}`);
    const s = db.select().from(site).where(eq(site.name, name)).get();
    if (!s) throw new ApiError(404, "not_found", `unknown site ${name}`);
    return s;
  };
  const finish = (id: string, status: DeployStatus) =>
    db.update(deploy).set({ status, finishedAt: new Date() }).where(eq(deploy.id, id)).run();

  const fromSha = (s: SiteRow) => rowFor(db, s.name, identityOf(binsOf(s).app))?.sha256 ?? null;

  /** Starts the job and inserts its deploy row in the same tick (before any step result is recorded). */
  function runJob(
    actorId: string,
    s: SiteRow,
    kind: DeployKind,
    st: DeployState,
    steps: StepDef[],
    bin: { sha256: string; sizeBytes: number; fileName: string | null },
    input: Record<string, unknown>,
  ): string {
    const id = crypto.randomUUID();
    const spec: JobSpec = {
      kind: kind === "deploy" ? "site.deploy" : "site.rollback",
      target: s.name,
      actorId,
      steps,
      input,
      onSuccess() {
        const live = identityOf(binsOf(s).app);
        db.transaction((tx) => {
          tx.update(deploy)
            .set({
              status: "succeeded",
              runtime: st.runtime,
              finishedAt: new Date(),
              binIno: live?.ino ?? null,
              binMtimeMs: live?.mtimeMs ?? null,
            })
            .where(eq(deploy.id, id))
            .run();
          tx.update(site).set({ runtime: st.runtime }).where(eq(site.name, s.name)).run();
        });
        if (kind === "deploy") rmSync(binsOf(s).drop, { force: true });
      },
      async afterRollback() {
        rmSync(binsOf(s).next, { force: true });
        try {
          if (st.restarted) deps.monitor?.noteIntentionalRestart({ kind: "app", name: appName(s) });
          const done = await revertApp(deps, s, st);
          if (done) log.warn(`[deploy] ${s.name}: ${done} after rollback`);
        } catch (e) {
          finish(id, "failed");
          throw new Error(`reverting pm2 app of ${s.name}: ${errMsg(e)}`, { cause: e });
        }
        finish(id, st.swapped && !st.undoFailed ? "rolled_back" : "failed");
      },
    };
    const jobId = jobs.start(spec);
    db.insert(deploy)
      .values({
        id,
        siteName: s.name,
        kind,
        status: "running",
        runtime: st.runtime,
        jobId,
        actorId,
        at: new Date(),
        ...bin,
      })
      .run();
    return jobId;
  }

  return {
    uploads,

    /** POST /sites/:name/uploads → 201 UploadState. */
    async startUpload(name: string, body: unknown): Promise<UploadState> {
      const s = siteRow(name);
      if (!existsSync(s.dir)) throw new ApiError(409, "no_folder", `site folder ${s.dir} does not exist`);
      await assertIntegration(s, deps.integrationFailing);
      return uploads.start(s.name, body);
    },

    /** GET /sites/:name/uploads/active. */
    activeUpload: (name: string): UploadState | null => uploads.activeFor(siteRow(name).name),

    /** GET /uploads/:id. */
    getUpload: (id: string): UploadState => uploads.view(uploads.get(id)),

    /** PUT /uploads/:id/chunks/:index; chunk 0 of an adopted site must match what its pm2 entry runs. */
    putChunk: (id: string, index: string, body: Uint8Array, sha: string | null): Promise<ChunkReceived> =>
      uploads.putChunk(id, index, body, sha, async (name, runtime) => {
        const s = siteRow(name);
        if (s.managed) return;
        try {
          assertRuntime(await scriptRuntime(deps.system, s), runtime);
        } catch (e) {
          if (e instanceof ApiError && e.code === "pm2_not_running") return; // checked again at complete
          throw e;
        }
      }),

    /** DELETE /uploads/:id. */
    abort: (id: string) => uploads.abort(id),

    /** Site delete (`validate`): its unfinished upload goes too. */
    dropUploadsFor: (name: string) => uploads.dropFor(name),

    /** SiteDetail.binary of a site. */
    binaries: (s: { name: string; dir: string }) => siteBinaries(db, s),

    /** POST /uploads/:id/complete: checks, sha256 of upload.bin (C1), then the site.deploy job. */
    async complete(actorId: string, uploadId: string): Promise<{ jobId: string }> {
      const u = uploads.get(uploadId);
      const missing = uploads.missing(u);
      if (missing.length) {
        throw new ApiError(400, "incomplete", `missing chunks: ${missing.join(", ")}`, { missing });
      }
      const s = siteRow(u.site);
      jobs.assertIdle();
      const expected = await scriptRuntime(deps.system, s);
      const runtime = u.runtime;
      if (!runtime) throw new ApiError(400, "incomplete", "chunk 0 was not received", { missing: [0] });
      assertRuntime(expected, runtime);
      const firstDeploy = !existsSync(binsOf(s).app);
      await assertIntegration(s, deps.integrationFailing);
      assertSiteSpace(s, uploads.binOf(u), u.sizeBytes, free);
      const sha256 = await uploads.verify(u);
      try {
        jobs.assertIdle(); // another job may have started while hashing
      } catch (e) {
        uploads.reopen(u);
        throw e;
      }
      const st = newState(runtime);
      const steps = [
        stageStep(s, { path: uploads.binOf(u), sizeBytes: u.sizeBytes }, () => uploads.removeDir(u.id)),
        detectStep(s, st, expected === "native" || expected === "grun" ? expected : null),
        chmodStep(s),
        swapStep(deps, s, st),
        runScriptStep(s, st),
        appsEntryStep(deps, s, st),
        appRestartStep(deps, s, st),
        health(deps, s, st),
      ];
      const bin = { sha256, sizeBytes: u.sizeBytes, fileName: u.fileName };
      const input = {
        site: s.name,
        sha256,
        fromSha256: fromSha(s),
        sizeBytes: u.sizeBytes,
        fileName: u.fileName,
        runtime,
        firstDeploy,
      };
      uploads.detach(u);
      const jobId = runJob(actorId, s, "deploy", st, steps, bin, input);
      recordAudit(db, {
        actorId,
        action: "site.deploy",
        target: s.name,
        meta: { jobId, sha256, sizeBytes: u.sizeBytes, runtime },
      });
      log.info(`[deploy] ${s.name} ${u.sizeBytes} bytes (${runtime}) by ${actorId}, job ${jobId}`);
      return { jobId };
    },

    /** POST /sites/:name/rollback: app ↔ app.prev as a site.rollback job. */
    async rollback(actorId: string, name: string): Promise<{ jobId: string }> {
      const s = siteRow(name);
      jobs.assertIdle();
      const p = binsOf(s);
      if (!existsSync(p.prev)) throw new ApiError(409, "no_previous", `${name} has no previous binary (app.prev)`);
      if (!existsSync(p.app)) throw new ApiError(409, "no_current", `${name} has no live binary (app)`);
      let runtime: SiteRuntime;
      try {
        runtime = detectRuntime(p.prev);
      } catch (e) {
        if (e instanceof BinaryError)
          throw new ApiError(400, "invalid_binary", `app.prev: ${e.message}`, { reason: e.reason });
        throw e;
      }
      assertRuntime(await scriptRuntime(deps.system, s), runtime);
      const toSha256 = await sha256File(p.prev);
      const bin = {
        sha256: toSha256,
        sizeBytes: statSync(p.prev).size,
        fileName: rowFor(db, s.name, identityOf(p.prev))?.fileName ?? null,
      };
      jobs.assertIdle();
      const st = newState(runtime);
      const steps = [
        rollbackSwapStep(deps, s, st),
        runScriptStep(s, st),
        appRestartStep(deps, s, st),
        health(deps, s, st),
      ];
      const jobId = runJob(actorId, s, "rollback", st, steps, bin, { site: s.name, toSha256, fromSha256: fromSha(s) });
      recordAudit(db, { actorId, action: "site.rollback", target: name, meta: { jobId, sha256: toSha256, runtime } });
      log.info(`[deploy] rollback ${name} to ${toSha256.slice(0, 12)} by ${actorId}, job ${jobId}`);
      return { jobId };
    },

    /**
     * job.cleanup of an interrupted/failed site.deploy or site.rollback (called by POST /jobs/:id/recover);
     * `resolves` = the original job (and an interrupted earlier cleanup of it).
     */
    recover(actorId: string, of: CleanupOf & { jobId: string }, resolves: string[] = [of.jobId]): string {
      const { steps } = cleanupSteps(deps, of, { timing: deps.healthTiming, healthTimeoutMs: deps.healthTimeoutMs });
      return jobs.start({
        kind: "job.cleanup",
        target: of.target,
        actorId,
        steps,
        input: { jobId: of.jobId },
        resolves,
      });
    },

    /** GET /sites/:name/deploys: newest first; `active` = the row whose file is the live `app` now. */
    list: (name: string, paging: Paging): Page<Deploy> => listDeploys(db, siteRow(name), paging),
  };
}

/** The deploy service instance type. */
export type DeployService = ReturnType<typeof createDeployService>;
