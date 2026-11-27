import { describe, expect, test } from "bun:test";
import {
  ALERT_MAX_PER_HOUR,
  type AlertSettings,
  type AlertStore,
  createAlertEngine,
  type EventRow,
} from "@/server/alerts/alert.engine";
import { TelegramError } from "@/server/alerts/telegram.client";
import { bootNotices } from "@/server/monitor/monitor.state";
import { alertDelayMs, problem } from "@/server/panel/overview.rules";
import type { Problem, ProblemKind } from "@/shared/monitor.types";

const T0 = Date.parse("2026-11-26T00:00:00Z"); // test-only fixed clock
const MIN = 60_000;
const SETTINGS: AlertSettings = {
  configured: true,
  enabled: true,
  minSeverity: "warning",
  intervalSec: 60,
  appBaseUrl: "https://panel.example.test",
  language: "en",
};

/** problem_event in memory, with the unique-open-key rule of the real index; rows are copied like a DB would. */
function memStore(): AlertStore & { rows: EventRow[] } {
  const rows: EventRow[] = [];
  const copy = (r: EventRow) => structuredClone(r);
  return {
    rows,
    openEvents: () => rows.filter((r) => r.closedAt === null).map(copy),
    closedSince: (since) => rows.filter((r) => r.closedAt !== null && r.closedAt >= since).map(copy),
    insert(row) {
      if (row.closedAt === null && rows.some((r) => r.key === row.key && r.closedAt === null))
        throw new Error(`unique open key ${row.key}`);
      rows.push({ ...structuredClone(row), id: rows.length + 1 });
      return rows.length;
    },
    update(id, patch) {
      const r = rows.find((x) => x.id === id);
      if (!r) throw new Error(`no row ${id}`);
      Object.assign(r, structuredClone(patch));
    },
  };
}

type Sent = { text: string; silent: boolean };
function harness(store = memStore()) {
  const sent: Sent[] = [];
  let failWith: Error | null = null;
  const engine = createAlertEngine({
    store,
    send: async (text, { silent }) => {
      if (failWith) throw failWith;
      sent.push({ text, silent });
    },
  });
  const tick = async (
    problems: Problem[],
    t: number,
    o: { suppressed?: Problem[]; unknown?: ProblemKind[]; s?: Partial<AlertSettings> } = {},
  ) => {
    const out = engine.reconcile(
      { problems, suppressed: o.suppressed ?? [], unknownKinds: new Set(o.unknown ?? []) },
      t,
    );
    await engine.deliver({ ...SETTINGS, ...o.s }, t);
    return out;
  };
  return { store, sent, engine, tick, fail: (e: Error | null) => (failWith = e) };
}

const appDown = problem("app_errored", "blog", "danger", { restarts: 15, site: "blog" });
const domainDown = problem("domain_unreachable", "blog.t", "danger", { failures: 3 });
const lowBattery = problem("battery_low", "battery", "warning", { percent: 22, plugged: "unplugged" });

