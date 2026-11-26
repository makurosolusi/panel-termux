import { describe, expect, test } from "bun:test";
import type { LoadBaseline, Problem, ProblemCode } from "@/shared/monitor.types";
import type { App, Battery, Domain, DomainHealth, PanelOverview, Service } from "@/shared/panel.types";
import { detail, title } from "@/shared/problem.copy";
import { idPanel } from "@/web/i18n/id.panel";
import { appColumns } from "@/web/panel/apps.page";
import { isBackupStale } from "@/web/panel/databases.page";
import { domainRows, domainTarget } from "@/web/panel/domains.page";
import { logUrls, parseStream } from "@/web/panel/log.page";
import {
  batteryView,
  countBadge,
  isFrozen,
  loadView,
  problemLogHref,
  problemSetKey,
  sinceText,
  splitProblems,
} from "@/web/panel/overview.state";
import { controlPlan, isDeferredRestart } from "@/web/panel/panel.control";
import { appKey, domainHolder, domainVerdict, serviceKey } from "@/web/panel/panel.status-key";
import { cloudflaredPoll, needsFullReload, panelPoll } from "@/web/panel/restart.state";
import { serviceSince, sortServices } from "@/web/panel/services.page";
import { apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";

// test-only fixtures
const svc = (over: Partial<Service> = {}): Service => ({
  name: "nginx",
  state: "run",
  pid: 10,
  uptimeSec: 3600,
  wantUp: true,
  protected: false,
  ...over,
});
const app = (over: Partial<App> = {}): App => ({
  name: "blog-app",
  status: "online",
  pid: 2,
  memoryMb: 50,
  cpu: null,
  restarts: 0,
  uptimeSec: 10,
  port: 3000,
  ...over,
});
const health = (over: Partial<DomainHealth> = {}): DomainHealth => ({
  status: 200,
  ms: 85,
  checkedAt: "2026-11-26T07:00:00Z",
  failures: 0,
  local: null,
  ...over,
});
const domain = (over: Partial<Domain> = {}): Domain => ({
  hostname: "blog.example.com",
  service: "http://localhost:3000",
  port: 3000,
  app: "blog-app",
  site: "blog",
  target: "app",
  health: health(),
  ...over,
});
const problem = (over: Partial<Problem> & Pick<Problem, "code" | "kind">): Problem => ({
  id: `${over.code}:${over.target ?? ""}`,
  target: "",
  severity: "danger",
  params: {},
  since: null,
  href: "/panel",
  ...over,
});

describe("serviceKey / appKey", () => {
  test.each([
    ["run", true, "running"],
    ["down", true, "down"],
    ["down", false, "stopped"],
    ["finish", true, "restarting"],
    ["unknown", true, "unknown"],
  ] as const)("service %s wantUp=%p → %s", (state, wantUp, key) => expect(serviceKey({ state, wantUp })).toBe(key));

  test.each([
    ["online", false, "running"],
    ["launching", false, "starting"],
    ["errored", false, "errored"],
    ["stopped", false, "stopped"],
    ["online", true, "crash_loop"],
    ["errored", true, "errored"],
  ] as const)("app %s crashLoop=%p → %s", (status, loop, key) => expect(appKey({ status }, loop)).toBe(key));
});

describe("domainVerdict (PLAN/02 §5.4)", () => {
  const r = idPanel.domains.reasons;
  test("not checked yet", () =>
    expect(domainVerdict(health({ checkedAt: null, status: null }))).toEqual({
      key: "unchecked",
      reason: r.unchecked,
    }));
  test("2xx/3xx healthy without reason", () => {
    expect(domainVerdict(health({ status: 200 }))).toEqual({ key: "healthy", reason: "" });
    expect(domainVerdict(health({ status: 302 })).key).toBe("healthy");
  });
  test("401/403 → auth_required", () => {
    for (const status of [401, 403])
      expect(domainVerdict(health({ status }))).toEqual({ key: "auth_required", reason: r.authRequired });
  });
  test("other 4xx is healthy with the status in the reason", () =>
    expect(domainVerdict(health({ status: 404 }))).toEqual({ key: "healthy", reason: r.clientError(404) }));
  test("fewer than 3 failures → unstable with the count", () =>
    expect(domainVerdict(health({ status: 502, failures: 2 }))).toEqual({ key: "unstable", reason: r.unstable(2) }));
  test("3 failures, local answers → tunnel is the problem", () =>
    expect(domainVerdict(health({ status: 502, failures: 3, local: 200 }))).toEqual({
      key: "unhealthy",
      reason: r.localAnswers(200),
    }));
  test("3 failures, no local answer → port is silent", () => {
    expect(domainVerdict(health({ status: null, failures: 3 }), { port: 3000 })).toEqual({
      key: "unhealthy",
      reason: r.portSilent(3000),
    });
    expect(domainVerdict(health({ status: 504, failures: 4 })).reason).toBe(r.noAnswer);
  });
  test("530 after 3 failures → tunnel_down", () =>
    expect(domainVerdict(health({ status: 530, failures: 3 }))).toEqual({ key: "tunnel_down", reason: r.tunnelDown }));
  test("held by another problem names it", () => {
    const heldBy = problem({ code: "service_down", kind: "service", target: "cloudflared" });
    expect(domainVerdict(health({ status: 530, failures: 3 }), { heldBy })).toEqual({
      key: "tunnel_down",
      reason: r.heldBy("Layanan cloudflared mati"),
    });
  });
  test("app stopped on purpose → stopped, even when failing", () =>
    expect(domainVerdict(health({ status: 502, failures: 5 }), { appStatus: "stopped" }).key).toBe("stopped"));
  test("wildcard is never probed", () =>
    expect(domainVerdict(health(), { wildcard: true })).toEqual({ key: "unchecked", reason: r.wildcard }));

  test("domainHolder precedence: internet, cloudflared, pm2 (app targets), own app", () => {
    const own = problem({ code: "app_errored", kind: "app", target: "blog-app" });
    const pm2 = problem({ code: "pm2_unavailable", kind: "service", target: "pm2" });
    const cf = problem({ code: "service_down", kind: "service", target: "cloudflared" });
    const net = problem({ code: "internet_down", kind: "network", target: "" });
    const d = domain();
    expect(domainHolder(d, [own])).toBe(own);
    expect(domainHolder(d, [own, pm2])).toBe(pm2);
    expect(domainHolder(d, [own, pm2, cf])).toBe(cf);
    expect(domainHolder(d, [own, pm2, cf, net])).toBe(net);
    expect(domainHolder(domain({ target: "panel", app: null }), [pm2])).toBeNull();
  });

  test("domainRows reads app status + holder from the overview; healthy rows are never held", () => {
    const o = {
      apps: [app({ status: "stopped" })],
      problems: [problem({ code: "service_down", kind: "service", target: "cloudflared" })],
    } as unknown as PanelOverview;
    expect(domainRows([domain({ health: health({ status: 502, failures: 3 }) })], o)[0]?.verdict.key).toBe("stopped");
    const other = domainRows([domain({ app: null, target: "other", health: health({ status: 530, failures: 3 }) })], o);
    expect(other[0]?.verdict.reason).toContain("Penyebabnya");
    expect(domainRows([domain({ app: null })], o)[0]?.verdict).toEqual({ key: "healthy", reason: "" });
  });

  test("domainTarget copy", () => {
    expect(domainTarget(domain())).toBe("Situs blog · aplikasi blog-app");
    expect(domainTarget(domain({ target: "panel", app: null }))).toBe("Panel Termux");
    expect(domainTarget(domain({ target: "other", app: null, service: "http://localhost:8080" }))).toBe(
      "Layanan lain (http://localhost:8080)",
    );
    expect(domainTarget(domain({ target: "none", app: null, port: null }))).toBe("Tanpa tujuan");
  });
});

test("every ProblemCode has a title and a detail", () => {
  // test-only: Record<ProblemCode, …> makes tsc fail when a code is added without being listed here
  const codes: Record<ProblemCode, true> = {
    service_down: true,
    service_crash_loop: true,
    pm2_unavailable: true,
    app_errored: true,
    app_crash_loop: true,
    domain_unreachable: true,
    domain_http_error: true,
    internet_down: true,
    backup_not_configured: true,
    backup_failed: true,
    backup_partial: true,
    backup_stale: true,
    backup_item_stale: true,
    backup_status_error: true,
    backup_secrets_included: true,
    key_mismatch: true,
    access_not_seen: true,
    disk_low: true,
    battery_low: true,
    battery_hot: true,
    alerts_failing: true,
    site_job_failed: true,
    host_rebooted: true,
    panel_restarted_unexpectedly: true,
  };
  for (const code of Object.keys(codes) as ProblemCode[]) {
    const p = { code, target: "x", params: {} };
    expect(title(p).length).toBeGreaterThan(3);
    expect(detail(p).length).toBeGreaterThan(3);
  }
});

describe("control tiers (PLAN/02 §5.2)", () => {
  const plan = (s: Partial<Service>) => controlPlan({ kind: "services", item: svc(s) });
  test("ordinary running service: restart primary, restart+stop confirm, start without dialog", () =>
    expect(plan({})).toEqual({ primary: "restart", tiers: { start: "none", restart: "confirm", stop: "confirm" } }));
  test.each(["sshd", "pm2", "postgres"])("protected %s: stop typed, restart confirm", (name) => {
    const p = plan({ name, protected: true });
    expect(p.tiers.stop).toBe("typed");
    expect(p.tiers.restart).toBe("confirm");
  });
  test.each(["panel", "cloudflared"])("%s: stop locked (lockout), also without the lockout field", (name) => {
    expect(plan({ name, protected: true }).tiers.stop).toBe("locked");
    expect(plan({ name: "other", lockout: true }).tiers.stop).toBe("locked");
  });
  test("down service: start primary, stop not offered", () =>
    expect(plan({ state: "down", pid: null })).toEqual({
      primary: "start",
      tiers: { start: "none", restart: "confirm", stop: "hidden" },
    }));
  test("apps: stop confirm, never typed; stopped app offers start", () => {
    expect(controlPlan({ kind: "apps", item: app() }).tiers.stop).toBe("confirm");
    expect(controlPlan({ kind: "apps", item: app({ status: "stopped" }) }).primary).toBe("start");
    expect(controlPlan({ kind: "apps", item: app({ status: "errored" }) }).primary).toBe("start");
  });
  test("only service restarts of panel/cloudflared are deferred", () => {
    expect(isDeferredRestart("services", "panel", "restart")).toBe(true);
    expect(isDeferredRestart("services", "cloudflared", "restart")).toBe(true);
    expect(isDeferredRestart("services", "cloudflared", "start")).toBe(false);
    expect(isDeferredRestart("apps", "panel", "restart")).toBe(false);
  });
  test("cloudflared and panel carry their impact text", () => {
    expect(idPanel.serviceImpact.cloudflared).toContain("Semua domain");
    expect(idPanel.serviceImpact.panel).toContain("terputus");
  });
});

describe("restart overlay decisions (PLAN/02 §4.4)", () => {
  test("panel is back only with JSON carrying a new bootId", () => {
    expect(panelPoll({ ok: true, version: "0.3.0", bootId: "old" }, "old")).toBe("waiting");
    expect(panelPoll(null, "old")).toBe("waiting");
    expect(panelPoll("<html>502</html>", "old")).toBe("waiting");
    expect(panelPoll({ ok: true, version: "0.3.0", bootId: "new" }, "old")).toBe("back");
  });
  test("cloudflared is back when running under a new pid", () => {
    expect(cloudflaredPoll([svc({ name: "cloudflared", pid: 5 })], 5)).toBe("waiting");
    expect(cloudflaredPoll([svc({ name: "cloudflared", state: "down", pid: null })], 5)).toBe("waiting");
    expect(cloudflaredPoll({ error: "x" }, 5)).toBe("waiting");
    expect(cloudflaredPoll([svc({ name: "cloudflared", pid: 6 })], 5)).toBe("back");
  });
  test("a changed version forces a full reload", () => {
    expect(needsFullReload("0.3.0", { ok: true, version: "0.3.1", bootId: "n" })).toBe(true);
    expect(needsFullReload("0.3.0", { ok: true, version: "0.3.0", bootId: "n" })).toBe(false);
    expect(needsFullReload(null, { ok: true, version: "0.3.1", bootId: "n" })).toBe(false);
  });
});

describe("Ringkasan state", () => {
  const danger = problem({ code: "service_down", kind: "service", target: "postgres", href: "/panel/services" });
  const info = problem({ code: "backup_not_configured", kind: "backup", severity: "info", href: "/panel/backups" });

  test("info items never join the alert strip or the count badges (B4)", () => {
    expect(splitProblems([danger, info])).toEqual({ alerts: [danger], info: [info] });
    expect(countBadge(["backup"], [info])).toEqual({ tone: "success", text: "Semua berjalan" });
  });
  test("count badge: down vs needs checking", () => {
    expect(countBadge(["service"], [danger])).toEqual({ tone: "danger", text: "1 mati" });
    const loop = problem({ code: "app_crash_loop", kind: "app", severity: "warning" });
    expect(countBadge(["app"], [loop])).toEqual({ tone: "warning", text: "1 perlu dicek" });
  });
  test("problem set key ignores order (live region speaks only on change)", () => {
    const b = problem({ code: "disk_low", kind: "disk", target: "x" });
    expect(problemSetKey([danger, b])).toBe(problemSetKey([b, danger]));
    expect(problemSetKey([danger])).not.toBe(problemSetKey([danger, b]));
  });
  test("battery: charge state neutral (A9), tone only from battery_low", () => {
    const b: Battery = {
      percent: 80,
      charging: false,
      status: "discharging",
      plugged: "unplugged",
      temperatureC: 33,
      health: null,
    };
    expect(batteryView(b, [])).toEqual({ value: "80%", hint: "Tidak mengisi", tone: undefined });
    expect(batteryView({ ...b, status: "not_charging", plugged: "usb" }, []).hint).toBe("Dicolok, tidak mengisi");
    expect(batteryView({ ...b, status: "charging", charging: true }, []).hint).toBe("Sedang dicas");
    const low = problem({ code: "battery_low", kind: "battery", severity: "warning" });
    expect(batteryView({ ...b, percent: 22 }, [low]).tone).toBe("warning");
    expect(batteryView(null, []).value).toBe("Tidak tersedia");
  });
  test("load is neutral without baseline, toned by ratio to the usual median (K6)", () => {
    const base: LoadBaseline = { p10: 18, p50: 20, p90: 22, spanHours: 48 };
    expect(loadView([20.9, 20.7, 20], null)).toEqual({
      value: "Beban sistem 20,9 · 20,7 · 20",
      usual: "nilai biasanya muncul setelah 1 hari pemantauan",
      tone: undefined,
    });
    expect(loadView([20, 21, 20], base)).toEqual({
      value: "Beban sistem 20 · 21 · 20",
      usual: "biasanya 18–22",
      tone: undefined,
    });
    expect(loadView([31, 31, 30], base).tone).toBe("warning");
    expect(loadView([41, 41, 40], base).tone).toBe("danger");
  });
  test("frozen problems come from unreadable sections", () => {
    expect(isFrozen(danger, ["services"])).toBe(true);
    expect(isFrozen(danger, ["apps"])).toBe(false);
  });
  test("since text in whole minutes", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(sinceText(null, now)).toBeNull();
    expect(sinceText("2026-11-27T09:59:30Z", now)).toBe("baru saja");
    expect(sinceText("2026-11-27T09:47:40Z", now)).toBe("sejak 12 mnt");
  });
  test("second link goes to the unit log unless the main link already is the log", () => {
    expect(problemLogHref(danger)).toBe("/panel/services/postgres/log");
    expect(
      problemLogHref(
        problem({ code: "app_errored", kind: "app", target: "web", href: "/panel/apps/web/log?stream=err" }),
      ),
    ).toBeNull();
    expect(problemLogHref(problem({ code: "pm2_unavailable", kind: "service", target: "pm2" }))).toBe(
      "/panel/services/pm2/log",
    );
    expect(problemLogHref(info)).toBeNull();
  });
});

