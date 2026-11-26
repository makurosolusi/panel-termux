// Site management behind /api/panel/sites, /jobs and /integration (PLAN/03 §3.5).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { HealthProbe, Site, SiteCheckResult, SiteDetail } from "../../shared/site.types";
import { recordAudit } from "../audit.service";
import { site, siteHostname } from "../db/schema";
import { siteBinaries } from "../deploy/binary.identity";
import { appName } from "../deploy/deploy.steps";
import { scriptRuntimeOf } from "../deploy/run.script";
import { log } from "../log.service";
import { ApiError } from "../routes/http.error";
import { type Pm2Proc, Pm2UnavailableError } from "../system/system.types";
import { discover } from "./adopt.candidates";
import { ensureAppsJson } from "./apps.file";
import { envKeys } from "./env.file";
import { createIntegration } from "./integration.service";
import { recoverJob } from "./job.recovery";
import { createJobRunner, type JobRunnerDeps } from "./job.runner";
import { adoptSite } from "./site.adopt";
import {
  checkSite,
  HOSTNAME_RE,
  type PanelSelf,
  parseHealthSettings,
  SITE_NAME_RE,
  type SiteCtx,
  suggestPort,
} from "./site.checks";
import { deleteSiteJob } from "./site.delete.job";
import { envInput, lockedEnvKeys, restartPending, saveEnv } from "./site.env.service";
import { readTextOrNull } from "./site.files";
import { addHostnamesJob, createSiteJob, type JobCtx, removeHostnameJob, restartSiteJob } from "./site.jobs";
import { siteSecretsFor } from "./site.secrets";
import { probeHealth } from "./site.steps";
import { toSites, troubled } from "./site.view";

/**
 * Deps of the site service. `panel` defaults to APP_BASE_URL/PORT of the process env; `backupBusy`/`onSiteDeleted`
 * are the backup lock and the after-delete hook (see JobCtx).
 */
export type SiteDeps = Omit<SiteCtx, "panel"> & { panel?: PanelSelf } & Omit<JobCtx, keyof SiteCtx> & JobRunnerDeps;

const MAX_HOSTNAMES = 5;

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const bad = (code: string, message: string, extra?: Record<string, unknown>) => new ApiError(400, code, message, extra);
const lower = (h: unknown) => (typeof h === "string" ? h.trim().toLowerCase() : h);
const hostsIn = (b: Record<string, unknown>): unknown[] =>
  Array.isArray(b.hostnames)
    ? b.hostnames.map(lower)
    : [lower(b.hostname), ...(Array.isArray(b.extraHostnames) ? b.extraHostnames.map(lower) : [])];

/** Panel host/port from the process env (the boot wiring may pass them explicitly). */
function panelFromEnv(): PanelSelf {
  let hostname: string | null = null;
  try {
    hostname = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).hostname : null;
  } catch {
    hostname = null; // invalid URL: env.ts refuses to boot with it, so only tests get here
  }
  const port = Number(process.env.PORT);
  return { hostname, port: Number.isInteger(port) && port > 0 ? port : null };
}

