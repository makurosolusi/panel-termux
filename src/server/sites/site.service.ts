import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type {
  DiscoveredIngress,
  Integration,
  Site,
  SiteCheckResult,
  SiteDetail,
  SiteRuntime,
} from "../../shared/site.types";
import { recordAudit } from "../audit.service";
import type { DnsProvider } from "../cloudflare/dns.types";
import { site, siteHostname } from "../db/schema";
import { log } from "../log.service";
import { RESOURCE_NAME_RE } from "../panel/panel.service";
import { ApiError } from "../routes/http.error";
import { describeSetting } from "../settings.service";
import type { SystemAdapters } from "../system/system.types";
import { assertEnvEntries, ENV_KEY_RE, EnvInputError, envKeys, updateEnv } from "./env.file";
import { readTunnelId } from "./ingress.editor";
import { createJobRunner } from "./job.runner";
import { checkSite, HOSTNAME_RE, SITE_NAME_RE, type SiteCtx, sitePaths, suggestPort } from "./site.checks";
import { readTextOrNull, writeAtomic } from "./site.files";
import { addHostnameJob, createSiteJob, deleteSiteJob, removeHostnameJob } from "./site.jobs";

/** Deps of the site service. One DnsProvider instance is shared with the /dev cloudflare routes. */
export type SiteDeps = { db: SiteCtx["db"]; secret: string; system: SystemAdapters; dns: DnsProvider };

/** Keys the panel writes into a new site's .env itself. */
const RESERVED_ENV = ["PORT", "DATABASE_URL"];
const ENV_MODE = 0o600;
const MAX_PORT = 65535;

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const bad = (code: string, message: string) => new ApiError(400, code, message);
const normHost = (h: unknown) => (typeof h === "string" ? h.trim().toLowerCase() : h);

