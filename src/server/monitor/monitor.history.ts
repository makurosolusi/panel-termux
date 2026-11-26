// Monitoring history repository (PLAN/02 §3.4, K25): metric_sample / check_result / problem_event over Drizzle.
// Writes happen in the sampler's tick transaction; downsampling happens only on read.
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import type { Page } from "../../shared/dev.types";
import type { LoadBaseline, MetricRange, MetricSeries, Problem, ProblemEvent } from "../../shared/monitor.types";
import type { DeviceInfo } from "../../shared/panel.types";
import type { AlertStore, EventRow } from "../alerts/alert.engine";
import type { Db } from "../db/client";
import { checkResult, metricSample, problemEvent } from "../db/schema";
import type { Paging } from "../routes/http.error";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** metric_sample and check_result older than this are pruned. */
export const HISTORY_RETENTION_MS = 7 * DAY;
/** Closed problem_event rows older than this are pruned. */
export const EVENT_RETENTION_MS = 30 * DAY;
/** loadBaseline stays null until the samples span at least this long (K6). */
export const BASELINE_MIN_SPAN_MS = DAY;
/** Bucket width per range so a series has at most 100 points (24 h → 96, 7 d → 84). */
export const METRIC_BUCKET_SEC: Record<MetricRange, number> = { "24h": 900, "7d": 7200 };
const RANGE_MS: Record<MetricRange, number> = { "24h": DAY, "7d": 7 * DAY };

/** One metric_sample row. */
export type MetricSampleRow = typeof metricSample.$inferInsert;
/** One check_result row. */
export type CheckRow = typeof checkResult.$inferInsert;

const MB = 1024 * 1024;

/** The metric_sample row of one tick (device null = section unavailable; info problems are not counted). */
export function tickSample(d: DeviceInfo | null, problems: Problem[], at: number): MetricSampleRow {
  const count = (sev: Problem["severity"]) => problems.filter((p) => p.severity === sev).length;
  return {
    at,
    batteryPct: d?.battery?.percent ?? null,
    batteryStatus: d?.battery?.status ?? null,
    batteryTempC: d?.battery?.temperatureC ?? null,
    memAvailableMb: d?.memory.availableMb ?? null,
    memTotalMb: d?.memory.totalMb ?? null,
    diskFreeMb: d ? Math.round(d.disk.freeBytes / MB) : null,
    load1: d?.load[0] ?? null,
    load5: d?.load[1] ?? null,
    problemsDanger: count("danger"),
    problemsWarning: count("warning"),
  };
}

/** Writes one tick: its metric sample and its domain checks (call inside the tick transaction). */
export function insertTick(db: Db, sample: MetricSampleRow, checks: CheckRow[]): void {
  db.insert(metricSample).values(sample).onConflictDoNothing().run();
  if (checks.length) db.insert(checkResult).values(checks).onConflictDoNothing().run();
}

/** Stores one manual domain check. */
export function insertCheck(db: Db, check: CheckRow): void {
  db.insert(checkResult).values(check).onConflictDoNothing().run();
}

/** All hosts' checks since `sinceMs`, oldest first (one query, no N+1). */
export function recentChecks(db: Db, sinceMs: number) {
  return db.select().from(checkResult).where(gte(checkResult.at, sinceMs)).orderBy(asc(checkResult.at)).all();
}

/** The newest `limit` checks of one host, oldest first (the PK index serves it). */
export function hostChecks(db: Db, hostname: string, limit: number) {
  const rows = db
    .select({ at: checkResult.at, status: checkResult.status })
    .from(checkResult)
    .where(eq(checkResult.hostname, hostname))
    .orderBy(desc(checkResult.at))
    .limit(limit)
    .all();
  return rows.reverse();
}

/** The newest `n` checks per host, oldest first (seeds the failure streaks at boot). */
export function lastChecksPerHost(db: Db, n: number) {
  return db.$client
    .query(
      `SELECT hostname, at, status, ms, local_status AS localStatus FROM (SELECT hostname, at, status, ms, local_status,
         ROW_NUMBER() OVER (PARTITION BY hostname ORDER BY at DESC) AS rn FROM check_result) WHERE rn <= ? ORDER BY at`,
    )
    .all(n) as { hostname: string; at: number; status: number | null; ms: number | null; localStatus: number | null }[];
}

