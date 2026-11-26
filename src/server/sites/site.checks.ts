import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { SiteIssue } from "../../shared/site.types";
import type { Db } from "../db/client";
import { site, siteHostname } from "../db/schema";
import { describeSetting } from "../settings.service";
import type { SystemAdapters } from "../system/system.types";
import { appNames, parseApps } from "./apps.file";
import { readTextOrNull } from "./site.files";

/** What site checks/jobs need. */
export type SiteCtx = { db: Db; secret: string; system: SystemAdapters };

/** Site name: also its folder, pm2 app name and (with `-` → `_`) its postgres role/database. */
export const SITE_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
/** Lowercase FQDN with at least one dot; restricted charset so it can be written to YAML unquoted. */
export const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PORT_RANGE_RE = /^(\d+)-(\d+)$/;

/** Postgres role/database name for a site. */
export const dbNameFor = (siteName: string) => siteName.replaceAll("-", "_");

/** Files the site jobs touch. */
export type SitePaths = { sitesDir: string; appsJson: string; ecosystem: string; cfConfig: string };

/**
 * Paths from setting `sites.dir`, with `~` expanded against the adapters' HOME (a sandbox in fake mode,
 * so dev/tests never touch the developer's real ~/sites).
 */
export function sitePaths({ db, system }: SiteCtx): SitePaths {
  const raw = describeSetting(db, "sites.dir").value ?? "~/sites";
  const sitesDir = raw === "~" ? system.home : raw.startsWith("~/") ? join(system.home, raw.slice(2)) : raw;
  return {
    sitesDir,
    appsJson: join(sitesDir, "apps.json"),
    ecosystem: join(sitesDir, "ecosystem.config.js"),
    cfConfig: system.cloudflared.configPath,
  };
}

/** `sites.port_range` as [from, to]. */
export function portRange({ db }: SiteCtx): [number, number] {
  const m = (describeSetting(db, "sites.port_range").value ?? "").match(PORT_RANGE_RE);
  if (!m) throw new Error("setting sites.port_range is not a-b");
  return [Number(m[1]), Number(m[2])];
}

/** Ports already taken by sites, ingress rules, pm2 apps and apps.json entries (not counting live listeners). */
export async function usedPorts(ctx: SiteCtx): Promise<Set<number>> {
  const [ingress, apps] = await Promise.all([ctx.system.cloudflared.listIngress(), ctx.system.pm2.list()]);
  const used = new Set<number>(
    ctx.db
      .select({ port: site.port })
      .from(site)
      .all()
      .map((r) => r.port),
  );
  for (const p of [...ingress.map((r) => r.port), ...apps.map((a) => a.port)]) if (p !== null) used.add(p);
  for (const a of parseApps(readTextOrNull(sitePaths(ctx).appsJson))) {
    const p = Number((a.env as Record<string, unknown> | undefined)?.PORT);
    if (Number.isInteger(p)) used.add(p);
  }
  return used;
}

/** First port of the range that is unused and not accepting connections; null when the range is full. */
export async function suggestPort(ctx: SiteCtx): Promise<number | null> {
  const [from, to] = portRange(ctx);
  const used = await usedPorts(ctx);
  for (let p = from; p <= to; p++) {
    if (!used.has(p) && !(await ctx.system.net.isListening(p))) return p;
  }
  return null;
}

/** Input of checkSite. `port` undefined = will be suggested (only checked when given). */
export type SiteCheckInput = { name: unknown; hostname: unknown; port?: unknown; database?: boolean };

/** Field issues for a new site (empty = ok). Shared by POST /sites/check and job step 1. */
export async function checkSite(ctx: SiteCtx, input: SiteCheckInput): Promise<SiteIssue[]> {
  const issues: SiteIssue[] = [];
  const add = (field: SiteIssue["field"], code: string, message: string) => issues.push({ field, code, message });
  const { name, hostname, port } = input;
  const paths = sitePaths(ctx);

  if (typeof name !== "string" || !SITE_NAME_RE.test(name)) {
    add("name", "invalid", "name must be 2-31 chars: a-z first, then a-z, 0-9 or -");
  } else {
    const sites = ctx.db.select({ name: site.name, app: site.app }).from(site).all();
    const pm2 = (await ctx.system.pm2.list()).map((a) => a.name);
    const taken = [...sites.flatMap((s) => [s.name, s.app]), ...pm2, ...appNames(readTextOrNull(paths.appsJson))];
    if (taken.includes(name)) add("name", "taken", `${name} is already used by a site or pm2 app`);
    else if (existsSync(join(paths.sitesDir, name))) add("name", "folder_exists", `folder ${name} already exists`);
    else if (input.database) {
      const dbs = await ctx.system.postgres.listDatabases();
      if (dbs.some((d) => d.name === dbNameFor(name))) {
        add("name", "database_exists", `database ${dbNameFor(name)} already exists`);
      }
    }
  }

  if (typeof hostname !== "string" || !HOSTNAME_RE.test(hostname)) {
    add("hostname", "invalid", "hostname must be a lowercase domain like app.example.com");
  } else {
    const inIngress = (await ctx.system.cloudflared.listIngress()).some((r) => r.hostname === hostname);
    const inSites = ctx.db.select().from(siteHostname).where(eq(siteHostname.hostname, hostname)).get();
    if (inIngress || inSites) add("hostname", "in_use", `${hostname} is already routed`);
  }

  if (port !== undefined) {
    const [from, to] = portRange(ctx);
    if (typeof port !== "number" || !Number.isInteger(port)) add("port", "invalid", "port must be an integer");
    else if (port < from || port > to) add("port", "out_of_range", `port must be within ${from}-${to}`);
    else if ((await usedPorts(ctx)).has(port) || (await ctx.system.net.isListening(port))) {
      add("port", "in_use", `port ${port} is already used`);
    }
  }
  return issues;
}
