// Site paths, ports and the field checks of POST /sites/check and the `validate` steps (coded, PLAN/03 §3.1).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  HEALTH_TIMEOUT_MAX_SEC,
  HEALTH_TIMEOUT_MIN_SEC,
  type HealthExpect,
  PM2_GUARD_NAME,
  type SiteIssue,
  type SiteIssueCode,
  type SiteNote,
} from "../../shared/site.types";
import { DnsZoneNotFoundError, type SiteDnsProvider } from "../cloudflare/dns.provider";
import { DnsNotConfiguredError } from "../cloudflare/dns.types";
import type { Db } from "../db/client";
import { job, site, siteHostname } from "../db/schema";
import { ApiError } from "../routes/http.error";
import { describeSetting } from "../settings.service";
import type { SystemAdapters } from "../system/system.types";
import { appNames, parseApps } from "./apps.file";
import { readTunnelId } from "./ingress.editor";
import { readTextOrNull } from "./site.files";

/** The panel's own address: its hostname/port are never offered to sites (D9). */
export type PanelSelf = { hostname: string | null; port: number | null };
/** What site checks/jobs need. */
export type SiteCtx = { db: Db; secret: string; system: SystemAdapters; panel?: PanelSelf };

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

/** Tunnel UUID from config.yml, or null. */
export const tunnelIdOf = (ctx: SiteCtx) => (): string | null => {
  const t = readTextOrNull(ctx.system.cloudflared.configPath);
  return t === null ? null : readTunnelId(t);
};

/** `sites.port_range` as [from, to]. */
export function portRange({ db }: SiteCtx): [number, number] {
  const m = (describeSetting(db, "sites.port_range").value ?? "").match(PORT_RANGE_RE);
  if (!m) throw new Error("setting sites.port_range is not a-b");
  return [Number(m[1]), Number(m[2])];
}

/** Ports taken by sites, ingress rules, pm2 apps, apps.json entries and the panel (not counting live listeners). */
export async function usedPorts(ctx: SiteCtx): Promise<Set<number>> {
  const [ingress, apps] = await Promise.all([ctx.system.cloudflared.listIngress(), ctx.system.pm2.list()]);
  const used = new Set<number>(
    ctx.db
      .select({ port: site.port })
      .from(site)
      .all()
      .map((r) => r.port),
  );
  if (ctx.panel?.port) used.add(ctx.panel.port);
  for (const p of [...ingress.map((r) => r.port), ...apps.map((a) => a.port)]) if (p !== null) used.add(p);
  for (const a of parseApps(readTextOrNull(sitePaths(ctx).appsJson))) {
    const p = Number((a.env as Record<string, unknown> | undefined)?.PORT);
    if (Number.isInteger(p)) used.add(p);
  }
  return used;
}

/** First port of the range that is unused, not the panel's and not accepting connections; null when full. */
export async function suggestPort(ctx: SiteCtx): Promise<number | null> {
  const [from, to] = portRange(ctx);
  const used = await usedPorts(ctx);
  for (let p = from; p <= to; p++) {
    if (!used.has(p) && !(await ctx.system.net.isListening(p))) return p;
  }
  return null;
}

/** Input of checkSite. `port` undefined = will be suggested. `dns` = also look the hostnames up (check endpoint). */
export type SiteCheckInput = {
  name?: unknown;
  hostnames: unknown[];
  port?: unknown;
  database?: boolean;
  scope?: "site" | "hostname";
  dns?: SiteDnsProvider;
};

// 0.2.x English text per code, still shown by the 0.2.x web (W7: removed with SiteIssue.message).
const MESSAGES: Record<SiteIssueCode, string> = {
  name_invalid: "name must be 2-31 chars: a-z first, then a-z, 0-9 or -",
  name_taken: "name is already used by a site or pm2 app",
  name_reserved: "name is reserved by the panel",
  name_folder_exists: "a folder with this name already exists",
  name_database_exists: "a database with this name already exists",
  name_leftover: "an earlier create of this name was cut off; recover it first",
  hostname_invalid: "hostname must be a lowercase domain like app.example.com",
  hostname_in_use: "hostname is already routed",
  hostname_self: "hostname is the panel's own address",
  hostname_duplicate: "hostname is listed twice",
  hostname_zone_missing: "no Cloudflare zone of the token matches this hostname",
  hostname_dns_conflict: "a DNS record not created by the panel exists for this hostname",
  port_invalid: "port must be an integer",
  port_out_of_range: "port is outside sites.port_range",
  port_in_use: "port is already used",
  port_panel: "port is the panel's own port",
};

/** Unresolved interrupted/failed site.create of `name` (wizard note `name_leftover`). */
const leftoverJob = (db: Db, name: string) =>
  db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.target, name),
        eq(job.kind, "site.create"),
        inArray(job.status, ["interrupted", "failed"]),
        isNull(job.resolvedBy),
      ),
    )
    .get();

