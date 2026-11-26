// Coded step lists of the site jobs (PLAN/03 §3.4). Each step is undoable, or irreversible and placed last.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { SiteDnsProvider } from "../cloudflare/dns.provider";
import { site, siteHostname } from "../db/schema";
import { appName } from "../deploy/deploy.steps";
import { log } from "../log.service";
import { Pm2UnavailableError } from "../system/system.types";
import { envText } from "./env.file";
import { insertIngressRule, removeIngressRule } from "./ingress.editor";
import { type JobSpec, type StepDef, StepError } from "./job.runner";
import { checkSite, dbNameFor, type SiteCtx, sitePaths, tunnelIdOf } from "./site.checks";
import { writeAtomic } from "./site.files";
import {
  appsRemoveStep,
  dnsDeleteStep,
  dnsEnsureStep,
  domainProbeStep,
  ingressStep,
  reapplyTunnel,
  restartSteps,
  tunnelRestartStep,
  tunnelState,
} from "./site.steps";

/** Deps of the job builders: site context plus the shared DNS provider. */
export type JobCtx = SiteCtx & { dns: SiteDnsProvider };
/** A `site` row. */
export type SiteRow = typeof site.$inferSelect;
type HostRow = typeof siteHostname.$inferSelect;

const DIR_MODE = 0o700;
const ENV_MODE = 0o600;
const PG_HOST = "127.0.0.1";
const PG_PORT = 5432;
const PASSWORD_BYTES = 24;

/** Ingress service URL of a local port. */
export const serviceOf = (port: number) => `http://localhost:${port}`;
const issueCodes = (issues: { code: string }[]) => issues.map((i) => i.code).join(",");

/** Input of the create job (request-validated; port resolved). `env` never reaches the journal. */
export type CreateInput = {
  name: string;
  hostnames: string[];
  port: number;
  database: boolean;
  env: Record<string, string>;
};

