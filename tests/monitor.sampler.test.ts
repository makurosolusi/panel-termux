import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, setting, user } from "@/server/db/schema";
import { LOG_RING_SIZE, readLogs } from "@/server/log.service";
import type { MonitorState } from "@/server/monitor/monitor.contract";
import { createAlertStore, historyPage } from "@/server/monitor/monitor.history";
import { createSampler, FIRST_TICK_DELAY_MS, MIN_TICK_GAP_MS, type TickResult } from "@/server/monitor/monitor.sampler";
import { createMonitor, type MonitorDeps, onChatMigrated } from "@/server/monitor/monitor.service";
import { createSnapshotCache } from "@/server/monitor/monitor.snapshot";
import type { ProblemContext } from "@/server/panel/overview.problems";
import { getSetting, setSettings } from "@/server/settings.service";
import { createFakeSystem } from "@/server/system/system.fake";
import type { IngressRule, Pm2Proc } from "@/server/system/system.types";
import type { BackupStatus } from "@/shared/backup.types";
import type { DeviceInfo, Service } from "@/shared/panel.types";
import type { SecurityStatus } from "@/shared/security.types";

// test-only fixtures
const SECRET = "fedcba9876543210".repeat(4);
const BOT_TOKEN = "123456789:AAH-fake_token_value_for_tests_000000";
const T0 = Date.parse("2026-11-26T00:00:00Z");
const root = mkdtempSync(join(tmpdir(), "panel-monitor-sampler-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dbN = 0;
const freshDb = (): Db => {
  const dir = join(root, String(dbN++));
  mkdirSync(dir);
  const db = openDb(dir);
  runMigrations(db);
  return db;
};

const DEVICE = {
  battery: { percent: 80, charging: true, status: "charging", plugged: "ac", temperatureC: 30 },
  cpuCores: 8,
  memory: { totalMb: 4000, availableMb: 1000 },
  disk: { freeBytes: 50e9, totalBytes: 100e9 },
  load: [1, 2, 3],
  uptimeSec: 9999,
} as DeviceInfo;
const CTX: ProblemContext = {
  intervalSec: 60,
  batteryWarnPercent: 25,
  jobs: [],
  alertsFailing: null,
  adminSeenSinceBoot: false,
};
/** Ids of real problems (info rows such as backup_not_configured are display-only). */
const ids = (r: TickResult | undefined, key: "id" | "code" = "id") =>
  r?.result.problems.filter((p) => p.severity !== "info").map((p) => p[key]);
const newState = (): MonitorState => ({
  domains: new Map(),
  appRestarts: new Map(),
  serviceRuns: new Map(),
  intentional: new Map(),
  internetDown: false,
});

/** Fake clock + timers: `fire()` runs the next scheduled callback after moving the clock to it. */
function fakeClock() {
  let t = T0;
  const queue: { fn: () => void; at: number; id: number }[] = [];
  let id = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    timers: {
      set: (fn: () => void, ms: number) => {
        queue.push({ fn, at: t + ms, id: ++id });
        return id;
      },
      clear: (h: unknown) => {
        const i = queue.findIndex((q) => q.id === h);
        if (i >= 0) queue.splice(i, 1);
      },
    },
    pending: () => queue.map((q) => q.at - t),
    fire: async () => {
      const next = queue.shift();
      if (!next) throw new Error("no timer scheduled");
      t = Math.max(t, next.at);
      next.fn();
      await new Promise((r) => setImmediate(r)); // drains the tick's microtasks and the re-schedule
    },
  };
}

function samplerHarness(o: { probeStatus?: number | null; online?: boolean } = {}) {
  const clock = fakeClock();
  const state = newState();
  let apps: Pm2Proc[] = [{ name: "blog", status: "online", restarts: 0, port: 3001 } as Pm2Proc];
  const rules: IngressRule[] = [
    { hostname: "blog.example.test", service: "http://127.0.0.1:3001", port: 3001 },
    { hostname: "*.example.test", service: "http://127.0.0.1:3001", port: 3001 },
  ];
  const snapshot = createSnapshotCache(
    {
      device: async () => DEVICE,
      services: async () => [] as Service[],
      apps: async () => apps,
      ingress: async () => rules,
      backup: () => ({ configured: false, running: false, restoring: false, lastRun: null }) as unknown as BackupStatus,
      security: () =>
        ({
          dataKey: { state: "ok", unreadableSettings: [] },
          access: { https: false, lastSeenAt: null },
        }) as unknown as SecurityStatus,
    },
    clock.now,
  );
  const ticks: TickResult[] = [];
  const calls = { probe: 0, local: 0, connectivity: 0 };
  let interval = 60;
  let gate: Promise<void> | null = null;
  const sampler = createSampler({
    snapshot,
    state,
    probe: async (h) => {
      calls.probe++;
      expect(h.includes("*")).toBe(false);
      return { status: o.probeStatus === undefined ? 200 : o.probeStatus, ms: 5 };
    },
    localStatus: async () => {
      calls.local++;
      return 502;
    },
    connectivity: async () => {
      calls.connectivity++;
      return o.online ?? true;
    },
    intervalSec: () => interval,
    context: (intervalSec) => ({ ...CTX, intervalSec }),
    commit: async (r) => {
      ticks.push(r);
      if (gate) await gate;
    },
    now: clock.now,
    timers: clock.timers,
  });
  return {
    sampler,
    clock,
    state,
    ticks,
    calls,
    setApps: (a: Pm2Proc[]) => {
      apps = a;
    },
    setInterval: (s: number) => {
      interval = s;
    },
    hold: () => {
      let open = () => {};
      gate = new Promise((r) => {
        open = r;
      });
      return () => {
        gate = null;
        open();
      };
    },
  };
}

describe("sampler", () => {
  test("first tick after 10 s, next after interval − duration, interval re-read every tick, stop ends it", async () => {
    const h = samplerHarness();
    const stop = h.sampler.start();
    expect(h.clock.pending()).toEqual([FIRST_TICK_DELAY_MS]);
    await h.clock.fire();
    expect(h.ticks).toHaveLength(1);
    expect(h.clock.pending()).toEqual([60_000]);
    h.setInterval(30);
    await h.clock.fire();
    expect(h.clock.pending()).toEqual([30_000]);
    expect(h.sampler.status()).toMatchObject({
      intervalSec: 30,
      running: true,
      sampledAt: new Date(h.clock.now()).toISOString(),
    });
    h.setInterval(1); // below the floor
    await h.clock.fire();
    expect(h.clock.pending()).toEqual([MIN_TICK_GAP_MS]);
    stop();
    expect(h.clock.pending()).toEqual([]);
    expect(h.sampler.status().running).toBe(false);
  });

  test("an overlapping tick is skipped and shares the running one", async () => {
    const h = samplerHarness();
    const open = h.hold();
    const a = h.sampler.tick();
    await Promise.resolve();
    const b = h.sampler.tick();
    expect(b).toBe(a);
    open();
    await Promise.all([a, b]);
    expect(h.ticks).toHaveLength(1);
    await h.sampler.idle();
  });

  test("failed probes build the streak, ask the local port, and raise domain_unreachable on the 3rd tick", async () => {
    const h = samplerHarness({ probeStatus: null, online: true });
    for (let i = 0; i < 3; i++) {
      await h.sampler.tick();
      h.clock.advance(60_000);
    }
    expect(h.calls).toEqual({ probe: 3, local: 3, connectivity: 3 });
    expect(h.state.domains.get("blog.example.test")).toMatchObject({ failures: 3, last: { status: null, local: 502 } });
    const last = h.ticks.at(-1);
    expect(last?.checks).toEqual([
      { hostname: "blog.example.test", at: expect.any(Number), status: null, ms: 5, localStatus: 502 },
    ]);
    expect(ids(last)).toEqual(["domain_unreachable:blog.example.test"]);
  });

  test("no answer anywhere and connectivity down → internet_down holds back the domain problem", async () => {
    const h = samplerHarness({ probeStatus: null, online: false });
    for (let i = 0; i < 3; i++) await h.sampler.tick();
    expect(h.state.internetDown).toBe(true);
    expect(ids(h.ticks.at(-1), "code")).toEqual(["internet_down"]);
    expect(h.ticks.at(-1)?.result.suppressed.map((p) => p.code)).toEqual(["domain_unreachable"]);
  });

  test("observe runs before computeProblems: 3 pm2 restarts within 10 min = app_crash_loop", async () => {
    const h = samplerHarness();
    for (const restarts of [0, 1, 2, 3]) {
      h.setApps([{ name: "blog", status: "online", restarts, port: 3001 } as Pm2Proc]);
      h.clock.advance(60_000);
      await h.sampler.tick();
    }
    expect(ids(h.ticks.at(-1))).toEqual(["app_crash_loop:blog"]);
  });

  test("a tick that throws is logged and the chain continues", async () => {
    const h = samplerHarness();
    const failing = createSampler({
      ...{ snapshot: createSnapshotCache({} as never, h.clock.now), state: newState() },
      ...{ probe: async () => ({ status: 200, ms: 1 }), localStatus: async () => null, connectivity: async () => true },
      ...{ intervalSec: () => 60, context: () => CTX, now: h.clock.now, timers: h.clock.timers },
      commit: async () => {
        throw new Error("db gone");
      },
    });
    failing.start();
    await h.clock.fire();
    expect(failing.status().sampledAt).toBeNull();
    expect(h.clock.pending()).toEqual([60_000]);
    failing.stop();
  });
});

function monitorHarness(o: Partial<MonitorDeps> = {}) {
  const db = freshDb();
  const clock = fakeClock();
  const deps: MonitorDeps = {
    db,
    secret: SECRET,
    system: createFakeSystem({ home: mkdtempSync(join(root, "home-")) }),
    backupStatus: () =>
      ({ configured: false, running: false, restoring: false, lastRun: null }) as unknown as BackupStatus,
    securityStatus: () =>
      ({
        dataKey: { state: "ok", unreadableSettings: [] },
        access: { https: false, lastSeenAt: null },
      }) as unknown as SecurityStatus,
    jobs: () => [],
    adminSeenSinceBoot: () => false,
    appBaseUrl: "https://panel.example.test",
    panelPort: 3000,
    bootNotice: { cleanShutdown: true, uptimeSec: 86_400 },
    now: clock.now,
    timers: clock.timers,
    ...o,
  };
  return { db, clock, deps, monitor: createMonitor(deps) };
}

describe("monitor service", () => {
  test("onChatMigrated stores the new chat id with a System audit row", () => {
    const db = freshDb();
    onChatMigrated({ db }, "-1001234567890");
    expect(getSetting({ db, secret: SECRET }, "alerts.telegram_chat_id")).toBe("-1001234567890");
    expect(db.select().from(setting).where(eq(setting.key, "alerts.telegram_chat_id")).get()?.updatedBy).toBeNull();
    expect(db.select().from(auditLog).all()).toMatchObject([
      {
        actorId: null,
        actorKind: "system",
        action: "settings.update",
        target: "alerts.telegram_chat_id",
        meta: { reason: "chat_migrated" },
      },
    ]);
    expect(() => onChatMigrated({ db }, "not a chat")).toThrow("onChatMigrated");
  });

  test("a migrated chat during delivery is saved, retried, and the token never reaches the DB or audit", async () => {
    const hits: { path: string; chat: string }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { chat_id: string };
        hits.push({ path: new URL(req.url).pathname, chat: body.chat_id });
        if (body.chat_id === "12345")
          return Response.json(
            { ok: false, description: "migrated", parameters: { migrate_to_chat_id: -100777 } },
            { status: 400 },
          );
        return Response.json({ ok: true, result: {} });
      },
    });
    try {
      const h = monitorHarness({ telegramBaseUrl: `http://127.0.0.1:${server.port}` });
      h.db.insert(user).values({ id: "u1", email: "root@example.test", name: "Root", role: "user" }).run();
      setSettings(
        { db: h.db, secret: SECRET },
        { "alerts.telegram_bot_token": BOT_TOKEN, "alerts.telegram_chat_id": "12345" },
        "u1",
      );
      h.monitor.start();
      await h.monitor.tick(); // fake device has an errored app → service/app problems with delay 0..2 min
      h.clock.advance(3 * 60_000);
      await h.monitor.tick();
      expect(hits.map((x) => x.chat)).toEqual(["12345", "-100777"]);
      expect(getSetting(h.deps, "alerts.telegram_chat_id")).toBe("-100777");
      const audit = JSON.stringify(h.db.select().from(auditLog).all());
      expect(audit).toContain("chat_migrated");
      expect(audit).not.toContain(BOT_TOKEN);
      expect(JSON.stringify(readLogs({ limit: LOG_RING_SIZE }))).not.toContain(BOT_TOKEN);
      expect(h.monitor.alertStatus()).toMatchObject({ state: "ok", lastError: null });
    } finally {
      server.stop(true);
    }
  });

  test("tick stores history + events; noteIntentionalRestart sets the grace window; boot notice stored closed", async () => {
    const h = monitorHarness({ bootNotice: { cleanShutdown: false, uptimeSec: 86_400 } });
    h.monitor.start();
    await h.monitor.tick();
    expect(h.monitor.status().sampledAt).toBe(new Date(h.clock.now()).toISOString());
    const shown = h.monitor.problems().problems;
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((p) => p.severity !== "info").every((p) => p.since !== null)).toBe(true);
    const open = createAlertStore(h.db).openEvents();
    expect(open.length).toBe(shown.filter((p) => p.severity !== "info").length);
    const notice = createAlertStore(h.db).closedSince(0);
    expect(notice).toMatchObject([{ code: "panel_restarted_unexpectedly", notifiedState: null }]);
    expect(historyPage(h.db, { page: 1, pageSize: 20, offset: 0 }).total).toBe(open.length);
    const procs = await h.monitor.pm2Procs();
    expect(procs.length).toBeGreaterThan(0);
    const sampleRows = h.db.$client.query("SELECT count(*) AS n FROM metric_sample").get() as { n: number };
    expect(sampleRows.n).toBe(1);
    expect(h.monitor.loadBaseline()).toBeNull();
    await h.monitor.idle();
  });

  test("noteIntentionalRestart: restarts in the grace window are not a crash loop", async () => {
    for (const intentional of [false, true]) {
      const h = monitorHarness();
      await h.monitor.tick();
      const app = (await h.monitor.pm2Procs()).find((a) => a.status === "online");
      if (!app) throw new Error("fake system has no online app");
      for (let i = 0; i < 3; i++) {
        if (intentional) h.monitor.noteIntentionalRestart({ kind: "app", name: app.name });
        await h.deps.system.pm2.control(app.name, "restart");
        h.clock.advance(60_000);
        await h.monitor.tick();
      }
      const crash = h.monitor.problems().problems.some((p) => p.id === `app_crash_loop:${app.name}`);
      expect(crash).toBe(!intentional);
    }
  });
});
