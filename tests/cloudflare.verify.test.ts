import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { requestUserIds } from "@/server/auth/role.guard";
import { createCloudflareDevRoutes } from "@/server/cloudflare/cloudflare.routes";
import { createDnsProvider, createFakeDnsProvider } from "@/server/cloudflare/dns.provider";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, user } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { setSetting } from "@/server/settings.service";
import type { CloudflareVerify } from "@/shared/dev.types";

// test-only dummy values
const SECRET = "0123456789abcdef".repeat(4);
const OTHER_SECRET = "fedcba9876543210".repeat(4);
const TOKEN = "cfTok_verify_abcdefghijklmnopqrstuvwxyz";
const NOZONE = "cfTok_nozone_abcdefghijklmnopqrstuvwxyz";
const EXPIRED = "cfTok_expired_abcdefghijklmnopqrstuvwxy";
const DRAFT = "cfTok_draftxx_abcdefghijklmnopqrstuvwxy";
const SLOW = "cfTok_slowxxx_abcdefghijklmnopqrstuvwxy";
const ECHO = "cfTok_echoxxx_abcdefghijklmnopqrstuvwxy";

const ZONES: Record<string, string[]> = { [TOKEN]: ["a.com", "b.com", "c.com"], [DRAFT]: ["d.com"], [NOZONE]: [] };
let failNext: { status: number; times: number } = { status: 200, times: 0 };
const calls: string[] = [];

const ok = (result: unknown, extra: object = {}) => Response.json({ success: true, errors: [], result, ...extra });
const fail = (status: number, code: number, message: string) =>
  Response.json({ success: false, errors: [{ code, message }], result: null }, { status });

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname.replace("/client/v4", "");
    calls.push(path);
    if (failNext.times > 0) {
      failNext.times--;
      return fail(failNext.status, 10000, "try again");
    }
    const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    if (token === SLOW) await Bun.sleep(200);
    if (token === ECHO) return fail(403, 9109, `Unauthorized token ${token}`); // a hostile proxy echoing the token
    if (path.endsWith("/tokens/verify")) {
      if (token === EXPIRED) return ok({ id: "t", status: "expired" });
      if (!(token in ZONES)) return fail(400, 1000, "Invalid API Token");
      return ok({ id: "t", status: "active" });
    }
    if (path === "/zones") {
      const z = ZONES[token] ?? [];
      return ok(
        z.map((name, i) => ({ id: `z${i}`, name })),
        { result_info: { page: 1, total_pages: 1 } },
      );
    }
    return fail(404, 7003, "No route for the URI");
  },
});

const dir = mkdtempSync(join(tmpdir(), "panel-cfverify-"));
let db: Db;
let dns: ReturnType<typeof createDnsProvider>;
const deps = () => ({ baseUrl: `${server.url.origin}/client/v4`, retryDelayMs: 5, timeoutMs: 100 });
const save = (v: string | null) => setSetting({ db, secret: SECRET }, "cloudflare.api_token", v, "u1");
const post = async (
  body?: unknown,
  provider: Parameters<typeof createCloudflareDevRoutes>[0]["dns"] = dns,
  actorId?: string,
) => {
  const req = new Request("http://localhost/cloudflare/verify", {
    method: "POST",
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  if (actorId) requestUserIds.set(req.headers, actorId); // what the /dev role guard does for a signed-in user
  const res = await createCloudflareDevRoutes({ dns: provider, db }).handle(req);
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as CloudflareVerify & { error?: string } };
};

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  db.insert(user).values({ id: "u1", email: "dev@example.com", name: "dev" }).run();
  dns = createDnsProvider({ db, secret: SECRET, ...deps() });
});
afterAll(() => {
  server.stop(true);
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  failNext = { status: 200, times: 0 };
  calls.length = 0;
});

