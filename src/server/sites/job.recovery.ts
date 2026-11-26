// POST /jobs/:id/recover (B26): one door. `cleanup` puts an interrupted/failed job's leftovers back (idempotent steps
// built from the real files after inspecting them), `retry` re-runs site.delete / hostname.remove from the journal.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Job } from "../../shared/site.types";
import { recordAudit } from "../audit.service";
import { dnsRecord, job, site, siteHostname } from "../db/schema";
import { cleanupSteps } from "../deploy/deploy.recovery";
import { log } from "../log.service";
import { ingressHostnames, removeIngressRule } from "./ingress.editor";
import type { JobRunner, JobSpec, StepDef, StepOutcome } from "./job.runner";
import { dbNameFor, sitePaths } from "./site.checks";
import { deleteSiteJob } from "./site.delete.job";
import { ENV_PREV, envRestoreStep } from "./site.env.service";
import { readTextOrNull } from "./site.files";
import { type JobCtx, removeHostnameJob, type SiteRow } from "./site.jobs";
import { appsRemoveStep, dnsDeleteStep, ingressStep, restartSteps, tunnelRestartStep, tunnelState } from "./site.steps";

/** Folder entries a cut-off create may leave that are safe to delete (anything else = someone's files). */
const CREATE_LEFTOVERS = new Set(["data", ".env"]);

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const inspect = (count: number): StepDef => ({
  key: "inspect",
  run: async () => (count ? { code: "inspect_found", params: { count } } : { code: "inspect_nothing" }),
});
const siteRow = (ctx: JobCtx, name: string): SiteRow | undefined =>
  ctx.db.select().from(site).where(eq(site.name, name)).get();

/** Removes ingress rules + panel-owned DNS records of `hostnames` that no site uses (create / hostname.add). */
function routeRepair(ctx: JobCtx, actorId: string, hostnames: string[]): StepDef[] {
  const used = new Set(
    ctx.db
      .select({ h: siteHostname.hostname })
      .from(siteHostname)
      .all()
      .map((r) => r.h),
  );
  const cfg = readTextOrNull(ctx.system.cloudflared.configPath);
  const routed = new Set(cfg === null ? [] : ingressHostnames(cfg));
  const stray = hostnames.filter((h) => !used.has(h) && routed.has(h));
  const owned = hostnames.filter(
    (h) => !used.has(h) && ctx.db.select().from(dnsRecord).where(eq(dnsRecord.hostname, h)).get(),
  );
  const tunnel = tunnelState();
  return [
    ingressStep(ctx, tunnel, stray, true, (t) => stray.reduce(removeIngressRule, t)),
    tunnelRestartStep(ctx, tunnel),
    dnsDeleteStep(ctx.dns, owned, actorId),
  ];
}

/** Cleanup of a cut-off site.create: everything the job may have made, unless a site now owns it (§4.11). */
function createRepair(ctx: JobCtx, actorId: string, orig: Job, input: Record<string, unknown>): StepDef[] {
  const name = String(input.name ?? orig.target);
  if (siteRow(ctx, name)) return [inspect(0)];
  const dir = join(sitePaths(ctx).sitesDir, name);
  const dbStep = orig.steps.find((s) => s.key === "database");
  const dbName = dbNameFor(name);
  const dropDb =
    input.database === true &&
    (dbStep?.status === "running" || dbStep?.status === "done" || dbStep?.status === "failed") &&
    !ctx.db.select().from(site).where(eq(site.database, dbName)).get();
  const steps: StepDef[] = [
    ...routeRepair(ctx, actorId, strs(input.hostnames)),
    appsRemoveStep(ctx, name, true),
    {
      key: "database_drop",
      async run(): Promise<StepOutcome> {
        if (!dropDb) return { code: "database_none", skipped: true };
        await ctx.system.postgres.dropRoleAndDatabase(dbName);
        return { code: "database_dropped", params: { name: dbName } };
      },
    },
    {
      key: "folder_remove",
      async run(): Promise<StepOutcome> {
        if (!existsSync(dir)) return { code: "folder_gone", skipped: true };
        const entries = readdirSync(dir);
        const dataEmpty = !existsSync(join(dir, "data")) || readdirSync(join(dir, "data")).length === 0;
        if (!dataEmpty || entries.some((e) => !CREATE_LEFTOVERS.has(e)))
          return { code: "folder_not_empty", params: { path: dir, entries: entries.length } };
        rmSync(dir, { recursive: true, force: true });
        return { code: "folder_removed", params: { path: dir } };
      },
    },
  ];
  return [inspect(steps.length), ...steps];
}

