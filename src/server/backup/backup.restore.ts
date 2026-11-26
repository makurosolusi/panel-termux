import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { S3Client } from "bun";
import { count, desc, eq, isNotNull } from "drizzle-orm";
import type { BackupRestore, BackupRestoreStarted } from "../../shared/backup.types";
import type { Page } from "../../shared/dev.types";
import { recordAudit } from "../audit.service";
import { backupRestore, backupRun, site, user } from "../db/schema";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";
import { SQL_IDENT_RE } from "../system/system.types";
import { type BackupConfig, describeS3Error, minuteStamp, type S3Config } from "./backup.config";
import { SPACE_MARGIN_BYTES, sha256File } from "./backup.items";
import type { RunDeps } from "./backup.run";

/** Restoring needs room for the download plus the restored database (PLAN/04 F10.4). */
const RESTORE_SPACE_FACTOR = 3;
const MAX_IDENT = 63;

type ErrorCode = NonNullable<BackupRestore["errorCode"]>;
class RestoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** `<source cut>_r<yyyymmddHHMM>[_n]`, a valid SQL identifier not taken by `taken` (F10.3). */
export function restoreTargetName(source: string, at: Date, taken: Set<string>): string {
  let cut = source.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z]/.test(cut)) cut = `db_${cut}`;
  const suffix = `_r${minuteStamp(at)}`;
  // Room for "_nn" so a collision suffix never pushes the name over 63 characters.
  const head = cut.slice(0, MAX_IDENT - suffix.length - 3);
  for (let n = 1; ; n++) {
    const name = `${head}${suffix}${n === 1 ? "" : `_${n}`}`;
    if (!taken.has(name) && SQL_IDENT_RE.test(name)) return name;
  }
}