describe("list pages", () => {
  test("services: problems first, then by name; since text", () => {
    const list = [
      svc({ name: "b" }),
      svc({ name: "a", state: "down", wantUp: true }),
      svc({ name: "c", state: "down", wantUp: false }),
    ];
    expect(sortServices(list).map((s) => s.name)).toEqual(["a", "c", "b"]);
    expect(serviceSince(svc({ uptimeSec: 10_800 }))).toBe("aktif 3 jam");
    expect(serviceSince(svc({ state: "down", downSec: 118_800, uptimeSec: null }))).toBe("mati 1 hari 9 jam");
    expect(serviceSince(svc({ state: "down", uptimeSec: null }))).toBe("–");
  });
  test("apps table has no CPU column", () => expect(appColumns.map((c) => c.key)).not.toContain("cpu"));
  test("database backup older than 36 h is stale; never backed up is not flagged", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    expect(isBackupStale("2026-11-25T23:00:00Z", now)).toBe(true);
    expect(isBackupStale("2026-11-27T01:00:00Z", now)).toBe(false);
    expect(isBackupStale(null, now)).toBe(false);
  });
  test("log urls: stream only for apps, download beside follow", () => {
    expect(logUrls("apps", "blog app", "err")).toEqual({
      follow: "/api/panel/apps/blog%20app/log?stream=err",
      download: "/api/panel/apps/blog%20app/log/download?stream=err",
    });
    expect(logUrls("services", "sshd", "err").follow).toBe("/api/panel/services/sshd/log");
    expect(parseStream(new URLSearchParams("stream=err"))).toBe("err");
    expect(parseStream(new URLSearchParams("stream=x"))).toBe("out");
  });
});

describe("panel error messages", () => {
  test.each([
    [409, "lockout", "memutus akses"],
    [409, "job_running", "Tunggu sampai selesai"],
    [409, "not_supervised", "runit"],
    [503, "pm2_unavailable", "pm2 tidak berjalan"],
    [429, "too_soon", "Tunggu sebentar"],
  ] as const)("%i %s", (status, error, text) =>
    expect(apiErrorMessage(errorFromResponse(status, { error }), idPanel.errorCodes)).toContain(text),
  );
});