/** Bucket averages of the range ending at `now`, oldest first, ≤ 100 points. */
export function metricSeries(db: Db, range: MetricRange, now: number): MetricSeries {
  const bucketSec = METRIC_BUCKET_SEC[range];
  const bucketMs = bucketSec * 1000;
  const bucket = sql<number>`(${metricSample.at} / ${bucketMs}) * ${bucketMs}`;
  const rows = db
    .select({
      at: bucket,
      batteryPct: sql<number | null>`avg(${metricSample.batteryPct})`,
      memAvailableMb: sql<number | null>`avg(${metricSample.memAvailableMb})`,
      diskFreeMb: sql<number | null>`avg(${metricSample.diskFreeMb})`,
      load5: sql<number | null>`avg(${metricSample.load5})`,
    })
    .from(metricSample)
    .where(gte(metricSample.at, now - RANGE_MS[range]))
    .groupBy(bucket)
    .orderBy(asc(bucket))
    .all();
  const round = (v: number | null, digits = 0) => (v === null ? null : Number(v.toFixed(digits)));
  const points = rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    batteryPct: round(r.batteryPct),
    memAvailableMb: round(r.memAvailableMb),
    diskFreeMb: round(r.diskFreeMb),
    load5: round(r.load5, 2),
  }));
  return { range, bucketSec, points };
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;

/** p10/p50/p90 of load5 over the last 7 days; null until the samples span ≥ 24 h (K6, display only). */
export function loadBaseline(db: Db, now: number): LoadBaseline | null {
  const values = db
    .select({ at: metricSample.at, load5: metricSample.load5 })
    .from(metricSample)
    .where(and(gte(metricSample.at, now - HISTORY_RETENTION_MS), isNotNull(metricSample.load5)))
    .orderBy(asc(metricSample.at))
    .all();
  const first = values[0];
  const last = values.at(-1);
  if (!first || !last || last.at - first.at < BASELINE_MIN_SPAN_MS) return null;
  const sorted = values.map((v) => v.load5 as number).sort((a, b) => a - b);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    p10: r(percentile(sorted, 0.1)),
    p50: r(percentile(sorted, 0.5)),
    p90: r(percentile(sorted, 0.9)),
    spanHours: Math.floor((last.at - first.at) / HOUR),
  };
}

// History lists real problems only: notices (kind host) and info rows never open events, but stay defensive.
const historyWhere = and(ne(problemEvent.kind, "host"), ne(problemEvent.severity, "info"));

/** GET /panel/problems/history: problem events newest first (no notices, no info). */
export function historyPage(db: Db, paging: Paging): Page<ProblemEvent> {
  const rows = db
    .select()
    .from(problemEvent)
    .where(historyWhere)
    .orderBy(desc(problemEvent.openedAt), desc(problemEvent.id))
    .limit(paging.pageSize)
    .offset(paging.offset)
    .all();
  const total = db.select({ n: count() }).from(problemEvent).where(historyWhere).get()?.n ?? 0;
  const items = rows.map((e) => ({
    id: e.id,
    code: e.code,
    kind: e.kind,
    target: e.target,
    severity: e.severity,
    params: e.params,
    openedAt: new Date(e.openedAt).toISOString(),
    closedAt: e.closedAt === null ? null : new Date(e.closedAt).toISOString(),
    notified: e.notifiedState !== null,
  }));
  return { items, total, page: paging.page, pageSize: paging.pageSize };
}

/** problem_event store of the alert engine. */
export function createAlertStore(db: Db): AlertStore {
  return {
    openEvents: (): EventRow[] => db.select().from(problemEvent).where(isNull(problemEvent.closedAt)).all(),
    closedSince: (sinceMs) => db.select().from(problemEvent).where(gte(problemEvent.closedAt, sinceMs)).all(),
    insert: (row) => db.insert(problemEvent).values(row).returning({ id: problemEvent.id }).get().id,
    update(id, patch) {
      db.update(problemEvent).set(patch).where(eq(problemEvent.id, id)).run();
    },
  };
}

/** Retention (one transaction): samples/checks > 7 days, closed events > 30 days. No VACUUM (pages are reused). */
export function pruneHistory(db: Db, now: number): void {
  db.transaction((tx) => {
    tx.delete(metricSample)
      .where(lt(metricSample.at, now - HISTORY_RETENTION_MS))
      .run();
    tx.delete(checkResult)
      .where(lt(checkResult.at, now - HISTORY_RETENTION_MS))
      .run();
    tx.delete(problemEvent)
      .where(lt(problemEvent.closedAt, now - EVENT_RETENTION_MS))
      .run();
  });
}
