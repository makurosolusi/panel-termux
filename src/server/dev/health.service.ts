import { statfsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import { count, eq, gt } from "drizzle-orm";
import pkg from "../../../package.json" with { type: "json" };
import type { DevHealth, HealthStatus, PanelCheck } from "../../shared/dev.types";
import type { PanelMode, Problem } from "../../shared/panel.types";
import type { BackupService } from "../backup/backup.service";
import { backupScheduler } from "../backup/backup.service";
import type { Db } from "../db/client";
import { appMeta, session, user } from "../db/schema";
import { requestStats } from "../http/request.log";
import { readLogs } from "../log.service";
import type { Monitor } from "../monitor/monitor.contract";
import { KeyMismatchError } from "../settings.service";
import type { JobRunner } from "../sites/job.runner";
import type { SystemAdapters } from "../system/system.types";

const MB = 1024 * 1024;
const MINUTE_MS = 60_000;
/** Process start time (ms since epoch), fixed at module load. */
const STARTED_AT = Date.now() - process.uptime() * 1000;

/** Problem codes shown as information only: they never lower the verdict (DECISIONS B4). */
export const INFO_CODES: readonly string[] = ["backup_not_configured", "access_not_seen"];
/** 500 responses in 5 min from which the `errors` check warns (K8). */
export const ERRORS_WARN_AT = 3;
/** 500 responses in 5 min from which the `errors` check fails (K8). */
export const ERRORS_FAIL_AT = 10;
/** The sampler counts as late after max(SAMPLER_LATE_TICKS × interval, SAMPLER_LATE_MIN_MS). */
export const SAMPLER_LATE_TICKS = 3;
/** Lower bound of the sampler lateness limit. */
export const SAMPLER_LATE_MIN_MS = 10 * MINUTE_MS;
/** The backup scheduler ticks every minute; older than this = timer held back (e.g. Doze). */
export const BACKUP_TICK_LATE_MS = 10 * MINUTE_MS;
const LAST_ERRORS = 5;

/** What /dev/health reads. Narrow picks of the boot-time services, so tests can pass small stubs. */
export type HealthDeps = {
  db: Db;
  appBaseUrl: string;
  system: Pick<SystemAdapters, "mode">;
  monitor: Pick<Monitor, "status" | "problems">;
  backup: Pick<BackupService, "status">;
  jobs: Pick<JobRunner, "active">;
};

/** Inputs of the panel-only checks (pure, K8). Times are epoch ms. */
export type PanelCheckInput = {
  now: number;
  uptimeSec: number;
  unhandled5m: number;
  sampledAt: string | null;
  intervalSec: number;
  backupTickAt: Date | null;
  mode: PanelMode;
  appBaseUrl: string;
};

const minutesSince = (now: number, at: number | null) => (at === null ? null : Math.floor((now - at) / MINUTE_MS));

/** "ok" when `at` is within `limitMs`, or the process is younger than that (nothing could have run yet). */
const freshness = (now: number, uptimeMs: number, at: number | null, limitMs: number): HealthStatus =>
  (at !== null && now - at <= limitMs) || uptimeMs < limitMs ? "ok" : "warn";

/** The four panel checks of §3.4: 500s, sampler, backup scheduler, fake mode on a public https base. */
export function panelChecks(i: PanelCheckInput): PanelCheck[] {
  const uptimeMs = i.uptimeSec * 1000;
  const sampled = i.sampledAt === null ? null : Date.parse(i.sampledAt);
  const tick = i.backupTickAt?.getTime() ?? null;
  const samplerLimit = Math.max(SAMPLER_LATE_TICKS * i.intervalSec * 1000, SAMPLER_LATE_MIN_MS);
  const n = i.unhandled5m;
  return [
    { key: "errors", status: n >= ERRORS_FAIL_AT ? "fail" : n >= ERRORS_WARN_AT ? "warn" : "ok", value: n },
    { key: "sampler", status: freshness(i.now, uptimeMs, sampled, samplerLimit), value: minutesSince(i.now, sampled) },
    {
      key: "backup_scheduler",
      status: freshness(i.now, uptimeMs, tick, BACKUP_TICK_LATE_MS),
      value: minutesSince(i.now, tick),
    },
    {
      key: "fake_on_https",
      status: i.mode === "fake" && i.appBaseUrl.startsWith("https://") ? "fail" : "ok",
      value: i.mode,
    },
  ];
}

const RANK: Record<HealthStatus, number> = { ok: 0, warn: 1, fail: 2 };

/** Worst of the checks and of the problems without info codes (danger → fail, warning → warn). */
export function verdictOf(problems: Problem[], checks: PanelCheck[]): HealthStatus {
  const fromProblems = problems
    .filter((p) => !INFO_CODES.includes(p.code ?? ""))
    .map((p): HealthStatus => (p.severity === "danger" ? "fail" : p.severity === "warning" ? "warn" : "ok"));
  return [...fromProblems, ...checks.map((c) => c.status)].reduce<HealthStatus>(
    (worst, s) => (RANK[s] > RANK[worst] ? s : worst),
    "ok",
  );
}

/** Backup summary; null when the data key cannot read the backup settings (never a 500, F7.4). */
function backupSummary(backup: HealthDeps["backup"]): DevHealth["backup"] {
  try {
    const s = backup.status();
    return s.keyMismatch ? null : { configured: s.configured, nextRunAt: s.nextRunAt };
  } catch (e) {
    if (e instanceof KeyMismatchError) return null;
    throw new Error(`dev health: backup status failed: ${(e as Error).message}`, { cause: e });
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** GET /api/dev/health: server-side verdict (problems + panel checks) plus process, DB and data-dir details. */
export function getHealth(deps: HealthDeps, now = Date.now()): DevHealth {
  const { db } = deps;
  const mem = process.memoryUsage();
  // The data dir is where panel.db lives (openDb), so no separate path is needed.
  const fs = statfsSync(dirname(db.$client.filename));
  // page_count * page_size = main DB file size (WAL excluded; it is checkpointed back regularly).
  const dbSize = db.$client
    .query<{ n: number }, []>("select page_count * page_size as n from pragma_page_count, pragma_page_size")
    .get();
  const schemaVersion = db.select({ v: appMeta.value }).from(appMeta).where(eq(appMeta.key, "schema_version")).get()?.v;
  const stats = requestStats(now);
  const mon = deps.monitor.status();
  const problems = deps.monitor.problems().problems;
  const backupTick = backupScheduler.lastTickAt();
  const uptimeSec = Math.floor(process.uptime());
  const checks = panelChecks({
    now,
    uptimeSec,
    unhandled5m: stats.unhandled5m,
    sampledAt: mon.sampledAt,
    intervalSec: mon.intervalSec,
    backupTickAt: backupTick,
    mode: deps.system.mode,
    appBaseUrl: deps.appBaseUrl,
  });
  return {
    verdict: verdictOf(problems, checks),
    checkedAt: new Date(now).toISOString(),
    problems,
    infoCodes: problems.map((p) => p.code ?? "").filter((c) => INFO_CODES.includes(c)),
    checks,
    mode: deps.system.mode,
    sampledAt: mon.sampledAt,
    backupTickAt: backupTick?.toISOString() ?? null,
    version: pkg.version,
    schemaVersion: schemaVersion ?? "none",
    startedAt: new Date(STARTED_AT).toISOString(),
    uptimeSec,
    memory: { rssMb: round1(mem.rss / MB), heapUsedMb: round1(mem.heapUsed / MB) },
    db: { sizeBytes: dbSize?.n ?? 0 },
    dataDir: { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize },
    runtime: { bun: Bun.version, node: process.versions.node, platform: process.platform, arch: process.arch },
    cpuCores: availableParallelism(),
    ...stats,
    counts: {
      users: db.select({ n: count() }).from(user).get()?.n ?? 0,
      sessions:
        db
          .select({ n: count() })
          .from(session)
          .where(gt(session.expiresAt, new Date(now)))
          .get()?.n ?? 0,
    },
    runningJob: deps.jobs.active(),
    backup: backupSummary(deps.backup),
    lastErrors: readLogs({ level: "error", limit: LAST_ERRORS }),
  };
}
