// Step lists of the four site jobs. Each step is undoable (or irreversible and placed last).
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { DnsProvider } from "../cloudflare/dns.types";
import { site, siteHostname } from "../db/schema";
import { addApp, type Pm2AppEntry, removeApp } from "./apps.file";
import { envLine } from "./env.file";
import { insertIngressRule, readTunnelId, removeIngressRule } from "./ingress.editor";
import type { JobSpec, StepDef } from "./job.runner";
import { checkSite, dbNameFor, type SiteCtx, sitePaths } from "./site.checks";
import { readTextOrNull, restoreText, writeAtomic } from "./site.files";
import { dnsDeleteStep, dnsEnsureStep, ingressStep, reapplyTunnel, restartStep, type TunnelState } from "./site.steps";

/** Deps of the job builders: site context plus the shared DNS provider. */
export type JobCtx = SiteCtx & { dns: DnsProvider };
type SiteRow = typeof site.$inferSelect;
type HostRow = typeof siteHostname.$inferSelect;

const DIR_MODE = 0o700;
const ENV_MODE = 0o600;
const PG_HOST = "127.0.0.1";
const PG_PORT = 5432;
const PASSWORD_BYTES = 24;

const service = (port: number) => `http://localhost:${port}`;
const tunnelOf = (ctx: SiteCtx) => () => {
  const t = readTextOrNull(ctx.system.cloudflared.configPath);
  return t === null ? null : readTunnelId(t);
};

/** apps.json edit as a step; undo writes back the exact previous bytes (or removes a file it created). */
function appsStep(ctx: SiteCtx, label: string, mutate: (t: string | null) => string, note = () => ""): StepDef {
  const { appsJson } = sitePaths(ctx);
  let prev: string | null = null;
  return {
    key: "apps",
    label,
    async run() {
      prev = readTextOrNull(appsJson);
      writeAtomic(appsJson, mutate(prev), { backup: true });
      return `apps.json updated${note()}`;
    },
    async undo() {
      restoreText(appsJson, prev);
    },
  };
}

const ecosystemNote = (ctx: SiteCtx) => () =>
  /apps\.json/.test(readTextOrNull(sitePaths(ctx).ecosystem) ?? "")
    ? ""
    : "; WARNING: ecosystem.config.js does not include apps.json, pm2 will not load it";

/** Input of the create job (already request-validated; port resolved). */
export type CreateInput = {
  name: string;
  hostname: string;
  port: number;
  database: boolean;
  env: Record<string, string>;
};

/** site.create: validate → folder → database → .env → apps.json → ingress → DNS → restart cloudflared. */
export function createSiteJob(ctx: JobCtx, actorId: string, input: CreateInput): JobSpec {
  const { name, hostname, port } = input;
  const dir = join(sitePaths(ctx).sitesDir, name);
  const dbName = dbNameFor(name);
  const password = randomBytes(PASSWORD_BYTES).toString("hex");
  const tunnel: TunnelState = { ingressChanged: false, restarted: false };
  const dns = { managed: false };
  const entry: Pm2AppEntry = {
    name,
    cwd: dir,
    script: "./app",
    interpreter: "none",
    env: { PORT: String(port) },
  };
  const steps: StepDef[] = [
    {
      key: "validate",
      label: "Validate",
      async run() {
        const issues = await checkSite(ctx, { name, hostname, port, database: input.database });
        if (issues.length) throw new Error(issues.map((i) => i.message).join("; "));
      },
    },
    {
      key: "folder",
      label: "Create site folder",
      async run() {
        mkdirSync(join(dir, "data"), { recursive: true, mode: DIR_MODE });
        chmodSync(dir, DIR_MODE);
        chmodSync(join(dir, "data"), DIR_MODE);
        return dir;
      },
      async undo() {
        rmSync(dir, { recursive: true, force: true });
      },
    },
    {
      key: "database",
      label: "Create database",
      async run() {
        if (!input.database) return { skipped: "no database requested" };
        try {
          await ctx.system.postgres.createRoleAndDatabase(dbName, password);
        } catch (e) {
          // Role may exist without the database (CREATE DATABASE failed); both were checked absent before.
          await ctx.system.postgres.dropRoleAndDatabase(dbName).catch(() => undefined);
          throw e;
        }
        return `role and database ${dbName}`;
      },
      async undo() {
        if (input.database) await ctx.system.postgres.dropRoleAndDatabase(dbName);
      },
    },
    {
      key: "env",
      label: "Write .env",
      async run() {
        const vars: [string, string][] = [...Object.entries(input.env), ["PORT", String(port)]];
        if (input.database) {
          vars.push(["DATABASE_URL", `postgresql://${dbName}:${password}@${PG_HOST}:${PG_PORT}/${dbName}`]);
        }
        writeAtomic(join(dir, ".env"), `${vars.map(([k, v]) => envLine(k, v)).join("\n")}\n`, { mode: ENV_MODE });
        return `${vars.length} keys`;
      },
      async undo() {
        rmSync(join(dir, ".env"), { force: true });
      },
    },
    appsStep(ctx, "Register pm2 app", (t) => addApp(t, entry), ecosystemNote(ctx)),
    ingressStep(ctx, tunnel, "Add ingress rule", (t) => insertIngressRule(t, hostname, service(port))),
    dnsEnsureStep(ctx.dns, hostname, tunnelOf(ctx), dns),
    restartStep(ctx, tunnel),
  ];
  return {
    kind: "site.create",
    target: name,
    actorId,
    steps,
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
        tx.insert(siteHostname)
          .values({ hostname, siteName: name, ingressManaged: true, dnsManaged: dns.managed })
          .run();
      });
    },
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}

