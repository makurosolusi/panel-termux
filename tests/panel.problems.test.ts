import { describe, expect, test } from "bun:test";
import type { MonitorSnapshot, MonitorState, SnapshotSection } from "@/server/monitor/monitor.contract";
import { observe, recordProbe } from "@/server/monitor/monitor.state";
import { BACKUP_STALE_MS, computeProblems, type ProblemContext } from "@/server/panel/overview.problems";
import type { Pm2Proc } from "@/server/system/pm2.termux";
import type { IngressRule } from "@/server/system/system.types";
import type { BackupRun, BackupStatus } from "@/shared/backup.types";
import type { Battery, DeviceInfo, Service } from "@/shared/panel.types";
import type { SecurityStatus } from "@/shared/security.types";

const NOW = Date.parse("2026-11-26T12:00:00Z"); // test-only fixed clock
const GB = 1024 ** 3;
const HOUR = 3_600_000;
const ok = <T>(value: T): SnapshotSection<T> => ({ ok: true, value, at: NOW });
const failed = <T>(error: string, at: number | null = NOW): SnapshotSection<T> => ({
  ok: false,
  error,
  at,
  stale: null,
});

// test-only fixtures
const BAT = { percent: 80, charging: false, status: "discharging", plugged: "unplugged", temperatureC: 30 } as const;
const battery = (o: Partial<Battery> = {}): Battery => ({ ...BAT, ...o });
const DEV = { cpuCores: 8, memory: { totalMb: 8000, availableMb: 4000 }, load: [20.9, 20.7, 20] as const };
const device = (o: Partial<DeviceInfo> = {}): DeviceInfo =>
  ({
    ...DEV,
    battery: battery(),
    disk: { freeBytes: 50 * GB, totalBytes: 100 * GB },
    uptimeSec: 9999,
    ...o,
  }) as DeviceInfo;
const SVC = { state: "run", pid: 100, uptimeSec: 5000, wantUp: true, protected: false } as const;
const svc = (name: string, o: Partial<Service> = {}): Service => ({ name, ...SVC, ...o });
const APP = { status: "online", pid: 1, memoryMb: 10, cpu: null, restarts: 0, uptimeSec: 100, port: null } as const;
const PM2 = { outLog: null, errLog: null, cwd: null, execPath: null, args: [], startedAtMs: null, module: false };
const app = (name: string, o: Partial<Pm2Proc> = {}): Pm2Proc => ({ name, ...APP, ...PM2, ...o });
const RUN = { id: "r1", trigger: "schedule", finishedAt: null, error: null, errorCode: null } as const;
const run = (status: BackupRun["status"], ageMs = 0, items: BackupRun["items"] = []): BackupRun => ({
  ...RUN,
  status,
  startedAt: new Date(NOW - ageMs).toISOString(),
  items,
});
const BK = { configured: true, missing: [], hourLocal: 3, nextRunAt: null, retentionDays: 14, running: false };
const backup = (o: Partial<BackupStatus> = {}): BackupStatus => ({ ...BK, lastRun: run("succeeded"), ...o });
const okKey: SecurityStatus["dataKey"] = {
  state: "ok",
  createdThisBoot: false,
  exportedAt: null,
  unreadableSettings: [],
};
const SEC = {
  access: { https: false, lastSeenAt: null },
  sessions: { active: 1, users: 1 },
  backupsIncludeSecrets: false,
};
const security = (o: Partial<SecurityStatus> = {}): SecurityStatus => ({ dataKey: okKey, ...SEC, ...o });
const services = ok([svc("sshd"), svc("cloudflared"), svc("pm2")]);
const snap = (o: Partial<MonitorSnapshot> = {}): MonitorSnapshot => ({
  device: ok(device()),
  services,
  apps: ok([app("blog", { port: 3001 })]),
  ingress: ok<IngressRule[]>([]),
  backup: ok(backup()),
  security: ok(security()),
  ...o,
});
const freshState = (): MonitorState => ({
  domains: new Map(),
  appRestarts: new Map(),
  serviceRuns: new Map(),
  intentional: new Map(),
  internetDown: false,
});
const CTX = { intervalSec: 60, batteryWarnPercent: 25, jobs: [], alertsFailing: null, adminSeenSinceBoot: true };
const ctx = (o: Partial<ProblemContext> = {}): ProblemContext => ({ ...CTX, ...o });
const compute = (s: Partial<MonitorSnapshot> = {}, c: Partial<ProblemContext> = {}, state = freshState()) =>
  computeProblems(snap(s), state, ctx(c), NOW);
