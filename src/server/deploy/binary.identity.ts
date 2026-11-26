// Which deploy row put a binary file in place (PLAN/03 D22): match stat (ino, mtimeMs, size), no hashing per request.
import { statSync } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import type { BinaryInfo } from "../../shared/site.types";
import type { Db } from "../db/client";
import { deploy } from "../db/schema";
import { binPaths } from "./swap";

/** stat identity of a file; mtime floored to ms (stored as integer). */
export type BinIdentity = { ino: number; mtimeMs: number; size: number };

/** Identity of the file at `path`, or null when it does not exist. */
export function identityOf(path: string): BinIdentity | null {
  try {
    const s = statSync(path);
    return { ino: s.ino, mtimeMs: Math.floor(s.mtimeMs), size: s.size };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`stat ${path}: ${(e as Error).message}`, { cause: e });
  }
}

type DeployRow = typeof deploy.$inferSelect;

/** Newest deploy row of `site` whose recorded identity is `id` (null = "Versi tanpa catatan"). */
export function rowFor(db: Db, site: string, id: BinIdentity | null): DeployRow | null {
  if (!id) return null;
  return (
    db
      .select()
      .from(deploy)
      .where(
        and(
          eq(deploy.siteName, site),
          eq(deploy.binIno, id.ino),
          eq(deploy.binMtimeMs, id.mtimeMs),
          eq(deploy.sizeBytes, id.size),
        ),
      )
      .orderBy(desc(deploy.at))
      .get() ?? null
  );
}

/** Records that row `rowId`'s binary now is the file with identity `id` (after a swap moved or copied it). */
export function setIdentity(db: Db, rowId: string, id: BinIdentity | null): void {
  if (id) db.update(deploy).set({ binIno: id.ino, binMtimeMs: id.mtimeMs }).where(eq(deploy.id, rowId)).run();
}

const info = (id: BinIdentity | null, row: DeployRow | null): BinaryInfo | null =>
  id && {
    sizeBytes: id.size,
    modifiedAt: new Date(id.mtimeMs).toISOString(),
    deployId: row?.id ?? null,
    sha256: row?.sha256 ?? null,
    fileName: row?.fileName ?? null,
    runtime: row?.runtime ?? null,
  };

/** `SiteDetail.binary`: the live `app` and `app.prev` of a site folder with the deploy rows they came from. */
export function siteBinaries(
  db: Db,
  site: { name: string; dir: string },
): {
  live: BinaryInfo | null;
  previous: BinaryInfo | null;
} {
  const p = binPaths(site.dir);
  const live = identityOf(p.app);
  const prev = identityOf(p.prev);
  return { live: info(live, rowFor(db, site.name, live)), previous: info(prev, rowFor(db, site.name, prev)) };
}
