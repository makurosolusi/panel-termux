// Shared harness for tests/site.create.test.ts and tests/site.manage.test.ts (not a test file itself).
import { afterAll, beforeAll, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth } from "@/server/auth/auth.service";
import { createFakeDnsProvider } from "@/server/cloudflare/dns.provider";
import { DnsNotConfiguredError, type DnsProvider } from "@/server/cloudflare/dns.types";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { user } from "@/server/db/schema";
import { createApiRoutes } from "@/server/routes/api.routes";
import { createFakeSystem } from "@/server/system/system.fake";
import type { DatabaseInfo } from "@/shared/panel.types";
import type { Role } from "@/shared/roles";
import type { Job } from "@/shared/site.types";

// test-only dummy values
const BASE = "http://localhost";
const SECRET = "0123456789abcdef".repeat(4);
const SUPER = ["root@example.com"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: SUPER };
export const SECRET_VALUE = "s3cr3t $value with spaces";

/**
 * Shared setup of the site API tests: temp DB + fake system in a sandbox HOME (fake ports: 3001 listening),
 * fake DNS provider whose "configured" state can be toggled. Call once at the top level of a test file.
 */
export function siteHarness(opts: { healthTimeoutMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "panel-site-api-"));
  const home = join(dir, "home");
  const system = createFakeSystem({ home, delayMs: 20, listeningPorts: [3001] });
  const fakeDns = createFakeDnsProvider();
  let dnsConfigured = true;
  const dns: DnsProvider = {
    verify: () => fakeDns.verify(),
    ensureTunnelCname: (h, t) => {
      if (!dnsConfigured) throw new DnsNotConfiguredError("no token");
      return fakeDns.ensureTunnelCname(h, t);
    },
    deleteManaged: (h) => fakeDns.deleteManaged(h),
  };
  const realValidate = system.cloudflared.validate;
  const cfg = join(home, ".cloudflared", "config.yml");
  const appsJson = join(home, "sites", "apps.json");
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

  let db: Db;
  let auth: ReturnType<typeof createAuth>;
  let api: ReturnType<typeof createApiRoutes>;
  let admin: string;
  let userCookie: string;
  let root: string;
  let seq = 0;

  function addUser(email: string, role: Role): string {
    const id = `s${++seq}`;
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

  const call = (method: string, path: string, body?: unknown, cookie: string = admin, area = "panel") =>
    api.handle(
      new Request(`${BASE}/api/${area}${path}`, {
        method,
        headers: {
          origin: BASE,
          "x-requested-with": "XMLHttpRequest",
          ...(cookie ? { cookie } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  /** Request with a raw (non-JSON) body, e.g. upload chunks. */
  const raw = (method: string, path: string, body: Uint8Array<ArrayBuffer>, cookie: string = admin) =>
    api.handle(
      new Request(`${BASE}/api/panel${path}`, {
        method,
        headers: {
          origin: BASE,
          "x-requested-with": "XMLHttpRequest",
          ...(cookie ? { cookie } : {}),
          "content-type": "application/octet-stream",
        },
        body,
      }),
    );
  const json = async <T>(res: Response, status = 200): Promise<T> => {
    const text = await res.text();
    expect({ status: res.status, text }).toMatchObject({ status });
    return JSON.parse(text) as T;
  };
  async function waitJob(id: string): Promise<Job> {
    for (;;) {
      const j = await json<Job>(await call("GET", `/jobs/${id}`));
      if (j.status !== "running") return j;
      await Bun.sleep(10);
    }
  }
  const startJob = async (method: string, path: string, body?: unknown) =>
    waitJob((await json<{ jobId: string }>(await call(method, path, body), 202)).jobId);
  const stepStatus = (j: Job) => Object.fromEntries(j.steps.map((s) => [s.key, s.status]));
  const dbs = async () => (await json<DatabaseInfo[]>(await call("GET", "/databases"))).map((d) => d.name);

  beforeAll(async () => {
    db = openDb(dir);
    runMigrations(db);
    auth = createAuth({ db, env, secret: SECRET });
    api = createApiRoutes(auth, { db, secret: SECRET, superAdmins: SUPER, dataDir: dir }, system, dns, opts);
    admin = await cookieFor(addUser("admin@x.io", "admin"));
    userCookie = await cookieFor(addUser("plain@x.io", "user"));
    root = await cookieFor(addUser("root@example.com", "super_admin"));
  });
  afterAll(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const h = {
    home,
    system,
    fakeDns,
    realValidate,
    cfg,
    appsJson,
    read,
    dir,
    call,
    raw,
    json,
    waitJob,
    startJob,
    stepStatus,
    dbs,
    get db() {
      return db;
    },
    get admin() {
      return admin;
    },
    get userCookie() {
      return userCookie;
    },
    get root() {
      return root;
    },
    setDnsConfigured(v: boolean) {
      dnsConfigured = v;
    },
  };
  return h;
}
