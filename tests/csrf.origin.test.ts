import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { createAuth } from "@/server/auth/auth.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { app, servePanel } from "@/server/index";
import { readLogs } from "@/server/log.service";
import { createApiRoutes } from "@/server/routes/api.routes";
import { rejectForeignOrigin } from "@/server/routes/origin.guard";

// test-only dummy values
const BASE = "http://localhost:3200";
const SECRET = "0123456789abcdef".repeat(4);
const SUPER = ["boss@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };
const OK = { origin: BASE, "sec-fetch-site": "same-origin", "x-requested-with": "XMLHttpRequest" };

const dir = mkdtempSync(join(tmpdir(), "panel-csrf-"));
let db: Db;
/** Composed like start(): health app + API routes nested in a root Elysia. */
let api: { handle(req: Request): Response | Promise<Response> };

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  const auth = createAuth({ db, env, secret: SECRET });
  api = new Elysia().use(app).use(createApiRoutes(auth, { db, secret: SECRET, superAdmins: SUPER, dataDir: dir }));
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (method: string, path: string, headers: Record<string, string>) =>
  api.handle(new Request(`${BASE}${path}`, { method, headers }));

// One state-changing route per family; anon requests that pass the guard reach the role guard → 401.
const MUTATIONS: [string, string][] = [
  ["POST", "/api/panel/services/cloudflared/restart"],
  ["POST", "/api/panel/apps/x/restart"],
  ["POST", "/api/panel/sites"],
  ["PUT", "/api/panel/sites/x/env"],
  ["DELETE", "/api/panel/sites/x"],
  ["PUT", "/api/panel/uploads/u/chunks/0"],
  ["POST", "/api/panel/backups/run"],
  ["PATCH", "/api/dev/users/x"],
  ["DELETE", "/api/dev/users/x"],
  ["PUT", "/api/dev/settings/sites.dir"],
  ["POST", "/api/dev/cloudflare/verify"],
];

const BAD: [string, Record<string, string>][] = [
  ["no headers at all", {}],
  ["missing Origin and X-Requested-With", { "sec-fetch-site": "same-origin" }],
  ["foreign Origin", { ...OK, origin: "https://evil.example.com" }],
  ["sibling-subdomain Origin", { ...OK, origin: "http://solusi.localhost:3200" }],
  ['Origin "null"', { ...OK, origin: "null" }],
  ["Sec-Fetch-Site same-site", { ...OK, "sec-fetch-site": "same-site" }],
  ["Sec-Fetch-Site cross-site", { ...OK, "sec-fetch-site": "cross-site" }],
  ["missing X-Requested-With", { origin: BASE, "sec-fetch-site": "same-origin" }],
  ["wrong X-Requested-With", { ...OK, "x-requested-with": "fetch" }],
];

describe("state-changing /api requests", () => {
  for (const [method, path] of MUTATIONS) {
    test(`${method} ${path}: every bad origin combination → 403 forbidden_origin`, async () => {
      for (const [, headers] of BAD) {
        const res = await send(method, path, headers);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toBe("forbidden_origin");
      }
    });

    test(`${method} ${path}: same-origin request passes the guard (→ 401 anon)`, async () => {
      expect((await send(method, path, OK)).status).toBe(401);
      // Non-browser client: no Origin/Sec-Fetch-Site, but the custom header.
      expect((await send(method, path, { "x-requested-with": "XMLHttpRequest" })).status).toBe(401);
    });
  }

  test("rejection is logged at warn with method, path and origin host only", async () => {
    await send("POST", "/api/panel/services/cloudflared/restart", {
      origin: "https://evil.example.com",
      cookie: "better-auth.session_token=s3cr3t",
    });
    const [entry] = readLogs({ level: "warn", q: "[csrf]", limit: 1 });
    expect(entry?.msg).toBe(
      "[csrf] rejected POST /api/panel/services/cloudflared/restart origin=evil.example.com fetch-site=-",
    );
  });
});

describe("unaffected requests", () => {
  test("GET with foreign Origin / cross-site is not blocked by the guard", async () => {
    const h = { origin: "https://evil.example.com", "sec-fetch-site": "cross-site" };
    expect((await send("GET", "/api/health", h)).status).toBe(200);
    expect((await send("GET", "/api/panel/services", h)).status).toBe(401);
    expect((await send("HEAD", "/api/me", h)).status).not.toBe(403);
  });

  test("/api/auth/* is left to Better Auth (no forbidden_origin from our guard)", async () => {
    const res = await send("POST", "/api/auth/sign-out", {});
    const body = await res.text();
    expect(body).not.toContain("forbidden_origin");
  });
});

describe("rejectForeignOrigin", () => {
  test("Origin compared to the APP_BASE_URL origin, path ignored", () => {
    const req = (origin: string) =>
      new Request("http://127.0.0.1/api/panel/x", {
        method: "POST",
        headers: { origin, "x-requested-with": "XMLHttpRequest" },
      });
    expect(rejectForeignOrigin(req("https://panel.example.com"), "https://panel.example.com/")).toBeNull();
    expect(rejectForeignOrigin(req("http://panel.example.com"), "https://panel.example.com")?.status).toBe(403);
  });
});

describe("through servePanel (real server)", () => {
  let server: ReturnType<typeof servePanel>;
  beforeAll(() => {
    server = servePanel(api, "https://panel.example.com", 0, false);
  });
  afterAll(() => server.stop(true));

  test("cross-site POST → 403; canonical page redirect unchanged", async () => {
    const post = await fetch(`http://127.0.0.1:${server.port}/api/panel/services/cloudflared/restart`, {
      method: "POST",
      headers: { origin: "https://solusi.example.com", "sec-fetch-site": "same-site" },
    });
    expect(post.status).toBe(403);
    const page = await fetch(`http://127.0.0.1:${server.port}/login`, { redirect: "manual" });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("https://panel.example.com/login");
  });
});