/**
 * site.delete. Managed: ingress → restart → DNS → apps.json → pm2 delete → db drop → folder (last three
 * irreversible). Adopted: only the ingress rules / DNS records the panel added, then the DB record.
 */
export function deleteSiteJob(
  ctx: JobCtx,
  actorId: string,
  s: SiteRow,
  hosts: HostRow[],
  keep: { data: boolean; database: boolean },
): JobSpec {
  const tunnel: TunnelState = { ingressChanged: false, restarted: false };
  const ingressHosts = hosts.filter((h) => s.managed || h.ingressManaged).map((h) => h.hostname);
  const skipUnlessManaged = (what: string) => ({ skipped: `adopted site: ${what} left untouched` });
  const steps: StepDef[] = [
    {
      key: "validate",
      label: "Validate",
      async run() {
        if (!ctx.db.select().from(site).where(eq(site.name, s.name)).get())
          throw new Error(`site ${s.name} no longer exists`);
      },
    },
    ingressStep(ctx, tunnel, "Remove ingress rules", (t) => ingressHosts.reduce(removeIngressRule, t)),
    restartStep(ctx, tunnel),
    dnsDeleteStep(
      ctx.dns,
      hosts.filter((h) => h.dnsManaged).map((h) => h.hostname),
      tunnelOf(ctx),
    ),
    s.managed
      ? appsStep(ctx, "Unregister pm2 app", (t) => removeApp(t, s.name))
      : { key: "apps", label: "Unregister pm2 app", run: async () => skipUnlessManaged("pm2 entry") },
    {
      key: "pm2",
      label: "Stop and remove pm2 process",
      irreversible: true,
      async run() {
        if (!s.managed) return skipUnlessManaged("pm2 process");
        return (await ctx.system.pm2.remove(s.name)) ? "pm2 process deleted" : { skipped: "not deployed" };
      },
    },
    {
      key: "database",
      label: "Drop database",
      irreversible: true,
      async run() {
        if (!s.managed) return skipUnlessManaged("database");
        if (!s.database) return { skipped: "site has no database" };
        if (keep.database) return { skipped: "kept (keepDatabase)" };
        await ctx.system.postgres.dropRoleAndDatabase(s.database);
        return `dropped ${s.database}`;
      },
    },
    {
      key: "folder",
      label: "Remove site folder",
      irreversible: true,
      async run() {
        if (!s.managed) return skipUnlessManaged("folder");
        if (keep.data) return { skipped: `kept ${s.dir} (keepData)` };
        if (!existsSync(s.dir)) return { skipped: "folder already gone" };
        rmSync(s.dir, { recursive: true, force: true });
        return `removed ${s.dir}`;
      },
    },
  ];
  return {
    kind: "site.delete",
    target: s.name,
    actorId,
    steps,
    onSuccess: () => ctx.db.delete(site).where(eq(site.name, s.name)).run(),
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}

/** hostname.add: validate → ingress → DNS → restart cloudflared. */
export function addHostnameJob(ctx: JobCtx, actorId: string, s: SiteRow, hostname: string): JobSpec {
  const tunnel: TunnelState = { ingressChanged: false, restarted: false };
  const dns = { managed: false };
  return {
    kind: "hostname.add",
    target: s.name,
    actorId,
    steps: [
      {
        key: "validate",
        label: "Validate",
        async run() {
          const issues = (await checkSite(ctx, { name: "x", hostname })).filter((i) => i.field === "hostname");
          if (issues.length) throw new Error(issues.map((i) => i.message).join("; "));
        },
      },
      ingressStep(ctx, tunnel, "Add ingress rule", (t) => insertIngressRule(t, hostname, service(s.port))),
      dnsEnsureStep(ctx.dns, hostname, tunnelOf(ctx), dns),
      restartStep(ctx, tunnel),
    ],
    onSuccess: () =>
      ctx.db
        .insert(siteHostname)
        .values({ hostname, siteName: s.name, ingressManaged: true, dnsManaged: dns.managed })
        .run(),
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}

/** hostname.remove: ingress → DNS → restart cloudflared. Caller ensures the panel may remove the rule. */
export function removeHostnameJob(ctx: JobCtx, actorId: string, s: SiteRow, h: HostRow): JobSpec {
  const tunnel: TunnelState = { ingressChanged: false, restarted: false };
  return {
    kind: "hostname.remove",
    target: s.name,
    actorId,
    steps: [
      ingressStep(ctx, tunnel, "Remove ingress rule", (t) => removeIngressRule(t, h.hostname)),
      dnsDeleteStep(ctx.dns, h.dnsManaged ? [h.hostname] : [], tunnelOf(ctx)),
      restartStep(ctx, tunnel),
    ],
    onSuccess: () => ctx.db.delete(siteHostname).where(eq(siteHostname.hostname, h.hostname)).run(),
    afterRollback: () => reapplyTunnel(ctx, tunnel),
  };
}
