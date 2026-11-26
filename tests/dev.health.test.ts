import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getHealth, type HealthDeps, type PanelCheckInput, panelChecks, verdictOf } from "@/server/dev/health.service";
import { logRequest } from "@/server/http/request.log";
import { log } from "@/server/log.service";
import { KeyMismatchError } from "@/server/settings.service";
import type { HealthStatus, PanelCheck } from "@/shared/dev.types";
import type { Problem } from "@/shared/monitor.types";

const MIN = 60_000;
const NOW = Date.parse("2026-11-27T10:00:00Z");
// test-only: an hour of uptime, so freshness is judged by timestamps
const base: PanelCheckInput = {
  now: NOW,
  uptimeSec: 3600,
  unhandled5m: 0,
  sampledAt: new Date(NOW - MIN).toISOString(),
  intervalSec: 60,
  backupTickAt: new Date(NOW - MIN),
  mode: "termux",
  appBaseUrl: "https://panel.example.test",
};
const statusOf = (key: PanelCheck["key"], over: Partial<PanelCheckInput>): HealthStatus | undefined =>
  panelChecks({ ...base, ...over }).find((c) => c.key === key)?.status;
const problem = (code: string, severity: Problem["severity"]): Problem =>
  ({ code, kind: "backup", target: "x", severity }) as Problem;

describe("panelChecks", () => {
  test("errors: 0/3/10 unhandled 500s → ok/warn/fail", () => {
    expect([0, 2, 3, 9, 10].map((n) => statusOf("errors", { unhandled5m: n }))).toEqual([
      "ok",
      "ok",
      "warn",
      "warn",
      "fail",
    ]);
  });
  test("sampler: late after max(3 × interval, 10 min); missing sample ok while young", () => {
    expect(statusOf("sampler", { sampledAt: new Date(NOW - 9 * MIN).toISOString() })).toBe("ok");
    expect(statusOf("sampler", { sampledAt: new Date(NOW - 11 * MIN).toISOString() })).toBe("warn");
    // interval 5 min → limit 15 min
    expect(statusOf("sampler", { intervalSec: 300, sampledAt: new Date(NOW - 14 * MIN).toISOString() })).toBe("ok");
    expect(statusOf("sampler", { sampledAt: null, uptimeSec: 30 })).toBe("ok");
    expect(statusOf("sampler", { sampledAt: null })).toBe("warn");
    expect(panelChecks({ ...base, sampledAt: new Date(NOW - 11 * MIN).toISOString() })[1]?.value).toBe(11);
  });
  test("backup_scheduler: tick older than 10 min → warn, unless uptime is shorter", () => {
    expect(statusOf("backup_scheduler", { backupTickAt: new Date(NOW - 11 * MIN) })).toBe("warn");
    expect(statusOf("backup_scheduler", { backupTickAt: null, uptimeSec: 60 })).toBe("ok");
    expect(statusOf("backup_scheduler", { backupTickAt: null })).toBe("warn");
  });
  test("fake_on_https: fake + https fails, fake + http and termux pass", () => {
    expect(statusOf("fake_on_https", { mode: "fake" })).toBe("fail");
    expect(statusOf("fake_on_https", { mode: "fake", appBaseUrl: "http://localhost:3200" })).toBe("ok");
    expect(statusOf("fake_on_https", { mode: "termux" })).toBe("ok");
  });
});

describe("verdictOf", () => {
  const ok = panelChecks(base);
  test("info codes never lower the verdict (B4)", () => {
    expect(verdictOf([problem("backup_not_configured", "warning"), problem("access_not_seen", "danger")], ok)).toBe(
      "ok",
    );
  });
  test("danger → fail, warning → warn, worst check wins", () => {
    expect(verdictOf([problem("disk_low", "danger")], ok)).toBe("fail");
    expect(verdictOf([problem("disk_low", "warning")], ok)).toBe("warn");
    expect(verdictOf([], panelChecks({ ...base, unhandled5m: 3 }))).toBe("warn");
    expect(verdictOf([problem("disk_low", "warning")], panelChecks({ ...base, mode: "fake" }))).toBe("fail");
  });
});

describe("getHealth", () => {
  const dir = mkdtempSync(join(tmpdir(), "panel-health-"));
  let db: Db;
  beforeAll(() => {
    db = openDb(dir);
    runMigrations(db);
  });
  afterAll(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const deps = (over: Partial<HealthDeps> = {}): HealthDeps => ({
    db,
    appBaseUrl: "http://localhost:3200",
    system: { mode: "fake" },
    monitor: {
      status: () => ({ sampledAt: null, intervalSec: 60, lastTickMs: null, running: false }),
      problems: () => ({
        problems: [problem("backup_not_configured", "info")],
        suppressed: [],
        unknownKinds: new Set(),
      }),
    },
    backup: { status: () => ({ configured: false, nextRunAt: null, keyMismatch: false }) as never },
    jobs: { active: () => null },
    ...over,
  });

  test("verdict, info codes, checks, details", () => {
    log.error("dev-health-marker");
    const h = getHealth(deps());
    // Request counters are process-wide (other test files log 500s), so the verdict is checked against its inputs.
    expect(h.verdict).toBe(verdictOf(h.problems ?? [], h.checks ?? []));
    expect(h).toMatchObject({
      infoCodes: ["backup_not_configured"],
      mode: "fake",
      sampledAt: null,
      backup: { configured: false, nextRunAt: null },
      runningJob: null,
      counts: { users: 0, sessions: 0 },
      schemaVersion: expect.stringMatching(/^\d{4}_/),
    });
    expect(h.checks?.map((c) => c.key)).toEqual(["errors", "sampler", "backup_scheduler", "fake_on_https"]);
    expect(h.lastErrors?.[0]?.msg).toBe("dev-health-marker");
    expect(h.db.sizeBytes).toBeGreaterThan(0);
    expect(h.dataDir.totalBytes).toBeGreaterThan(h.dataDir.freeBytes);
  });

  test("502s count in errorCount5m only, not in the errors check", () => {
    const before = getHealth(deps());
    logRequest({ method: "POST", path: "/api/dev/alerts/test", status: 502, ms: 1, userId: null });
    const h = getHealth(deps());
    expect(h.errorCount5m).toBe(before.errorCount5m + 1);
    expect(h.unhandled5m).toBe(before.unhandled5m);
  });

  test("fake mode on https fails the verdict", () => {
    expect(getHealth(deps({ appBaseUrl: "https://panel.example.test" })).verdict).toBe("fail");
  });

  test("key mismatch → backup null, never a throw", () => {
    const throwing = {
      status: () => {
        throw new KeyMismatchError("unreadable");
      },
    };
    expect(getHealth(deps({ backup: throwing as never })).backup).toBeNull();
    const flagged = { status: () => ({ configured: true, nextRunAt: null, keyMismatch: true }) };
    expect(getHealth(deps({ backup: flagged as never })).backup).toBeNull();
  });

  test("a running job is reported", () => {
    const job = { id: "j1", kind: "site.create" as never, target: "blog", startedAt: new Date(NOW).toISOString() };
    expect(getHealth(deps({ jobs: { active: () => job } })).runningJob).toEqual(job);
  });
});