describe("reconcile", () => {
  test("opens one row per key, fills since, info never opens an event", async () => {
    const h = harness();
    const info = problem("backup_not_configured", "backup", "info");
    const out = await h.tick([appDown, info], T0);
    expect(out.map((p) => p.since)).toEqual([new Date(T0).toISOString(), null]);
    await h.tick([appDown, info], T0 + MIN);
    expect(h.store.rows.map((r) => [r.key, r.openedAt, r.closedAt])).toEqual([["app_errored:blog", T0, null]]);
  });

  test("hysteresis: closes only after 2 absent ticks", async () => {
    const h = harness();
    await h.tick([appDown], T0);
    await h.tick([], T0 + MIN);
    expect(h.store.rows[0]?.closedAt).toBeNull();
    await h.tick([appDown], T0 + 2 * MIN); // back: counter reset
    await h.tick([], T0 + 3 * MIN);
    expect(h.store.rows[0]?.closedAt).toBeNull();
    await h.tick([], T0 + 4 * MIN);
    expect(h.store.rows[0]?.closedAt).toBe(T0 + 4 * MIN);
  });

  test("pm2 unreadable for a tick (kind unknown) → no recovery, no new event", async () => {
    const h = harness();
    await h.tick([appDown], T0);
    await h.tick([appDown], T0 + MIN);
    const before = h.sent.length;
    for (let i = 2; i < 6; i++) await h.tick([], T0 + i * MIN, { unknown: ["app"] });
    expect(h.store.rows).toHaveLength(1);
    expect(h.store.rows[0]?.closedAt).toBeNull();
    expect(h.sent).toHaveLength(before);
  });

  test("battery unreadable (null) keeps the battery event open", async () => {
    const h = harness();
    await h.tick([lowBattery], T0);
    for (let i = 1; i < 5; i++) await h.tick([], T0 + i * MIN, { unknown: ["battery"] });
    expect(h.store.rows[0]?.closedAt).toBeNull();
  });

  test("a suppressed problem is neither closed nor sent again", async () => {
    const h = harness();
    await h.tick([domainDown], T0);
    expect(h.sent).toHaveLength(1);
    const cause = problem("service_down", "cloudflared", "danger");
    for (let i = 1; i < 5; i++) await h.tick([cause], T0 + i * MIN, { suppressed: [domainDown] });
    expect(h.store.rows.find((r) => r.key === domainDown.id)?.closedAt).toBeNull();
    expect(h.sent.every((s, i) => i === 0 || !s.text.includes("blog.t"))).toBe(true);
  });

  test("reopen within 15 min reuses the row (opened_at, since kept)", async () => {
    const h = harness();
    await h.tick([appDown], T0);
    await h.tick([], T0 + MIN);
    await h.tick([], T0 + 2 * MIN);
    const out = await h.tick([appDown], T0 + 10 * MIN);
    expect(h.store.rows).toHaveLength(1);
    expect(h.store.rows[0]?.closedAt).toBeNull();
    expect(out[0]?.since).toBe(new Date(T0).toISOString());
    await h.tick([], T0 + 11 * MIN);
    await h.tick([], T0 + 12 * MIN);
    await h.tick([appDown], T0 + 40 * MIN); // closed 28 min ago → new row
    expect(h.store.rows).toHaveLength(2);
  });
});

