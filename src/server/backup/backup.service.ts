import { rmSync } from "node:fs";
import { join } from "node:path";
import { S3Client } from "bun";
import { count, desc, eq, isNull, sql } from "drizzle-orm";
import pkg from "../../../package.json" with { type: "json" };
import type {
  BackupExcluded,
  BackupLastGood,
  BackupRun,
  BackupStatus,
  BackupTrigger,
  BackupVerifyInput,
} from "../../shared/backup.types";
import type { Page } from "../../shared/dev.types";
import { hasRole, type Role } from "../../shared/roles";
import { pruneAudit, recordAudit } from "../audit.service";
import { assertFresh } from "../auth/role.guard";
import type { Db } from "../db/client";
import { backupRun } from "../db/schema";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";
import { getSetting } from "../settings.service";
import { type BackupConfig, describeS3Error, isDue, localDay, nextRunAt, readBackupConfig } from "./backup.config";
import { freeBytesIn } from "./backup.items";
import { type BackupPaths, restoreHint } from "./backup.manifest";
import { createRestoreService, INTERRUPTED_ERROR } from "./backup.restore";
import { backupPaths, executeRun, type RunDeps } from "./backup.run";
import { verifyBackupTarget } from "./backup.verify";

/** What the backup service needs. `dataDir` holds panel.db and the temp folder; `freeBytes` defaults to statfs. */
export type BackupDeps = Omit<RunDeps, "freeBytes"> & { freeBytes?: RunDeps["freeBytes"] };

const PRESIGN_TTL_SEC = 15 * 60;
const SCHEDULER_TICK_MS = 60_000;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type RunRow = typeof backupRun.$inferSelect;

/** Runs that may still hold good items (fully pruned runs cannot), newest insert first. */
const liveRunsNewestFirst = (db: Db): RunRow[] =>
  db.select().from(backupRun).where(isNull(backupRun.prunedAt)).orderBy(desc(sql`rowid`)).all();

/** Newest ok, non-pruned item per (kind, name), newest = insert order; checksums/manifest excluded. */
function lastGoodAll(db: Db, paths: BackupPaths): BackupLastGood[] {
  const out = new Map<string, BackupLastGood>();
  for (const r of liveRunsNewestFirst(db))
    r.items.forEach((i, itemIndex) => {
      const id = `${i.kind}\0${i.name}`;
      if (!i.ok || i.pruned || i.kind === "checksums" || i.kind === "manifest" || out.has(id)) return;
      out.set(id, {
        kind: i.kind,
        name: i.name,
        runId: r.id,
        itemIndex,
        at: r.startedAt.toISOString(),
        sizeBytes: i.sizeBytes,
        checked: i.checked ?? null,
        restoreHint: restoreHint(i, paths),
      });
    });
  return [...out.values()];
}

let lastTick: Date | null = null;
/** Liveness of the daily tick for /dev/health (DECISIONS B5). */
export const backupScheduler = { lastTickAt: (): Date | null => lastTick };

