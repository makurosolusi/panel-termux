import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createAuth } from "@/server/auth/auth.service";
import { assertFresh, FRESH_SESSION_MS } from "@/server/auth/role.guard";
import { encryptSecret } from "@/server/crypto.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, session, setting, user } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { createApiRoutes } from "@/server/routes/api.routes";
import { ApiError } from "@/server/routes/http.error";
import {
  getSetting,
  InvalidSettingError,
  KeyMismatchError,
  SETTINGS,
  setSetting,
  unreadableSecretSettings,
} from "@/server/settings.service";
import { type DevSetting, type DevSettings, SETTING_KEYS } from "@/shared/dev.types";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "fedcba9876543210".repeat(4);
const OTHER_SECRET = "0".repeat(64);
const SUPER = ["root@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };
const CF_TOKEN = "cfTok_abcdefghijklmnopqrstuvwxyz0123456789";
const TG_TOKEN = "123456:abcdefghijklmnopqrstuvwxyz0123456789";

const dir = mkdtempSync(join(tmpdir(), "panel-settings-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let api: ReturnType<typeof createApiRoutes>;
let rootId: string;
let root: string;
let rootSessionId: string;

/** Creates a session through Better Auth and returns its id plus a signed cookie header. */
async function sessionFor(userId: string): Promise<{ id: string; cookie: string }> {
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
  return { id: s.id, cookie: `better-auth.session_token=${encodeURIComponent(signed)}` };
}

const call = (method: string, path: string, body?: unknown, cookie = root) =>
  api.handle(
    new Request(`${BASE}/api/dev${path}`, {
      method,
      headers: {
        origin: BASE,
        "x-requested-with": "XMLHttpRequest",
        cookie,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
const patch = (values: unknown) => call("PATCH", "/settings", { values });
const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const audits = () => db.select().from(auditLog).where(eq(auditLog.action, "settings.update")).all();
const row = (key: string) => db.select().from(setting).where(eq(setting.key, key)).get();
const item = (items: DevSetting[], key: string) => items.find((s) => s.key === key);

beforeAll(async () => {
  db = openDb(dir);
  runMigrations(db);
  auth = createAuth({ db, env, secret: SECRET });
  api = createApiRoutes(auth, { db, secret: SECRET, superAdmins: SUPER, dataDir: dir });
  rootId = "s1";
  db.insert(user).values({ id: rootId, email: "root@example.com", name: "Root", role: "user" }).run();
  const s = await sessionFor(rootId); // promoted to super_admin by the session hook
  root = s.cookie;
  rootSessionId = s.id;
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /settings", () => {
  test("every SETTING_KEYS key in order, with defaults, readable, secrets null", async () => {
    const { items } = await json<DevSettings>(await call("GET", "/settings"));
    expect(items.map((s) => s.key)).toEqual([...SETTING_KEYS]);
    expect(Object.keys(SETTINGS).sort()).toEqual([...SETTING_KEYS].sort());
    expect(item(items, "sites.port_range")).toMatchObject({ value: "3001-3999", default: "3001-3999", isSet: false });
    expect(item(items, "panel.protected_services")?.default).toBe("sshd,cloudflared,panel,pm2,postgres");
    expect(item(items, "monitor.battery_warn_percent")?.value).toBe("25");
    expect(item(items, "backup.include_secrets")?.value).toBe("off");
    expect(item(items, "alerts.min_severity")?.value).toBe("warning");
    expect(item(items, "alerts.language")).toMatchObject({ value: "en", default: "en", secret: false });
    expect(items.filter((s) => s.secret).map((s) => s.key)).toEqual([
      "cloudflare.api_token",
      "backup.s3_access_key_id",
      "backup.s3_secret_access_key",
      "alerts.telegram_bot_token",
    ]);
    for (const s of items) expect(s.readable).toBe(true);
    for (const s of items.filter((i) => i.secret)) expect(s.value).toBeNull();
  });
});

describe("PATCH /settings", () => {
  test("three keys → 200, trimmed, one audit per key with key only", async () => {
    const before = audits().length;
    const { items } = await json<DevSettings>(
      await patch({ "backup.hour": " 4 ", "backup.retention_days": "30", "monitor.sample_interval_sec": "120" }),
    );
    expect(item(items, "backup.hour")).toMatchObject({ value: "4", isSet: true, updatedAt: expect.any(String) });
    expect(item(items, "monitor.sample_interval_sec")?.value).toBe("120");
    const added = audits().slice(before);
    expect(added.map((a) => a.target).sort()).toEqual([
      "backup.hour",
      "backup.retention_days",
      "monitor.sample_interval_sec",
    ]);
    for (const a of added) expect(a).toMatchObject({ actorId: rootId, meta: { reset: false } });
  });

  test("unchanged value and reset of an unset key write no audit", async () => {
    const before = audits().length;
    await json(await patch({ "backup.hour": "4", "alerts.enabled": null }));
    expect(audits().length).toBe(before);
  });

  test("one invalid key rejects the whole batch: 400 fields, nothing stored, no audit", async () => {
    const before = audits().length;
    const body = await json<{ error: string; fields: Record<string, string> }>(
      await patch({ "sites.port_range": "5000-5100", "backup.hour": "25", "alerts.min_severity": " " }),
      400,
    );
    expect(body).toMatchObject({
      error: "invalid_value",
      fields: { "backup.hour": "invalid", "alerts.min_severity": "empty" },
    });
    expect(body.fields["sites.port_range"]).toBeUndefined();
    expect(row("sites.port_range")).toBeUndefined();
    expect(row("backup.hour")?.value).toBe("4");
    expect(audits().length).toBe(before);
  });

  test("body shape errors → 400 invalid_body", async () => {
    expect(await json(await patch({ nope: "x", "backup.hour": "3" }), 400)).toMatchObject({
      error: "invalid_body",
      fields: { nope: "unknown" },
    });
    expect(await json(await patch({ "backup.hour": 3 }), 400)).toMatchObject({
      error: "invalid_body",
      fields: { "backup.hour": "invalid" },
    });
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, "x"]));
    expect(await json(await patch(many), 400)).toMatchObject({ error: "invalid_body" });
    expect(await json(await patch({}), 400)).toMatchObject({ error: "invalid_body" });
    expect(await json(await call("PATCH", "/settings", ["x"]), 400)).toMatchObject({ error: "invalid_body" });
    expect(row("backup.hour")?.value).toBe("4");
  });

  test("null resets to default with audit {reset: true}", async () => {
    const { items } = await json<DevSettings>(await patch({ "backup.hour": null }));
    expect(item(items, "backup.hour")).toMatchObject({ value: "3", isSet: false, updatedAt: null });
    expect(audits().at(-1)).toMatchObject({ target: "backup.hour", meta: { reset: true } });
  });

  test("PUT /settings/:key is gone → 404", async () => {
    expect((await call("PUT", "/settings/sites.dir", { value: "/tmp" })).status).toBe(404);
  });

  test("secret: encrypted at rest, never in response, audit or logs", async () => {
    const res = await call("PATCH", "/settings", {
      values: { "cloudflare.api_token": CF_TOKEN, "alerts.telegram_bot_token": TG_TOKEN },
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(CF_TOKEN);
    expect(text).not.toContain(TG_TOKEN);
    const raw = row("cloudflare.api_token")?.value ?? "";
    expect(raw.startsWith("v1.")).toBe(true);
    expect(raw).not.toContain(CF_TOKEN);
    expect(getSetting({ db, secret: SECRET }, "cloudflare.api_token")).toBe(CF_TOKEN);
    expect(() => getSetting({ db, secret: OTHER_SECRET }, "cloudflare.api_token")).toThrow(KeyMismatchError);
    // A secret sent again always counts as changed.
    const before = audits().length;
    await json(await patch({ "cloudflare.api_token": CF_TOKEN }));
    expect(audits().length).toBe(before + 1);
    const trail = JSON.stringify(audits()) + (await (await call("GET", "/audit?pageSize=100")).text());
    const logs = JSON.stringify(readLogs({ limit: 1000 }));
    for (const s of [trail, logs]) {
      expect(s).not.toContain(CF_TOKEN);
      expect(s).not.toContain(TG_TOKEN);
    }
  });

  test("unreadable secret → readable:false and any secret save 409 key_mismatch", async () => {
    db.update(setting)
      .set({ value: encryptSecret(OTHER_SECRET, "abcdefgh12345678") })
      .where(eq(setting.key, "cloudflare.api_token"))
      .run();
    expect(unreadableSecretSettings({ db, secret: SECRET })).toEqual(["cloudflare.api_token"]);
    const { items } = await json<DevSettings>(await call("GET", "/settings"));
    expect(item(items, "cloudflare.api_token")).toMatchObject({ readable: false, isSet: true });
    expect(item(items, "alerts.telegram_bot_token")?.readable).toBe(true);
    // A different secret key is blocked too (no mixed-key state), and nothing of the batch is written.
    expect(
      await json(await patch({ "backup.s3_access_key_id": "AKIA12345678", "sites.dir": "/data/sites" }), 409),
    ).toMatchObject({ error: "key_mismatch" });
    expect(row("backup.s3_access_key_id")).toBeUndefined();
    expect(row("sites.dir")).toBeUndefined();
    expect(() => setSetting({ db, secret: SECRET }, "cloudflare.api_token", null, rootId)).toThrow(KeyMismatchError);
    await json(await patch({ "sites.dir": "/data/sites" })); // non-secret saves still work
    db.delete(setting).where(eq(setting.key, "cloudflare.api_token")).run();
    expect(unreadableSecretSettings({ db, secret: SECRET })).toEqual([]);
  });

  test("sensitive backup change needs a fresh session → 403 reauth_required", async () => {
    const stale = new Date(Date.now() - FRESH_SESSION_MS - 60_000);
    db.update(session).set({ createdAt: stale }).where(eq(session.id, rootSessionId)).run();
    try {
      expect(await json(await patch({ "backup.include_secrets": "on" }), 403)).toMatchObject({
        error: "reauth_required",
      });
      expect(await json(await patch({ "backup.prefix": "elsewhere/" }), 403)).toMatchObject({
        error: "reauth_required",
      });
      expect(row("backup.prefix")).toBeUndefined();
      // Turning secrets off, or re-sending the current prefix, is not sensitive.
      await json(await patch({ "backup.include_secrets": "off", "backup.prefix": null }));
    } finally {
      db.update(session).set({ createdAt: new Date() }).where(eq(session.id, rootSessionId)).run();
    }
    await json(await patch({ "backup.include_secrets": "on" }));
    expect(row("backup.include_secrets")?.value).toBe("on");
  });
});

describe("setSetting wrapper and registry", () => {
  test("setSetting still stores, validates and resets", () => {
    const deps = { db, secret: SECRET };
    setSetting(deps, "sites.port_range", " 5000-5100 ", rootId);
    expect(getSetting(deps, "sites.port_range")).toBe("5000-5100");
    expect(() => setSetting(deps, "sites.port_range", "80-90", rootId)).toThrow(InvalidSettingError);
    setSetting(deps, "sites.port_range", null, rootId);
    expect(getSetting(deps, "sites.port_range")).toBe("3001-3999");
    expect(getSetting(deps, "sites.dir")).toBe("/data/sites");
    setSetting(deps, "sites.dir", null, rootId);
    expect(getSetting(deps, "sites.dir")).toBe(join(process.env.HOME ?? "", "sites"));
  });

  const ok = (k: keyof typeof SETTINGS, ...xs: string[]) => {
    for (const x of xs) expect(SETTINGS[k].validate(x)).toBeNull();
  };
  const bad = (k: keyof typeof SETTINGS, ...xs: string[]) => {
    for (const x of xs) expect(SETTINGS[k].validate(x)).not.toBeNull();
  };
  test("validators of the 0.3.0 keys", () => {
    ok("monitor.battery_warn_percent", "off", "16", "100");
    bad("monitor.battery_warn_percent", "15", "101", "2.5");
    ok("monitor.sample_interval_sec", "30", "600");
    bad("monitor.sample_interval_sec", "29", "601");
    ok("alerts.enabled", "on", "off");
    bad("alerts.enabled", "yes");
    ok("alerts.min_severity", "warning", "danger");
    bad("alerts.min_severity", "info");
    ok("alerts.language", "en", "id");
    bad("alerts.language", "fr", "en-US", "ID");
    ok("alerts.telegram_bot_token", TG_TOKEN);
    bad("alerts.telegram_bot_token", "123:short", "abc:abcdefghijklmnopqrstuvwxyz0123456789");
    ok("alerts.telegram_chat_id", "-1001234567890", "42", "@my_channel");
    bad("alerts.telegram_chat_id", "@abc", "chat", "1".repeat(21));
    ok("audit.retention_days", "90", "3650");
    bad("audit.retention_days", "89", "3651");
    ok("backup.include_secrets", "off", "on");
    ok("backup.keep_min_runs", "3");
    bad("backup.keep_min_runs", "0");
    ok("backup.max_item_mb", "2048");
    bad("backup.max_item_mb", "0", "x");
    bad("panel.protected_services", "sshd,,x");
  });

  test("assertFresh: 403 reauth_required only past FRESH_SESSION_MS", () => {
    const now = new Date("2026-11-26T12:00:00Z");
    expect(() => assertFresh({ createdAt: new Date(now.getTime() - FRESH_SESSION_MS) }, now)).not.toThrow();
    try {
      assertFresh({ createdAt: new Date(now.getTime() - FRESH_SESSION_MS - 1) }, now);
      throw new Error("assertFresh did not throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ status: 403, code: "reauth_required" });
    }
  });
});
