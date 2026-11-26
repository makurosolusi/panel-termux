// Demo history rows (PLAN/05 W3): backup runs + restore tests keyed like real runs, closed problems, a week of
// metric samples and domain checks that agree with the fake HOME (demo-seed.sandbox.ts).
import { createHash } from "node:crypto";
import pkg from "../package.json" with { type: "json" };
import { runKeyStem } from "../src/server/backup/backup.config";
import { itemFile } from "../src/server/backup/backup.manifest";
import type { Db } from "../src/server/db/client";
import type { BackupItemRow } from "../src/server/db/schema";
import * as t from "../src/server/db/schema";
import { DEMO_BATTERY, DEMO_HOSTS, writeDemoObject } from "./demo-seed.sandbox";

/** Transaction handle the seed writes with. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SAMPLE_EVERY_MS = 10 * MINUTE;
const HISTORY_SPAN_MS = 7 * 24 * HOUR - HOUR; // inside the 7-day history retention

const DEMO_PREFIX = "panel-termux/"; // = backup.prefix default
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * 5 backup runs (succeeded/failed/partial) with items named and keyed like a real run, and 3 restore tests. Every
 * uploaded item also exists in the fake S3 bucket (database items as fake dumps), so download and restore work.
 */
export function seedBackups(tx: Tx, dataDir: string, ago: (h: number) => Date): void {
  const item = (
    kind: BackupItemRow["kind"],
    name: string,
    at: Date,
    good: boolean,
    errorCode: BackupItemRow["errorCode"],
  ): BackupItemRow => {
    const key = `${runKeyStem(DEMO_PREFIX, at)}${itemFile(kind, name)}`;
    const body = kind === "database" ? `PGDMP fake dump of ${name}\n` : `demo ${kind} backup\n`;
    if (good) writeDemoObject(dataDir, key, body);
    return {
      kind,
      name,
      key,
      sizeBytes: good ? 2_400_000 + name.length * 91_000 : null,
      ok: good,
      error: good ? null : "demo failure",
      errorCode: good ? null : errorCode,
      sha256: good ? sha256(body) : null,
      checked: good,
    };
  };
  // [id, trigger, status, hours ago]
  const runs = [
    ["bk-demo-1", "schedule", "succeeded", 148],
    ["bk-demo-2", "schedule", "succeeded", 124],
    ["bk-demo-3", "schedule", "failed", 100],
    ["bk-demo-4", "manual", "partial", 52],
    ["bk-demo-5", "schedule", "succeeded", 4],
  ] as const;
  for (const [id, trigger, status, h] of runs) {
    const rest = status !== "failed";
    const at = ago(h);
    const items = [
      item("globals", "globals", at, rest, "upload_failed"),
      ...["adminneo", "solusi"].map((db) => item("database", db, at, rest, "upload_failed")),
      item("database", "toko_kopi", at, status === "succeeded", rest ? "produce_failed" : "upload_failed"),
      item("sites", "sites", at, rest, "upload_failed"),
      item("cloudflared", "cloudflared", at, rest, "upload_failed"),
      item("panel", "panel", at, rest, "upload_failed"),
    ];
    tx.insert(t.backupRun)
      .values({
        id,
        trigger,
        status,
        items,
        error: rest ? null : "upload_failed",
        actorId: trigger === "manual" ? "demo-super" : null,
        startedAt: at,
        finishedAt: new Date(at.getTime() + 4 * MINUTE),
        includesSecrets: false,
        panelVersion: pkg.version,
      })
      .run();
  }
  // [id, run, target db, status, actor, hours ago, dropped hours ago]
  const restores = [
    ["rs-demo-1", "bk-demo-2", "toko_kopi_uji_1", "succeeded", "demo-super", 120, 118],
    ["rs-demo-2", "bk-demo-5", "toko_kopi_uji_2", "succeeded", "demo-super", 3, null],
    ["rs-demo-3", "bk-demo-1", "toko_kopi_uji_3", "failed", "demo-admin", 140, null],
  ] as const;
  for (const [id, runId, targetDb, status, actorId, h, dropped] of restores)
    tx.insert(t.backupRestore)
      .values({
        id,
        runId,
        itemIndex: 3, // the toko_kopi database item
        sourceName: "toko_kopi",
        targetDb,
        status,
        actorId,
        startedAt: ago(h),
        finishedAt: ago(h - 0.1),
        tableCount: status === "succeeded" ? 12 : null,
        error: status === "failed" ? "pg_restore exited with 1" : null,
        errorCode: status === "failed" ? ("restore_failed" as const) : null,
        droppedAt: dropped === null ? null : ago(dropped),
      })
      .run();
}

