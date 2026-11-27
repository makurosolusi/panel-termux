import { describe, expect, test } from "bun:test";
import type { DevHealth, DevSetup, PanelCheck, SetupItem } from "../src/shared/dev.types";
import type { Problem } from "../src/shared/panel.types";
import { codeSegments } from "../src/web/components/code-text";
import {
  checkRow,
  HEALTH_STATUS_KEY,
  infoRows,
  sortedChecks,
  verdictOf,
  verdictProblems,
  verdictSentence,
} from "../src/web/dev/health.state";
import {
  ACCESS_GUIDE_URL,
  bannerVisible,
  cardVisible,
  isComplete,
  itemAction,
  manualToggle,
  reopenNeedsPut,
  setupProgress,
  visibleItems,
} from "../src/web/dev/onboarding.state";
import { idDevHealth } from "../src/web/i18n/id.dev.health";
import { idDevSetup } from "../src/web/i18n/id.dev.setup";
import { formatLocaleForFile } from "./i18n.fixture";

formatLocaleForFile("id"); // Indonesian literals below until wave 1 migrates this file

// test-only fixtures
const NOW = new Date("2026-11-27T10:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const problem = (code: Problem["code"], severity: Problem["severity"], target = "x"): Problem => ({
  id: `${code}:${target}`,
  code,
  kind: "service",
  target,
  severity,
  params: {},
  since: null,
  href: "/panel/services",
});

const check = (key: PanelCheck["key"], status: PanelCheck["status"], value: PanelCheck["value"] = 0): PanelCheck => ({
  key,
  status,
  value,
});

const health = (over: Partial<DevHealth> = {}): DevHealth => ({
  version: "0.3.0",
  schemaVersion: "12",
  startedAt: minsAgo(120),
  uptimeSec: 7200,
  memory: { rssMb: 80, heapUsedMb: 30 },
  db: { sizeBytes: 1_000_000 },
  dataDir: { freeBytes: 50, totalBytes: 100 },
  runtime: { bun: "1.3", node: "24", platform: "android", arch: "arm64" },
  cpuCores: 8,
  requestsPerMinute: 4,
  errorCount5m: 0,
  counts: { users: 2, sessions: 3 },
  problems: [],
  infoCodes: [],
  checks: [
    check("errors", "ok"),
    check("sampler", "ok", 1),
    check("backup_scheduler", "ok", 2),
    check("fake_on_https", "ok", "termux"),
  ],
  sampledAt: minsAgo(1),
  backupTickAt: minsAgo(2),
  ...over,
});

const title = (p: Problem) => `T:${p.code}`;

describe("health verdict (B4: info never lowers it)", () => {
  test("only info codes → ok, and they show under Informasi", () => {
    const h = health({
      problems: [problem("backup_not_configured", "warning"), problem("access_not_seen", "warning")],
      infoCodes: ["backup_not_configured", "access_not_seen"],
    });
    expect(verdictOf(h)).toBe("ok");
    expect(verdictProblems(h)).toEqual([]);
    expect(infoRows(h)).toEqual(["backup_not_configured", "access_not_seen"]);
    expect(verdictSentence(h, NOW, title)).toBe(idDevHealth.verdictOk);
  });

  test("info codes fall back to the B4 defaults when the server omits infoCodes", () => {
    const h = health({ problems: [problem("backup_not_configured", "warning")], infoCodes: undefined });
    expect(verdictOf(h)).toBe("ok");
  });

  test("severity info never counts even with an unknown code", () => {
    expect(verdictOf(health({ problems: [problem("host_rebooted", "info")] }))).toBe("ok");
  });

  test("one danger problem → fail; headline is that problem", () => {
    const h = health({ problems: [problem("disk_low", "warning"), problem("service_down", "danger")] });
    expect(verdictOf(h)).toBe("fail");
    expect(verdictProblems(h).map((p) => p.code)).toEqual(["service_down", "disk_low"]);
    expect(verdictSentence(h, NOW, title)).toBe("T:service_down");
  });

  test("a warn check → warn; server verdict wins when present", () => {
    const h = health({ checks: [check("errors", "warn", 4)] });
    expect(verdictOf(h)).toBe("warn");
    expect(verdictSentence(h, NOW, title)).toBe(idDevHealth.checks.errors.warn(4));
    expect(verdictOf({ ...h, verdict: "fail" })).toBe("fail");
  });

  test("failing check outranks a warning problem in the headline", () => {
    const h = health({ problems: [problem("disk_low", "warning")], checks: [check("fake_on_https", "fail", "fake")] });
    expect(verdictSentence(h, NOW, title)).toBe(idDevHealth.checks.fake_on_https.fail);
  });

  test("verdict maps to canonical status keys", () => {
    expect(HEALTH_STATUS_KEY).toEqual({ ok: "healthy", warn: "attention", fail: "errored" });
  });
});

