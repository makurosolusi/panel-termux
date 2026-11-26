// POST /sites/adopt: record a running hand-written pm2 app as an adopted site, data taken from pm2 (PLAN/03 §4.2).
import { realpathSync } from "node:fs";
import { and, eq, isNull, or } from "drizzle-orm";
import { PM2_GUARD_NAME } from "../../shared/site.types";
import { recordAudit } from "../audit.service";
import { site, siteHostname } from "../db/schema";
import { log } from "../log.service";
import { ApiError } from "../routes/http.error";
import { type Pm2Proc, Pm2UnavailableError } from "../system/system.types";
import { candidateOf, ingressOf } from "./adopt.candidates";
import { HOSTNAME_RE, SITE_NAME_RE, type SiteCtx, sitePaths } from "./site.checks";

const bad = (code: string, message: string) => new ApiError(400, code, message);
const conflict = (code: string, message: string, extra?: Record<string, unknown>) =>
  new ApiError(409, code, message, extra);

async function procsOrBusy(ctx: SiteCtx): Promise<Pm2Proc[]> {
  try {
    return await ctx.system.pm2.procs();
  } catch (e) {
    if (e instanceof Pm2UnavailableError) throw conflict("pm2_not_running", `pm2 is not running (${e.reason})`);
    throw e;
  }
}

/** Re-runs every discovery check server-side, then inserts the site + hostname rows. Returns the site name. */
export async function adoptSite(ctx: SiteCtx, actorId: string, body: Record<string, unknown>): Promise<string> {
  const hostname = typeof body.hostname === "string" ? body.hostname.trim().toLowerCase() : "";
  const app = body.app;
  if (!HOSTNAME_RE.test(hostname)) throw bad("invalid_hostname", "invalid hostname");
  if (typeof app !== "string" || app === "") throw bad("invalid_app", "app (pm2 process name) is required");
  const name = body.name === undefined || body.name === "" ? app : body.name;
  if (typeof name !== "string" || !SITE_NAME_RE.test(name)) throw bad("invalid_name", "invalid site name");
  if (name === PM2_GUARD_NAME) throw bad("name_reserved", `${PM2_GUARD_NAME} is reserved by the panel`);

  const procs = await procsOrBusy(ctx);
  const proc = procs.find((p) => p.name === app && p.name !== PM2_GUARD_NAME);
  if (!proc) throw new ApiError(404, "app_not_found", `pm2 has no app named ${app}`);
  const user = ctx.db
    .select({ name: site.name })
    .from(site)
    .where(or(eq(site.app, app), and(isNull(site.app), eq(site.name, app))))
    .get();
  if (user) throw conflict("app_in_use", `${app} already runs site ${user.name}`, { site: user.name });
  if (ctx.db.select().from(site).where(eq(site.name, name)).get()) throw conflict("exists", `site ${name} exists`);
  if (ctx.db.select().from(siteHostname).where(eq(siteHostname.hostname, hostname)).get())
    throw conflict("exists", `${hostname} already belongs to a site`);

  const rule = (await ctx.system.cloudflared.listIngress()).find((r) => r.hostname === hostname);
  if (!rule) throw bad("invalid_hostname", `${hostname} has no ingress rule in config.yml`);
  let sitesReal: string | null = null;
  try {
    sitesReal = realpathSync(sitePaths(ctx).sitesDir);
  } catch (e) {
    throw conflict("adopt_blocked", `sites.dir: ${(e as Error).message}`, { blockers: ["outside_sites_dir"] });
  }
  const cand = candidateOf(proc, sitesReal, new Set(rule.port === null ? [] : [rule.port]));
  const ing = ingressOf(ctx, rule, [cand]);
  if (ing.self) throw conflict("self_hostname", `${hostname} is the panel's own address`);
  const blockers = [
    ...(ing.blockers ?? []),
    ...cand.blockers.filter((b) => !(b === "name_invalid" && body.name !== undefined)),
  ];
  if (blockers.length) throw conflict("adopt_blocked", `cannot adopt ${app}: ${blockers.join(", ")}`, { blockers });
  const port = rule.port as number;
  if (ctx.db.select().from(site).where(eq(site.port, port)).get())
    throw conflict("exists", `port ${port} belongs to a site`);

  ctx.db.transaction((tx) => {
    tx.insert(site)
      .values({ name, port, app, database: null, runtime: cand.runtime ?? "grun", managed: false, dir: cand.cwd ?? "" })
      .run();
    tx.insert(siteHostname).values({ hostname, siteName: name, ingressManaged: false, dnsManaged: false }).run();
  });
  recordAudit(ctx.db, { actorId, action: "site.adopt", target: name, meta: { hostname, port, app } });
  log.info(`[sites] adopted ${name} (pm2 ${app}) by ${actorId}`);
  return name;
}