describe("deliver", () => {
  test("delay per code; danger rings, warning-only digests are silent; header + link", async () => {
    const h = harness();
    await h.tick([appDown, lowBattery], T0);
    expect(h.sent).toHaveLength(0); // app_errored waits 1 min, battery 2 min
    await h.tick([appDown, lowBattery], T0 + MIN);
    expect(h.sent).toEqual([
      {
        text: "<b>Panel Termux</b> · panel.example.test\nCRITICAL · App blog errored · since 1 min\n\nOpen Overview: https://panel.example.test/panel",
        silent: false,
      },
    ]);
    await h.tick([appDown, lowBattery], T0 + 2 * MIN);
    expect(h.sent[1]).toEqual({
      text: expect.stringContaining("WARNING · Battery at 22% and not charging"),
      silent: true,
    });
    expect(h.sent[1]?.text).not.toContain("blog");
  });

  test("recovery has no cooldown; escalation to danger bypasses it; 24 h reminder", async () => {
    const h = harness();
    const hot = (t: number) => problem("battery_hot", "battery", t >= 50 ? "danger" : "warning", { temperatureC: t });
    await h.tick([hot(46)], T0);
    await h.tick([hot(46)], T0 + 2 * MIN);
    expect(h.sent).toHaveLength(1);
    await h.tick([hot(51)], T0 + 3 * MIN); // escalation 1 min after the last send
    expect(h.sent[1]?.text).toContain("CRITICAL · Battery is hot (51 °C)");
    await h.tick([hot(51)], T0 + 4 * MIN);
    expect(h.sent).toHaveLength(2);
    await h.tick([hot(51)], T0 + 24 * 60 * MIN + 3 * MIN);
    expect(h.sent[2]?.text).toContain("STILL · CRITICAL · Battery is hot (51 °C)");
    await h.tick([], T0 + 24 * 60 * MIN + 4 * MIN);
    await h.tick([], T0 + 24 * 60 * MIN + 5 * MIN); // closes 2 min after the reminder: no cooldown
    expect(h.sent[3]?.text).toContain("RECOVERED · Battery is hot (51 °C) · lasted 1 d");
    expect(h.sent).toHaveLength(4);
  });

  test("min_severity=danger: 51 → 47 °C sends nothing more; a warning-only problem is never sent", async () => {
    const h = harness();
    const s = { minSeverity: "danger" as const };
    const hot = (t: number) => problem("battery_hot", "battery", t >= 50 ? "danger" : "warning", { temperatureC: t });
    await h.tick([hot(51)], T0, { s });
    await h.tick([hot(51)], T0 + 2 * MIN, { s });
    expect(h.sent).toHaveLength(1);
    for (let i = 3; i < 30; i++) await h.tick([hot(47)], T0 + i * MIN, { s });
    expect(h.sent).toHaveLength(1);
    const w = harness();
    for (let i = 0; i < 5; i++) await w.tick([hot(47)], T0 + i * MIN, { s });
    expect(w.sent).toHaveLength(0);
  });

  test("flapping domain (fail-fail-fail-healthy every 4 min) for 1 hour → ≤ 4 messages", async () => {
    const h = harness();
    for (let i = 0; i < 60; i++) await h.tick(i % 4 === 2 ? [domainDown] : [], T0 + i * MIN);
    expect(h.sent.length).toBeGreaterThanOrEqual(2);
    expect(h.sent.length).toBeLessThanOrEqual(4);
  });

  test("restart: rows from the DB are not sent again; recovery while offline says so", async () => {
    const store = memStore();
    const a = harness(store);
    await a.tick([appDown], T0);
    await a.tick([appDown], T0 + MIN);
    expect(a.sent).toHaveLength(1);
    const b = harness(store); // panel restarted, same DB
    await b.tick([appDown], T0 + 5 * MIN);
    await b.tick([appDown], T0 + 6 * MIN);
    expect(b.sent).toHaveLength(0);
    const c = harness(store); // panel was down 3 h, the app healed meanwhile
    await c.tick([], T0 + 3 * 60 * MIN);
    await c.tick([], T0 + 3 * 60 * MIN + MIN);
    expect(c.sent[0]?.text).toContain(
      "RECOVERED · App blog errored · recovered while the panel wasn't running (last seen 3 h 1 min ago)",
    );
  });

  test("boot notice: sent once, still sent after a failed first try", async () => {
    const h = harness();
    h.engine.recordNotices([problem("host_rebooted", "host", "warning", { uptimeMin: 4 })], T0);
    h.fail(new TelegramError("telegram_unreachable", "telegram sendMessage failed: timeout"));
    await h.tick([], T0);
    expect(h.engine.status(SETTINGS)).toMatchObject({ state: "ok", lastError: "telegram_unreachable", pending: 1 });
    h.fail(null);
    await h.tick([], T0 + 30_000); // inside the 1 min backoff
    expect(h.sent).toHaveLength(0);
    await h.tick([], T0 + MIN);
    expect(h.sent[0]?.text).toContain("INFO · The phone just restarted");
    await h.tick([], T0 + 2 * MIN);
    expect(h.sent).toHaveLength(1);
    expect(h.store.rows[0]?.notifiedState).toBe("closed");
  });

  test("failed send marks nothing; 3 failures in a row → failing; reset retries at once", async () => {
    const h = harness();
    h.fail(new TelegramError("telegram_forbidden", "telegram sendMessage failed: HTTP 403"));
    await h.tick([domainDown], T0);
    expect(h.store.rows[0]?.notifiedState).toBeNull();
    expect(h.engine.failing()).toBeNull();
    await h.tick([domainDown], T0 + 61 * MIN);
    await h.tick([domainDown], T0 + 122 * MIN);
    expect(h.engine.failing()).toBe("telegram_forbidden");
    expect(h.engine.status(SETTINGS).state).toBe("failing");
    h.fail(null);
    await h.tick([domainDown], T0 + 123 * MIN); // 403 waits an hour
    expect(h.sent).toHaveLength(0);
    h.engine.resetFailures();
    await h.tick([domainDown], T0 + 124 * MIN);
    expect(h.sent).toHaveLength(1);
    expect(h.store.rows[0]).toMatchObject({
      notifiedState: "open",
      notifiedSeverity: "danger",
      lastSentAt: T0 + 124 * MIN,
    });
  });

  test("429 waits retry_after", async () => {
    const h = harness();
    h.fail(new TelegramError("telegram_rate_limited", "HTTP 429", 300));
    await h.tick([domainDown], T0);
    h.fail(null);
    await h.tick([domainDown], T0 + 4 * MIN);
    expect(h.sent).toHaveLength(0);
    await h.tick([domainDown], T0 + 5 * MIN);
    expect(h.sent).toHaveLength(1);
  });

  test("channel off or not configured: nothing sent or marked, pending counted", async () => {
    const h = harness();
    await h.tick([domainDown], T0, { s: { enabled: false } });
    expect(h.sent).toHaveLength(0);
    expect(h.engine.status({ configured: true, enabled: false })).toMatchObject({ state: "disabled", pending: 1 });
    expect(h.engine.status({ configured: false, enabled: true }).state).toBe("not_configured");
    await h.tick([domainDown], T0 + MIN);
    expect(h.sent).toHaveLength(1);
  });

  test("alerts.language=id: digest and overflow text in Indonesian", async () => {
    const h = harness();
    const s = { language: "id" as const };
    await h.tick([appDown], T0, { s });
    await h.tick([appDown], T0 + MIN, { s });
    expect(h.sent[0]?.text).toBe(
      "<b>Panel Termux</b> · panel.example.test\nGAWAT · Aplikasi blog bermasalah · sejak 1 mnt\n\nBuka Ringkasan: https://panel.example.test/panel",
    );
    const cap = harness();
    for (let i = 0; i < ALERT_MAX_PER_HOUR; i++)
      await cap.tick([problem("disk_low", `d${i}`, "danger")], T0 + i * MIN, { s });
    expect(cap.sent.at(-1)?.text).toBe("Terlalu banyak notifikasi. Buka Ringkasan untuk melihat semuanya.");
  });

  test("hourly cap: 19 digests, then one overflow notice, then silence until the hour rolls", async () => {
    const h = harness();
    for (let i = 0; i < 25; i++) await h.tick([problem("disk_low", `d${i}`, "danger")], T0 + i * MIN);
    expect(h.sent).toHaveLength(ALERT_MAX_PER_HOUR);
    expect(h.sent[ALERT_MAX_PER_HOUR - 1]?.text).toBe("Too many alerts. Open Overview to see them all.");
    await h.tick([problem("disk_low", "late", "danger")], T0 + 61 * MIN);
    expect(h.sent).toHaveLength(ALERT_MAX_PER_HOUR + 1);
  });
});