describe("check rows", () => {
  test("errors: ok has no link; warn/fail link to the error log with the count", () => {
    const h = health();
    expect(checkRow(check("errors", "ok", 0), h, NOW)).toEqual({
      key: "errors",
      status: "ok",
      text: idDevHealth.checks.errors.ok,
      href: undefined,
    });
    const fail = checkRow(check("errors", "fail", 12), h, NOW);
    expect(fail.text).toBe(idDevHealth.checks.errors.fail(12));
    expect(fail.href).toBe("/dev/logs?level=error");
  });

  test("sampler before the first sample → waiting and never lowers the row", () => {
    const row = checkRow(check("sampler", "warn", null), health({ sampledAt: null }), NOW);
    expect(row.status).toBe("ok");
    expect(row.text).toBe(idDevHealth.checks.sampler.waiting);
  });

  test("late sampler says how long ago", () => {
    const row = checkRow(check("sampler", "warn", 20), health({ sampledAt: minsAgo(20) }), NOW);
    expect(row.status).toBe("warn");
    expect(row.text).toContain("20 mnt lalu");
    expect(row.text).toContain("terlambat");
  });

  test("checks sort worst first", () => {
    const h = health({ checks: [check("errors", "ok"), check("sampler", "warn"), check("fake_on_https", "fail")] });
    expect(sortedChecks(h).map((c) => c.key)).toEqual(["fake_on_https", "sampler", "errors"]);
  });
});

const item = (
  key: SetupItem["key"],
  level: SetupItem["level"],
  done = false,
  over: Partial<SetupItem> = {},
): SetupItem => ({
  key,
  level,
  done,
  source: "auto",
  needsFirstRun: false,
  applicable: true,
  ...over,
});

const setup = (over: Partial<DevSetup> = {}): DevSetup => ({
  items: [
    item("access", "required", true),
    item("secret_saved", "required", true, { source: "manual" }),
    item("backup", "required"),
    item("cloudflare_token", "recommended"),
    item("apps_json", "recommended"),
    item("first_site", "recommended"),
    item("admins", "optional", true),
  ],
  dismissedAt: null,
  complete: false,
  ...over,
});

describe("onboarding items", () => {
  test("progress counts required + recommended only: 2 dari 6", () => {
    expect(setupProgress(setup())).toEqual({ done: 2, total: 6 });
    expect(idDevSetup.banner.title(2, 6)).toBe("Siapkan Panel Termux: 2 dari 6 selesai");
  });

  test("access not applicable (http base) is hidden and not counted", () => {
    const s = setup();
    s.items[0] = item("access", "required", false, { applicable: false });
    expect(visibleItems(s).map((i) => i.key)).not.toContain("access");
    expect(setupProgress(s)).toEqual({ done: 1, total: 5 });
  });

  test("0.2.x adopt_sites never renders", () => {
    const s = setup({ items: [...setup().items, item("adopt_sites", "recommended")] });
    expect(visibleItems(s).some((i) => i.key === "adopt_sites")).toBe(false);
  });

  test("manual tick: pending access/secret → tick; manual-done → untick; auto-done or other keys → none", () => {
    expect(manualToggle(item("access", "required"))).toBe("tick");
    expect(manualToggle(item("secret_saved", "required", true, { source: "manual" }))).toBe("untick");
    expect(manualToggle(item("secret_saved", "required", true, { source: "auto" }))).toBeNull();
    expect(manualToggle(item("backup", "required"))).toBeNull();
  });

  test("actions: backup switches to the first run, access opens the recipe, secret jumps to the data key card", () => {
    expect(itemAction(item("backup", "required"))?.to).toBe("/dev/settings#cadangan");
    expect(itemAction(item("backup", "required", false, { needsFirstRun: true }))).toEqual({
      kind: "route",
      to: "/panel/backups",
      label: idDevSetup.backupFirstRun,
    });
    expect(itemAction(item("access", "required"))).toMatchObject({ kind: "external", to: ACCESS_GUIDE_URL });
    expect(itemAction(item("secret_saved", "required"))).toMatchObject({ kind: "anchor", to: "#kunci-data" });
    expect(itemAction(item("first_site", "recommended"))?.to).toBe("/panel/sites/new");
  });

  test("backtick copy splits into code segments", () => {
    expect(codeSegments(idDevSetup.items.secret_saved.body)[0]).toEqual({ text: "data/secret", code: true });
    expect(codeSegments("a `b` c")).toEqual([
      { text: "a ", code: false },
      { text: "b", code: true },
      { text: " c", code: false },
    ]);
  });
});

describe("onboarding dismiss", () => {
  test("pending + not dismissed → card and banner show", () => {
    expect(cardVisible(setup(), false)).toBe(true);
    expect(bannerVisible(setup())).toBe(true);
  });

  test("dismissed → both hidden, even when reopened locally; reopen needs a PUT", () => {
    const s = setup({ dismissedAt: "2026-11-27T09:00:00Z" });
    expect(cardVisible(s, false)).toBe(false);
    expect(cardVisible(s, true)).toBe(false);
    expect(bannerVisible(s)).toBe(false);
    expect(reopenNeedsPut(s)).toBe(true);
  });

  test("complete → hidden automatically; the reopen button shows it again without a PUT", () => {
    const s = setup({ complete: true });
    expect(cardVisible(s, false)).toBe(false);
    expect(bannerVisible(s)).toBe(false);
    expect(reopenNeedsPut(s)).toBe(false);
    expect(cardVisible(s, true)).toBe(true);
  });

  test("complete derived from items when the server omits it (optional ignored)", () => {
    const all = setup().items.map((i) => ({ ...i, done: i.level !== "optional" }));
    expect(isComplete({ items: all })).toBe(true);
    expect(isComplete({ items: setup().items })).toBe(false);
  });
});