const DRAIN_HOURS = 6;
const DRAIN_START_PCT = 58;
const OLD_FAILING_MS = 26 * HOUR;

/** Closed problems; 7 days of metric samples and checks of the demo ingress hosts. */
export function seedMonitor(tx: Tx, now: number): void {
  // [code, kind, target, severity, params, opened h ago, closed h ago]
  const events = [
    ["domain_unreachable", "domain", "old.contoh.test", "danger", { failures: 3 }, 150, 149],
    ["app_errored", "app", "kasir-lama", "danger", { restarts: 15 }, 130, 128],
    ["backup_failed", "backup", "backup", "danger", {}, 100, 76],
    ["battery_hot", "battery", "battery", "warning", { temperatureC: 43.5 }, 70, 69.5],
    ["disk_low", "disk", "disk", "warning", { freePct: 9 }, 40, 30],
    ["internet_down", "network", "internet", "danger", { domains: 3 }, 26, 25.8],
    ["site_job_failed", "site", "toko-kopi", "danger", { jobId: "job-demo-04" }, 48, 47],
  ] as const;
  tx.insert(t.problemEvent)
    .values(
      events.map(([code, kind, target, severity, params, from, to]) => ({
        key: `${code}:${target}`,
        code,
        kind,
        target,
        severity,
        params,
        openedAt: now - from * HOUR,
        lastSeenAt: now - to * HOUR,
        closedAt: now - to * HOUR,
        notifiedState: "closed" as const,
        notifiedSeverity: severity,
        lastSentAt: now - to * HOUR,
      })),
    )
    .run();
  const samples: (typeof t.metricSample.$inferInsert)[] = [];
  const checks: (typeof t.checkResult.$inferInsert)[] = [];
  for (let at = now - HISTORY_SPAN_MS, i = 0; at < now; at += SAMPLE_EVERY_MS, i++) {
    const w = Math.sin(i / 24);
    // The last DRAIN_HOURS unplugged: the battery runs down to the live 22 % (DEMO_BATTERY).
    const drainH = (now - at) / HOUR;
    const draining = drainH < DRAIN_HOURS;
    samples.push({
      at,
      batteryPct: draining
        ? Math.round(DEMO_BATTERY.percent + (DRAIN_START_PCT - DEMO_BATTERY.percent) * (drainH / DRAIN_HOURS))
        : Math.round(70 + 25 * Math.sin(i / 40)),
      batteryStatus: draining || i % 80 >= 40 ? "discharging" : "charging",
      batteryTempC: 31 + 4 * w,
      memAvailableMb: Math.round(3_800 + 900 * w),
      memTotalMb: 11_776,
      diskFreeMb: 186_000 - i * 4,
      load1: 18 + 4 * w,
      load5: 19 + 3 * w,
      problemsDanger: i % 90 === 0 ? 1 : 0,
      problemsWarning: i % 50 < 3 ? 1 : 0,
    });
    // old.contoh.test answers 502 since kasir-lama errored (the live fake probe says the same).
    for (const hostname of DEMO_HOSTS)
      checks.push({
        hostname,
        at,
        status: hostname.startsWith("old.") && now - at < OLD_FAILING_MS ? 502 : 200,
        ms: 40 + (i % 9) * 12,
        localStatus: null,
      });
  }
  tx.insert(t.metricSample).values(samples).run();
  tx.insert(t.checkResult).values(checks).run();
}
