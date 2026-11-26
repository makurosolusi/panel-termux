import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { decideRole, syncSuperAdminsOnBoot, syncUserRole } from "@/server/auth/access.service";
import { flushFailedSignIns, handleAuthRequest } from "@/server/auth/auth.audit";
import { createAuth } from "@/server/auth/auth.service";
import { SESSION_ABSOLUTE_MAX_DAYS } from "@/server/auth/role.guard";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, session, user } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { createApiRoutes } from "@/server/routes/api.routes";
import type { Role } from "@/shared/roles";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "0123456789abcdef".repeat(4);
const SUPER = ["boss@example.com", "boss.dev@example.com", "boss.oauth@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };

const dir = mkdtempSync(join(tmpdir(), "panel-auth-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let api: ReturnType<typeof createApiRoutes>;

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  auth = createAuth({ db, env, secret: SECRET });
  api = createApiRoutes(auth, { db, secret: SECRET, superAdmins: SUPER, dataDir: dir });
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
function addUser(email: string, role: Role = "user"): string {
  const id = `u${++seq}`;
  db.insert(user)
    .values({ id, email, name: `n${seq}`, role })
    .run();
  return id;
}
const roleOf = (id: string) => db.select({ role: user.role }).from(user).where(eq(user.id, id)).get()?.role;

/** Creates a session through Better Auth (runs the session hook) and returns a signed cookie header. */
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
  const signed = `${s.token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
  return `better-auth.session_token=${encodeURIComponent(signed)}`;
}
const get = (path: string, cookie?: string) =>
  api.handle(new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} }));

describe("decideRole", () => {
  test("env email → super_admin regardless of case", () => {
    expect(decideRole("Boss@Example.com", "user", SUPER)).toBe("super_admin");
  });
  test("anyone else keeps the stored role", () => {
    expect(decideRole("a@x.io", "admin", SUPER)).toBe("admin");
    expect(decideRole("stranger@x.io", "user", SUPER)).toBe("user");
  });
  test("ex super_admin is demoted to user", () => {
    expect(decideRole("old@x.io", "super_admin", SUPER)).toBe("user");
  });
});

describe("role sync (DB)", () => {
  test("promotes env email to super_admin", () => {
    const id = addUser("boss@example.com");
    expect(syncUserRole(db, id, SUPER)).toBe("super_admin");
    expect(roleOf(id)).toBe("super_admin");
  });

  test("demotes super_admin removed from env", () => {
    const id = addUser("former@x.io", "super_admin");
    expect(syncUserRole(db, id, SUPER)).toBe("user");
    expect(roleOf(id)).toBe("user");
  });

  test("session creation for any stored user succeeds (no invite gate)", async () => {
    const id = addUser("anyone@x.io");
    const ctx = await auth.$context;
    expect(await ctx.internalAdapter.createSession(id)).toMatchObject({ userId: id });
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(1);
  });

  test("boot sync demotes stale super_admins and keeps their sessions", async () => {
    const id = addUser("gone@x.io", "super_admin");
    const cookie = await cookieFor(id); // session hook already demotes on creation
    expect(roleOf(id)).toBe("user");
    db.update(user).set({ role: "super_admin" }).where(eq(user.id, id)).run();
    syncSuperAdminsOnBoot(db, SUPER);
    expect(roleOf(id)).toBe("user");
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(1);
    const me = await get("/api/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ role: "user", home: "/profile" });
  });
});

describe("HTTP API", () => {
  test("GET /api/me → 401 without session", async () => {
    const res = await get("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized", message: "sign in required" });
  });

  test("GET /api/me → 200 with session", async () => {
    const id = addUser("member@x.io");
    const res = await get("/api/me", await cookieFor(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id,
      email: "member@x.io",
      name: expect.any(String),
      image: null,
      role: "user",
      home: "/profile",
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
  });

  test("/api/panel/ping: 401 anon, 403 user, 200 admin", async () => {
    expect((await get("/api/panel/ping")).status).toBe(401);
    const u = await get("/api/panel/ping", await cookieFor(addUser("p-user@x.io")));
    expect(u.status).toBe(403);
    expect(await u.json()).toEqual({ error: "forbidden" });
    const a = await get("/api/panel/ping", await cookieFor(addUser("p-admin@x.io", "admin")));
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true });
  });

  test("/api/dev/ping: 403 admin, 200 super_admin", async () => {
    const a = await get("/api/dev/ping", await cookieFor(addUser("d-admin@x.io", "admin")));
    expect(a.status).toBe(403);
    expect(await a.json()).toEqual({ error: "forbidden" });
    const bossId = addUser("boss.dev@example.com");
    const sa = await get("/api/dev/ping", await cookieFor(bossId)); // env email → promoted on session
    expect(sa.status).toBe(200);
    expect(await sa.json()).toEqual({ ok: true });
  });

  test("POST /api/auth/sign-in/social returns Google URL with our callback", async () => {
    const res = await api.handle(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      }),
    );
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const u = new URL(url);
    expect(u.host).toBe("accounts.google.com");
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/google`);
  });

  test("OAuth callback for a never-seen Google account signs in as user", async () => {
    const res = await googleCallback("Stranger@X.io");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = sessionCookie(res);
    const me = await get("/api/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "stranger@x.io", role: "user", home: "/profile" });
  });

  test("OAuth callback for an env super admin email signs in as super_admin", async () => {
    const res = await googleCallback("Boss.OAuth@Example.com");
    expect(res.status).toBe(302);
    const me = await get("/api/me", sessionCookie(res));
    expect(await me.json()).toMatchObject({ role: "super_admin", home: "/panel" });
  });
});