describe("rules the engine relies on", () => {
  test("bootNotices: reboot by uptime, else unexpected restart without marker", () => {
    expect(bootNotices({ cleanShutdown: false, uptimeSec: 240 }).map((p) => [p.id, p.params.uptimeMin])).toEqual([
      ["host_rebooted:host", 4],
    ]);
    expect(bootNotices({ cleanShutdown: false, uptimeSec: 3600 }).map((p) => p.id)).toEqual([
      "panel_restarted_unexpectedly:panel",
    ]);
    expect(bootNotices({ cleanShutdown: true, uptimeSec: 3600 })).toEqual([]);
  });

  test("alertDelayMs: per table; info and alerts_failing never sent; app_crash_loop = 1 tick", () => {
    expect(alertDelayMs("service_down", 60)).toBe(120_000);
    expect(alertDelayMs("app_errored", 60)).toBe(60_000);
    expect(alertDelayMs("app_crash_loop", 90)).toBe(90_000);
    expect(alertDelayMs("domain_unreachable", 60)).toBe(0);
    expect(alertDelayMs("backup_not_configured", 60)).toBeNull();
    expect(alertDelayMs("access_not_seen", 60)).toBeNull();
    expect(alertDelayMs("alerts_failing", 60)).toBeNull();
  });
});
