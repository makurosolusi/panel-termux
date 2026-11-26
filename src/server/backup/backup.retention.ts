import type { S3Client } from "bun";
import { eq } from "drizzle-orm";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { type BackupItemRow, backupRun } from "../db/schema";
import { log } from "../log.service";
import { describeS3Error, type S3Config, s3ErrorCode } from "./backup.config";

const MS_PER_DAY = 86_400_000;

/** A run as retention sees it, in insert (rowid) order. */
export type PruneRun = {
  id: string;
  status: string;
  startedAt: Date;
  items: Pick<BackupItemRow, "kind" | "name" | "key" | "ok" | "pruned">[];
};
/** Retention knobs (settings `backup.retention_days`, `keep_min_runs`, `include_secrets`). */
export type PruneOptions = { retentionDays: number; keepMinRuns: number; includeSecrets: boolean };
/** One object to delete. */
export type PruneCandidate = { runId: string; itemIndex: number; key: string };

const isIndex = (kind: string) => kind === "checksums" || kind === "manifest";

/**
 * Pure retention plan from backup_run records only, never a bucket listing (PLAN/04 K3, F3). `runs` must
 * be in insert order. Protected: the newest `keepMinRuns` succeeded runs and the newest good item per
 * (kind, name), except `secrets` items while include_secrets is off (those all go, regardless of age).
 * checksums/manifest of a run go only once everything else of that run is pruned or going.
 */
export function planPrune(runs: PruneRun[], opts: PruneOptions, now: Date): PruneCandidate[] {
  const live = runs.filter((r) => r.status !== "running");
  const protectedRuns = new Set(
    live
      .filter((r) => r.status === "succeeded")
      .slice(-opts.keepMinRuns)
      .map((r) => r.id),
  );
  const protectedItems = new Set<string>();
  const seen = new Set<string>();
  for (const r of [...live].reverse())
    r.items.forEach((i, idx) => {
      const id = `${i.kind}\0${i.name}`;
      if (!i.ok || i.pruned || isIndex(i.kind) || seen.has(id)) return;
      seen.add(id);
      if (i.kind !== "secrets" || opts.includeSecrets) protectedItems.add(`${r.id}#${idx}`);
    });

  const cutoff = now.getTime() - opts.retentionDays * MS_PER_DAY;
  const out: PruneCandidate[] = [];
  for (const r of live) {
    const old = r.startedAt.getTime() < cutoff && !protectedRuns.has(r.id);
    const picked = r.items.map((i, idx) => {
      if (!i.ok || i.pruned || isIndex(i.kind)) return false;
      if (i.kind === "secrets" && !opts.includeSecrets) return true;
      return old && !protectedItems.has(`${r.id}#${idx}`);
    });
    const restGone = r.items.every((i, idx) => isIndex(i.kind) || !i.ok || i.pruned || picked[idx]);
    r.items.forEach((i, idx) => {
      const index = old && restGone && isIndex(i.kind) && i.ok && !i.pruned;
      if (picked[idx] || index) out.push({ runId: r.id, itemIndex: idx, key: i.key });
    });
  }
  return out;
}

/** Counts of one prune pass (audit `backup.prune`). */
export type PruneResult = { deleted: number; failed: number; denied: number };

/**
 * Deletes the planned objects and marks them pruned. The first AccessDenied stops the pass (token without
 * delete right, K21) and flags the current run's manifest `retention_denied`. A run whose every good item
 * is pruned gets `pruned_at`.
 */
export async function applyPrune(
  db: Db,
  client: S3Client,
  s3: S3Config,
  plan: PruneCandidate[],
  currentRunId: string,
): Promise<PruneResult> {
  const res: PruneResult = { deleted: 0, failed: 0, denied: 0 };
  const done = new Map<string, number[]>();
  for (const c of plan) {
    try {
      await client.delete(c.key);
      res.deleted++;
      done.set(c.runId, [...(done.get(c.runId) ?? []), c.itemIndex]);
    } catch (e) {
      if (s3ErrorCode(e) === "AccessDenied") {
        res.denied++;
        break;
      }
      res.failed++;
      log.warn(`[backup] prune ${c.key} failed: ${describeS3Error(e, s3)}`);
    }
  }
  for (const [runId, idxs] of done) {
    const row = db.select().from(backupRun).where(eq(backupRun.id, runId)).get();
    if (!row) continue;
    const items = row.items.map((i, idx) => (idxs.includes(idx) ? { ...i, pruned: true } : i));
    const allGone = items.every((i) => !i.ok || i.pruned);
    db.update(backupRun)
      .set({ items, prunedAt: allGone ? new Date() : row.prunedAt })
      .where(eq(backupRun.id, runId))
      .run();
  }
  if (res.denied) {
    const row = db.select().from(backupRun).where(eq(backupRun.id, currentRunId)).get();
    if (row) {
      const items = row.items.map((i) => (i.kind === "manifest" ? { ...i, warning: "retention_denied" as const } : i));
      db.update(backupRun).set({ items }).where(eq(backupRun.id, currentRunId)).run();
    }
  }
  if (res.deleted || res.failed || res.denied)
    recordAudit(db, { actorId: null, action: "backup.prune", target: currentRunId, meta: { ...res } });
  return res;
}
