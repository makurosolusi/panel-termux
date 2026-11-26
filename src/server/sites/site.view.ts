// Site rows → API `Site` view (list + detail base), split out of site.service.ts (file health).
import { desc, eq } from "drizzle-orm";
import type { Site } from "../../shared/site.types";
import type { Db } from "../db/client";
import { deploy, type site, siteHostname, user } from "../db/schema";
import { appName } from "../deploy/deploy.steps";
import type { Pm2Proc } from "../system/system.types";

/** API view of site rows with hostnames, pm2 status (null procs → "unknown") and the last deploy. */
export function toSites(db: Db, rows: (typeof site.$inferSelect)[], procs: Pm2Proc[] | null): Site[] {
  const hosts = db.select().from(siteHostname).all();
  return rows.map((s) => {
    const p = procs?.find((a) => a.name === appName(s));
    const d = db
      .select({ at: deploy.at, kind: deploy.kind, status: deploy.status, actorName: user.name })
      .from(deploy)
      .leftJoin(user, eq(user.id, deploy.actorId))
      .where(eq(deploy.siteName, s.name))
      .orderBy(desc(deploy.at))
      .get();
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

/** Errored app or failed/interrupted last deploy: listed first. */
export const troubled = (s: Site): boolean =>
  s.appStatus === "errored" || ["failed", "interrupted"].includes(s.lastDeploy?.status ?? "");
