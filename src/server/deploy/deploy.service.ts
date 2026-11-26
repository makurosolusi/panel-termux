import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { count, desc, eq } from "drizzle-orm";
import type { Deploy, DeployKind, DeployStatus, UploadStarted } from "../../shared/deploy.types";
import { DEPLOY_CHUNK_SIZE } from "../../shared/deploy.types";
import type { Page } from "../../shared/dev.types";
import type { SiteRuntime } from "../../shared/site.types";
import { recordAudit } from "../audit.service";
import { deploy, site, user } from "../db/schema";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";
import type { JobRunner, JobSpec, StepDef } from "../sites/job.runner";
import { SITE_NAME_RE, type SiteCtx } from "../sites/site.checks";
import {
  appsRuntimeStep,
  assembleStep,
  binPaths,
  chmodStep,
  type DeployState,
  detectStep,
  healthStep,
  restartStep,
  revertApp,
  swapBackStep,
  swapStep,
} from "./deploy.steps";
import { BinaryError, detectRuntime } from "./elf.runtime";
import { createUploadStore } from "./upload.store";

/** How long a restarted app gets to answer `GET /` before the deploy is undone. */
export const HEALTH_TIMEOUT_MS = 30_000;

/** Deps: site context, the shared job runner (global lock), the panel data dir (uploads/ lives there). */
export type DeployDeps = SiteCtx & { jobs: JobRunner; dataDir: string; healthTimeoutMs?: number };

type SiteRow = typeof site.$inferSelect;

async function sha256File(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) h.update(chunk);
  return h.digest("hex");
}

