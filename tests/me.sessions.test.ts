import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createAuth } from "@/server/auth/auth.service";
import { maskIp, shortUserAgent } from "@/server/auth/sessions.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { appMeta, auditLog, session, site, user } from "@/server/db/schema";
import { createApiHandler } from "@/server/http/api.handler";
import { readLogs } from "@/server/log.service";
import { createApiRoutes } from "@/server/routes/api.routes";
import { setSetting } from "@/server/settings.service";
import { createFakeSystem } from "@/server/system/system.fake";
import type { DevSetup } from "@/shared/dev.types";
import type { MeSession } from "@/shared/me.types";
import type { Role } from "@/shared/roles";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "abcdef0123456789".repeat(4);
const SUPER = ["root@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

const dir = mkdtempSync(join(tmpdir(), "panel-me-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let api: ReturnType<typeof createApiRoutes>;

let seq = 0;
function addUser(email: string, role: Role = "user"): string {
  const id = `m${++seq}`;
  db.insert(user)
    .values({ id, email, name: `n${seq}`, role })
    .run();
  return id;
}

/** Signed session cookie + the session id behind it. */
async function login(userId: string): Promise<{ cookie: string; id: string }> {
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
  const value = `${s.token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
  return { cookie: `better-auth.session_token=${encodeURIComponent(value)}`, id: s.id };
}

const call = (method: string, path: string, cookie?: string) =>
  api.handle(
    new Request(`${BASE}/api${path}`, {
      method,
      headers: { origin: BASE, "x-requested-with": "XMLHttpRequest", ...(cookie ? { cookie } : {}) },
    }),
  );

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  auth = createAuth({ db, env, secret: SECRET });
  api = createApiRoutes(auth, { db, secret: SECRET, superAdmins: SUPER, dataDir: dir }, createFakeSystem());
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("helpers", () => {
  test("shortUserAgent", () => {
    expect(shortUserAgent(CHROME_ANDROID)).toBe("Chrome on Android");
    expect(shortUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/131 Safari/537 Edg/131")).toBe("Edge on Windows");
    expect(shortUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18 Safari/604")).toBe(
      "Safari on iOS",
    );
    expect(shortUserAgent(null)).toBeNull();
  });

  test("maskIp", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.113.x");
    expect(maskIp("::ffff:198.51.100.7")).toBe("198.51.100.x");
    expect(maskIp("2001:db8:1:2::5")).toBe("2001:db8:1::/48");
    expect(maskIp(null)).toBeNull();
  });
});

describe("/api/me/sessions", () => {
  test("401 without session", async () => {
    expect((await call("GET", "/me/sessions")).status).toBe(401);
  });

  test("list own sessions: current flag, parsed UA, masked IP, no tokens; others' sessions hidden", async () => {
    const me = addUser("me@x.io");
    const a = await login(me);
    const b = await login(me);
    await login(addUser("other@x.io"));
    db.update(session).set({ userAgent: CHROME_ANDROID, ipAddress: "203.0.113.42" }).where(eq(session.id, b.id)).run();
    const res = await call("GET", "/me/sessions", a.cookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    const list = JSON.parse(text) as MeSession[];
    expect(list.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(list.find((s) => s.id === a.id)?.current).toBe(true);
    expect(list.find((s) => s.id === b.id)).toEqual({
      id: b.id,
      current: false,
      createdAt: expect.any(String),
      lastActiveAt: expect.any(String),
      userAgent: "Chrome on Android",
      ipMasked: "203.0.113.x",
    });
    const tokens = db.select({ t: session.token }).from(session).all();
    for (const { t } of tokens) expect(text).not.toContain(t);
  });

  test("DELETE: cannot revoke the current session; revokes another; 404 for someone else's", async () => {
    const me = addUser("del@x.io");
    const a = await login(me);
    const b = await login(me);
    const foreign = await login(addUser("x@x.io"));
    const cur = await call("DELETE", `/me/sessions/${a.id}`, a.cookie);
    expect(cur.status).toBe(400);
    expect(await cur.json()).toMatchObject({ error: "current_session" });
    expect((await call("DELETE", `/me/sessions/${foreign.id}`, a.cookie)).status).toBe(404);
    expect((await call("DELETE", `/me/sessions/${b.id}`, a.cookie)).status).toBe(204);
    expect(db.select().from(session).where(eq(session.id, b.id)).get()).toBeUndefined();
    expect((await call("GET", "/me", b.cookie)).status).toBe(401);
    expect((await call("GET", "/me", a.cookie)).status).toBe(200);
    const audit = db.select().from(auditLog).where(eq(auditLog.action, "session.revoke")).all();
    expect(audit.some((r) => r.target === b.id && r.actorId === me)).toBe(true);
  });

  test("revoke-others keeps the current session", async () => {
    const me = addUser("others@x.io");
    const a = await login(me);
    await login(me);
    await login(me);
    const res = await call("POST", "/me/sessions/revoke-others", a.cookie);
    expect(await res.json()).toEqual({ revoked: 2 });
    const left = db.select().from(session).where(eq(session.userId, me)).all();
    expect(left.map((s) => s.id)).toEqual([a.id]);
    expect((await call("GET", "/me", a.cookie)).status).toBe(200);
  });

  test("request log names the user id, never the email or query", async () => {
    const me = addUser("logged.person@x.io");
    const { cookie } = await login(me);
    const handle = createApiHandler(api, { https: false });
    const res = await handle(new Request(`${BASE}/api/me/sessions?debug=1`, { headers: { cookie } }));
    expect(res.status).toBe(200);
    const line = readLogs({ level: "info", q: `user=${me}`, limit: 1 })[0]?.msg;
    expect(line).toMatch(new RegExp(`^\\[http\\] GET /api/me/sessions 200 \\d+ms user=${me}$`));
  });
});

describe("/api/ready", () => {
  test("200 when migrations are applied, 503 when the schema version is behind", async () => {
    const ok = await call("GET", "/ready");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, schemaVersion: expect.stringMatching(/^\d{4}_/) });
    const v = db.select().from(appMeta).where(eq(appMeta.key, "schema_version")).get()?.value as string;
    db.update(appMeta).set({ value: "0000_old" }).where(eq(appMeta.key, "schema_version")).run();
    const stale = await call("GET", "/ready");
    expect(stale.status).toBe(503);
    expect(await stale.json()).toMatchObject({ error: "not_ready", message: expect.stringContaining("0000_old") });
    db.update(appMeta).set({ value: v }).where(eq(appMeta.key, "schema_version")).run();
  });
});

describe("/api/dev/setup", () => {
  test("super_admin only; items follow settings, sites and admins", async () => {
    const root = await login(addUser("root@example.com", "super_admin"));
    expect((await call("GET", "/dev/setup", (await login(addUser("adm@x.io", "user"))).cookie)).status).toBe(403);
    const get = async () => {
      const r = await call("GET", "/dev/setup", root.cookie);
      expect(r.status).toBe(200);
      return Object.fromEntries(((await r.json()) as DevSetup).items.map((i) => [i.key, i.done]));
    };
    // Fake sandbox ecosystem already spreads apps.json.
    expect(await get()).toEqual({
      cloudflare_token: false,
      backup: false,
      apps_json: true,
      adopt_sites: false,
      admins: false,
    });
    setSetting({ db, secret: SECRET }, "cloudflare.api_token", "cfTok_0123456789abcdefghij", "m1"); // test-only
    for (const [k, v] of [
      ["backup.s3_endpoint", "https://s3.example.test"],
      ["backup.s3_bucket", "panel-backups"],
      ["backup.s3_access_key_id", "AKIATEST"],
      ["backup.s3_secret_access_key", "secret-test-only"],
    ] as const)
      setSetting({ db, secret: SECRET }, k, v, "m1");
    db.insert(site)
      .values({ name: "blog", port: 3001, app: "blog", database: null, runtime: "native", managed: false, dir: "/x" })
      .run();
    addUser("admin2@x.io", "admin");
    expect(await get()).toEqual({
      cloudflare_token: true,
      backup: true,
      apps_json: true,
      adopt_sites: true,
      admins: true,
    });
  });
});
