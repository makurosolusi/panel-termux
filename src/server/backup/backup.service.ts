import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { S3Client } from "bun";
import { count, desc, eq } from "drizzle-orm";
import type { BackupRun, BackupStatus, BackupTrigger } from "../../shared/backup.types";
import type { Page } from "../../shared/dev.types";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { type BackupItemRow, backupRun } from "../db/schema";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";
import type { SettingsDeps } from "../settings.service";
import type { SystemAdapters } from "../system/system.types";
import { type BackupConfig, isDue, nextRunAt, readBackupConfig, runKeyStem, type S3Config } from "./backup.config";

/** What the backup service needs. `dataDir` holds panel.db and the temp folder for dumps. */
export type BackupDeps = SettingsDeps & { dataDir: string; system: SystemAdapters };

const PRESIGN_TTL_SEC = 15 * 60;
const SCHEDULER_TICK_MS = 60_000;
const MS_PER_DAY = 86_400_000;
const PANEL_DB = "panel.db";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** S3 failures carry Bun's S3 error code (e.g. AccessDenied); credentials are masked defensively. */
function describe(e: unknown, s3: S3Config): string {
  const code = (e as { code?: unknown })?.code;
  const msg = `${typeof code === "string" ? `${code}: ` : ""}${errMsg(e)}`;
  return msg.replaceAll(s3.secretAccessKey, "***").replaceAll(s3.accessKeyId, "***").slice(0, 300);
}

/** Deletes objects under `prefix` last modified before `cutoff`; keys outside the prefix are never touched. */
async function prune(client: S3Client, prefix: string, cutoff: number): Promise<number> {
  const old: string[] = [];
  let token: string | undefined;
  do {
    const r = await client.list({ prefix, continuationToken: token });
    for (const o of r.contents ?? []) {
      const at = o.lastModified ? Date.parse(o.lastModified) : Number.NaN;
      if (o.key.startsWith(prefix) && at < cutoff) old.push(o.key);
    }
    token = r.isTruncated ? r.nextContinuationToken : undefined;
  } while (token);
  // Listing finishes before deleting so continuation tokens stay valid.
  for (const key of old) await client.delete(key);
  return old.length;
}

