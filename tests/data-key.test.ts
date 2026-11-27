import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { createAuth } from "@/server/auth/auth.service";
import { encryptSecret } from "@/server/crypto.service";
import {
  checkDataKeyOnBoot,
  dataKeyFileName,
  dataKeyState,
  exportDataKeyText,
  getSecurityStatus,
  resetUnreadableSettings,
} from "@/server/data-key.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { appMeta, auditLog, session, setting, user } from "@/server/db/schema";
import { createSecurityRoutes } from "@/server/routes/security.routes";
import { getSetting, KeyMismatchError, type SettingKey, setSetting } from "@/server/settings.service";
import type { RevokedSessions, SecurityStatus } from "@/shared/security.types";

// test-only dummy values
const BASE = "https://panel.example.com";
const KEY = "a1".repeat(32);
const OLD_KEY = "b2".repeat(32);
const env = {
  APP_BASE_URL: BASE,
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
  SUPER_ADMIN_EMAILS: ["root@example.com"],
};

const dir = mkdtempSync(join(tmpdir(), "panel-datakey-"));
let db: Db;
const deps = () => ({ db, secret: KEY });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const put = (key: SettingKey, secret: string, value = "tok_0123456789abcdefghij") =>
  db
    .insert(setting)
    .values({ key, value: encryptSecret(secret, value), updatedAt: new Date(), updatedBy: null })
    .run();
const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action)).all();

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  db.insert(user).values({ id: "root", email: "root@example.com", name: "Root", role: "super_admin" }).run();
  db.insert(user).values({ id: "adm", email: "adm@example.com", name: "Adm", role: "admin" }).run();
});
beforeEach(() => {
  for (const t of [setting, auditLog, session, appMeta]) db.delete(t).run();
});

describe("data key state (try-decrypt)", () => {
  test("no secrets or all readable → ok; boot check writes no audit", () => {
    expect(dataKeyState(deps())).toEqual({ state: "ok", unreadable: [] });
    put("cloudflare.api_token", KEY);
    expect(checkDataKeyOnBoot(deps(), false)).toBe("ok");
    expect(audits("secret.mismatch")).toHaveLength(0);
  });

  test("rows from another key → mismatch: visible, audited, nothing deleted, saving secrets blocked", () => {
    put("cloudflare.api_token", OLD_KEY);
    put("alerts.telegram_bot_token", OLD_KEY);
    expect(dataKeyState(deps())).toEqual({
      state: "mismatch",
      unreadable: ["cloudflare.api_token", "alerts.telegram_bot_token"],
    });
    expect(checkDataKeyOnBoot(deps(), true)).toBe("mismatch");
    expect(audits("secret.mismatch").map((a) => a.meta)).toEqual([{ createdThisBoot: true, unreadable: 2 }]);
    expect(db.select().from(setting).all()).toHaveLength(2);
    expect(() => setSetting(deps(), "backup.s3_access_key_id", "AKIA0123456789", "root")).toThrow(KeyMismatchError);
    // Path A: the old key file comes back → ok again without any write.
    expect(dataKeyState({ db, secret: OLD_KEY }).state).toBe("ok");
  });

  test("reset deletes only unreadable rows and audits their keys", () => {
    put("cloudflare.api_token", OLD_KEY);
    put("backup.s3_access_key_id", KEY, "AKIA0123456789");
    expect(resetUnreadableSettings(deps(), "root")).toEqual(["cloudflare.api_token"]);
    expect(dataKeyState(deps()).state).toBe("ok");
    expect(getSetting(deps(), "backup.s3_access_key_id")).toBe("AKIA0123456789");
    expect(audits("secret.reset").map((a) => a.meta)).toEqual([{ keys: ["cloudflare.api_token"] }]);
    expect(resetUnreadableSettings(deps(), "root")).toEqual([]);
  });
});

describe("data key file", () => {
  test("text holds the key, the panel URL and the restore command; name carries the local date", () => {
    const now = new Date(2026, 10, 26, 21, 30);
    const text = exportDataKeyText(KEY, BASE, now);
    expect(text).toStartWith("Panel Termux — data key (data/secret)\n");
    expect(text).toContain(`Panel: ${BASE} · created 2026-11-26 21:30`);
    expect(text).toContain(`printf '%s' '${KEY}' > ~/panel/data/secret && chmod 600 ~/panel/data/secret`);
    expect(text.trimEnd().split("\n").at(-1)).toBe(KEY);
    expect(dataKeyFileName(now)).toBe("panel-termux-data-key-2026-11-26.txt");
  });
});

