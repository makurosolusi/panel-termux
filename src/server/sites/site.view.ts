// Site rows → API `Site` view (list + detail base), split out of site.service.ts (file health).
import { eq, inArray, sql } from "drizzle-orm";
import { missingFromPm2, type Site } from "../../shared/site.types";
import type { Db } from "../db/client";
import { deploy, type site, siteHostname, user } from "../db/schema";
import { appName } from "../deploy/deploy.steps";
import type { Pm2Proc } from "../system/system.types";

/** Latest deploy (+ actor name) per site in ONE query: row_number() over the (site_name, at) index. */
function lastDeploys(db: Db, names: string[]) {
  const ranked = db
    .select({
      siteName: deploy.siteName,
      at: deploy.at,
      kind: deploy.kind,
      status: deploy.status,
      actorId: deploy.actorId,
      rn: sql<number>`row_number() over (partition by ${deploy.siteName} order by ${deploy.at} desc)`.as("rn"),
    })
    .from(deploy)
    .where(inArray(deploy.siteName, names))
    .as("ranked");
  const rows = db
    .select({
      siteName: ranked.siteName,
      at: ranked.at,
      kind: ranked.kind,
      status: ranked.status,
      actorName: user.name,
    })
    .from(ranked)
    .leftJoin(user, eq(user.id, ranked.actorId))
    .where(eq(ranked.rn, 1))
    .all();
  return new Map(rows.map(({ siteName, ...d }) => [siteName, d]));
}

/** API view of site rows with hostnames, pm2 status (null procs → "unknown") and the last deploy. */
export function toSites(db: Db, rows: (typeof site.$inferSelect)[], procs: Pm2Proc[] | null): Site[] {
  if (rows.length === 0) return [];
  const names = rows.map((s) => s.name);
  const hosts = db.select().from(siteHostname).where(inArray(siteHostname.siteName, names)).all();
  const last = lastDeploys(db, names);
  return rows.map((s) => {
    const p = procs?.find((a) => a.name === appName(s));
    const d = last.get(s.name);
    return {
      name: s.name,
      port: s.port,
      hostnames: hosts.filter((h) => h.siteName === s.name).map((h) => h.hostname),
      database: s.database,
      runtime: s.runtime,
      managed: s.managed,
      app: appName(s),
      appStatus: procs === null ? "unknown" : (p?.status ?? "not_deployed"),
      restarts: p?.restarts ?? null,
      lastDeploy: d ? { ...d, at: d.at.toISOString(), actorName: d.actorName ?? null } : null,
      createdAt: s.createdAt.toISOString(),
    };
  });
}

/** Errored or missing app, or failed/interrupted last deploy: listed first. */
export const troubled = (s: Site): boolean =>
  s.appStatus === "errored" || missingFromPm2(s) || ["failed", "interrupted"].includes(s.lastDeploy?.status ?? "");