/** Step list of a cleanup of `orig` (journal `input` read from the row; the API view does not carry it). */
function cleanupFor(ctx: JobCtx, actorId: string, orig: Job, input: Record<string, unknown>): StepDef[] {
  const s = siteRow(ctx, orig.target);
  switch (orig.kind) {
    case "site.deploy":
    case "site.rollback":
      return cleanupSteps(ctx, { kind: orig.kind, target: orig.target, input }).steps;
    case "site.create":
      return createRepair(ctx, actorId, orig, input);
    case "hostname.add": {
      const steps = routeRepair(ctx, actorId, strs(input.hostnames));
      return [inspect(steps.length), ...steps];
    }
    case "site.env":
      if (!s || !existsSync(join(s.dir, ENV_PREV))) return [inspect(0)];
      return [inspect(1), envRestoreStep(s), ...restartSteps(ctx, s)];
    case "site.restart":
      return s ? [inspect(1), ...restartSteps(ctx, s)] : [inspect(0)];
    default:
      return [inspect(0)];
  }
}

/** Re-run of site.delete / hostname.remove from the journal; target gone → a cleanup that finds nothing. */
function retryFor(ctx: JobCtx, actorId: string, orig: Job, input: Record<string, unknown>): JobSpec | null {
  const s = siteRow(ctx, orig.target);
  if (!s) return null;
  const hosts = ctx.db.select().from(siteHostname).where(eq(siteHostname.siteName, s.name)).all();
  if (orig.kind === "site.delete")
    return deleteSiteJob(ctx, actorId, s, hosts, {
      data: input.keepData === true,
      database: input.keepDatabase === true,
    });
  const h = hosts.find((x) => x.hostname === input.hostname);
  return h ? removeHostnameJob(ctx, actorId, s, h) : null;
}

/** Starts the recovery of job `id` and returns the new job id (409 not_recoverable/already_resolved/busy). */
export function recoverJob(ctx: JobCtx, jobs: JobRunner, actorId: string, id: string): { jobId: string } {
  jobs.assertIdle();
  const { job: asked, mode } = jobs.recoverable(id);
  // A cut-off cleanup is redone as a new cleanup of the original job; both get resolved by it.
  const orig = asked.kind === "job.cleanup" && asked.cleans ? jobs.get(asked.cleans) : asked;
  const resolves = [...new Set([orig.id, asked.id])];
  const input = ctx.db.select({ input: job.input }).from(job).where(eq(job.id, orig.id)).get()?.input ?? {};
  const retry = mode === "retry" && asked.kind !== "job.cleanup" ? retryFor(ctx, actorId, orig, input) : null;
  const spec: JobSpec = retry
    ? { ...retry, resolves }
    : {
        kind: "job.cleanup",
        target: orig.target,
        actorId,
        input: { jobId: orig.id },
        steps: mode === "retry" ? [inspect(0)] : cleanupFor(ctx, actorId, orig, input),
        resolves,
      };
  const jobId = jobs.start(spec);
  recordAudit(ctx.db, { actorId, action: "job.recover", target: orig.target, meta: { jobId, of: asked.id, mode } });
  log.info(`[sites] recover ${asked.id} (${asked.kind}, ${mode}) by ${actorId}: job ${jobId}`);
  return { jobId };
}