describe("/api/dev/security routes", () => {
  let auth: ReturnType<typeof createAuth>;
  let api: Elysia;
  let rootId: string;
  let root: string;
  let rootSession: string;

  async function cookieFor(userId: string): Promise<{ cookie: string; id: string }> {
    const ctx = await auth.$context;
    const s = await ctx.internalAdapter.createSession(userId);
    if (!s) throw new Error(`createSession for ${userId} returned null`);
    const k = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s.token));
    const signed = `${s.token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
    return { cookie: `__Secure-better-auth.session_token=${encodeURIComponent(signed)}`, id: s.id };
  }
  const call = (method: string, path: string, cookie: string, body?: unknown) =>
    api.handle(
      new Request(`${BASE}/api/dev${path}`, {
        method,
        headers: { origin: BASE, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  const stale = (id: string) =>
    db
      .update(session)
      .set({ createdAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(session.id, id))
      .run();

  beforeAll(() => {
    auth = createAuth({ db, env, secret: KEY });
    api = new Elysia({ prefix: "/api" }).use(
      createSecurityRoutes(auth, { db, secret: KEY, appBaseUrl: BASE, createdThisBoot: true }),
    ) as unknown as Elysia;
    rootId = "root";
  });
  beforeEach(async () => {
    ({ cookie: root, id: rootSession } = await cookieFor(rootId));
  });

  test("GET /security: status for super_admin, 403 for admin", async () => {
    put("cloudflare.api_token", OLD_KEY);
    db.insert(setting)
      .values({ key: "backup.include_secrets", value: "on", updatedAt: new Date(), updatedBy: null })
      .run();
    const res = await call("GET", "/security", root);
    expect(res.status).toBe(200);
    const s = (await res.json()) as SecurityStatus;
    expect(s.dataKey).toEqual({
      state: "mismatch",
      createdThisBoot: true,
      exportedAt: null,
      unreadableSettings: ["cloudflare.api_token"],
    });
    expect(s.access.https).toBe(true);
    expect(s.sessions).toEqual({ active: 1, users: 1 });
    expect(s.backupsIncludeSecrets).toBe(true);
    expect((await call("GET", "/security", (await cookieFor("adm")).cookie)).status).toBe(403);
  });

  test("export: fresh session → attachment, no-store, exportedAt + audit; stale → 403; mismatch → 409", async () => {
    const res = await call("POST", "/security/data-key/export", root);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="panel-termux-data-key-\d{4}-\d\d-\d\d\.txt"$/,
    );
    expect(await res.text()).toContain(KEY);
    expect(audits("secret.export")).toHaveLength(1);
    const status = getSecurityStatus(deps(), { appBaseUrl: BASE, createdThisBoot: false });
    expect(status.dataKey.exportedAt).not.toBeNull();

    put("cloudflare.api_token", OLD_KEY);
    expect((await call("POST", "/security/data-key/export", root)).status).toBe(409);
    stale(rootSession);
    const r403 = await call("POST", "/security/data-key/export", root);
    expect(r403.status).toBe(403);
    expect(((await r403.json()) as { error: string }).error).toBe("reauth_required");
  });

  test("reset: typed `delete` (or the old `hapus`) + fresh session; 400 confirm_mismatch, 409 key_ok, 403 stale", async () => {
    put("cloudflare.api_token", OLD_KEY);
    const bad = await call("POST", "/security/data-key/reset", root, { confirm: "DELETE" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("confirm_mismatch");
    expect((await call("POST", "/security/data-key/reset", root, { confirm: "reset" })).status).toBe(400);
    const ok = await call("POST", "/security/data-key/reset", root, { confirm: "delete" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as SecurityStatus).dataKey.state).toBe("ok");
    expect(db.select().from(setting).all()).toHaveLength(0);
    const again = await call("POST", "/security/data-key/reset", root, { confirm: "delete" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("key_ok");
    put("cloudflare.api_token", OLD_KEY);
    // the Indonesian UI word, accepted alongside the English one (PLAN/08 §5)
    expect((await call("POST", "/security/data-key/reset", root, { confirm: "hapus" })).status).toBe(200);
    put("cloudflare.api_token", OLD_KEY);
    stale(rootSession);
    expect((await call("POST", "/security/data-key/reset", root, { confirm: "hapus" })).status).toBe(403);
    expect(db.select().from(setting).all()).toHaveLength(1);
  });

  test("revoke-all signs out every other session, keeps the caller's", async () => {
    await cookieFor("adm");
    await cookieFor(rootId);
    const res = await call("POST", "/sessions/revoke-all", root);
    expect(res.status).toBe(200);
    expect(((await res.json()) as RevokedSessions).revoked).toBe(2);
    expect(
      db
        .select()
        .from(session)
        .all()
        .map((s) => s.id),
    ).toEqual([rootSession]);
  });
});