function createBackupService(deps: BackupDeps) {
  const { db, dataDir, system } = deps;
  const tmpDir = join(dataDir, "backup-tmp");
  let running: Promise<void> | null = null;

  // Runs still "running" were cut off by a restart; their temp files are leftovers.
  db.update(backupRun)
    .set({ status: "failed", error: "interrupted by panel restart", finishedAt: new Date() })
    .where(eq(backupRun.status, "running"))
    .run();
  rmSync(tmpDir, { recursive: true, force: true });

  const config = (): BackupConfig => readBackupConfig(deps);

  const restoreHint = (i: BackupItemRow): string => {
    const file = i.key.split("/").pop() ?? i.key;
    if (i.kind === "database") return `pg_restore -U postgres -d ${i.name} --clean ${file}`;
    const live = join(dataDir, PANEL_DB);
    return `sv down panel && cp ${file} ${live} && rm -f ${live}-wal ${live}-shm && sv up panel`;
  };

  const toRun = (r: typeof backupRun.$inferSelect): BackupRun => ({
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    items: r.items.map((i) => ({ ...i, restoreHint: restoreHint(i) })),
    error: r.error,
  });

  async function execute(id: string, s3: S3Config, cfg: BackupConfig, startedAt: Date, actorId: string | null) {
    const client = new S3Client(s3);
    const stem = runKeyStem(cfg.prefix, startedAt);
    const items: BackupItemRow[] = [];
    const errors: string[] = [];
    const save = (patch: Partial<typeof backupRun.$inferInsert> = {}) =>
      db
        .update(backupRun)
        .set({ items: [...items], ...patch })
        .where(eq(backupRun.id, id))
        .run();

    async function item(kind: BackupItemRow["kind"], name: string, key: string, produce: (f: string) => unknown) {
      const file = join(tmpDir, `${crypto.randomUUID()}.tmp`);
      try {
        await produce(file);
        const sizeBytes = Bun.file(file).size;
        await client.write(key, Bun.file(file));
        items.push({ kind, name, key, sizeBytes, ok: true, error: null });
      } catch (e) {
        const error = `${kind} ${name} -> ${key}: ${describe(e, s3)}`;
        log.warn(`[backup] run ${id} item failed: ${error}`);
        items.push({ kind, name, key, sizeBytes: null, ok: false, error });
      } finally {
        rmSync(file, { force: true });
      }
      save();
    }

    mkdirSync(tmpDir, { recursive: true });
    let names: string[] = [];
    try {
      names = (await system.postgres.listDatabases()).map((d) => d.name);
    } catch (e) {
      errors.push(`list databases: ${errMsg(e)}`);
    }
    for (const name of names) await item("database", name, `${stem}${name}.dump`, (f) => system.postgres.dump(name, f));
    await item("panel", "panel", `${stem}${PANEL_DB}`, (f) => db.$client.run("VACUUM INTO ?", [f]));

    const ok = items.filter((i) => i.ok).length;
    const status = ok === items.length && !errors.length ? "succeeded" : ok === 0 ? "failed" : "partial";
    let pruned = 0;
    if (status !== "failed") {
      try {
        pruned = await prune(client, cfg.prefix, startedAt.getTime() - cfg.retentionDays * MS_PER_DAY);
      } catch (e) {
        errors.push(`retention under ${cfg.prefix}: ${describe(e, s3)}`);
      }
    }
    const error = errors.length ? errors.join("; ") : null;
    save({ status, error, finishedAt: new Date() });
    const trigger = actorId ? "manual" : "schedule";
    recordAudit(db, { actorId, action: "backup.run", target: id, meta: { trigger, status, items: items.length } });
    log.info(`[backup] run ${id} ${status}: ${ok}/${items.length} items, pruned ${pruned}`);
  }

  /** Starts a run in the background; 400 `not_configured`, 409 `busy` while another run is in progress. */
  function start(trigger: BackupTrigger, actorId: string | null): { runId: string } {
    const cfg = config();
    if (!cfg.s3) throw new ApiError(400, "not_configured", `missing settings: ${cfg.missing.join(", ")}`);
    if (running) throw new ApiError(409, "busy", "a backup run is already in progress");
    const id = crypto.randomUUID();
    const startedAt = new Date();
    db.insert(backupRun).values({ id, trigger, status: "running", items: [], actorId, startedAt }).run();
    const s3 = cfg.s3;
    running = execute(id, s3, cfg, startedAt, actorId)
      .catch((e) => {
        log.error(`[backup] run ${id} crashed: ${describe(e, s3)}`);
        db.update(backupRun)
          .set({ status: "failed", error: describe(e, s3), finishedAt: new Date() })
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
    /** Resolves when the current run (if any) has finished. */
    idle: () => running ?? Promise.resolve(),

    status(now = new Date()): BackupStatus {
      const cfg = config();
      const last = db.select().from(backupRun).orderBy(desc(backupRun.startedAt)).limit(1).get();
      return {
        configured: cfg.s3 !== null,
        missing: cfg.missing,
        hourLocal: cfg.hour,
        nextRunAt: cfg.s3 && cfg.hour !== null ? nextRunAt(cfg.hour, now).toISOString() : null,
        retentionDays: cfg.retentionDays,
        running: running !== null,
        lastRun: last ? toRun(last) : null,
      };
    },

    list(paging: Paging): Page<BackupRun> {
      const rows = db
        .select()
        .from(backupRun)
        .orderBy(desc(backupRun.startedAt))
        .limit(paging.pageSize)
        .offset(paging.offset)
        .all();
      const total = db.select({ n: count() }).from(backupRun).get()?.n ?? 0;
      return { items: rows.map(toRun), total, page: paging.page, pageSize: paging.pageSize };
    },

    /** Presigned GET URL (15 min) of a successful item; audited. */
    downloadUrl(actorId: string, id: string, rawIndex: string): string {
      const row = getRow(id);
      if (!row) throw new ApiError(404, "not_found", `backup run ${id} not found`);
      const index = Number(rawIndex);
      const item = Number.isInteger(index) && index >= 0 ? row.items[index] : undefined;
      if (!item?.ok) throw new ApiError(404, "not_found", `backup run ${id} has no uploaded item ${rawIndex}`);
      const cfg = config();
      if (!cfg.s3) throw new ApiError(400, "not_configured", `missing settings: ${cfg.missing.join(", ")}`);
      const url = new S3Client(cfg.s3).presign(item.key, { expiresIn: PRESIGN_TTL_SEC, method: "GET" });
      recordAudit(db, { actorId, action: "backup.download", target: item.key, meta: { runId: id } });
      return url;
    },

    /** Daily schedule: re-reads settings every tick; never overlaps a run. Returns a stop function. */
    startScheduler(tickMs = SCHEDULER_TICK_MS, clock: () => Date = () => new Date()): () => void {
      let prev = clock();
      const timer = setInterval(() => {
        const now = clock();
        const since = prev;
        prev = now;
        try {
          const cfg = config();
          if (!isDue(cfg.hour, since, now)) return;
          if (!cfg.s3) return log.warn(`[backup] scheduled run skipped: missing ${cfg.missing.join(", ")}`);
          if (running) return log.warn("[backup] scheduled run skipped: a run is in progress");
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
