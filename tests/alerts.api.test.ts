import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { TEST_TEXT } from "@/server/alerts/alert.messages";
import { createAuth } from "@/server/auth/auth.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, user } from "@/server/db/schema";
import type { MonitorService } from "@/server/monitor/monitor.service";
import { createAlertRoutes } from "@/server/routes/alerts.routes";
import { getSetting, setSetting } from "@/server/settings.service";
import type { AlertTestResult, TelegramChats } from "@/shared/monitor.types";
import type { Role } from "@/shared/roles";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "0123456789abcdef".repeat(4);
const TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const env = {
  APP_BASE_URL: BASE,
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
  SUPER_ADMIN_EMAILS: ["root@x.io"],
};

const dir = mkdtempSync(join(tmpdir(), "panel-alerts-"));
let db: Db;
let auth: ReturnType<typeof createAuth>;
let rootId: string;
let root: string;
let adminCookie: string;

/** Mock Bot API: `reply` decides each answer; `calls` records method + body. */
type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let reply: (c: Call) => { status: number; json: unknown } = () => ({ status: 200, json: { ok: true, result: {} } });
let telegram: ReturnType<typeof Bun.serve>;

let resets = 0;
const monitor = { resetAlertFailures: () => resets++ } as unknown as MonitorService;

let seq = 0;
function addUser(email: string, role: Role): string {
  const id = `a${++seq}`;
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

/** Fresh routes (own 5 s test-send gap) against the mock Bot API. */
const makeApi = () =>
  new Elysia({ prefix: "/api" }).use(
    createAlertRoutes({ auth, db, secret: SECRET, monitor, telegramBaseUrl: `http://127.0.0.1:${telegram.port}` }),
  );
let api: ReturnType<typeof makeApi>;
const post = (path: string, cookie = root) =>
  api.handle(new Request(`${BASE}/api/dev/alerts${path}`, { method: "POST", headers: { cookie } }));
const json = async <T>(res: Response, status = 200): Promise<T> => {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
};
const configure = (token: string | null, chat: string | null) => {
  setSetting({ db, secret: SECRET }, "alerts.telegram_bot_token", token, rootId);
  setSetting({ db, secret: SECRET }, "alerts.telegram_chat_id", chat, rootId);
};

beforeAll(async () => {
  telegram = Bun.serve({
    port: 0,
    async fetch(req) {
      const method = new URL(req.url).pathname.split("/").at(-1) ?? "";
      const c = { method, body: (await req.json()) as Record<string, unknown> };
      calls.push(c);
      const r = reply(c);
      return Response.json(r.json, { status: r.status });
    },
  });
  db = openDb(dir);
  runMigrations(db);
  auth = createAuth({ db, env, secret: SECRET });
  rootId = addUser("root@x.io", "super_admin");
  root = await cookieFor(rootId);
  adminCookie = await cookieFor(addUser("admin@x.io", "admin"));
});
beforeEach(() => {
  api = makeApi();
  calls = [];
  resets = 0;
  reply = () => ({ status: 200, json: { ok: true, result: {} } });
});
afterAll(() => {
  telegram.stop(true);
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("access", () => {
  test.each(["/test", "/telegram/chats"])("POST %s → 401 anon, 403 admin", async (path) => {
    expect(await json(await post(path, ""), 401)).toEqual({ error: "unauthorized" });
    expect(await json(await post(path, adminCookie), 403)).toEqual({ error: "forbidden" });
  });
});

describe("POST /dev/alerts/test", () => {
  test("not configured → 409 alerts_not_configured, nothing sent", async () => {
    configure(TOKEN, null);
    expect(await json(await post("/test"), 409)).toMatchObject({ error: "alerts_not_configured" });
    expect(calls).toEqual([]);
  });

  test("sends the test text, resets alert failures, then 429 too_soon with retryAfterSec", async () => {
    configure(TOKEN, "-100123");
    const r = await json<AlertTestResult>(await post("/test"));
    expect(r).toEqual({ ok: true, sentAt: expect.any(String) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "sendMessage", body: { chat_id: "-100123", text: TEST_TEXT } });
    expect(resets).toBe(1);
    const again = await json<{ error: string; retryAfterSec: number }>(await post("/test"), 429);
    expect(again).toMatchObject({ error: "too_soon", retryAfterSec: expect.any(Number) });
    expect(calls).toHaveLength(1);
  });

  test("Bot API 401 → 502 telegram_token_invalid without the token; failures not reset", async () => {
    configure(TOKEN, "-100123");
    reply = () => ({ status: 401, json: { ok: false, description: `Unauthorized ${TOKEN}` } });
    const body = await json<{ error: string; message: string }>(await post("/test"), 502);
    expect(body.error).toBe("telegram_token_invalid");
    expect(body.message).not.toContain(TOKEN);
    expect(resets).toBe(0);
  });

  test("chat migrated → new id stored with a System audit row and the send retried once", async () => {
    configure(TOKEN, "-100123");
    reply = (c) =>
      c.body.chat_id === "-100123"
        ? {
            status: 400,
            json: { ok: false, description: "group upgraded", parameters: { migrate_to_chat_id: -100999 } },
          }
        : { status: 200, json: { ok: true, result: {} } };
    await json<AlertTestResult>(await post("/test"));
    expect(calls.map((c) => c.body.chat_id)).toEqual(["-100123", "-100999"]);
    expect(getSetting({ db, secret: SECRET }, "alerts.telegram_chat_id")).toBe("-100999");
    const row = db.select().from(auditLog).where(eq(auditLog.action, "settings.update")).all().at(-1);
    expect(row).toMatchObject({ actorKind: "system", target: "alerts.telegram_chat_id" });
    expect(row?.meta).toMatchObject({ reason: "chat_migrated" });
  });
});

describe("POST /dev/alerts/telegram/chats", () => {
  test("no token → 409 alerts_token_missing", async () => {
    configure(null, null);
    expect(await json(await post("/telegram/chats"), 409)).toMatchObject({ error: "alerts_token_missing" });
  });

  test("lists unique chats from getUpdates", async () => {
    configure(TOKEN, null);
    const chat = { id: -5, title: "Ops", type: "group" };
    reply = () => ({
      status: 200,
      json: {
        ok: true,
        result: [
          { message: { chat } },
          { my_chat_member: { chat } },
          { message: { chat: { id: 7, first_name: "Bip", type: "private" } } },
        ],
      },
    });
    const r = await json<TelegramChats>(await post("/telegram/chats"));
    expect(r.chats).toEqual([
      { id: "-5", title: "Ops", type: "group" },
      { id: "7", title: "Bip", type: "private" },
    ]);
    expect(calls[0]?.method).toBe("getUpdates");
  });

  test("webhook active → 502 telegram_conflict", async () => {
    configure(TOKEN, null);
    reply = () => ({ status: 409, json: { ok: false, description: "Conflict: webhook is active" } });
    expect(await json(await post("/telegram/chats"), 502)).toMatchObject({ error: "telegram_conflict" });
  });
});
