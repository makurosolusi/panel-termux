import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  decideAccess,
  isEmailAllowed,
  NOT_INVITED,
  syncSuperAdminsOnBoot,
  syncUserRole,
} from "@/server/auth/access.service";
import { createAuth } from "@/server/auth/auth.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { allowedEmail, session, user } from "@/server/db/schema";
import { createApiRoutes } from "@/server/routes/api.routes";
import type { Role } from "@/shared/roles";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "0123456789abcdef".repeat(4);
const SUPER = ["boss@example.com", "boss.dev@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };

const dir = mkdtempSync(join(tmpdir(), "panel-auth-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let api: ReturnType<typeof createApiRoutes>;

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  auth = createAuth({ db, env, secret: SECRET });
  api = createApiRoutes(auth);
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
function addUser(email: string, role: Role = "user", invited = false): string {
  const id = `u${++seq}`;
  db.insert(user)
    .values({ id, email, name: `n${seq}`, role })
    .run();
  if (invited) db.insert(allowedEmail).values({ email }).run();
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

describe("decideAccess", () => {
  test("env email → super_admin regardless of case or invite", () => {
    expect(decideAccess("Boss@Example.com", "user", SUPER, false)).toEqual({ allowed: true, role: "super_admin" });
  });
  test("invited email keeps its role", () => {
    expect(decideAccess("a@x.io", "admin", SUPER, true)).toEqual({ allowed: true, role: "admin" });
  });
  test("stranger is refused", () => {
    expect(decideAccess("stranger@x.io", "user", SUPER, false)).toEqual({ allowed: false });
  });
  test("ex super_admin still invited is demoted to user", () => {
    expect(decideAccess("old@x.io", "super_admin", SUPER, true)).toEqual({ allowed: true, role: "user" });
  });
});

describe("invite list + role sync (DB)", () => {
  test("isEmailAllowed: env, invited (case-insensitive), stranger", () => {
    db.insert(allowedEmail).values({ email: "guest@x.io" }).run();
    expect(isEmailAllowed(db, "BOSS@example.com", SUPER)).toBe(true);
    expect(isEmailAllowed(db, "Guest@X.io", SUPER)).toBe(true);
    expect(isEmailAllowed(db, "nobody@x.io", SUPER)).toBe(false);
  });

  test("promotes env email to super_admin", () => {
    const id = addUser("boss@example.com");
    expect(syncUserRole(db, id, SUPER)).toEqual({ allowed: true, role: "super_admin" });
    expect(roleOf(id)).toBe("super_admin");
  });

  test("demotes super_admin removed from env", () => {
    const id = addUser("former@x.io", "super_admin", true);
    expect(syncUserRole(db, id, SUPER).allowed).toBe(true);
    expect(roleOf(id)).toBe("user");
  });

  test("session creation is refused with not_invited for an uninvited user", async () => {
    const id = addUser("revoked@x.io");
    const ctx = await auth.$context;
    const err = await ctx.internalAdapter.createSession(id).catch((e: unknown) => e);
    expect((err as { body?: { code?: string } }).body?.code).toBe(NOT_INVITED);
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(0);
  });

  test("boot sync demotes/revokes stale super_admins", async () => {
    const id = addUser("gone@x.io", "super_admin", true);
    const cookie = await cookieFor(id); // session hook already demotes on creation
    expect(roleOf(id)).toBe("user");
    db.update(user).set({ role: "super_admin" }).where(eq(user.id, id)).run();
    db.delete(allowedEmail).where(eq(allowedEmail.email, "gone@x.io")).run();
    syncSuperAdminsOnBoot(db, SUPER);
    expect(db.select().from(session).where(eq(session.userId, id)).all()).toHaveLength(0);
    expect((await get("/api/me", cookie)).status).toBe(401);
  });
});

describe("HTTP API", () => {
  test("GET /api/me → 401 without session", async () => {
    const res = await get("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("GET /api/me → 200 with session", async () => {
    const id = addUser("member@x.io", "user", true);
    const res = await get("/api/me", await cookieFor(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id,
      email: "member@x.io",
      name: expect.any(String),
      image: null,
      role: "user",
      home: "/profile",
    });
  });

  test("/api/panel/ping: 401 anon, 403 user, 200 admin", async () => {
    expect((await get("/api/panel/ping")).status).toBe(401);
    const u = await get("/api/panel/ping", await cookieFor(addUser("p-user@x.io", "user", true)));
    expect(u.status).toBe(403);
    expect(await u.json()).toEqual({ error: "forbidden" });
    const a = await get("/api/panel/ping", await cookieFor(addUser("p-admin@x.io", "admin", true)));
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true });
  });

  test("/api/dev/ping: 403 admin, 200 super_admin", async () => {
    const a = await get("/api/dev/ping", await cookieFor(addUser("d-admin@x.io", "admin", true)));
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

  test("OAuth callback for an uninvited Google account redirects to /login?error=not_invited", async () => {
    const res = await googleCallback("stranger@x.io");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "", BASE);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe(NOT_INVITED);
    expect(db.select().from(user).where(eq(user.email, "stranger@x.io")).all()).toHaveLength(0);
  });

  test("OAuth callback for an invited Google account signs in and redirects to callbackURL", async () => {
    db.insert(allowedEmail).values({ email: "newbie@x.io" }).run();
    const res = await googleCallback("Newbie@X.io");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token="))).toBe(true);
    expect(db.select({ role: user.role }).from(user).where(eq(user.email, "newbie@x.io")).get()?.role).toBe("user");
  });
});

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