/** "Pulihkan ke database baru" (K10/F10): restore a database item into a fresh database, and drop it again. */
export function createRestoreService(deps: RunDeps, runBusy: () => boolean, config: () => BackupConfig) {
  const { db, system } = deps;
  const tmpDir = join(deps.dataDir, "backup-tmp");
  let running: Promise<void> | null = null;
  // Runs and restores share one lock (PLAN/04 F10.2).
  const busy = () => running !== null || runBusy();

  // Restores still "running" were cut off by a restart (F6.8); the half-made database stays droppable.
  db.update(backupRestore)
    .set({ status: "failed", error: "interrupted by panel restart", finishedAt: new Date() })
    .where(eq(backupRestore.status, "running"))
    .run();

  const usedDbs = () =>
    new Set(
      db
        .select({ d: site.database })
        .from(site)
        .where(isNotNull(site.database))
        .all()
        .map((r) => r.d),
    );

  async function execute(id: string, s3: S3Config, item: { key: string; name: string; sha256: string | null }) {
    const tmp = join(tmpDir, `restore-${id}.dump`);
    const row = db.select().from(backupRestore).where(eq(backupRestore.id, id)).get();
    if (!row) throw new Error(`backup_restore ${id} vanished before it started`);
    const stage = async <T>(code: ErrorCode, fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (e) {
        throw new RestoreError(code, describeS3Error(e, s3));
      }
    };
    try {
      mkdirSync(tmpDir, { recursive: true });
      await stage("download_failed", () => Bun.write(tmp, new S3Client(s3).file(item.key)));
      if (item.sha256 === null) log.info(`[backup] restore ${id}: item has no sha256 (pre-0.3.0), checksum skipped`);
      else if ((await sha256File(tmp)) !== item.sha256)
        throw new RestoreError("checksum_mismatch", `sha256 of ${item.key} differs from the recorded one`);
      const source = (await system.postgres.listDatabases()).find((d) => d.name === item.name);
      const owner = source?.owner ?? "postgres";
      const { tableCount } = await stage("restore_failed", () => system.postgres.restoreInto(tmp, row.targetDb, owner));
      db.update(backupRestore)
        .set({ status: "succeeded", tableCount, finishedAt: new Date() })
        .where(eq(backupRestore.id, id))
        .run();
    } catch (e) {
      const errorCode = e instanceof RestoreError ? e.code : "restore_failed";
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 400);
      log.warn(`[backup] restore ${id} into ${row.targetDb} failed (${errorCode}): ${error}`);
      db.update(backupRestore)
        .set({ status: "failed", error, errorCode, finishedAt: new Date() })
        .where(eq(backupRestore.id, id))
        .run();
    } finally {
      rmSync(tmp, { force: true });
    }
    const done = db.select().from(backupRestore).where(eq(backupRestore.id, id)).get();
    recordAudit(db, {
      actorId: row.actorId,
      action: "backup.restore",
      target: row.targetDb,
      meta: { runId: row.runId, item: item.name, status: done?.status ?? "failed" },
    });
  }

  return {
    /** A restore is in progress. */
    running: () => running !== null,
    /** Resolves when the current restore (if any) has finished. */
    idle: () => running ?? Promise.resolve(),

    /** Starts a restore in the background; 400 not_database, 404, 410 pruned, 409 busy/key_mismatch/insufficient_space. */
    async start(actorId: string, runId: string, rawIndex: string, now = new Date()): Promise<BackupRestoreStarted> {
      const run = db.select().from(backupRun).where(eq(backupRun.id, runId)).get();
      const index = Number(rawIndex);
      const item = run && Number.isInteger(index) && index >= 0 ? run.items[index] : undefined;
      if (!item) throw new ApiError(404, "not_found", `backup run ${runId} has no item ${rawIndex}`);
      if (item.kind !== "database" || !item.ok)
        throw new ApiError(400, "not_database", `item ${rawIndex} of run ${runId} is not an uploaded database dump`);
      if (item.pruned) throw new ApiError(410, "pruned", `item ${rawIndex} of run ${runId} was deleted by retention`);
      // Read before the lock check: from the check to taking the lock there is no await (no double start).
      const dbNames = (await system.postgres.listDatabases()).map((d) => d.name);
      if (busy()) throw new ApiError(409, "busy", "a backup run or restore is in progress");
      const cfg = config();
      if (cfg.keyMismatch) throw new ApiError(409, "key_mismatch", "backup settings cannot be read with the data key");
      if (!cfg.s3) throw new ApiError(400, "not_configured", `missing settings: ${cfg.missing.join(", ")}`);
      const need = RESTORE_SPACE_FACTOR * (item.sizeBytes ?? 0) + SPACE_MARGIN_BYTES;
      const free = deps.freeBytes(deps.dataDir);
      if (free < need) throw new ApiError(409, "insufficient_space", `free ${free} B, restore needs ${need} B`);

      const recorded = db.select({ t: backupRestore.targetDb }).from(backupRestore).all();
      const targetDb = restoreTargetName(item.name, now, new Set([...dbNames, ...recorded.map((r) => r.t)]));
      const id = crypto.randomUUID();
      db.insert(backupRestore)
        .values({
          id,
          runId,
          itemIndex: index,
          sourceName: item.name,
          targetDb,
          status: "running",
          actorId,
          startedAt: now,
        })
        .run();
      running = execute(id, cfg.s3, { key: item.key, name: item.name, sha256: item.sha256 ?? null })
        .catch((e) => log.error(`[backup] restore ${id} crashed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          running = null;
        });
      return { restoreId: id, targetDb };
    },

    /** Restores newest first, with whether a site uses the target and who started it. */
    list(paging: Paging): Page<BackupRestore> {
      const used = usedDbs();
      const rows = db
        .select({ r: backupRestore, actorName: user.name })
        .from(backupRestore)
        .leftJoin(user, eq(user.id, backupRestore.actorId))
        .orderBy(desc(backupRestore.startedAt))
        .limit(paging.pageSize)
        .offset(paging.offset)
        .all();
      const total = db.select({ n: count() }).from(backupRestore).get()?.n ?? 0;
      const items = rows.map(({ r, actorName }) => ({
        id: r.id,
        runId: r.runId,
        itemIndex: r.itemIndex,
        sourceName: r.sourceName,
        targetDb: r.targetDb,
        status: r.status,
        error: r.error,
        errorCode: r.errorCode,
        tableCount: r.tableCount,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        droppedAt: r.droppedAt?.toISOString() ?? null,
        inUse: used.has(r.targetDb),
        actor: r.actorId && actorName !== null ? { id: r.actorId, name: actorName } : null,
      }));
      return { items, total, page: paging.page, pageSize: paging.pageSize };
    },

    /** "Hapus database uji" (typed: `confirm` must equal targetDb); drops only the recorded database, never a role. */
    async drop(actorId: string, id: string, confirm: unknown): Promise<void> {
      const r = db.select().from(backupRestore).where(eq(backupRestore.id, id)).get();
      if (!r) throw new ApiError(404, "not_found", `restore ${id} not found`);
      if (confirm !== r.targetDb) throw new ApiError(400, "confirm_mismatch", `type ${r.targetDb} to confirm`);
      if (r.droppedAt) throw new ApiError(409, "already_dropped", `${r.targetDb} was already dropped`);
      if (r.status === "running") throw new ApiError(409, "restore_running", `restore into ${r.targetDb} is running`);
      if (usedDbs().has(r.targetDb)) throw new ApiError(409, "in_use", `a site uses database ${r.targetDb}`);
      if (busy()) throw new ApiError(409, "busy", "a backup run or restore is in progress");
      await system.postgres.dropDatabase(r.targetDb);
      db.update(backupRestore).set({ droppedAt: new Date() }).where(eq(backupRestore.id, id)).run();
      recordAudit(db, { actorId, action: "backup.restore_drop", target: r.targetDb });
    },

    /** Newest succeeded restore (BackupStatus.lastRestoreTest). */
    lastSucceeded(): { at: string; sourceName: string } | null {
      const r = db
        .select()
        .from(backupRestore)
        .where(eq(backupRestore.status, "succeeded"))
        .orderBy(desc(backupRestore.startedAt))
        .limit(1)
        .get();
      return r ? { at: (r.finishedAt ?? r.startedAt).toISOString(), sourceName: r.sourceName } : null;
    },
  };
}

/** Restore part of the backup service. */
export type RestoreService = ReturnType<typeof createRestoreService>;
