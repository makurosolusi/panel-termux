import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { createAuth } from "@/server/auth/auth.service";
import { backupServiceFor } from "@/server/backup/backup.service";
import { getSecurityStatus } from "@/server/data-key.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, site, user } from "@/server/db/schema";
import { createMonitor } from "@/server/monitor/monitor.service";
import { createPanelRoutes } from "@/server/routes/panel.routes";
import { setSetting } from "@/server/settings.service";
import { createFakeSystem, type FakeOptions } from "@/server/system/system.fake";
import type { DevAuditEntry, Page } from "@/shared/dev.types";
import type { AlertStatus, MetricSeries, PanelStatus, ProblemEvent } from "@/shared/monitor.types";
import type {
  App,
  DatabaseInfo,
  DeferredRestart,
  Domain,
  LogChunk,
  PanelOverview,
  Service,
} from "@/shared/panel.types";
import type { Role } from "@/shared/roles";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "0123456789abcdef".repeat(4);
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: [] };
const FAKE_DELAY_MS = 30;
const SITE_SECRET = "demo line 1"; // test-only: an .env value that occurs in the fake adminneo log

const dir = mkdtempSync(join(tmpdir(), "panel-api-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let admin: string;
let userCookie: string;
let adminId: string;
type Api = { handle(r: Request): Promise<Response> };
let api: Api;
const gate = { jobActive: false, jobLocked: false, backupBusy: false };
const restarts: number[] = [];
let seq = 0;
function addUser(email: string, role: Role): string {
  const id = `p${++seq}`;
  db.insert(user)
    .values({ id, email, name: `n${seq}`, role })
    .run();
  return id;
}

async function cookieFor(userId: string): Promise<string> {
  const ctx = await auth.$context;
  const s = await ctx.internalAdapter.createSession(userId);
  if (!s) throw new Error(`createSession for ${userId} returned null`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(s.token));
  return `better-auth.session_token=${encodeURIComponent(`${s.token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)}`;
}

/** Panel routes over a fresh fake system and monitor (one tick done). */
async function makeApi(fake: FakeOptions = {}): Promise<Api> {
  const system = createFakeSystem({ delayMs: FAKE_DELAY_MS, home: mkdtempSync(join(dir, "home-")), ...fake });
  const backup = backupServiceFor({ db, secret: SECRET, dataDir: dir, system });
  const monitor = createMonitor({
    db,
    secret: SECRET,
    system,
    backupStatus: () => backup.status(),
    securityStatus: () => getSecurityStatus({ db, secret: SECRET }, { appBaseUrl: BASE, createdThisBoot: false }),
    jobs: () => [],
    adminSeenSinceBoot: () => false,
    appBaseUrl: BASE,
    panelPort: 3200,
    bootNotice: { cleanShutdown: true, uptimeSec: 86_400 },
    connectivityUrl: "http://127.0.0.1:1/", // test-only: never reached while some domain answers
  });
  await monitor.tick();
  const routes = createPanelRoutes(auth, {
    db,
    secret: SECRET,
    system,
    monitor,
    jobs: { active: () => (gate.jobActive ? ({ id: "j" } as never) : null), isLocked: () => gate.jobLocked },
    backup: { busy: () => gate.backupBusy },
    bootId: "boot-1",
    panelPort: 3200,
    restartSelf: () => restarts.push(Date.now()),
  });
  return new Elysia({ prefix: "/api" }).use(routes);
}

const call = (method: string, path: string, opts: { cookie?: string; body?: unknown; on?: Api } = {}) =>
  (opts.on ?? api).handle(
    new Request(`${BASE}/api/panel${path}`, {
      method,
      headers: {
        ...(opts.cookie === "" ? {} : { cookie: opts.cookie ?? admin }),
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action)).all();

beforeAll(async () => {
  db = openDb(dir);
  runMigrations(db);
  auth = createAuth({ db, env, secret: SECRET });
  const siteDir = join(dir, "site-adminneo");
  mkdirSync(siteDir);
  writeFileSync(join(siteDir, ".env"), `PORT=3006\nAPP_KEY=${SITE_SECRET}\n`);
  db.insert(site)
    .values({
      name: "neo",
      port: 3006,
      app: "adminneo",
      database: "adminneo",
      runtime: "native",
      managed: true,
      dir: siteDir,
    })
    .run();
  adminId = addUser("admin@x.io", "admin");
  admin = await cookieFor(adminId);
  userCookie = await cookieFor(addUser("plain@x.io", "user"));
  api = await makeApi({ panelPid: process.pid });
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("access control", () => {
  const endpoints = [
    ["GET", "/overview"],
    ["GET", "/status"],
    ["GET", "/metrics"],
    ["GET", "/problems/history"],
    ["GET", "/alerts/status"],
    ["GET", "/services"],
    ["POST", "/services/crond/start"],
    ["GET", "/services/sshd/log"],
    ["GET", "/services/sshd/log/download"],
    ["GET", "/apps"],
    ["POST", "/apps/adminneo/restart"],
    ["GET", "/apps/adminneo/log"],
    ["GET", "/apps/adminneo/log/download"],
    ["GET", "/domains"],
    ["POST", "/domains/db.contoh.test/check"],
    ["GET", "/databases"],
  ];
  test.each(endpoints)("%s %s → 401 anon, 403 user", async (method, path) => {
    expect(await json(await call(method, path, { cookie: "" }), 401)).toEqual({ error: "unauthorized" });
    expect(await json(await call(method, path, { cookie: userCookie }), 403)).toEqual({ error: "forbidden" });
  });
});

describe("monitoring reads", () => {
  test("overview: problem-first data from the monitor, Android-like battery, public app fields only", async () => {
    const o = await json<PanelOverview>(await call("GET", "/overview"));
    expect(o.mode).toBe("fake");
    expect(o.device?.battery).toEqual({
      percent: 81,
      charging: false,
      status: "discharging",
      plugged: "unplugged",
      temperatureC: 31.5,
      health: "GOOD",
    });
    const ids = o.problems.map((p) => `${p.id}:${p.severity}`);
    expect(ids).toContain("app_errored:kasir-lama:danger");
    expect(ids).toContain("backup_not_configured:backup:info");
    expect(ids.some((k) => k.startsWith("service_down:crond"))).toBe(false); // crond is intentionally down
    expect(o.problems.every((p) => p.kind !== "host")).toBe(true);
    expect(o.unavailable).toEqual([]);
    expect(o.sampledAt).toEqual(expect.any(String));
    expect(Date.parse(o.dataAt ?? "")).toBeLessThanOrEqual(Date.parse(o.generatedAt));
    expect(o.backup).toEqual({ configured: false, lastRunAt: null, lastStatus: null, nextRunAt: null });
    expect(o.sites).toEqual({ total: 1, deployed: 1 });
    expect(o.alerts).toEqual({ state: "not_configured", lastError: null });
    expect(o.recentActivity.length).toBeLessThanOrEqual(5);
    const neo = o.apps.find((a) => a.name === "adminneo") as App & Record<string, unknown>;
    expect(neo).toMatchObject({ site: "neo", cpu: null, module: false });
    for (const k of ["outLog", "errLog", "cwd", "execPath", "args"]) expect(neo[k]).toBeUndefined();
    expect(o.services.find((s) => s.name === "panel")).toMatchObject({ lockout: true, protected: true });
  });

  test("activity without auth./session.; status counts danger/warning; metrics; history; alert status", async () => {
    await call("POST", "/services/crond/start");
    const o = await json<PanelOverview>(await call("GET", "/overview"));
    const actions = o.recentActivity.map((e: DevAuditEntry) => e.action);
    expect(actions).toContain("service.start");
    expect(actions.every((a) => !a.startsWith("auth.") && !a.startsWith("session."))).toBe(true);
    const s = await json<PanelStatus>(await call("GET", "/status"));
    expect(s.danger).toBe(o.problems.filter((p) => p.severity === "danger").length);
    expect(s.warning).toBe(o.problems.filter((p) => p.severity === "warning").length);
    expect(s.sampledAt).toBe(o.sampledAt ?? null);
    expect((await json<MetricSeries>(await call("GET", "/metrics"))).range).toBe("24h");
    const week = await json<MetricSeries>(await call("GET", "/metrics?range=7d"));
    expect(week).toMatchObject({ range: "7d", bucketSec: 7200 });
    expect(week.points.length).toBeGreaterThan(0);
    expect(await json(await call("GET", "/metrics?range=1y"), 400)).toMatchObject({ error: "invalid_range" });
    const h = await json<Page<ProblemEvent>>(await call("GET", "/problems/history?pageSize=500"));
    expect(h.pageSize).toBe(100);
    expect(h.items.some((e) => e.code === "app_errored")).toBe(true);
    expect(h.items.every((e) => e.severity !== "info" && e.kind !== "host")).toBe(true);
    expect(await json(await call("GET", "/problems/history?page=0"), 400)).toMatchObject({
      error: "invalid_pagination",
    });
    expect(await json<AlertStatus>(await call("GET", "/alerts/status"))).toMatchObject({ state: "not_configured" });
  });

  test("domains: health from stored checks, target and recent strip; manual check validation + 429 extra", async () => {
    const d = await json<Domain[]>(await call("GET", "/domains"));
    const solusi = d.find((x) => x.hostname === "solusi.contoh.test");
    expect(solusi).toMatchObject({
      port: 3005,
      app: "makuro-solusi",
      target: "app",
      health: { status: 200, failures: 0 },
    });
    expect(solusi?.recent?.length).toBeGreaterThan(0);
    expect(d.find((x) => x.hostname === "old.contoh.test")).toMatchObject({
      target: "other",
      health: { status: 502, failures: 1 },
    });
    expect(await json(await call("POST", "/domains/bad_host!/check"), 400)).toMatchObject({
      error: "invalid_hostname",
    });
    expect(await json(await call("POST", "/domains/nope.example.test/check"), 404)).toMatchObject({
      error: "not_found",
    });
    expect(await json<Domain>(await call("POST", "/domains/db.contoh.test/check"))).toMatchObject({
      hostname: "db.contoh.test",
      health: { status: 200 },
    });
    const again = await json(await call("POST", "/domains/db.contoh.test/check"), 429);
    expect(again).toMatchObject({ error: "too_soon", retryAfterSec: expect.any(Number) });
  });

  test("databases carry site and last backup; postgres down → 503 postgres_down", async () => {
    const d = await json<DatabaseInfo[]>(await call("GET", "/databases"));
    expect(d.find((x) => x.name === "adminneo")).toMatchObject({ site: "neo", lastBackupAt: null });
    await call("POST", "/services/postgres/stop", { body: { confirm: "postgres" } });
    expect(await json(await call("GET", "/databases"), 503)).toMatchObject({ error: "postgres_down" });
    await call("POST", "/services/postgres/start");
  });

  test("pm2 not running → 503 pm2_unavailable with reason", async () => {
    const down = await makeApi({ supervisorDown: true });
    const want = { error: "pm2_unavailable", reason: "service_down" };
    expect(await json(await call("GET", "/apps", { on: down }), 503)).toMatchObject(want);
    expect(await json(await call("POST", "/apps/adminneo/restart", { on: down }), 503)).toMatchObject(want);
  });
});

describe("control", () => {
  test("service start/stop are audited; the next read shows the new state", async () => {
    expect((await json<Service>(await call("POST", "/services/crond/stop"))).state).toBe("down");
    const s = await json<Service>(await call("POST", "/services/crond/start"));
    expect(s).toMatchObject({ name: "crond", state: "run", protected: false, lockout: false });
    expect((await json<Service[]>(await call("GET", "/services"))).find((x) => x.name === "crond")?.state).toBe("run");
    expect(audits("service.start").some((r) => r.target === "crond" && r.actorId === adminId)).toBe(true);
  });

  test("protected stop needs the typed name; audit records confirmTyped", async () => {
    expect(await json(await call("POST", "/services/sshd/stop"), 409)).toMatchObject({ error: "confirm_required" });
    expect((await call("POST", "/services/sshd/stop", { body: { confirm: "ssh" } })).status).toBe(409);
    const s = await json<Service>(await call("POST", "/services/sshd/stop", { body: { confirm: "sshd" } }));
    expect(s).toMatchObject({ state: "down", protected: true });
    expect(audits("service.stop").find((r) => r.target === "sshd")?.meta).toEqual({ confirmTyped: true });
    await call("POST", "/services/sshd/start");
  });

  test("panel and cloudflared can never be stopped (lockout), even outside protected_services", async () => {
    setSetting({ db, secret: SECRET }, "panel.protected_services", "sshd", adminId);
    for (const name of ["panel", "cloudflared"]) {
      const body = { confirm: name };
      expect(await json(await call("POST", `/services/${name}/stop`, { body }), 409)).toMatchObject({
        error: "lockout",
      });
    }
    setSetting({ db, secret: SECRET }, "panel.protected_services", null, adminId);
  });

  test("site job lock → 409 job_running; concurrent action → 409 busy", async () => {
    gate.jobLocked = true;
    expect(await json(await call("POST", "/services/crond/restart"), 409)).toMatchObject({ error: "job_running" });
    expect(await json(await call("POST", "/apps/adminneo/restart"), 409)).toMatchObject({ error: "job_running" });
    gate.jobLocked = false;
    const [a, b] = await Promise.all([call("POST", "/services/crond/restart"), call("POST", "/services/crond/stop")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await (a.status === 409 ? a : b).json()).toMatchObject({ error: "busy" });
    await call("POST", "/services/crond/start");
  });

  test("restart panel: 202 DeferredRestart, then restartSelf; refused while a job or backup runs", async () => {
    gate.jobActive = true;
    expect(await json(await call("POST", "/services/panel/restart"), 409)).toMatchObject({ error: "job_running" });
    gate.jobActive = false;
    gate.backupBusy = true;
    expect(await json(await call("POST", "/services/panel/restart"), 409)).toMatchObject({ error: "job_running" });
    gate.backupBusy = false;
    const before = restarts.length;
    const r = await json<DeferredRestart>(await call("POST", "/services/panel/restart"), 202);
    expect(r).toEqual({ deferred: true, service: "panel", bootId: "boot-1", oldPid: process.pid });
    expect(restarts.length).toBe(before); // the 202 goes out first
    await Bun.sleep(400);
    expect(restarts.length).toBe(before + 1);
    expect(audits("service.restart").some((x) => x.target === "panel")).toBe(true);
  });

  test("restart panel of a process runit does not supervise → 409 not_supervised", async () => {
    const res = await call("POST", "/services/panel/restart", { on: await makeApi() });
    expect(await json(res, 409)).toMatchObject({ error: "not_supervised" });
  });

  test("restart cloudflared: 202 with the old pid, then a new pid", async () => {
    const svc = async () =>
      (await json<Service[]>(await call("GET", "/services"))).find((s) => s.name === "cloudflared");
    const oldPid = (await svc())?.pid;
    const r = await json<DeferredRestart>(await call("POST", "/services/cloudflared/restart"), 202);
    expect(r).toMatchObject({ deferred: true, service: "cloudflared", oldPid });
    await Bun.sleep(700);
    const now = await svc();
    expect(now?.state === "run" && now.pid !== oldPid).toBe(true);
  });

  test("app actions are audited and carry site; unknown → 404; invalid name/action → 400", async () => {
    expect(await json<App>(await call("POST", "/apps/demo-api/start"))).toMatchObject({ status: "online", site: null });
    expect(await json<App>(await call("POST", "/apps/adminneo/restart"))).toMatchObject({ site: "neo" });
    expect(audits("app.restart").some((r) => r.target === "adminneo")).toBe(true);
    expect(await json(await call("POST", "/apps/nope/start"), 404)).toMatchObject({ error: "not_found" });
    for (const bad of ["Sshd", "-rf", ".hidden", "a%20b", "a;b"])
      expect(await json(await call("POST", `/services/${bad}/start`), 400)).toMatchObject({ error: "invalid_name" });
    expect(await json(await call("POST", "/services/crond/kill"), 400)).toMatchObject({ error: "invalid_action" });
  });
});

describe("logs", () => {
  test("LogChunk: default 500, clamp 2000, timestamps split, invalid params", async () => {
    const c = await json<LogChunk>(await call("GET", "/services/sshd/log"));
    expect(c.lines).toHaveLength(500);
    expect(c).toMatchObject({ reset: false, truncated: false, cursor: expect.any(String) });
    expect(c.lines[0]).toEqual({ at: null, text: "2026-01-01T00:00:00Z sshd: demo line 1" });
    expect((await json<LogChunk>(await call("GET", "/services/sshd/log?lines=9999"))).lines).toHaveLength(2000);
    for (const bad of ["0", "-1", "abc", "1.5"])
      expect(await json(await call("GET", `/services/sshd/log?lines=${bad}`), 400)).toMatchObject({
        error: "invalid_lines",
      });
    expect(await json(await call("GET", "/services/sshd/log?after=%%%"), 400)).toMatchObject({
      error: "invalid_cursor",
    });
    expect(await json(await call("GET", "/services/nope/log"), 404)).toMatchObject({ error: "not_found" });
  });

  test("follow with ?after= returns only new lines", async () => {
    const first = await json<LogChunk>(await call("GET", "/apps/adminneo/log?lines=5"));
    const next = await call("GET", `/apps/adminneo/log?after=${first.cursor}`);
    expect(await json(next)).toMatchObject({ lines: [], reset: false, cursor: first.cursor });
  });

  test("app log: stream tag and the site's .env values redacted", async () => {
    const c = await json<LogChunk & { redacted: number }>(await call("GET", "/apps/adminneo/log?stream=err&lines=3"));
    expect(c.lines.map((l) => l.stream)).toEqual(["err", "err", "err"]);
    expect(c.lines[0]?.text).toContain("***");
    expect(c.lines[0]?.text).not.toContain(SITE_SECRET);
    expect(c.redacted).toBeGreaterThan(0);
    expect(await json(await call("GET", "/apps/adminneo/log?stream=x"), 400)).toMatchObject({
      error: "invalid_stream",
    });
  });

  test("download: text/plain attachment, redacted, audited log.download", async () => {
    const res = await call("GET", "/apps/adminneo/log/download?stream=err");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="adminneo-\d{8}-\d{4}\.log"$/);
    expect(await res.text()).not.toContain(SITE_SECRET);
    expect((await call("GET", "/services/sshd/log/download")).status).toBe(200);
    const targets = audits("log.download").map((r) => r.target);
    expect(targets).toEqual(expect.arrayContaining(["app:adminneo:err", "service:sshd"]));
    expect((await call("GET", "/services/nope/log/download")).status).toBe(404);
  });
});