const ids = (s: Partial<MonitorSnapshot> = {}, c: Partial<ProblemContext> = {}, state = freshState()) =>
  compute(s, c, state).problems.map((p) => `${p.id}:${p.severity}`);
const failingDomains = (status: number | null, ...hosts: string[]) => {
  const state = freshState();
  for (const h of hosts)
    for (let i = 0; i < 3; i++) recordProbe(state, h, { status, ms: 1, checkedAt: null, failures: 0, local: null });
  return state;
};
const rule = (hostname: string, port: number | null): IngressRule => ({ hostname, service: "x", port });

describe("computeProblems", () => {
  test("healthy snapshot → nothing, every kind known", () => {
    const r = compute();
    expect(r.problems).toEqual([]);
    expect(r.suppressed).toEqual([]);
    expect([...r.unknownKinds]).toEqual([]);
  });

  test("service_down only when wantUp; problem carries code, params, href, since null", () => {
    const down = svc("sshd", { state: "down", pid: null, downSec: 120 });
    const r = compute({ services: ok([down, svc("crond", { state: "down", wantUp: false })]) });
    const want = {
      id: "service_down:sshd",
      code: "service_down",
      kind: "service",
      target: "sshd",
      severity: "danger",
    } as const;
    expect(r.problems).toEqual([
      { ...want, params: { state: "down", downSec: 120 }, since: null, href: "/panel/services" },
    ]);
  });

  test("cloudflared down + 3 failing domains → one problem, domains suppressed", () => {
    const ingress = ok([rule("a.t", 1), rule("b.t", 2), rule("c.t", null)]);
    const r = compute(
      { services: ok([svc("cloudflared", { state: "down" })]), ingress },
      {},
      failingDomains(530, "a.t", "b.t", "c.t"),
    );
    expect(r.problems.map((p) => p.id)).toEqual(["service_down:cloudflared"]);
    expect(r.suppressed.map((p) => p.id)).toEqual([
      "domain_http_error:a.t",
      "domain_http_error:b.t",
      "domain_http_error:c.t",
    ]);
  });

  test("app errored + its domain 502 → one problem; other domains still shown", () => {
    const apps = ok([app("blog", { status: "errored", port: 3001, restarts: 15 }), app("shop", { port: 3002 })]);
    const ingress = ok([rule("blog.t", 3001), rule("shop.t", 3002)]);
    const r = compute({ apps, ingress }, {}, failingDomains(502, "blog.t", "shop.t"));
    expect(r.problems.map((p) => p.id)).toEqual(["app_errored:blog", "domain_http_error:shop.t"]);
    expect(r.problems[0]?.href).toBe("/panel/apps/blog/log?stream=err");
    expect(r.suppressed.map((p) => p.id)).toEqual(["domain_http_error:blog.t"]);
  });

  test("pm2_unavailable: app kind unknown, hides service_down:pm2 and domains of pm2 apps", () => {
    const apps: SnapshotSection<Pm2Proc[]> = {
      ok: false,
      error: "Pm2UnavailableError: service_down",
      at: NOW,
      stale: [app("blog", { port: 3001 })],
    };
    const services = ok([svc("pm2", { state: "down" })]);
    const ingress = ok([rule("blog.t", 3001), rule("other.t", 9)]);
    const r = compute({ apps, services, ingress }, {}, failingDomains(null, "blog.t", "other.t"));
    expect(r.problems.map((p) => `${p.id}:${p.params.reason ?? ""}`)).toEqual([
      "pm2_unavailable:pm2:service_down",
      "domain_unreachable:other.t:",
    ]);
    expect(r.suppressed.map((p) => p.id)).toEqual(["service_down:pm2", "domain_unreachable:blog.t"]);
    expect(r.unknownKinds.has("app")).toBe(true);
  });

  test("jlist failing: 1 tick → only unknown, 2 ticks → pm2_unavailable jlist_failed", () => {
    expect(compute({ apps: failed("timeout", NOW - 60_000) }).problems).toEqual([]);
    expect(ids({ apps: failed("timeout", NOW - 120_000) })).toEqual(["pm2_unavailable:pm2:danger"]);
  });

  test("app stopped → no problem, and its domain is not a problem either (K5)", () => {
    const apps = ok([app("blog", { status: "stopped", port: 3001 })]);
    expect(ids({ apps, ingress: ok([rule("blog.t", 3001)]) }, {}, failingDomains(502, "blog.t"))).toEqual([]);
  });

  test("domains: < 3 failures, healthy and wildcard hosts are not problems", () => {
    const state = failingDomains(null, "*.t", "down.t");
    recordProbe(state, "flaky.t", { status: null, ms: null, checkedAt: null });
    recordProbe(state, "flaky.t", { status: null, ms: null, checkedAt: null });
    recordProbe(state, "healed.t", { status: null, ms: null, checkedAt: null });
    recordProbe(state, "healed.t", { status: 200, ms: 1, checkedAt: null });
    expect(state.domains.get("healed.t")?.failures).toBe(0);
    const ingress = ok([rule("*.t", 1), rule("down.t", 1), rule("flaky.t", 1), rule("healed.t", 1)]);
    expect(ids({ ingress }, {}, state)).toEqual(["domain_unreachable:down.t:danger"]);
  });

  test("internet_down hides every domain problem", () => {
    const state = failingDomains(null, "a.t");
    state.internetDown = true;
    const r = compute({ ingress: ok([rule("a.t", 1)]) }, {}, state);
    expect(r.problems.map((p) => p.id)).toEqual(["internet_down:internet"]);
    expect(r.suppressed.map((p) => p.id)).toEqual(["domain_unreachable:a.t"]);
  });

  describe("battery (A9/B3)", () => {
    const bat = (b: Partial<Battery>, warn: number | null = 25) =>
      ids({ device: ok(device({ battery: battery(b) })) }, { batteryWarnPercent: warn });
    test("warning below the setting when not charging; discharging and not_charging both count", () => {
      expect(bat({ percent: 24 })).toEqual(["battery_low:battery:warning"]);
      expect(bat({ percent: 24, status: "not_charging", plugged: "usb" })).toEqual(["battery_low:battery:warning"]);
      expect(bat({ percent: 25 })).toEqual([]);
    });
    test("danger below 15% even while plugged (usb, not charging)", () => {
      expect(bat({ percent: 14, status: "not_charging", plugged: "usb" })).toEqual(["battery_low:battery:danger"]);
    });
    test("charging or full → none; unplugged at 80% → none", () => {
      expect(bat({ percent: 10, status: "charging", charging: true })).toEqual([]);
      expect(bat({ percent: 10, status: "full", charging: true })).toEqual([]);
      expect(bat({ percent: 80, plugged: "unplugged" })).toEqual([]);
    });
    test("setting off: no warning, danger still applies", () => {
      expect(bat({ percent: 20 }, null)).toEqual([]);
      expect(bat({ percent: 14 }, null)).toEqual(["battery_low:battery:danger"]);
    });
    test("temperature ≥ 45 °C warning, ≥ 50 °C danger", () => {
      expect(bat({ temperatureC: 44.9 })).toEqual([]);
      expect(bat({ temperatureC: 45 })).toEqual(["battery_hot:battery:warning"]);
      expect(bat({ temperatureC: 50 })).toEqual(["battery_hot:battery:danger"]);
    });
    test("battery null → kind unknown (C1), no problem", () => {
      const r = compute({ device: ok(device({ battery: null })) });
      expect(r.problems).toEqual([]);
      expect([...r.unknownKinds]).toEqual(["battery"]);
    });
  });

  test("failed sections → their kinds unknown and no problems of that kind", () => {
    const r = compute({ device: failed("x"), services: failed("x"), ingress: failed("x"), security: failed("x") });
    expect(r.problems).toEqual([]);
    expect([...r.unknownKinds].sort()).toEqual(["battery", "disk", "domain", "network", "security", "service"]);
  });

  test("disk: < 10% free warning, < 5% danger", () => {
    const disk = (free: number) =>
      ids({ device: ok(device({ disk: { freeBytes: free * GB, totalBytes: 100 * GB } })) });
    expect(disk(10)).toEqual([]);
    expect(disk(9)).toEqual(["disk_low:disk:warning"]);
    expect(disk(4)).toEqual(["disk_low:disk:danger"]);
  });

  test("service_crash_loop needs 3 ticks with a new pid and short uptime; intentional restarts excluded", () => {
    const state = freshState();
    const tick = (pid: number, t: number) => {
      const s = snap({ services: ok([svc("postgres", { pid, uptimeSec: 2 })]) });
      observe(state, s, NOW + t, 60);
      return computeProblems(s, state, ctx(), NOW + t).problems.map((p) => p.id);
    };
    expect(tick(1, 0)).toEqual([]);
    expect(tick(2, 60_000)).toEqual([]);
    expect(tick(2, 90_000)).toEqual([]); // same pid: no new entry
    expect(tick(3, 120_000)).toEqual(["service_crash_loop:postgres"]);
    state.intentional.set("service:postgres", NOW + 200_000);
    expect(tick(4, 180_000)).toEqual([]);
  });

  test("app_crash_loop: ≥ 3 restarts in 10 min; intentional restart and counter drop reset the ring", () => {
    const state = freshState();
    const tick = (restarts: number, t: number) => {
      const s = snap({ apps: ok([app("blog", { restarts })]) });
      observe(state, s, NOW + t, 60);
      return computeProblems(s, state, ctx(), NOW + t).problems.map((p) => `${p.id}:${p.params.restarts10m}`);
    };
    expect(tick(0, 0)).toEqual([]);
    expect(tick(2, 60_000)).toEqual([]);
    expect(tick(3, 120_000)).toEqual(["app_crash_loop:blog:3"]);
    expect(tick(1, 180_000)).toEqual([]); // counter dropped (pm2 reset) → ring reset
    state.intentional.set("app:blog", NOW + 300_000);
    expect(tick(5, 240_000)).toEqual([]); // manual restarts within the grace
    expect(tick(6, 360_000)).toEqual([]);
    expect(tick(6, 15 * 60_000)).toEqual([]); // old entries fall out of the window
  });

  describe("backup and security codes (PLAN/04)", () => {
    test("not configured → info only", () => {
      expect(ids({ backup: ok(backup({ configured: false, lastRun: null })) })).toEqual([
        "backup_not_configured:backup:info",
      ]);
    });
    test("failed → danger, partial → warning, stale/never → warning, running → none", () => {
      const b = (over: Partial<BackupStatus>) => ids({ backup: ok(backup(over)) });
      expect(b({ lastRun: run("failed") })).toEqual(["backup_failed:backup:danger"]);
      expect(b({ lastRun: run("partial") })).toEqual(["backup_partial:backup:warning"]);
      expect(b({ lastRun: run("succeeded", BACKUP_STALE_MS + 1) })).toEqual(["backup_stale:backup:warning"]);
      expect(b({ lastRun: null })).toEqual(["backup_stale:backup:warning"]);
      expect(b({ running: true, lastRun: run("failed") })).toEqual([]);
    });
    test("backup_item_stale per item of the last run; never/old/future lastGood; stale run hides it", () => {
      const items = (["database", "panel", "sites", "checksums"] as const).map((kind) => ({
        kind,
        name: kind === "database" ? "blog" : kind,
        key: "k",
        sizeBytes: 1,
        ok: kind !== "database",
        error: null,
        restoreHint: "",
      }));
      const good = (kind: "panel" | "sites", ageMs: number) => ({
        kind,
        name: kind,
        runId: "r0",
        itemIndex: 0,
        at: new Date(NOW - ageMs).toISOString(),
        sizeBytes: 1,
        checked: true,
        restoreHint: "",
      });
      const lastGood = [good("panel", HOUR), good("sites", -HOUR)];
      const r = compute({ backup: ok(backup({ lastRun: run("partial", 0, items), lastGood })) });
      expect(r.problems.map((p) => `${p.id}:${p.params.hours}`)).toEqual([
        "backup_partial:backup:undefined",
        "backup_item_stale:database:blog:null",
        "backup_item_stale:sites:sites:null",
      ]);
      const stale = compute({
        backup: ok(backup({ lastRun: run("succeeded", BACKUP_STALE_MS + HOUR, items), lastGood })),
      });
      expect(stale.problems.map((p) => p.id)).toEqual(["backup_stale:backup"]);
      expect(stale.suppressed.map((p) => p.code)).toContain("backup_item_stale");
    });
    test("key_mismatch from security or backup hides backup_* (incl. status error)", () => {
      const sec = ok(
        security({
          dataKey: { state: "mismatch", createdThisBoot: true, exportedAt: null, unreadableSettings: ["a", "b"] },
        }),
      );
      const r = compute({ security: sec, backup: ok(backup({ keyMismatch: true, lastRun: run("failed") })) });
      expect(r.problems.map((p) => `${p.id}:${p.params.count}:${p.href}`)).toEqual([
        "key_mismatch:data_key:2:/dev/health#kunci-data",
      ]);
      expect(r.suppressed.map((p) => p.code)).toEqual(["backup_failed"]);
      expect(ids({ backup: failed("KeyMismatchError: cannot decrypt") })).toEqual(["key_mismatch:data_key:danger"]);
    });
    test("backup.status() throwing → backup_status_error, backup kind unknown", () => {
      const r = compute({ backup: failed("Error: boom") });
      expect(r.problems.map((p) => p.id)).toEqual(["backup_status_error:backup"]);
      expect(r.unknownKinds.has("backup")).toBe(true);
    });
    test("backup_secrets_included warning; access_not_seen info only after an admin request on https", () => {
      expect(ids({ backup: ok(backup({ includeSecrets: true })) })).toEqual(["backup_secrets_included:backup:warning"]);
      const https = ok(security({ access: { https: true, lastSeenAt: null } }));
      expect(ids({ security: https })).toEqual(["access_not_seen:access:info"]);
      expect(ids({ security: https }, { adminSeenSinceBoot: false })).toEqual([]);
      const recent = ok(security({ access: { https: true, lastSeenAt: new Date(NOW - HOUR).toISOString() } }));
      expect(ids({ security: recent })).toEqual([]);
    });
  });

  test("site_job_failed: newest job per target, unresolved failed/interrupted only", () => {
    const jobs: ProblemContext["jobs"] = [
      { id: "j3", kind: "site.deploy", target: "blog", status: "interrupted", resolvedBy: null },
      { id: "j2", kind: "site.deploy", target: "blog", status: "failed", resolvedBy: null },
      { id: "j1", kind: "site.create", target: "shop", status: "failed", resolvedBy: "u1" },
      { id: "j0", kind: "site.env", target: "wiki", status: "succeeded", resolvedBy: null },
    ];
    const r = compute({}, { jobs });
    expect(r.problems.map((p) => [p.id, p.href, p.params])).toEqual([
      ["site_job_failed:blog", "/panel/jobs/j3", { jobId: "j3", kind: "site.deploy", status: "interrupted" }],
    ]);
  });

  test("alerts_failing carries the reason", () => {
    expect(compute({}, { alertsFailing: "telegram_forbidden" }).problems[0]?.params).toEqual({
      reason: "telegram_forbidden",
    });
  });

  test("order: danger, warning, info, then table order, then target", () => {
    const r = compute(
      {
        services: ok([svc("zz", { state: "down" }), svc("aa", { state: "down" })]),
        device: ok(device({ battery: battery({ percent: 20 }), disk: { freeBytes: 4 * GB, totalBytes: 100 * GB } })),
        backup: ok(backup({ configured: false })),
      },
      { alertsFailing: "telegram_unreachable" },
    );
    expect(r.problems.map((p) => p.id)).toEqual([
      "service_down:aa",
      "service_down:zz",
      "disk_low:disk",
      "battery_low:battery",
      "alerts_failing:telegram",
      "backup_not_configured:backup",
    ]);
  });
});