/** site.create: validate → folder → database → env_write → ingress → dns → tunnel_restart → domain_probe. */
export function createSiteJob(ctx: JobCtx, actorId: string, input: CreateInput): JobSpec {
  const { name, hostnames, port } = input;
  const dir = join(sitePaths(ctx).sitesDir, name);
  const dbName = dbNameFor(name);
  const password = randomBytes(PASSWORD_BYTES).toString("hex");
  const tunnel = tunnelState();
  const owned = new Set<string>();
  const steps: StepDef[] = [
    {
      key: "validate",
      async run() {
        const { issues } = await checkSite(ctx, { name, hostnames, port, database: input.database });
        if (issues.length) throw new StepError("invalid_site", { issues: issueCodes(issues) });
        return { code: "validated" };
      },
    },
    {
      key: "folder",
      async run() {
        try {
          mkdirSync(join(dir, "data"), { recursive: true, mode: DIR_MODE });
          chmodSync(dir, DIR_MODE);
          chmodSync(join(dir, "data"), DIR_MODE);
        } catch (e) {
          throw new StepError("folder_failed", { path: dir }, (e as Error).message);
        }
        return { code: "folder_created", params: { path: dir } };
      },
      async undo() {
        rmSync(dir, { recursive: true, force: true });
      },
    },
    {
      key: "database",
      async run() {
        if (!input.database) return { code: "database_skipped", skipped: true };
        try {
          await ctx.system.postgres.createRoleAndDatabase(dbName, password);
        } catch (e) {
          // The role may exist without the database (CREATE DATABASE failed); both were checked absent before.
          await ctx.system.postgres.dropRoleAndDatabase(dbName).catch((d: unknown) => {
            log.error(`[sites] cleanup of half-created database ${dbName} failed: ${(d as Error).message}`);
          });
          throw new StepError("database_failed", { name: dbName }, (e as Error).message);
        }
        return { code: "database_created", params: { name: dbName } };
      },
      async undo() {
        if (input.database) await ctx.system.postgres.dropRoleAndDatabase(dbName);
      },
    },
    {
      key: "env_write",
      async run() {
        const vars: [string, string][] = [...Object.entries(input.env), ["PORT", String(port)]];
        if (input.database) {
          vars.push(["DATABASE_URL", `postgresql://${dbName}:${password}@${PG_HOST}:${PG_PORT}/${dbName}`]);
        }
        try {
          writeAtomic(join(dir, ".env"), envText(vars), { mode: ENV_MODE });
        } catch (e) {
          throw new StepError("env_failed", {}, (e as Error).message);
        }
        return { code: "env_written", params: { count: vars.length } };
      },
      async undo() {
        rmSync(join(dir, ".env"), { force: true });
      },
    },
    ingressStep(ctx, tunnel, hostnames, false, (t) =>
      hostnames.reduce((acc, h) => insertIngressRule(acc, h, serviceOf(port)), t),
    ),
    dnsEnsureStep(ctx.dns, hostnames, tunnelIdOf(ctx), owned, actorId),
    tunnelRestartStep(ctx, tunnel),
    domainProbeStep(ctx, hostnames),
  ];
  return {
    kind: "site.create",
    target: name,
    actorId,
    steps,
    input: { name, hostnames, port, database: input.database },
    onSuccess() {
      ctx.db.transaction((tx) => {
        tx.insert(site)
          .values({
            name,
            port,
            app: name,
            database: input.database ? dbName : null,
            runtime: "native",
            managed: true,
            dir,
          })
          .run();
        for (const hostname of hostnames)
          tx.insert(siteHostname)
            .values({ hostname, siteName: name, ingressManaged: true, dnsManaged: owned.has(hostname) })
            .run();
      });
    },
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}

/** Irreversible step that only acts on managed sites (adopted: `<prefix>_adopted_skip`). */
const managedOnly = (key: StepDef["key"], s: SiteRow, prefix: string, run: StepDef["run"]): StepDef => ({
  key,
  irreversible: true,
  run: async (c) => (s.managed ? run(c) : { code: `${prefix}_adopted_skip`, skipped: true }),
});

/** Keep flags of a site delete. */
export type DeleteKeep = { data: boolean; database: boolean };

/**
 * site.delete: validate → apps_remove (first, D5) → ingress → tunnel_restart → dns (non-fatal) → app_remove! →
 * database_drop! → folder_remove!. Adopted sites: only panel-added ingress rules / DNS records, then the DB row.
 */
export function deleteSiteJob(ctx: JobCtx, actorId: string, s: SiteRow, hosts: HostRow[], keep: DeleteKeep): JobSpec {
  const tunnel = tunnelState();
  const ingressHosts = hosts.filter((h) => s.managed || h.ingressManaged).map((h) => h.hostname);
  const steps: StepDef[] = [
    {
      key: "validate",
      async run() {
        if (!ctx.db.select().from(site).where(eq(site.name, s.name)).get())
          throw new StepError("invalid_site", { issues: "gone" });
        return { code: "validated" };
      },
    },
    appsRemoveStep(ctx, s.name, s.managed),
    ingressStep(ctx, tunnel, ingressHosts, true, (t) => ingressHosts.reduce(removeIngressRule, t)),
    tunnelRestartStep(ctx, tunnel),
    dnsDeleteStep(
      ctx.dns,
      hosts.filter((h) => h.dnsManaged).map((h) => h.hostname),
      actorId,
    ),
    managedOnly("app_remove", s, "app", async () => {
      try {
        const removed = await ctx.system.pm2.remove(appName(s));
        return removed
          ? { code: "app_removed", params: { name: appName(s) } }
          : { code: "app_not_deployed", skipped: true };
      } catch (e) {
        if (e instanceof Pm2UnavailableError) throw new StepError("pm2_not_running", { reason: e.reason });
        throw new StepError("pm2_failed", {}, (e as Error).message);
      }
    }),
    managedOnly("database_drop", s, "database", async () => {
      if (!s.database) return { code: "database_none", skipped: true };
      if (keep.database) return { code: "database_kept", skipped: true };
      try {
        await ctx.system.postgres.dropRoleAndDatabase(s.database);
      } catch (e) {
        throw new StepError("database_failed", { name: s.database }, (e as Error).message);
      }
      return { code: "database_dropped", params: { name: s.database } };
    }),
    managedOnly("folder_remove", s, "folder", async () => {
      if (keep.data) return { code: "folder_kept", skipped: true };
      if (!existsSync(s.dir)) return { code: "folder_gone", skipped: true };
      try {
        rmSync(s.dir, { recursive: true, force: true });
      } catch (e) {
        throw new StepError("folder_failed", { path: s.dir }, (e as Error).message);
      }
      return { code: "folder_removed", params: { path: s.dir } };
    }),
  ];
  return {
    kind: "site.delete",
    target: s.name,
    actorId,
    steps,
    input: { name: s.name, keepData: keep.data, keepDatabase: keep.database },
    onSuccess: () => ctx.db.delete(site).where(eq(site.name, s.name)).run(),
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}

/** hostname.add (1–5 domains, one cloudflared restart): validate → ingress → dns → tunnel_restart → domain_probe. */
export function addHostnamesJob(ctx: JobCtx, actorId: string, s: SiteRow, hostnames: string[]): JobSpec {
  const tunnel = tunnelState();
  const owned = new Set<string>();
  return {
    kind: "hostname.add",
    target: s.name,
    actorId,
    input: { site: s.name, hostnames },
    steps: [
      {
        key: "validate",
        async run() {
          const { issues } = await checkSite(ctx, { hostnames, scope: "hostname" });
          if (issues.length) throw new StepError("invalid_site", { issues: issueCodes(issues) });
          return { code: "validated" };
        },
      },
      ingressStep(ctx, tunnel, hostnames, false, (t) =>
        hostnames.reduce((acc, h) => insertIngressRule(acc, h, serviceOf(s.port)), t),
      ),
      dnsEnsureStep(ctx.dns, hostnames, tunnelIdOf(ctx), owned, actorId),
      tunnelRestartStep(ctx, tunnel),
      domainProbeStep(ctx, hostnames),
    ],
    onSuccess: () =>
      ctx.db.transaction((tx) => {
        for (const hostname of hostnames)
          tx.insert(siteHostname)
            .values({ hostname, siteName: s.name, ingressManaged: true, dnsManaged: owned.has(hostname) })
            .run();
      }),
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}

/** hostname.remove: ingress → tunnel_restart → dns (non-fatal, no second restart). Caller checks the rule is ours. */
export function removeHostnameJob(ctx: JobCtx, actorId: string, s: SiteRow, h: HostRow): JobSpec {
  const tunnel = tunnelState();
  return {
    kind: "hostname.remove",
    target: s.name,
    actorId,
    input: { site: s.name, hostname: h.hostname },
    steps: [
      ingressStep(ctx, tunnel, [h.hostname], true, (t) => removeIngressRule(t, h.hostname)),
      tunnelRestartStep(ctx, tunnel),
      dnsDeleteStep(ctx.dns, h.dnsManaged ? [h.hostname] : [], actorId),
    ],
    onSuccess: () => ctx.db.delete(siteHostname).where(eq(siteHostname.hostname, h.hostname)).run(),
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}

/** site.restart: app_restart → health. */
export const restartSiteJob = (ctx: SiteCtx, actorId: string, s: SiteRow): JobSpec => ({
  kind: "site.restart",
  target: s.name,
  actorId,
  input: { site: s.name },
  steps: restartSteps(ctx, s),
});
