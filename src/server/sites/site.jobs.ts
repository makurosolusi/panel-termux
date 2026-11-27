// Coded step lists of the site jobs (PLAN/03 §3.4). Each step is undoable, or irreversible and placed last.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { SiteDnsProvider } from "../cloudflare/dns.provider";
import { site, siteHostname } from "../db/schema";
import { log } from "../log.service";
import { envText } from "./env.file";
import { insertIngressRule, removeIngressRule } from "./ingress.editor";
import { type JobSpec, type StepDef, StepError } from "./job.runner";
import { checkSite, dbNameFor, type SiteCtx, sitePaths, tunnelIdOf } from "./site.checks";
import { writeAtomic } from "./site.files";
import {
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
export type JobCtx = SiteCtx & {
  dns: SiteDnsProvider;
  /** A backup run or restore is in progress: dropping a site database then is refused (`busy_backup`). */
  backupBusy?: () => boolean;
  /** Called after a site delete is committed (e.g. to drop its pending uploads). */
  onSiteDeleted?: (name: string) => void;
};
/** A `site` row. */
export type SiteRow = typeof site.$inferSelect;
/** A `site_hostname` row. */
export type HostRow = typeof siteHostname.$inferSelect;

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
    dnsEnsureStep(ctx.dns, hostnames, tunnelIdOf(ctx), owned, actorId, ctx.system.cloudflared),
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
      dnsEnsureStep(ctx.dns, hostnames, tunnelIdOf(ctx), owned, actorId, ctx.system.cloudflared),
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