/** Site management service; one job runner and one integration cache per instance. */
export function createSiteService(deps: SiteDeps) {
  const ctx = { ...deps, panel: deps.panel ?? panelFromEnv() };
  const { db, system } = ctx;
  const jobs = createJobRunner(db, { monitor: deps.monitor });
  const integ = createIntegration(ctx);

  const siteRow = (name: string) => {
    if (!SITE_NAME_RE.test(name)) throw bad("invalid_name", `invalid site name ${JSON.stringify(name)}`);
    const s = db.select().from(site).where(eq(site.name, name)).get();
    if (!s) throw new ApiError(404, "not_found", `unknown site ${name}`);
    return s;
  };
  const hostsOf = (name: string) => db.select().from(siteHostname).where(eq(siteHostname.siteName, name)).all();
  /** pm2 processes, or null when pm2 is not running (statuses then read "unknown"). */
  const procsOrNull = async (): Promise<Pm2Proc[] | null> =>
    system.pm2.procs().catch((e: unknown) => {
      if (!(e instanceof Pm2UnavailableError)) throw e;
      return null;
    });
  const assertPm2 = async () => {
    if ((await procsOrNull()) === null) throw new ApiError(409, "pm2_not_running", "pm2 is not running");
  };

  async function detail(name: string): Promise<SiteDetail> {
    const s = siteRow(name);
    const procs = await procsOrNull();
    const [base] = toSites(db, [s], procs) as [Site];
    const proc = procs?.find((p) => p.name === appName(s));
    const ready = s.managed && !existsSync(join(s.dir, "app")) ? (await integ.get()).ready : true;
    return {
      ...base,
      dir: s.dir,
      envKeys: envKeys(readTextOrNull(join(s.dir, ".env")) ?? ""),
      lockedEnvKeys: lockedEnvKeys(s),
      pm2EnvKeys: s.managed ? [] : await integ.envKeysOf(appName(s)),
      restartPending: restartPending(s, proc),
      dns: hostsOf(name).map((h) => ({ hostname: h.hostname, managed: h.dnsManaged })),
      health: { path: s.healthPath, expect: s.healthExpect, timeoutSec: s.healthTimeoutSec },
      binary: siteBinaries(db, s),
      scriptRuntime: proc ? scriptRuntimeOf(proc) : null,
      deployBlocker: !existsSync(s.dir)
        ? "no_folder"
        : procs === null
          ? "pm2_not_running"
          : ready
            ? null
            : "integration",
      activeJob: jobs.active(),
    };
  }

  return {
    jobs,
    detail,

    list: async () =>
      toSites(db, db.select().from(site).orderBy(site.name).all(), await procsOrNull()).sort(
        (a, b) => Number(troubled(b)) - Number(troubled(a)),
      ),

    /** Unclaimed ingress + pm2 apps; Pm2UnavailableError → 503 `pm2_unavailable` in the routes. */
    discovered: () => discover(ctx),

    async suggestPort(): Promise<{ port: number }> {
      const port = await suggestPort(ctx);
      if (port === null) throw new ApiError(409, "no_free_port", "no free port left in sites.port_range");
      return { port };
    },

    async check(body: unknown): Promise<SiteCheckResult> {
      const b = obj(body);
      const scope = b.scope === "hostname" ? "hostname" : "site";
      const r = await checkSite(ctx, {
        ...b,
        hostnames: hostsIn(b),
        scope,
        dns: deps.dns,
        database: b.database === true,
      });
      return { ok: r.issues.length === 0, ...r };
    },

    async create(actorId: string, body: unknown): Promise<{ jobId: string }> {
      jobs.assertIdle();
      const b = obj(body);
      if (typeof b.database !== "boolean") throw bad("invalid_database", "database must be a boolean");
      const env = envInput(b.env);
      const reserved = Object.keys(env).find((k) => k === "PORT" || k === "DATABASE_URL");
      if (reserved) throw bad("invalid_env", `${reserved} is set by the panel`, { key: reserved, reason: "key" });
      const hostnames = hostsIn(b);
      if (hostnames.length > MAX_HOSTNAMES) throw bad("invalid_hostname", `at most ${MAX_HOSTNAMES} domains`);
      const { issues } = await checkSite(ctx, { name: b.name, hostnames, port: b.port, database: b.database });
      if (issues.length) throw bad("invalid_site", issues.map((i) => `${i.field}: ${i.code}`).join("; "), { issues });
      const port = b.port === undefined ? (await this.suggestPort()).port : (b.port as number);
      const name = b.name as string;
      const hs = hostnames as string[];
      const jobId = jobs.start(createSiteJob(ctx, actorId, { name, hostnames: hs, port, database: b.database, env }));
      recordAudit(db, {
        actorId,
        action: "site.create",
        target: name,
        meta: { jobId, hostnames: hs, port, database: b.database, envKeys: Object.keys(env) },
      });
      log.info(`[sites] create ${name} (${hs.join(", ")}:${port}) by ${actorId}, job ${jobId}`);
      return { jobId };
    },

    async adopt(actorId: string, body: unknown): Promise<SiteDetail> {
      jobs.assertIdle();
      return detail(await adoptSite(ctx, actorId, obj(body)));
    },

    saveEnv: (actorId: string, name: string, body: unknown) => saveEnv(ctx, jobs, actorId, siteRow(name), body),

    async updateSettings(actorId: string, name: string, body: unknown): Promise<SiteDetail> {
      const s = siteRow(name);
      const set = parseHealthSettings(obj(obj(body).health));
      jobs.assertIdle();
      if (Object.keys(set).length) db.update(site).set(set).where(eq(site.name, s.name)).run();
      recordAudit(db, { actorId, action: "site.settings_update", target: name, meta: { health: set } });
      return detail(name);
    },

    /** GET /sites/:name/health: one probe with the site's path/expect and Host = first domain. */
    health: (name: string): Promise<HealthProbe> => probeHealth(ctx, siteRow(name), hostsOf(name)[0]?.hostname),

    async restart(actorId: string, name: string): Promise<{ jobId: string }> {
      jobs.assertIdle();
      const s = siteRow(name);
      await assertPm2();
      const jobId = jobs.start(restartSiteJob(ctx, actorId, s));
      recordAudit(db, { actorId, action: "site.restart", target: name, meta: { jobId } });
      return { jobId };
    },

    addHostnames(actorId: string, name: string, body: unknown): { jobId: string } {
      jobs.assertIdle();
      const s = siteRow(name);
      const hostnames = hostsIn(obj(body));
      if (
        hostnames.length < 1 ||
        hostnames.length > MAX_HOSTNAMES ||
        !hostnames.every((h) => typeof h === "string" && HOSTNAME_RE.test(h))
      )
        throw bad("invalid_hostname", `1-${MAX_HOSTNAMES} valid hostnames are required`);
      const hs = [...new Set(hostnames as string[])];
      const jobId = jobs.start(addHostnamesJob(ctx, actorId, s, hs));
      recordAudit(db, { actorId, action: "hostname.add", target: name, meta: { jobId, hostnames: hs } });
      return { jobId };
    },

    removeHostname(actorId: string, name: string, hostname: string): { jobId: string } {
      jobs.assertIdle();
      const s = siteRow(name);
      const hosts = hostsOf(name);
      const h = hosts.find((x) => x.hostname === hostname.toLowerCase());
      if (!h) throw new ApiError(404, "not_found", `${hostname} is not a hostname of ${name}`);
      if (hosts.length === 1) throw bad("last_hostname", "a site needs at least one hostname; delete the site instead");
      if (!s.managed && !h.ingressManaged)
        throw new ApiError(409, "hand_written", `${hostname} is a hand-written ingress rule of an adopted site`);
      const jobId = jobs.start(removeHostnameJob(ctx, actorId, s, h));
      recordAudit(db, { actorId, action: "hostname.remove", target: name, meta: { jobId, hostname: h.hostname } });
      return { jobId };
    },

    /**
     * DELETE /sites/:name: a managed site needs `confirm=<name>` (typed confirmation, D24); dropping its database
     * while a backup runs is 409 `busy_backup`.
     */
    remove(actorId: string, name: string, keep: { data: boolean; database: boolean }, confirm?: string) {
      jobs.assertIdle();
      const s = siteRow(name);
      if (s.managed && confirm !== name) throw bad("confirm_mismatch", `confirm must be the site name ${name}`);
      if (s.managed && s.database && !keep.database && deps.backupBusy?.())
        throw new ApiError(409, "busy_backup", "a backup run or restore is in progress");
      const jobId = jobs.start(deleteSiteJob(ctx, actorId, s, hostsOf(name), keep));
      recordAudit(db, {
        actorId,
        action: "site.delete",
        target: name,
        meta: { jobId, keepData: keep.data, keepDatabase: keep.database },
      });
      log.info(`[sites] delete ${name} by ${actorId}, job ${jobId}`);
      return { jobId };
    },

    recover: (actorId: string, id: string) => recoverJob(ctx, jobs, actorId, id),

    getIntegration: () => integ.get(),
    verifyIntegration: () => {
      jobs.assertIdle();
      return integ.verify();
    },
    /** Sync status for /dev/setup (`ecosystemIncludesAppsJson`), from the last check. */
    integration: () => integ.snapshot(),
    /** Boot: writes apps.json `[]` when sites.dir exists and it does not (D3). */
    ensureAppsJson: () => ensureAppsJson(ctx),
    /** .env values of the site run by pm2 app `app` (log redaction, B22). */
    secretsFor: (app: string) => siteSecretsFor(db, app),
  };
}

/** The site service instance type. */
export type SiteService = ReturnType<typeof createSiteService>;