describe("session lifetime and auth audit", () => {
  const DAY = 86_400_000;
  const actions = (actorId: string) =>
    db
      .select({ a: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.actorId, actorId))
      .all()
      .map((r) => r.a);

  test("a session older than SESSION_ABSOLUTE_MAX_DAYS is deleted and treated as signed out", async () => {
    const id = addUser("old-session@x.io", "admin");
    const cookie = await cookieFor(id);
    const age = (days: number) =>
      db
        .update(session)
        .set({ createdAt: new Date(Date.now() - days * DAY) })
        .where(eq(session.userId, id))
        .run();
    age(SESSION_ABSOLUTE_MAX_DAYS - 1);
    expect((await get("/api/panel/ping", cookie)).status).toBe(200);
    age(SESSION_ABSOLUTE_MAX_DAYS + 1);
    expect((await get("/api/panel/ping", cookie)).status).toBe(401);
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(0);
    expect((await get("/api/me", cookie)).status).toBe(401);
  });

  test("new Google account is audited as auth.account_created, then auth.sign_in", async () => {
    await googleCallback("fresh.person@x.io");
    const u = db.select({ id: user.id }).from(user).where(eq(user.email, "fresh.person@x.io")).get();
    expect(u).toBeDefined();
    expect(actions(u?.id ?? "").sort()).toEqual(["auth.account_created", "auth.sign_in"]);
  });

  test("handleAuthRequest audits a successful sign-out with the user read beforehand", async () => {
    const id = addUser("leaver@x.io");
    const cookie = await cookieFor(id);
    const res = await handleAuthRequest(
      auth,
      db,
      new Request(`${BASE}/api/auth/sign-out`, { method: "POST", headers: { cookie, origin: BASE } }),
    );
    expect(res.status).toBe(200);
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(0);
    expect(actions(id)).toContain("auth.sign_out");
    // Anonymous sign-out: nothing to audit.
    const before = db.select().from(auditLog).all().length;
    await handleAuthRequest(
      auth,
      db,
      new Request(`${BASE}/api/auth/sign-out`, { method: "POST", headers: { origin: BASE } }),
    );
    expect(db.select().from(auditLog).all()).toHaveLength(before);
  });

  test("failed callbacks are only counted into one aggregate warn (codes, no audit row)", async () => {
    const before = db.select().from(auditLog).all().length;
    const bad = () => handleAuthRequest(auth, db, new Request(`${BASE}/api/auth/callback/google?state=nope&code=c`));
    const res = await bad();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login?error=");
    await bad();
    flushFailedSignIns();
    const line = readLogs({ level: "warn", q: "failed sign-in callbacks", limit: 1 })[0]?.msg ?? "";
    expect(line).toMatch(/^\[auth\] 2 failed sign-in callbacks in the last minute: \w+×2$/);
    expect(db.select().from(auditLog).all()).toHaveLength(before);
  });
});

/** `name=value` cookie header from a response's session Set-Cookie. */
const sessionCookie = (res: Response): string => {
  const c = res.headers.getSetCookie().find((h) => h.startsWith("better-auth.session_token="));
  if (!c) throw new Error("no session cookie in response");
  return c.split(";")[0] ?? "";
};

/** Drives sign-in/social → callback/google with a faked Google token endpoint returning `email`. */
async function googleCallback(email: string): Promise<Response> {
  const start = await api.handle(
    new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    }),
  );
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state") ?? "";
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  // Unsigned id_token is enough: Better Auth's Google provider only decodes it after the code exchange.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const idToken = `${b64({ alg: "none" })}.${b64({ sub: `g-${email}`, email, email_verified: true, name: "G" })}.`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      access_token: "at",
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 3600,
    })) as unknown as typeof fetch;
  try {
    return await api.handle(
      new Request(`${BASE}/api/auth/callback/google?state=${encodeURIComponent(state)}&code=c`, {
        headers: { cookie },
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}