describe("POST /cloudflare/verify (saved token)", () => {
  test("not_set without calling Cloudflare", async () => {
    const r = await post();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false, code: "not_set", zones: null });
    expect(calls).toHaveLength(0);
  });
  test("ok with zone count", async () => {
    save(TOKEN);
    expect((await post()).json).toEqual({ ok: true, code: "ok", zones: 3, detail: expect.any(String) });
  });
  test("invalid token → api_error carrying the Cloudflare code", async () => {
    save("wrongToken_abcdefghijklmnop");
    const r = await post();
    expect(r.json).toMatchObject({ ok: false, code: "api_error", zones: null });
    expect(r.json.detail).toContain("1000");
    expect(r.text).not.toContain("wrongToken");
  });
  test("inactive token", async () => {
    save(EXPIRED);
    expect((await post()).json).toMatchObject({ ok: false, code: "inactive" });
  });
  test("active token without zones → no_zones, zones 0", async () => {
    save(NOZONE);
    expect((await post()).json).toMatchObject({ ok: false, code: "no_zones", zones: 0 });
  });
  test("token saved under another data key → key_mismatch", async () => {
    save(TOKEN);
    const other = createDnsProvider({ db, secret: OTHER_SECRET, ...deps() });
    expect((await post(undefined, other)).json).toMatchObject({ ok: false, code: "key_mismatch", zones: null });
    expect(calls).toHaveLength(0);
  });
});

describe("transport", () => {
  test("429 then success: retried once", async () => {
    save(TOKEN);
    failNext = { status: 429, times: 1 };
    expect((await post()).json.code).toBe("ok");
    expect(calls.filter((c) => c.endsWith("/tokens/verify"))).toHaveLength(2);
  });
  test("5xx twice → api_error after one retry", async () => {
    save(TOKEN);
    failNext = { status: 503, times: 2 };
    const r = await post();
    expect(r.json).toMatchObject({ ok: false, code: "api_error" });
    expect(r.json.detail).toContain("503");
    expect(calls).toHaveLength(2);
  });
  test("timeout → api_error, token not in detail", async () => {
    save(SLOW);
    const r = await post();
    expect(r.json).toMatchObject({ ok: false, code: "api_error" });
    expect(r.json.detail).toContain("verify token");
    expect(r.text).not.toContain(SLOW);
  });
});

describe("audit", () => {
  const rows = () => db.select().from(auditLog).where(eq(auditLog.action, "cloudflare.verify")).all();
  test("every test that ran → cloudflare.verify with { ok, code } and the actor; never the token", async () => {
    const before = rows().length;
    save(TOKEN);
    await post(undefined, dns, "u1");
    await post({ token: DRAFT }, dns, "u1");
    const added = rows().slice(before);
    expect(added.map((r) => [r.actorId, r.meta])).toEqual([
      ["u1", { ok: true, code: "ok" }],
      ["u1", { ok: true, code: "ok" }],
    ]);
    expect(JSON.stringify(added)).not.toContain(DRAFT);
    expect(JSON.stringify(added)).not.toContain(TOKEN);
  });
  test("refused body (400) is not audited", async () => {
    const before = rows().length;
    expect((await post({ token: "short" }, dns, "u1")).status).toBe(400);
    expect(rows()).toHaveLength(before);
  });
});

describe("draft token", () => {
  test("draft is tested instead of the saved token and not saved", async () => {
    save(NOZONE);
    expect((await post({ token: ` ${DRAFT} ` })).json).toMatchObject({ ok: true, code: "ok", zones: 1 });
    expect((await post()).json.code).toBe("no_zones"); // saved token unchanged, zone cache not poisoned
  });
  test("{token:null} and {} test the saved token", async () => {
    save(TOKEN);
    expect((await post({ token: null })).json.zones).toBe(3);
    expect((await post({})).json.zones).toBe(3);
  });
  test("malformed draft → 400 invalid_value, Cloudflare not called", async () => {
    const r = await post({ token: "short" });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "invalid_value", fields: { "cloudflare.api_token": "invalid" } });
    expect((await post({ token: 42 })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  test("non-JSON body → 400 invalid_body", async () => {
    const r = await post("{nope");
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("invalid_body");
  });
  test("token echoed by the API is redacted from detail and logs", async () => {
    const r = await post({ token: ECHO });
    expect(r.json).toMatchObject({ ok: false, code: "api_error" });
    expect(r.json.detail).toContain("[redacted]");
    expect(r.text).not.toContain(ECHO);
    for (const l of readLogs({ limit: 2000 }))
      for (const t of [ECHO, TOKEN, DRAFT, SLOW]) expect(l.msg).not.toContain(t);
  });
});

test("provider without verifyToken (fake) maps its verdict", async () => {
  expect((await post(undefined, createFakeDnsProvider())).json).toEqual({
    ok: true,
    code: "ok",
    zones: null,
    detail: "fake DNS provider",
  });
});
