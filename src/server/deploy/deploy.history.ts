import { count, desc, eq } from "drizzle-orm";
import type { Deploy } from "../../shared/deploy.types";
import type { Page } from "../../shared/dev.types";
import type { Db } from "../db/client";
import { deploy, user } from "../db/schema";
import type { Paging } from "../routes/http.error";
import { identityOf, rowFor } from "./binary.identity";
import { binPaths } from "./swap";

/** GET /sites/:name/deploys: newest first; `active` = the row whose file is the live `app` now (stat match). */
export function listDeploys(db: Db, s: { name: string; dir: string }, paging: Paging): Page<Deploy> {
  const activeId = rowFor(db, s.name, identityOf(binPaths(s.dir).app))?.id ?? null;
  const rows = db
    .select({ d: deploy, actorName: user.name })
    .from(deploy)
    .leftJoin(user, eq(user.id, deploy.actorId))
    .where(eq(deploy.siteName, s.name))
    .orderBy(desc(deploy.at))
    .limit(paging.pageSize)
    .offset(paging.offset)
    .all();
  const total = db.select({ n: count() }).from(deploy).where(eq(deploy.siteName, s.name)).get()?.n ?? 0;
  const items = rows.map(({ d, actorName }) => ({
    id: d.id,
    at: d.at.toISOString(),
    finishedAt: d.finishedAt?.toISOString() ?? null,
    actor: d.actorId ? { id: d.actorId, name: actorName ?? "" } : null,
    sha256: d.sha256,
    sizeBytes: d.sizeBytes,
    fileName: d.fileName,
    runtime: d.runtime,
    status: d.status,
    jobId: d.jobId,
    kind: d.kind,
    active: d.id === activeId,
  }));
  return { items, total, page: paging.page, pageSize: paging.pageSize };
}
