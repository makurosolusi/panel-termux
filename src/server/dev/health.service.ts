import { statfsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { count, eq, gt } from "drizzle-orm";
import pkg from "../../../package.json" with { type: "json" };
import type { DevHealth } from "../../shared/dev.types";
import type { Db } from "../db/client";
import { appMeta, session, user } from "../db/schema";
import { requestStats } from "../http/request.log";

const MB = 1024 * 1024;
/** Process start time (ms since epoch), fixed at module load. */
const STARTED_AT = Date.now() - process.uptime() * 1000;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Snapshot of process, DB and data-dir health for /dev. */
export function getHealth(db: Db, dataDir: string): DevHealth {
  const mem = process.memoryUsage();
  const fs = statfsSync(dataDir);
  // page_count * page_size = main DB file size (WAL excluded; it is checkpointed back regularly).
  const dbSize = db.$client
    .query<{ n: number }, []>("select page_count * page_size as n from pragma_page_count, pragma_page_size")
    .get();
  const schemaVersion = db.select({ v: appMeta.value }).from(appMeta).where(eq(appMeta.key, "schema_version")).get()?.v;
  return {
    version: pkg.version,
    schemaVersion: schemaVersion ?? "none",
    startedAt: new Date(STARTED_AT).toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    memory: { rssMb: round1(mem.rss / MB), heapUsedMb: round1(mem.heapUsed / MB) },
    db: { sizeBytes: dbSize?.n ?? 0 },
    dataDir: { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize },
    runtime: { bun: Bun.version, node: process.versions.node, platform: process.platform, arch: process.arch },
    cpuCores: availableParallelism(),
    ...requestStats(),
    counts: {
      users: db.select({ n: count() }).from(user).get()?.n ?? 0,
      sessions: db.select({ n: count() }).from(session).where(gt(session.expiresAt, new Date())).get()?.n ?? 0,
    },
  };
}
