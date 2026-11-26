import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createAuth } from "@/server/auth/auth.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { account, allowedEmail, auditLog, session, setting, user } from "@/server/db/schema";
import { log } from "@/server/log.service";
import { createApiRoutes } from "@/server/routes/api.routes";
import { getSetting } from "@/server/settings.service";
import type { DevAuditEntry, DevHealth, DevInvite, DevLogs, DevSetting, DevUser, Page } from "@/shared/dev.types";
import type { Role } from "@/shared/roles";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "fedcba9876543210".repeat(4);
const SUPER = ["root@example.com", "root2@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };
const CF_TOKEN = "cfTok_abcdefghijklmnopqrstuvwxyz0123456789";

const dir = mkdtempSync(join(tmpdir(), "panel-dev-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let api: ReturnType<typeof createApiRoutes>;
let rootId: string;
let root: string; // super_admin cookie
let adminCookie: string;
let userCookie: string;

let seq = 0;
function addUser(email: string, role: Role = "user", invited = true): string {
  const id = `d${++seq}`;
  db.insert(user)
    .values({ id, email, name: `name${seq}`, role })
    .run();
  if (invited) db.insert(allowedEmail).values({ email }).run();
  return id;
}

/** Creates a session through Better Auth (runs the session hooks) and returns a signed cookie header. */
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

const call = (method: string, path: string, cookie?: string, body?: unknown) =>
  api.handle(
    new Request(`${BASE}/api/dev${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const auditRows = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action)).all();

beforeAll(async () => {
  db = openDb(dir);
  runMigrations(db);
  auth = createAuth({ db, env, secret: SECRET });
  api = createApiRoutes(auth, { db, secret: SECRET, superAdmins: SUPER, dataDir: dir });
  rootId = addUser("root@example.com", "user", false); // promoted by the session hook
  root = await cookieFor(rootId);
  adminCookie = await cookieFor(addUser("admin@x.io", "admin"));
  userCookie = await cookieFor(addUser("plain@x.io", "user"));
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("access control", () => {
  // Always 3 entries: a 2-arg row would make bun treat the 3rd callback param as `done`.
  const endpoints: [string, string, unknown][] = [
    ["GET", "/health", null],
    ["GET", "/users", null],
    ["PATCH", "/users/x", { role: "admin" }],
    ["DELETE", "/users/x", null],
    ["GET", "/invites", null],
    ["POST", "/invites", { email: "a@b.io" }],
    ["DELETE", "/invites/a%40b.io", null],
    ["GET", "/audit", null],
    ["GET", "/logs", null],
    ["GET", "/settings", null],
    ["PUT", "/settings/sites.dir", { value: "/tmp" }],
  ];
  test.each(endpoints)("%s %s → 401 anon, 403 user/admin", async (method, path, b) => {
    const body = b ?? undefined;
    expect(await json(await call(method, path, undefined, body), 401)).toEqual({ error: "unauthorized" });
    expect(await json(await call(method, path, userCookie, body), 403)).toEqual({ error: "forbidden" });
    expect(await json(await call(method, path, adminCookie, body), 403)).toEqual({ error: "forbidden" });
  });
  test("sign-in is audited", () => {
    expect(auditRows("auth.sign_in").some((r) => r.actorId === rootId)).toBe(true);
  });
});

describe("GET /health", () => {
  test("shape and counts", async () => {
    const h = await json<DevHealth>(await call("GET", "/health", root));
    expect(h).toEqual({
      version: expect.any(String),
      schemaVersion: expect.stringContaining("dev"),
      startedAt: expect.any(String),
      uptimeSec: expect.any(Number),
      memory: { rssMb: expect.any(Number), heapUsedMb: expect.any(Number) },
      db: { sizeBytes: expect.any(Number) },
      dataDir: { freeBytes: expect.any(Number), totalBytes: expect.any(Number) },
      runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
      counts: { users: 3, sessions: 3, invites: 2 },
    });
    expect(h.db.sizeBytes).toBeGreaterThan(0);
    expect(h.dataDir.totalBytes).toBeGreaterThan(h.dataDir.freeBytes);
    expect(Date.parse(h.startedAt)).toBeLessThanOrEqual(Date.now());
  });
});

describe("users", () => {
  test("list: pagination bounds, q filter, lastSeenAt, isEnvSuperAdmin", async () => {
    for (let i = 0; i < 4; i++) addUser(`bulk${i}@paging.io`);
    const p1 = await json<Page<DevUser>>(await call("GET", "/users?page=1&pageSize=2", root));
    expect(p1.items).toHaveLength(2);
    expect(p1).toMatchObject({ page: 1, pageSize: 2, total: 7 });
    const p4 = await json<Page<DevUser>>(await call("GET", "/users?page=4&pageSize=2", root));
    expect(p4.items).toHaveLength(1);
    const beyond = await json<Page<DevUser>>(await call("GET", "/users?page=99", root));
    expect(beyond.items).toEqual([]);
    expect((await json<Page<DevUser>>(await call("GET", "/users?pageSize=500", root))).pageSize).toBe(100);
    for (const bad of ["page=0", "page=-1", "pageSize=0", "page=abc", "pageSize=1.5"]) {
      expect(await json(await call("GET", `/users?${bad}`, root), 400)).toMatchObject({ error: "invalid_pagination" });
    }
    const q = await json<Page<DevUser>>(await call("GET", "/users?q=PAGING", root));
    expect(q.total).toBe(4);
    expect((await json<Page<DevUser>>(await call("GET", "/users?q=%25", root))).total).toBe(0); // % is literal
    const me = (await json<Page<DevUser>>(await call("GET", "/users?q=root@", root))).items[0];
    expect(me).toMatchObject({ id: rootId, role: "super_admin", isEnvSuperAdmin: true });
    expect(me?.lastSeenAt).not.toBeNull();
    expect(q.items[0]?.lastSeenAt).toBeNull();
  });

  test("PATCH role: change, invalid, protected (env super admin, self), 404", async () => {
    const id = addUser("promote@x.io");
    const u = await json<DevUser>(await call("PATCH", `/users/${id}`, root, { role: "admin" }));
    expect(u).toMatchObject({ id, role: "admin", isEnvSuperAdmin: false });
    expect(db.select({ r: user.role }).from(user).where(eq(user.id, id)).get()?.r).toBe("admin");
    expect(auditRows("user.role_change").at(-1)).toMatchObject({
      actorId: rootId,
      target: id,
      meta: { from: "user", to: "admin" },
    });
    for (const role of ["super_admin", "boss", undefined]) {
      expect(await json(await call("PATCH", `/users/${id}`, root, { role }), 400)).toMatchObject({
        error: "invalid_role",
      });
    }
    const env2 = addUser("root2@example.com", "super_admin", false);
    expect(await json(await call("PATCH", `/users/${env2}`, root, { role: "user" }), 409)).toMatchObject({
      error: "protected",
    });
    expect(await json(await call("PATCH", `/users/${rootId}`, root, { role: "user" }), 409)).toMatchObject({
      error: "protected",
    });
    expect(await json(await call("PATCH", "/users/nope", root, { role: "user" }), 404)).toMatchObject({
      error: "not_found",
    });
  });

  test("DELETE removes user, sessions, accounts, invite; protected cases", async () => {
    const id = addUser("gone@x.io");
    const cookie = await cookieFor(id);
    db.insert(account).values({ id: "acc-gone", accountId: "g", providerId: "google", userId: id }).run();
    expect((await call("DELETE", `/users/${id}`, root)).status).toBe(204);
    expect(db.select().from(user).where(eq(user.id, id)).all()).toHaveLength(0);
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(0);
    expect(db.select().from(account).where(eq(account.userId, id)).all()).toHaveLength(0);
    expect(db.select().from(allowedEmail).where(eq(allowedEmail.email, "gone@x.io")).all()).toHaveLength(0);
    expect((await api.handle(new Request(`${BASE}/api/me`, { headers: { cookie } }))).status).toBe(401);
    expect(auditRows("user.delete").at(-1)).toMatchObject({ actorId: rootId, target: id });
    expect(await json(await call("DELETE", `/users/${rootId}`, root), 409)).toMatchObject({ error: "protected" });
    expect(await json(await call("DELETE", "/users/nope", root), 404)).toMatchObject({ error: "not_found" });
  });
});

describe("invites", () => {
  test("create, invalid, duplicate, env super admin", async () => {
    const inv = await json<DevInvite>(await call("POST", "/invites", root, { email: "  New@Guest.IO " }), 201);
    expect(inv).toEqual({
      email: "new@guest.io",
      invitedBy: { id: rootId, name: expect.any(String) },
      createdAt: expect.any(String),
      registered: false,
    });
    expect(auditRows("invite.create").at(-1)).toMatchObject({ actorId: rootId, target: "new@guest.io" });
    for (const email of ["nope", "", 42, undefined]) {
      expect(await json(await call("POST", "/invites", root, { email }), 400)).toMatchObject({
        error: "invalid_email",
      });
    }
    expect(await json(await call("POST", "/invites", root, { email: "NEW@guest.io" }), 409)).toMatchObject({
      error: "exists",
    });
    expect(await json(await call("POST", "/invites", root, { email: "root2@example.com" }), 409)).toMatchObject({
      error: "exists",
    });
    expect(await json(await call("POST", "/invites", root, "not-an-object"), 400)).toMatchObject({
      error: "invalid_email",
    });
  });

  test("list: registered flag, inviter, pagination", async () => {
    addUser("member@guest.io"); // invited + registered (no inviter)
    const page = await json<Page<DevInvite>>(await call("GET", "/invites?pageSize=100", root));
    expect(page.total).toBe(page.items.length);
    expect(page.items.find((i) => i.email === "member@guest.io")).toMatchObject({ registered: true, invitedBy: null });
    expect(page.items.find((i) => i.email === "new@guest.io")).toMatchObject({ registered: false });
    const small = await json<Page<DevInvite>>(await call("GET", "/invites?page=2&pageSize=1", root));
    expect(small).toMatchObject({ page: 2, pageSize: 1, total: page.total });
    expect(small.items).toHaveLength(1);
  });

  test("DELETE revokes the user's sessions; 404 when missing", async () => {
    const id = addUser("kick@guest.io");
    const cookie = await cookieFor(id);
    expect((await call("DELETE", `/invites/${encodeURIComponent("Kick@guest.io")}`, root)).status).toBe(204);
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(0);
    expect((await api.handle(new Request(`${BASE}/api/me`, { headers: { cookie } }))).status).toBe(401);
    expect(auditRows("invite.delete").at(-1)).toMatchObject({ target: "kick@guest.io", meta: { sessionsRevoked: 1 } });
    expect(await json(await call("DELETE", "/invites/kick%40guest.io", root), 404)).toMatchObject({
      error: "not_found",
    });
  });

  test("denied sign-in is audited with the email domain only", async () => {
    const id = addUser("stranger@denied.io", "user", false);
    const ctx = await auth.$context;
    await ctx.internalAdapter.createSession(id).catch(() => "refused");
    const row = auditRows("auth.denied").at(-1);
    expect(row?.target).toBe("denied.io");
    expect(JSON.stringify(row)).not.toContain("stranger");
  });
});

describe("audit", () => {
  test("newest first, filters, pagination", async () => {
    const all = await json<Page<DevAuditEntry>>(await call("GET", "/audit?pageSize=100", root));
    expect(all.total).toBeGreaterThan(5);
    const ids = all.items.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const inv = await json<Page<DevAuditEntry>>(await call("GET", "/audit?action=invite.create", root));
    expect(inv.items.length).toBeGreaterThan(0);
    expect(inv.items.every((e) => e.action === "invite.create" && e.actor?.id === rootId)).toBe(true);
    const byActor = await json<Page<DevAuditEntry>>(await call("GET", `/audit?actorId=${rootId}&pageSize=1`, root));
    expect(byActor.items).toHaveLength(1);
    expect(byActor.items[0]?.actor).toEqual({ id: rootId, name: expect.any(String) });
    expect(await json(await call("GET", "/audit?page=0", root), 400)).toMatchObject({ error: "invalid_pagination" });
  });
});

describe("logs", () => {
  test("newest first, level/q/limit filters", async () => {
    log.info("dev-test-marker one");
    log.error("dev-test-marker two");
    const { items } = await json<DevLogs>(await call("GET", "/logs?q=DEV-TEST-MARKER", root));
    expect(items.map((e) => e.msg)).toEqual(["dev-test-marker two", "dev-test-marker one"]);
    const errs = await json<DevLogs>(await call("GET", "/logs?q=dev-test-marker&level=warn", root));
    expect(errs.items.map((e) => e.level)).toEqual(["error"]);
    expect((await json<DevLogs>(await call("GET", "/logs?limit=1", root))).items).toHaveLength(1);
    expect(await json(await call("GET", "/logs?level=loud", root), 400)).toMatchObject({ error: "invalid_level" });
    expect(await json(await call("GET", "/logs?limit=0", root), 400)).toMatchObject({ error: "invalid_limit" });
  });
});

describe("settings", () => {
  test("list: registry with defaults, secrets null", async () => {
    const { items } = await json<{ items: DevSetting[] }>(await call("GET", "/settings", root));
    expect(items.map((s) => s.key)).toEqual([
      "cloudflare.api_token",
      "cloudflare.account_id",
      "sites.dir",
      "sites.port_range",
      "panel.protected_services",
    ]);
    expect(items.find((s) => s.key === "sites.port_range")).toMatchObject({ value: "3001-3999", isSet: false });
    expect(items.find((s) => s.key === "cloudflare.api_token")).toMatchObject({ secret: true, value: null });
  });

  test("secret is encrypted at rest, never returned, audit has key only", async () => {
    const res = await json<DevSetting>(await call("PUT", "/settings/cloudflare.api_token", root, { value: CF_TOKEN }));
    expect(res).toMatchObject({ key: "cloudflare.api_token", isSet: true, value: null });
    const raw = db.select().from(setting).where(eq(setting.key, "cloudflare.api_token")).get()?.value ?? "";
    expect(raw).not.toBe(CF_TOKEN);
    expect(raw).not.toContain(CF_TOKEN);
    expect(raw.startsWith("v1.")).toBe(true);
    expect(getSetting({ db, secret: SECRET }, "cloudflare.api_token")).toBe(CF_TOKEN);
    expect(() => getSetting({ db, secret: "0".repeat(64) }, "cloudflare.api_token")).toThrow(/cloudflare.api_token/);
    const list = await (await call("GET", "/settings", root)).text();
    expect(list).not.toContain(CF_TOKEN);
    const audit = auditRows("settings.update").at(-1);
    expect(audit).toMatchObject({ actorId: rootId, target: "cloudflare.api_token" });
    expect(JSON.stringify(audit)).not.toContain(CF_TOKEN);
    const allAudit = await (await call("GET", "/audit?pageSize=100", root)).text();
    expect(allAudit).not.toContain(CF_TOKEN);
  });

  test("validation, reset to default, unknown key, ~ expansion", async () => {
    for (const value of ["80-90", "4000-3000", "3000-70000", "abc", "", 5]) {
      expect(await json(await call("PUT", "/settings/sites.port_range", root, { value }), 400)).toMatchObject({
        error: "invalid_value",
      });
    }
    const set = await json<DevSetting>(await call("PUT", "/settings/sites.port_range", root, { value: " 5000-5100 " }));
    expect(set).toMatchObject({ value: "5000-5100", isSet: true, updatedAt: expect.any(String) });
    const reset = await json<DevSetting>(await call("PUT", "/settings/sites.port_range", root, { value: null }));
    expect(reset).toMatchObject({ value: "3001-3999", isSet: false, updatedAt: null });
    expect(await json(await call("PUT", "/settings/nope", root, { value: "x" }), 404)).toMatchObject({
      error: "not_found",
    });
    expect(await json(await call("PUT", "/settings/sites.dir", root, { value: "relative/dir" }), 400)).toMatchObject({
      error: "invalid_value",
    });
    expect(getSetting({ db, secret: SECRET }, "sites.dir")).toBe(join(process.env.HOME ?? "", "sites"));
    expect(
      await json(await call("PUT", "/settings/panel.protected_services", root, { value: "sshd,,x" }), 400),
    ).toMatchObject({ error: "invalid_value" });
  });
});