function createBackupService(input: BackupDeps) {
  const deps: RunDeps = { ...input, freeBytes: input.freeBytes ?? freeBytesIn };
  const { db, dataDir } = deps;
  let running: Promise<void> | null = null;

  // Runs still "running" were cut off by a restart; their temp files are leftovers.
  db.update(backupRun)
    .set({ status: "failed", error: INTERRUPTED_ERROR, finishedAt: new Date() })
    .where(eq(backupRun.status, "running"))
    .run();
  rmSync(join(dataDir, "backup-tmp"), { recursive: true, force: true });

  const config = (): BackupConfig => readBackupConfig(deps);
  const restores = createRestoreService(deps, () => running !== null, config);
  const busy = () => running !== null || restores.running();

  const toRun = (r: RunRow): BackupRun => {
    const paths = backupPaths(deps);
    return {
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      items: r.items.map((i) => ({ ...i, pruned: i.pruned ?? false, restoreHint: restoreHint(i, paths) })),
      error: r.error,
      // No column for it: the boot sweep above is the only writer of INTERRUPTED_ERROR.
      errorCode: r.status === "failed" && r.error === INTERRUPTED_ERROR ? "interrupted" : null,
      includesSecrets: r.includesSecrets,
      panelVersion: r.panelVersion,
      prunedAt: r.prunedAt ? r.prunedAt.toISOString() : null,
    };
  };

  /** Starts a run in the background; 409 key_mismatch, 400 not_configured, 409 busy (run or restore). */
  function start(trigger: BackupTrigger, actorId: string | null): { runId: string } {
    const cfg = config();
    if (cfg.keyMismatch) throw new ApiError(409, "key_mismatch", "backup settings cannot be read with the data key");
    if (!cfg.s3) throw new ApiError(400, "not_configured", `missing settings: ${cfg.missing.join(", ")}`);
    if (busy()) throw new ApiError(409, "busy", "a backup run or restore is in progress");
    const id = crypto.randomUUID();
    const startedAt = new Date();
    db.insert(backupRun)
      .values({
        id,
        trigger,
        status: "running",
        items: [],
        actorId,
        startedAt,
        includesSecrets: cfg.includeSecrets,
        panelVersion: pkg.version,
      })
      .run();
    const s3 = cfg.s3;
    running = executeRun(deps, { id, startedAt, actorId }, cfg, s3)
      .catch((e) => {
        log.error(`[backup] run ${id} crashed: ${describeS3Error(e, s3)}`);
        db.update(backupRun)
          .set({ status: "failed", error: describeS3Error(e, s3), finishedAt: new Date() })
          .where(eq(backupRun.id, id))
          .run();
      })
      .finally(() => {
        running = null;
      });
    return { runId: id };
  }

  const getRow = (id: string) => db.select().from(backupRun).where(eq(backupRun.id, id)).get();

  return {
    /** Unset required setting keys (empty = configured). */
    missing: () => config().missing,
    start,
    /** A run or a restore is in progress (02 refuses restarting `panel`, 03 refuses `database_drop`). */
    busy,
    /** Resolves when the current run and restore (if any) have finished. */
    idle: async () => {
      await (running ?? Promise.resolve());
      await restores.idle();
    },
    restores,
    /** S3 connection test, POST /api/dev/backup/verify. */
    verify: (actorId: string, draft?: BackupVerifyInput) => verifyBackupTarget(deps, actorId, draft),

    /** Never throws because of the data key: keyMismatch is reported instead (F7.4). */
    status(now = new Date()): BackupStatus {
      const cfg = config();
      const last = db.select().from(backupRun).orderBy(desc(sql`rowid`)).limit(1).get();
      const excluded: BackupExcluded[] = ["site_binaries", "cloudflared_cert"];
      if (!cfg.includeSecrets) excluded.push("secrets_off");
      return {
        configured: cfg.missing.length === 0,
        missing: cfg.missing,
        keyMismatch: cfg.keyMismatch,
        hourLocal: cfg.hour,
        nextRunAt: cfg.s3 && cfg.hour !== null ? nextRunAt(cfg.hour, now).toISOString() : null,
        retentionDays: cfg.retentionDays,
        keepMinRuns: cfg.keepMinRuns,
        maxItemMb: cfg.maxItemBytes / (1024 * 1024),
        includeSecrets: cfg.includeSecrets,
        running: running !== null,
        restoring: restores.running(),
        lastRun: last ? toRun(last) : null,
        lastGood: lastGoodAll(db, backupPaths(deps)),
        excluded,
        lastRestoreTest: restores.lastSucceeded(),
      };
    },

    list(paging: Paging): Page<BackupRun> {
      const rows = db
        .select()
        .from(backupRun)
        .orderBy(desc(sql`rowid`))
        .limit(paging.pageSize)
        .offset(paging.offset)
        .all();
      const total = db.select({ n: count() }).from(backupRun).get()?.n ?? 0;
      return { items: rows.map(toRun), total, page: paging.page, pageSize: paging.pageSize };
    },

    /** Presigned GET URL (15 min) of an uploaded item; `secrets` = super_admin + fresh session (F4). Audited. */
    downloadUrl(who: { id: string; role: Role; session: { createdAt: Date } }, id: string, rawIndex: string): string {
      const row = getRow(id);
      if (!row) throw new ApiError(404, "not_found", `backup run ${id} not found`);
      const index = Number(rawIndex);
      const item = Number.isInteger(index) && index >= 0 ? row.items[index] : undefined;
      if (!item?.ok) throw new ApiError(404, "not_found", `backup run ${id} has no uploaded item ${rawIndex}`);
      if (item.kind === "secrets") {
        if (!hasRole(who.role, "super_admin")) throw new ApiError(403, "forbidden", "secrets need a super admin");
        assertFresh(who.session);
      }
      if (item.pruned) throw new ApiError(410, "pruned", `item ${rawIndex} of run ${id} was deleted by retention`);
      const cfg = config();
      if (cfg.keyMismatch) throw new ApiError(409, "key_mismatch", "backup settings cannot be read with the data key");
      if (!cfg.s3) throw new ApiError(400, "not_configured", `missing settings: ${cfg.missing.join(", ")}`);
      const url = new S3Client(cfg.s3).presign(item.key, { expiresIn: PRESIGN_TTL_SEC, method: "GET" });
      recordAudit(db, { actorId: who.id, action: "backup.download", target: item.key, meta: { runId: id } });
      return url;
    },

    /**
     * Daily tick: re-reads settings, starts the scheduled run, never overlaps a run, and prunes the audit
     * log when the local date changes (K13). Returns a stop function.
     */
    startScheduler(tickMs = SCHEDULER_TICK_MS, clock: () => Date = () => new Date()): () => void {
      let prev = clock();
      const timer = setInterval(() => {
        const now = clock();
        const since = prev;
        prev = now;
        lastTick = now;
        try {
          if (localDay(since) !== localDay(now)) pruneAudit(db, Number(getSetting(deps, "audit.retention_days")), now);
        } catch (e) {
          log.error(`[backup] audit retention failed: ${errMsg(e)}`);
        }
        try {
          const cfg = config();
          if (!isDue(cfg.hour, since, now)) return;
          // isDue fires once per local day, so this warns at most once a day (F2.1).
          if (cfg.keyMismatch)
            return log.warn("[backup] scheduled run skipped: backup settings unreadable with the data key");
          if (!cfg.s3) return log.warn(`[backup] scheduled run skipped: missing ${cfg.missing.join(", ")}`);
          if (busy()) return log.warn("[backup] scheduled run skipped: a run or restore is in progress");
          start("schedule", null);
        } catch (e) {
          log.error(`[backup] scheduler tick failed: ${errMsg(e)}`);
        }
      }, tickMs);
      return () => clearInterval(timer);
    },
  };
}

/** Backup service API. */
export type BackupService = ReturnType<typeof createBackupService>;

const instances = new WeakMap<Db, BackupService>();

/**
 * The one backup service of a panel DB (routes and the boot scheduler share it, so the busy lock
 * really is process-wide). First call wins; later deps for the same DB are ignored.
 */
export function backupServiceFor(deps: BackupDeps): BackupService {
  let s = instances.get(deps.db);
  if (!s) {
    s = createBackupService(deps);
    instances.set(deps.db, s);
  }
  return s;
}