/** Binary deploys behind /api/panel: chunked upload → site.deploy job, site.rollback job, deploy history. */
export function createDeployService(deps: DeployDeps) {
  const { db, jobs } = deps;
  const healthTimeoutMs = deps.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
  const uploads = createUploadStore(join(deps.dataDir, "uploads"));

  // Rows still "running" were cut off by a panel restart (the job runner marks their jobs failed too).
  db.update(deploy).set({ status: "failed" }).where(eq(deploy.status, "running")).run();

  const siteRow = (name: string): SiteRow => {
    if (!SITE_NAME_RE.test(name)) throw new ApiError(400, "invalid_name", `invalid site name ${JSON.stringify(name)}`);
    const s = db.select().from(site).where(eq(site.name, name)).get();
    if (!s) throw new ApiError(404, "not_found", `unknown site ${name}`);
    return s;
  };
  const setStatus = (id: string, status: DeployStatus) =>
    db.update(deploy).set({ status }).where(eq(deploy.id, id)).run();

  /** Wraps the step list with the deploy row bookkeeping and the post-rollback restart. */
  function runJob(
    actorId: string,
    s: SiteRow,
    kind: DeployKind,
    st: DeployState,
    steps: StepDef[],
    bin: { sha256: string; sizeBytes: number },
  ): string {
    const id = crypto.randomUUID();
    const spec: JobSpec = {
      kind: kind === "deploy" ? "site.deploy" : "site.rollback",
      target: s.name,
      actorId,
      steps,
      onSuccess() {
        db.transaction((tx) => {
          tx.update(deploy).set({ status: "succeeded", runtime: st.runtime }).where(eq(deploy.id, id)).run();
          tx.update(site).set({ runtime: st.runtime }).where(eq(site.name, s.name)).run();
        });
        if (kind === "deploy") rmSync(binPaths(s).drop, { force: true });
      },
      async afterRollback() {
        rmSync(binPaths(s).next, { force: true });
        try {
          const done = await revertApp(deps, s, st);
          if (done) log.warn(`[deploy] ${s.name}: ${done} after rollback`);
        } catch (e) {
          setStatus(id, "failed");
          throw e;
        }
        setStatus(id, st.swapped && !st.undoFailed ? "rolled_back" : "failed");
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

  const newState = (runtime: SiteRuntime): DeployState => ({
    runtime,
    swapped: false,
    appsChanged: false,
    restarted: false,
    undoFailed: false,
  });

  return {
    uploads,

    startUpload(name: string, body: unknown): UploadStarted {
      const u = uploads.start(siteRow(name).name, body);
      return { uploadId: u.id, chunkSize: DEPLOY_CHUNK_SIZE };
    },

    putChunk: async (uploadId: string, index: string, body: ArrayBuffer) => ({
      received: await uploads.putChunk(uploadId, index, body),
    }),

    abort: (uploadId: string) => uploads.abort(uploadId),

    complete(actorId: string, uploadId: string): { jobId: string } {
      const u = uploads.get(uploadId);
      const missing = uploads.missing(u);
      if (missing.length) throw new ApiError(400, "incomplete", `missing chunks: ${missing.join(", ")}`);
      const s = siteRow(u.site);
      jobs.assertIdle();
      let runtime: SiteRuntime;
      try {
        runtime = detectRuntime(join(u.dir, "0.part")); // ELF + program headers sit in the first chunk
      } catch (e) {
        if (e instanceof BinaryError) throw new ApiError(400, "invalid_binary", e.message);
        throw e;
      }
      const st = newState(runtime);
      const steps = [
        assembleStep(s, u),
        detectStep(s, st),
        chmodStep(s),
        swapStep(s, st),
        appsRuntimeStep(deps, s, st),
        restartStep(deps, s, st),
        healthStep(deps, s, healthTimeoutMs),
      ];
      const jobId = runJob(actorId, s, "deploy", st, steps, { sha256: u.sha256, sizeBytes: u.sizeBytes });
      uploads.detach(u);
      recordAudit(db, {
        actorId,
        action: "site.deploy",
        target: s.name,
        meta: { jobId, sha256: u.sha256, sizeBytes: u.sizeBytes, runtime },
      });
      log.info(`[deploy] ${s.name} ${u.sizeBytes} bytes (${runtime}) by ${actorId}, job ${jobId}`);
      return { jobId };
    },

    async rollback(actorId: string, name: string): Promise<{ jobId: string }> {
      const s = siteRow(name);
      jobs.assertIdle();
      const p = binPaths(s);
      if (!existsSync(p.prev)) throw new ApiError(409, "no_previous", `${name} has no previous binary (app.prev)`);
      if (!existsSync(p.app)) throw new ApiError(409, "no_current", `${name} has no live binary (app)`);
      let runtime: SiteRuntime;
      try {
        runtime = detectRuntime(p.prev);
      } catch (e) {
        if (e instanceof BinaryError) throw new ApiError(400, "invalid_binary", `app.prev: ${e.message}`);
        throw e;
      }
      const bin = { sha256: await sha256File(p.prev), sizeBytes: statSync(p.prev).size };
      const st = newState(runtime);
      const steps = [
        swapBackStep(s, st),
        appsRuntimeStep(deps, s, st),
        restartStep(deps, s, st),
        healthStep(deps, s, healthTimeoutMs),
      ];
      const jobId = runJob(actorId, s, "rollback", st, steps, bin);
      recordAudit(db, { actorId, action: "site.rollback", target: name, meta: { jobId, sha256: bin.sha256, runtime } });
      log.info(`[deploy] rollback ${name} to ${bin.sha256.slice(0, 12)} by ${actorId}, job ${jobId}`);
      return { jobId };
    },

    list(name: string, paging: Paging): Page<Deploy> {
      const s = siteRow(name);
      const rows = db
        .select({ d: deploy, actorName: user.name })
        .from(deploy)
        .leftJoin(user, eq(user.id, deploy.actorId))
        .where(eq(deploy.siteName, s.name))
        .orderBy(desc(deploy.at))
        .limit(paging.pageSize)
        .offset(paging.offset)
        .all();
      const total = db.select({ n: count() }).from(deploy).where(eq(deploy.siteName, s.name)).get()?.n ?? 0;
      const items = rows.map(({ d, actorName }) => ({
        id: d.id,
        at: d.at.toISOString(),
        actor: d.actorId ? { id: d.actorId, name: actorName ?? "" } : null,
        sha256: d.sha256,
        sizeBytes: d.sizeBytes,
        runtime: d.runtime,
        status: d.status,
        jobId: d.jobId,
        kind: d.kind,
      }));
      return { items, total, page: paging.page, pageSize: paging.pageSize };
    },
  };
}

/** The deploy service instance type. */
export type DeployService = ReturnType<typeof createDeployService>;
