import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createAuth } from "@/server/auth/auth.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, user } from "@/server/db/schema";
import { createApiRoutes } from "@/server/routes/api.routes";
import { setSetting } from "@/server/settings.service";
import { createFakeSystem } from "@/server/system/system.fake";
import type { App, DatabaseInfo, Domain, LogLines, PanelOverview, Service } from "@/shared/panel.types";
import type { Role } from "@/shared/roles";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "0123456789abcdef".repeat(4);
const SUPER = ["root@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };
const FAKE_DELAY_MS = 30;

const dir = mkdtempSync(join(tmpdir(), "panel-api-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let api: ReturnType<typeof createApiRoutes>;
let admin: string;
let userCookie: string;
let adminId: string;

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

const call = (method: string, path: string, cookie = admin) =>
  api.handle(
    new Request(`${BASE}/api/panel${path}`, {
      method,
      headers: { origin: BASE, "x-requested-with": "XMLHttpRequest", ...(cookie ? { cookie } : {}) },
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
  api = createApiRoutes(
    auth,
    { db, secret: SECRET, superAdmins: SUPER, dataDir: dir },
    createFakeSystem({ delayMs: FAKE_DELAY_MS }),
  );
  adminId = addUser("admin@x.io", "admin");
  admin = await cookieFor(adminId);
  userCookie = await cookieFor(addUser("plain@x.io", "user"));
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("access control", () => {
  const endpoints: [string, string, null][] = [
    ["GET", "/overview", null],
    ["GET", "/services", null],
    ["POST", "/services/crond/start", null],
    ["GET", "/services/sshd/log", null],
    ["GET", "/apps", null],
    ["POST", "/apps/adminneo/restart", null],
    ["GET", "/apps/adminneo/log", null],
    ["GET", "/domains", null],
    ["GET", "/databases", null],
  ];
  test.each(endpoints)("%s %s → 401 anon, 403 user", async (method, path) => {
    expect(await json(await call(method, path, ""), 401)).toEqual({ error: "unauthorized" });
    expect(await json(await call(method, path, userCookie), 403)).toEqual({ error: "forbidden" });
  });
});

describe("monitoring", () => {
  test("overview shape", async () => {
    const o = await json<PanelOverview>(await call("GET", "/overview"));
    expect(o.mode).toBe("fake");
    expect(o.device.memory.totalMb).toBeGreaterThan(0);
    expect(o.device.load).toHaveLength(3);
    expect(o.device.battery).toEqual({ percent: 76, charging: true, temperatureC: 31.5 });
    expect(o.services.map((s) => s.name)).toContain("sshd");
    expect(o.apps.length).toBeGreaterThan(0);
    expect(o.domains.length).toBeGreaterThan(0);
  });

  test("services carry protected flag from settings", async () => {
    const s = await json<Service[]>(await call("GET", "/services"));
    const sshd = s.find((x) => x.name === "sshd");
    expect(sshd).toMatchObject({ state: "run", wantUp: true, protected: true, pid: expect.any(Number) });
    expect(s.find((x) => x.name === "crond")).toMatchObject({ state: "down", pid: null, protected: false });
  });

  test("domains map app by port and include health", async () => {
    const d = await json<Domain[]>(await call("GET", "/domains"));
    const solusi = d.find((x) => x.hostname === "solusi.example.test");
    expect(solusi).toMatchObject({ port: 3005, app: "makuro-solusi", health: { status: 200, ms: 12 } });
    expect(solusi?.health.checkedAt).toEqual(expect.any(String));
    expect(d.find((x) => x.hostname === "old.example.test")).toMatchObject({ app: null, health: { status: 502 } });
  });

  test("databases", async () => {
    const d = await json<DatabaseInfo[]>(await call("GET", "/databases"));
    expect(d.map((x) => x.name)).toEqual(["adminneo", "solusi"]);
    expect(d[0]?.sizeBytes).toBeGreaterThan(0);
  });
});

describe("control", () => {
  test("service start changes state and is audited", async () => {
    const s = await json<Service>(await call("POST", "/services/crond/start"));
    expect(s).toMatchObject({ name: "crond", state: "run", pid: expect.any(Number) });
    const after = await json<Service[]>(await call("GET", "/services"));
    expect(after.find((x) => x.name === "crond")?.state).toBe("run");
    expect(audits("service.start").some((r) => r.target === "crond" && r.actorId === adminId)).toBe(true);
  });

  test("service stop of unprotected service", async () => {
    expect((await json<Service>(await call("POST", "/services/crond/stop"))).state).toBe("down");
    expect(audits("service.stop").some((r) => r.target === "crond")).toBe(true);
  });

  test("stop of protected service → 409; protection follows the setting", async () => {
    expect(await json(await call("POST", "/services/sshd/stop"), 409)).toMatchObject({ error: "protected" });
    expect((await json<Service>(await call("POST", "/services/sshd/restart"))).state).toBe("run");
    setSetting({ db, secret: SECRET }, "panel.protected_services", "panel", adminId);
    expect((await json<Service>(await call("POST", "/services/sshd/stop"))).protected).toBe(false);
    setSetting({ db, secret: SECRET }, "panel.protected_services", null, adminId);
    await call("POST", "/services/sshd/start");
  });

  test("concurrent action on one resource → 409 busy", async () => {
    const [a, b] = await Promise.all([call("POST", "/services/crond/restart"), call("POST", "/services/crond/stop")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await (a.status === 409 ? a : b).json()).toMatchObject({ error: "busy" });
    // Different resources do not block each other.
    const [c, d] = await Promise.all([call("POST", "/apps/demo-api/start"), call("POST", "/apps/adminneo/restart")]);
    expect([c.status, d.status]).toEqual([200, 200]);
  });

  test("app actions change state and are audited", async () => {
    expect(await json<App>(await call("POST", "/apps/demo-api/stop"))).toMatchObject({ status: "stopped", pid: null });
    const started = await json<App>(await call("POST", "/apps/demo-api/start"));
    expect(started).toMatchObject({ status: "online", pid: expect.any(Number), port: 3007 });
    const before = started.restarts;
    expect((await json<App>(await call("POST", "/apps/demo-api/restart"))).restarts).toBe(before + 1);
    expect(audits("app.restart").some((r) => r.target === "demo-api")).toBe(true);
  });

  test("unknown resource → 404, invalid name/action → 400", async () => {
    expect(await json(await call("POST", "/services/nope/start"), 404)).toMatchObject({ error: "not_found" });
    expect(await json(await call("POST", "/apps/nope/start"), 404)).toMatchObject({ error: "not_found" });
    expect(await json(await call("GET", "/services/nope/log"), 404)).toMatchObject({ error: "not_found" });
    for (const bad of ["Sshd", "-rf", ".hidden", "a%20b", "a;b"]) {
      expect(await json(await call("POST", `/services/${bad}/start`), 400)).toMatchObject({ error: "invalid_name" });
      expect(await json(await call("GET", `/apps/${bad}/log`), 400)).toMatchObject({ error: "invalid_name" });
    }
    expect(await json(await call("POST", "/services/crond/kill"), 400)).toMatchObject({ error: "invalid_action" });
  });
});

describe("logs", () => {
  test("default 200, explicit count, clamp at 2000", async () => {
    expect((await json<LogLines>(await call("GET", "/services/sshd/log"))).lines).toHaveLength(200);
    expect((await json<LogLines>(await call("GET", "/services/sshd/log?lines=5"))).lines).toHaveLength(5);
    expect((await json<LogLines>(await call("GET", "/services/sshd/log?lines=9999"))).lines).toHaveLength(2000);
    for (const bad of ["0", "-1", "abc", "1.5"]) {
      expect(await json(await call("GET", `/services/sshd/log?lines=${bad}`), 400)).toMatchObject({
        error: "invalid_lines",
      });
    }
  });

  test("app log streams", async () => {
    const err = await json<LogLines>(await call("GET", "/apps/adminneo/log?stream=err&lines=3"));
    expect(err.lines).toHaveLength(3);
    expect(err.lines[0]).toContain("[err]");
    expect((await json<LogLines>(await call("GET", "/apps/adminneo/log"))).lines[0]).toContain("[out]");
    expect(await json(await call("GET", "/apps/adminneo/log?stream=x"), 400)).toMatchObject({
      error: "invalid_stream",
    });
  });
});
