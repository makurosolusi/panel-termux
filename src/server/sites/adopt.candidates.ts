// GET /sites/discovered: ingress rules and real pm2 apps that belong to no site, with what blocks adopting them (D7–D9).
import { existsSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import {
  type AdoptCandidateApp,
  type Discovered,
  type DiscoveredIngress,
  PM2_GUARD_NAME,
  type SiteRuntime,
} from "../../shared/site.types";
import { site, siteHostname } from "../db/schema";
import { BinaryError, detectRuntime } from "../deploy/elf.runtime";
import { scriptRuntimeOf } from "../deploy/run.script";
import { portFromArgs } from "../system/pm2.termux";
import type { IngressRule, Pm2Proc } from "../system/system.types";
import { envPort } from "./env.file";
import { SITE_NAME_RE, type SiteCtx, sitePaths } from "./site.checks";
import { readTextOrNull } from "./site.files";

const real = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null; // missing path: treated as "not there" by the callers
  }
};

/** Adopt view of one pm2 app; `sitesReal` = realpath of sites.dir. Ports: pm2 env → args → .env PORT (D7/D8). */
export function candidateOf(p: Pm2Proc, sitesReal: string | null, ingressPorts: Set<number>): AdoptCandidateApp {
  const blockers: AdoptCandidateApp["blockers"] = [];
  const warnings: AdoptCandidateApp["warnings"] = [];
  const cwd = p.cwd ? real(p.cwd) : null;
  if (p.module) blockers.push("pm2_module");
  if (!SITE_NAME_RE.test(p.name)) blockers.push("name_invalid");
  let runtime: SiteRuntime | null = null;
  if (!cwd || !sitesReal || !cwd.startsWith(sitesReal + sep)) blockers.push("outside_sites_dir");
  else if (!existsSync(join(cwd, "app"))) blockers.push("no_binary");
  else {
    try {
      runtime = detectRuntime(join(cwd, "app"));
    } catch (e) {
      if (!(e instanceof BinaryError)) throw e;
      blockers.push("invalid_binary");
    }
  }
  const scriptRuntime = scriptRuntimeOf({ execPath: p.execPath, cwd });
  if (scriptRuntime === "other") warnings.push("script_other");
  else if (runtime && runtime !== scriptRuntime) warnings.push("runtime_script_mismatch");
  let port = p.port;
  let portSource: AdoptCandidateApp["portSource"] = null;
  if (port !== null) portSource = portFromArgs(p.args) === port ? "pm2_args" : "pm2_env";
  else if (cwd) {
    port = envPort(readTextOrNull(join(cwd, ".env")) ?? "");
    if (port !== null) portSource = "dotenv";
  }
  if (port === null) warnings.push("port_unknown");
  else if (!ingressPorts.has(port)) warnings.push("port_mismatch");
  return { name: p.name, status: p.status, cwd, port, portSource, runtime, scriptRuntime, blockers, warnings };
}

/** Ingress view of one rule; the panel's own host/port is `self` and never adoptable (D9). */
export function ingressOf(ctx: SiteCtx, r: IngressRule, apps: AdoptCandidateApp[]): DiscoveredIngress {
  const self = r.hostname === ctx.panel?.hostname || (r.port !== null && r.port === ctx.panel?.port);
  const blockers: NonNullable<DiscoveredIngress["blockers"]> = [];
  if (self) blockers.push("self");
  if (r.port === null) blockers.push("no_port");
  if (r.hostname.startsWith("*")) blockers.push("wildcard");
  const match = self || r.port === null ? null : (apps.find((a) => a.port === r.port)?.name ?? null);
  return { hostname: r.hostname, port: r.port, app: match, self, match, blockers };
}

/** Unclaimed ingress rules + pm2 apps (modules and `pm2-guard` hidden, B24). Throws Pm2UnavailableError. */
export async function discover(ctx: SiteCtx): Promise<Discovered> {
  const [ingress, procs] = await Promise.all([ctx.system.cloudflared.listIngress(), ctx.system.pm2.procs()]);
  const known = new Set(
    ctx.db
      .select({ h: siteHostname.hostname })
      .from(siteHostname)
      .all()
      .map((r) => r.h),
  );
  const taken = new Set(
    ctx.db
      .select({ app: site.app, name: site.name })
      .from(site)
      .all()
      .map((r) => r.app ?? r.name),
  );
  const free = ingress.filter((r) => !known.has(r.hostname));
  const ports = new Set(free.flatMap((r) => (r.port === null ? [] : [r.port])));
  const sitesReal = real(sitePaths(ctx).sitesDir);
  const apps = procs
    .filter((p) => !p.module && p.name !== PM2_GUARD_NAME && !taken.has(p.name))
    .map((p) => candidateOf(p, sitesReal, ports));
  return { ingress: free.map((r) => ingressOf(ctx, r, apps)), apps };
}