/** Field issues + DNS notes for a new site or new hostnames (empty issues = ok). */
export async function checkSite(
  ctx: SiteCtx,
  input: SiteCheckInput,
): Promise<{ issues: SiteIssue[]; notes: SiteNote[] }> {
  const issues: SiteIssue[] = [];
  const notes: SiteNote[] = [];
  const add = (field: SiteIssue["field"], code: SiteIssueCode, params: SiteIssue["params"] = {}, hostname?: string) =>
    issues.push({ field, code, params, message: MESSAGES[code], ...(hostname ? { hostname } : {}) });
  const paths = sitePaths(ctx);
  const { name, port } = input;

  if (input.scope !== "hostname") {
    if (typeof name !== "string" || !SITE_NAME_RE.test(name)) add("name", "name_invalid");
    else if (name === PM2_GUARD_NAME) add("name", "name_reserved", { name });
    else {
      const sites = ctx.db.select({ name: site.name, app: site.app }).from(site).all();
      const pm2 = (await ctx.system.pm2.list()).map((a) => a.name);
      const taken = [...sites.flatMap((s) => [s.name, s.app]), ...pm2, ...appNames(readTextOrNull(paths.appsJson))];
      const leftover = leftoverJob(ctx.db, name);
      if (taken.includes(name)) add("name", "name_taken", { name });
      else if (leftover) add("name", "name_leftover", { jobId: leftover.id });
      else if (existsSync(join(paths.sitesDir, name))) add("name", "name_folder_exists", { name });
      else if (input.database) {
        const dbs = await ctx.system.postgres.listDatabases();
        if (dbs.some((d) => d.name === dbNameFor(name))) add("name", "name_database_exists", { name: dbNameFor(name) });
      }
    }
  }

  const ingress = await ctx.system.cloudflared.listIngress();
  const seen = new Set<string>();
  for (const raw of input.hostnames) {
    const h = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!HOSTNAME_RE.test(h)) {
      add("hostname", "hostname_invalid", {}, typeof raw === "string" ? raw : undefined);
      continue;
    }
    if (seen.has(h)) add("hostname", "hostname_duplicate", { hostname: h }, h);
    else if (h === ctx.panel?.hostname) add("hostname", "hostname_self", { hostname: h }, h);
    else if (
      ingress.some((r) => r.hostname === h) ||
      ctx.db.select().from(siteHostname).where(eq(siteHostname.hostname, h)).get()
    )
      add("hostname", "hostname_in_use", { hostname: h }, h);
    else if (input.dns) await dnsCheck(ctx, input.dns, h, add, notes);
    seen.add(h);
  }

  if (port !== undefined) {
    const [from, to] = portRange(ctx);
    if (typeof port !== "number" || !Number.isInteger(port)) add("port", "port_invalid");
    else if (port === ctx.panel?.port) add("port", "port_panel", { port });
    else if (port < from || port > to) add("port", "port_out_of_range", { from, to });
    else if ((await usedPorts(ctx)).has(port) || (await ctx.system.net.isListening(port))) {
      add("port", "port_in_use", { port });
    }
  }
  return { issues, notes };
}

type AddIssue = (field: "hostname", code: SiteIssueCode, params: SiteIssue["params"], hostname?: string) => void;

async function dnsCheck(ctx: SiteCtx, dns: SiteDnsProvider, h: string, add: AddIssue, notes: SiteNote[]) {
  const note = (code: SiteNote["code"]) =>
    notes.push({ field: "hostname", hostname: h, code, params: { hostname: h } });
  const tunnel = tunnelIdOf(ctx)();
  if (!dns.inspect || !tunnel) return;
  try {
    const r = await dns.inspect(h, tunnel);
    if (r === "conflict") add("hostname", "hostname_dns_conflict", { hostname: h }, h);
    else if (r === "same_tunnel") note("dns_same_tunnel");
    else if (r === "owned") note("dns_owned");
  } catch (e) {
    if (e instanceof DnsNotConfiguredError) note("dns_token_missing");
    else if (e instanceof DnsZoneNotFoundError) add("hostname", "hostname_zone_missing", { hostname: h }, h);
    else note("dns_check_failed");
  }
}

const MAX_HEALTH_PATH = 200;
const EXPECTS: readonly HealthExpect[] = ["lt500", "2xx3xx"];
const invalidSettings = (field: string, message: string) =>
  new ApiError(400, "invalid_settings", `health.${field} ${message}`, { field });

/** PATCH /sites/:name/settings `health` → columns to update, or 400 `invalid_settings {field}` (D16 bounds). */
export function parseHealthSettings(h: Record<string, unknown>): Partial<typeof site.$inferInsert> {
  const set: Partial<typeof site.$inferInsert> = {};
  if (h.path !== undefined) {
    if (typeof h.path !== "string" || !/^\/[\x21-\x7e]*$/.test(h.path) || h.path.length > MAX_HEALTH_PATH)
      throw invalidSettings("path", "must start with / (printable ASCII)");
    set.healthPath = h.path;
  }
  if (h.expect !== undefined) {
    if (!EXPECTS.includes(h.expect as HealthExpect)) throw invalidSettings("expect", "is lt500 or 2xx3xx");
    set.healthExpect = h.expect as HealthExpect;
  }
  const t = h.timeoutSec;
  if (t !== undefined) {
    if (typeof t !== "number" || !Number.isInteger(t) || t < HEALTH_TIMEOUT_MIN_SEC || t > HEALTH_TIMEOUT_MAX_SEC)
      throw invalidSettings("timeoutSec", `is ${HEALTH_TIMEOUT_MIN_SEC}-${HEALTH_TIMEOUT_MAX_SEC}`);
    set.healthTimeoutSec = t;
  }
  return set;
}
