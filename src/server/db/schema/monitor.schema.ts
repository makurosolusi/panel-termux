import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ProblemCode, ProblemKind, ProblemParams, ProblemSeverity } from "../../../shared/monitor.types";
import type { BatteryStatus } from "../../../shared/panel.types";

// Monitoring history (PLAN/02 §3.4, 0008). Non-critical and bounded: the sampler prunes it hourly.
// Times are plain unix ms integers (bucket math in SQL), not Date columns.

/** One row per sampler tick; nullable sections so a failed probe never blocks the row. */
export const metricSample = sqliteTable("metric_sample", {
  at: integer("at").primaryKey(),
  batteryPct: integer("battery_pct"),
  batteryStatus: text("battery_status").$type<BatteryStatus>(),
  batteryTempC: real("battery_temp_c"),
  memAvailableMb: integer("mem_available_mb"),
  memTotalMb: integer("mem_total_mb"),
  diskFreeMb: integer("disk_free_mb"),
  load1: real("load1"),
  load5: real("load5"),
  problemsDanger: integer("problems_danger").notNull(),
  problemsWarning: integer("problems_warning").notNull(),
});

/**
 * One row per domain probe; `localStatus` only when the public probe failed.
 * The migration declares it WITHOUT ROWID (drizzle cannot express that): the composite PK is the table.
 */
export const checkResult = sqliteTable(
  "check_result",
  {
    hostname: text("hostname").notNull(),
    at: integer("at").notNull(),
    status: integer("status"),
    ms: integer("ms"),
    localStatus: integer("local_status"),
  },
  (t) => [primaryKey({ columns: [t.hostname, t.at] })],
);

/** Problem lifecycle = alert state. Open rows (`closedAt` null) survive restarts so alerts are not re-sent. */
export const problemEvent = sqliteTable(
  "problem_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** `code:target` */
    key: text("key").notNull(),
    code: text("code").$type<ProblemCode>().notNull(),
    kind: text("kind").$type<ProblemKind>().notNull(),
    target: text("target").notNull(),
    /** Highest severity seen while open. */
    severity: text("severity").$type<ProblemSeverity>().notNull(),
    /** Last seen params. */
    params: text("params", { mode: "json" }).$type<ProblemParams>().notNull(),
    openedAt: integer("opened_at").notNull(),
    /** Updated on change or at most every 10 min (bounds writes, detects gaps). */
    lastSeenAt: integer("last_seen_at").notNull(),
    closedAt: integer("closed_at"),
    /** What Telegram last heard; null = nothing sent. */
    notifiedState: text("notified_state").$type<"open" | "closed">(),
    notifiedSeverity: text("notified_severity").$type<ProblemSeverity>(),
    lastSentAt: integer("last_sent_at"),
  },
  (t) => [
    uniqueIndex("problem_event_open_key_idx").on(t.key).where(sql`closed_at IS NULL`),
    index("problem_event_key_closed_idx").on(t.key, t.closedAt),
  ],
);
