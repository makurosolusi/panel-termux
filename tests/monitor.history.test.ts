import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAlertEngine, type NewEventRow } from "@/server/alerts/alert.engine";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as h from "@/server/monitor/monitor.history";
import { problem } from "@/server/panel/overview.rules";

const root = mkdtempSync(join(tmpdir(), "panel-monitor-history-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshDb = (): Db => {
  const dir = join(root, String(n++));
  mkdirSync(dir);
  const db = openDb(dir);
  expect(runMigrations(db)).toBe("0008_monitor");
  return db;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-20T00:00:00Z"); // test-only fixed clock
const sample = (at: number, load5: number | null = 1, batteryPct = 80): h.MetricSampleRow => ({
  at,
  batteryPct,
  load5,
  problemsDanger: 0,
  problemsWarning: 0,
});
const event = (key: string, o: Partial<NewEventRow> = {}): NewEventRow => {
  const [code, target] = key.split(":") as [NewEventRow["code"], string];
  return {
    ...{ key, code, kind: "service", target, severity: "danger", params: {}, openedAt: T0, lastSeenAt: T0 },
    ...{ closedAt: null, notifiedState: null, notifiedSeverity: null, lastSentAt: null },
    ...o,
  };
};

describe("monitor history", () => {
  test("tick writes, per-host reads and the boot seed query", () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++)
      h.insertTick(db, sample(T0 + i * MIN), [
        { hostname: "a.test", at: T0 + i * MIN, status: i < 2 ? 200 : null, ms: 10, localStatus: i < 2 ? null : 502 },
        { hostname: "b.test", at: T0 + i * MIN, status: 200, ms: 20, localStatus: null },
      ]);
    h.insertTick(db, sample(T0), []); // same tick twice is ignored, not an error
    expect(h.recentChecks(db, T0 + 3 * MIN)).toHaveLength(4);
    expect(h.hostChecks(db, "a.test", 2)).toEqual([
      { at: T0 + 3 * MIN, status: null },
      { at: T0 + 4 * MIN, status: null },
    ]);
    const seed = h.lastChecksPerHost(db, 3);
    expect(seed).toHaveLength(6);
    expect(seed.filter((c) => c.hostname === "a.test").map((c) => c.localStatus)).toEqual([502, 502, 502]);
    expect(seed.map((c) => c.at)).toEqual([...seed.map((c) => c.at)].sort((x, y) => x - y));
  });

  test("metricSeries downsamples on read to at most 100 bucket averages", () => {
    const db = freshDb();
    const now = T0 + 7 * DAY;
    for (let t = now - 7 * DAY + MIN; t <= now; t += 10 * MIN) h.insertTick(db, sample(t, 2, 50), []);
    h.insertTick(db, sample(now - 30 * MIN, 4, 70), []);
    const week = h.metricSeries(db, "7d", now);
    expect(week.bucketSec).toBe(7200);
    expect(week.points.length).toBeLessThanOrEqual(100);
    expect(week.points.length).toBeGreaterThan(80);
    const day = h.metricSeries(db, "24h", now);
    expect(day.points.length).toBeLessThanOrEqual(100);
    const lifted = day.points.filter((p) => (p.load5 ?? 0) > 2); // the 4.0 sample lifts only its bucket's average
    expect(lifted).toHaveLength(1);
    expect(lifted[0]?.load5).toBe(2.67); // (2 + 2 + 4) / 3, rounded to 2 digits
    expect(Date.parse(day.points[0]?.at ?? "")).toBeGreaterThanOrEqual(now - DAY - 900_000);
  });

  test("loadBaseline is null below 24 h of samples, then p10/p50/p90 of load5", () => {
    const db = freshDb();
    for (let i = 0; i < 20; i++) h.insertTick(db, sample(T0 + i * HOUR, i + 1), []);
    expect(h.loadBaseline(db, T0 + 20 * HOUR)).toBeNull();
    for (let i = 20; i <= 100; i++) h.insertTick(db, sample(T0 + i * HOUR, i + 1), []);
    h.insertTick(db, sample(T0 + 101 * HOUR, null), []); // missing load is skipped
    const b = h.loadBaseline(db, T0 + 101 * HOUR);
    expect(b).toEqual({ p10: 11, p50: 51, p90: 91, spanHours: 100 });
  });

  test("alert store over problem_event: unique open key, reopen, closedSince", () => {
    const db = freshDb();
    const store = h.createAlertStore(db);
    const id = store.insert(event("service_down:sshd", { params: { state: "down" } }));
    expect(() => store.insert(event("service_down:sshd"))).toThrow();
    expect(store.openEvents()).toMatchObject([{ id, params: { state: "down" } }]);
    store.update(id, { closedAt: T0 + MIN });
    expect(store.openEvents()).toEqual([]);
    expect(store.closedSince(T0)).toMatchObject([{ id }]);
    expect(store.closedSince(T0 + 2 * MIN)).toEqual([]);
    store.insert(event("service_down:sshd"));
    expect(store.openEvents()).toHaveLength(1);
  });

  test("the alert engine runs on the real store: open, close after 2 ticks, notices stored closed", async () => {
    const db = freshDb();
    const sent: string[] = [];
    const engine = createAlertEngine({ store: h.createAlertStore(db), send: async (t) => void sent.push(t) });
    const p = problem("service_down", "postgres", "danger", { state: "down", downSec: 5 });
    const empty = { problems: [], suppressed: [], unknownKinds: new Set<never>() };
    const shown = engine.reconcile({ ...empty, problems: [p] }, T0);
    expect(shown[0]?.since).toBe(new Date(T0).toISOString());
    engine.reconcile(empty, T0 + MIN);
    expect(h.createAlertStore(db).openEvents()).toHaveLength(1);
    engine.reconcile(empty, T0 + 2 * MIN);
    expect(h.createAlertStore(db).openEvents()).toHaveLength(0);
    engine.recordNotices([problem("host_rebooted", "host", "warning", { uptimeMin: 3 })], T0);
    expect(h.historyPage(db, { page: 1, pageSize: 20, offset: 0 }).items.map((e) => e.code)).toEqual(["service_down"]);
  });

  test("historyPage: newest first, paginated, without notices and info", () => {
    const db = freshDb();
    const store = h.createAlertStore(db);
    for (let i = 0; i < 5; i++) store.insert(event(`service_down:s${i}`, { openedAt: T0 + i * MIN }));
    store.insert(event("host_rebooted:host", { kind: "host", closedAt: T0 }));
    store.insert(event("backup_not_configured:backup", { kind: "backup", severity: "info" }));
    const page = h.historyPage(db, { page: 2, pageSize: 2, offset: 2 });
    expect(page.total).toBe(5);
    expect(page.items.map((e) => e.target)).toEqual(["s2", "s1"]);
    expect(page.items[0]).toMatchObject({
      closedAt: null,
      notified: false,
      openedAt: new Date(T0 + 2 * MIN).toISOString(),
    });
  });

  test("pruneHistory: samples/checks > 7 days, closed events > 30 days; open events stay", () => {
    const db = freshDb();
    const now = T0 + 40 * DAY;
    h.insertTick(db, sample(now - 8 * DAY), [
      { hostname: "a", at: now - 8 * DAY, status: 200, ms: 1, localStatus: null },
    ]);
    h.insertTick(db, sample(now - 6 * DAY), [
      { hostname: "a", at: now - 6 * DAY, status: 200, ms: 1, localStatus: null },
    ]);
    const store = h.createAlertStore(db);
    store.insert(event("service_down:old", { closedAt: now - 31 * DAY }));
    store.insert(event("service_down:recent", { closedAt: now - 29 * DAY }));
    store.insert(event("service_down:open", { openedAt: now - 39 * DAY }));
    h.pruneHistory(db, now);
    expect(h.recentChecks(db, 0).map((c) => c.at)).toEqual([now - 6 * DAY]);
    expect(h.metricSeries(db, "7d", now).points).toHaveLength(1);
    const left = h.historyPage(db, { page: 1, pageSize: 20, offset: 0 }).items.map((e) => e.target);
    expect(left.sort()).toEqual(["open", "recent"]);
  });
});