function envInput(v: unknown, field: string): Record<string, string> {
  if (v === undefined) return {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw bad("invalid_env", `${field} must be an object`);
  try {
    assertEnvEntries(v as Record<string, unknown>);
  } catch (e) {
    if (e instanceof EnvInputError) throw bad("invalid_env", e.message);
    throw e;
  }
  return v as Record<string, string>;
}

/** Site management behind /api/panel/sites, /jobs and /integration. */
export function createSiteService(deps: SiteDeps) {
  const ctx = deps;
  const { db, system } = deps;
  const jobs = createJobRunner(db);

  const siteRow = (name: string) => {
    if (!SITE_NAME_RE.test(name)) throw bad("invalid_name", `invalid site name ${JSON.stringify(name)}`);
    const s = db.select().from(site).where(eq(site.name, name)).get();
    if (!s) throw new ApiError(404, "not_found", `unknown site ${name}`);
    return s;
  };
  const hostsOf = (name: string) => db.select().from(siteHostname).where(eq(siteHostname.siteName, name)).all();

  async function toSites(rows: (typeof site.$inferSelect)[]): Promise<Site[]> {
    const hosts = db.select().from(siteHostname).all();
    const apps = await system.pm2.list().catch((e: unknown) => {
      log.warn(`[sites] pm2 list unavailable: ${(e as Error).message}`);
      return [];
    });
    return rows.map((s) => ({
      name: s.name,
      port: s.port,
      hostnames: hosts.filter((h) => h.siteName === s.name).map((h) => h.hostname),
      database: s.database,
      runtime: s.runtime,
      managed: s.managed,
      appStatus: apps.find((a) => a.name === s.app)?.status ?? "not_deployed",
      createdAt: s.createdAt.toISOString(),
    }));
  }

  return {
    jobs,

    list: async () => toSites(db.select().from(site).orderBy(site.name).all()),

    async detail(name: string): Promise<SiteDetail> {
      const s = siteRow(name);
      const [base] = await toSites([s]);
      return {
        ...(base as Site),
        dir: s.dir,
        envKeys: envKeys(readTextOrNull(join(s.dir, ".env")) ?? ""),
        dns: hostsOf(name).map((h) => ({ hostname: h.hostname, managed: h.dnsManaged })),
      };
    },

    async discovered(): Promise<DiscoveredIngress[]> {
      const [ingress, apps] = await Promise.all([system.cloudflared.listIngress(), system.pm2.list()]);
      const known = new Set(
        db
          .select({ h: siteHostname.hostname })
          .from(siteHostname)
          .all()
          .map((r) => r.h),
      );
      return ingress
        .filter((r) => !known.has(r.hostname))
        .map((r) => ({
          hostname: r.hostname,
          port: r.port,
          app: r.port === null ? null : (apps.find((a) => a.port === r.port)?.name ?? null),
        }));
    },

    async suggestPort(): Promise<{ port: number }> {
      const port = await suggestPort(ctx);
      if (port === null) throw new ApiError(409, "no_free_port", "no free port left in sites.port_range");
      return { port };
    },

    async check(body: unknown): Promise<SiteCheckResult> {
      const b = obj(body);
      const issues = await checkSite(ctx, { name: b.name, hostname: normHost(b.hostname), port: b.port });
      return { ok: issues.length === 0, issues };
    },

    async create(actorId: string, body: unknown): Promise<{ jobId: string }> {
      jobs.assertIdle();
      const b = obj(body);
      if (typeof b.database !== "boolean") throw bad("invalid_database", "database must be a boolean");
      const env = envInput(b.env, "env");
      const reserved = Object.keys(env).filter((k) => RESERVED_ENV.includes(k));
      if (reserved.length) throw bad("invalid_env", `${reserved.join(", ")} are set by the panel`);
      const hostname = normHost(b.hostname);
      const issues = await checkSite(ctx, { name: b.name, hostname, port: b.port, database: b.database });
      if (issues.length) throw bad("invalid_site", issues.map((i) => `${i.field}: ${i.message}`).join("; "));
      const port = b.port === undefined ? (await this.suggestPort()).port : (b.port as number);
      const name = b.name as string;
      const input = { name, hostname: hostname as string, port, database: b.database, env };
      const jobId = jobs.start(createSiteJob(ctx, actorId, input));
      recordAudit(db, {
        actorId,
        action: "site.create",
        target: name,
        meta: { jobId, hostname, port, database: b.database, envKeys: Object.keys(env) },
      });
      log.info(`[sites] create ${name} (${hostname}:${port}) by ${actorId}, job ${jobId}`);
      return { jobId };
    },

    async adopt(actorId: string, body: unknown): Promise<Site> {
      jobs.assertIdle();
      const b = obj(body);
      const { name, port, app } = b;
      const hostname = normHost(b.hostname);
      const runtime = (b.runtime ?? "grun") as SiteRuntime;
      if (typeof name !== "string" || !SITE_NAME_RE.test(name)) throw bad("invalid_name", "invalid site name");
      if (db.select().from(site).where(eq(site.name, name)).get())
        throw new ApiError(409, "exists", `site ${name} exists`);
      if (typeof hostname !== "string" || !HOSTNAME_RE.test(hostname))
        throw bad("invalid_hostname", "invalid hostname");
      if (db.select().from(siteHostname).where(eq(siteHostname.hostname, hostname)).get()) {
        throw new ApiError(409, "exists", `${hostname} already belongs to a site`);
      }
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > MAX_PORT) {
        throw bad("invalid_port", "port must be an integer 1-65535");
      }
      if (db.select().from(site).where(eq(site.port, port)).get())
        throw new ApiError(409, "exists", `port ${port} belongs to a site`);
      if (app !== undefined && (typeof app !== "string" || !RESOURCE_NAME_RE.test(app)))
        throw bad("invalid_app", "invalid pm2 app name");
      if (runtime !== "native" && runtime !== "grun")
        throw bad("invalid_runtime", 'runtime must be "native" or "grun"');
      const dir = join(sitePaths(ctx).sitesDir, name);
      db.transaction((tx) => {
        tx.insert(site)
          .values({
            name,
            port,
            app: (app as string | undefined) ?? null,
            database: null,
            runtime,
            managed: false,
            dir,
          })
          .run();
        tx.insert(siteHostname).values({ hostname, siteName: name, ingressManaged: false, dnsManaged: false }).run();
      });
      recordAudit(db, { actorId, action: "site.adopt", target: name, meta: { hostname, port, app: app ?? null } });
      log.info(`[sites] adopted ${name} by ${actorId}`);
      return (await toSites([siteRow(name)]))[0] as Site;
    },

    async updateEnv(actorId: string, name: string, body: unknown): Promise<{ envKeys: string[] }> {
      const s = siteRow(name);
      const b = obj(body);
      const set = envInput(b.set ?? {}, "set");
      const unset = b.unset ?? [];
      if (!Array.isArray(unset) || !unset.every((k) => typeof k === "string" && ENV_KEY_RE.test(k))) {
        throw bad("invalid_env", "unset must be an array of env keys");
      }
      if (!existsSync(s.dir)) throw new ApiError(409, "no_folder", `site folder ${s.dir} does not exist`);
      const path = join(s.dir, ".env");
      const next = updateEnv(readTextOrNull(path) ?? "", set, unset);
      writeAtomic(path, next, { mode: ENV_MODE });
      // Keys only: values never reach audit or logs.
      recordAudit(db, { actorId, action: "site.env_update", target: name, meta: { set: Object.keys(set), unset } });
      const restarted = s.app ? await system.pm2.control(s.app, "restart") : null;
      log.info(`[sites] env of ${name} updated by ${actorId}${restarted ? ", app restarted" : ""}`);
      return { envKeys: envKeys(next) };
    },

    addHostname(actorId: string, name: string, body: unknown): { jobId: string } {
      jobs.assertIdle();
      const s = siteRow(name);
      const hostname = normHost(obj(body).hostname);
      if (typeof hostname !== "string" || !HOSTNAME_RE.test(hostname))
        throw bad("invalid_hostname", "invalid hostname");
      const jobId = jobs.start(addHostnameJob(ctx, actorId, s, hostname));
      recordAudit(db, { actorId, action: "hostname.add", target: name, meta: { jobId, hostname } });
      return { jobId };
    },

    removeHostname(actorId: string, name: string, hostname: string): { jobId: string } {
      jobs.assertIdle();
      const s = siteRow(name);
      const hosts = hostsOf(name);
      const h = hosts.find((x) => x.hostname === hostname.toLowerCase());
      if (!h) throw new ApiError(404, "not_found", `${hostname} is not a hostname of ${name}`);
      if (hosts.length === 1) throw bad("last_hostname", "a site needs at least one hostname; delete the site instead");
      if (!s.managed && !h.ingressManaged) {
        throw new ApiError(409, "hand_written", `${hostname} is a hand-written ingress rule of an adopted site`);
      }
      const jobId = jobs.start(removeHostnameJob(ctx, actorId, s, h));
      recordAudit(db, { actorId, action: "hostname.remove", target: name, meta: { jobId, hostname: h.hostname } });
      return { jobId };
    },

    remove(actorId: string, name: string, keep: { data: boolean; database: boolean }): { jobId: string } {
      jobs.assertIdle();
      const s = siteRow(name);
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

    integration(): Integration {
      const p = sitePaths(ctx);
      const eco = readTextOrNull(p.ecosystem);
      const cfg = readTextOrNull(p.cfConfig);
      const issues: string[] = [];
      let tunnelId: string | null = null;
      let cfgError: string | null = null;
      try {
        tunnelId = cfg === null ? null : readTunnelId(cfg);
      } catch (e) {
        cfgError = `${p.cfConfig}: ${(e as Error).message}`;
      }
      const ecosystemIncludesAppsJson = eco !== null && /apps\.json/.test(eco);
      const appsJsonExists = existsSync(p.appsJson);
      const cloudflareTokenSet = describeSetting(db, "cloudflare.api_token").isSet;
      if (eco === null) issues.push(`${p.ecosystem} not found`);
      else if (!ecosystemIncludesAppsJson)
        issues.push(`${p.ecosystem} does not spread apps.json into apps (add ...require('./apps.json'))`);
      if (!appsJsonExists) issues.push(`${p.appsJson} does not exist yet (created with the first site)`);
      if (cfg === null) issues.push(`${p.cfConfig} not found`);
      else if (cfgError) issues.push(cfgError);
      else if (!tunnelId) issues.push(`${p.cfConfig}: no tunnel UUID in tunnel: or the credentials-file name`);
      if (!cloudflareTokenSet) issues.push("Cloudflare API token not set (/dev settings): DNS records will be skipped");
      return { ecosystemIncludesAppsJson, appsJsonExists, tunnelId, cloudflareTokenSet, issues };
    },
  };
}

/** The site service instance type. */
export type SiteService = ReturnType<typeof createSiteService>;
