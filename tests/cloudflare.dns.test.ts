import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createCloudflareDevRoutes } from "@/server/cloudflare/cloudflare.routes";
import { createDnsProvider, createFakeDnsProvider, MANAGED_COMMENT } from "@/server/cloudflare/dns.provider";
import { DnsConflictError, DnsNotConfiguredError, type DnsProvider } from "@/server/cloudflare/dns.types";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, dnsRecord, user } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { setSetting } from "@/server/settings.service";

// test-only dummy values
const SECRET = "0123456789abcdef".repeat(4);
const TOKEN = "cfTok_mock_abcdefghijklmnopqrstuvwxyz0123";
const TUNNEL = "11111111-2222-3333-4444-555555555555";
const TARGET = `${TUNNEL}.cfargotunnel.com`;

type Rec = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  comment?: string;
  zone: string;
};
const zones = [
  { id: "z-example", name: "example.com" },
  { id: "z-deep", name: "deep.example.com" },
  { id: "z-ample", name: "ample.com" }, // suffix trap: "example.com" ends with "ample.com" but not on a label boundary
  { id: "z-other", name: "other.net" },
];
const records = new Map<string, Rec>();
const calls: { method: string; path: string; auth: string | null }[] = [];
let fail429 = 0;
let recSeq = 0;

const ok = (result: unknown, extra: object = {}) => Response.json({ success: true, errors: [], result, ...extra });
const fail = (status: number, code: number, message: string) =>
  Response.json({ success: false, errors: [{ code, message }], result: null }, { status });

// Mock of the Cloudflare v4 endpoints used by dns.provider (shapes per cloudflare/api-schemas openapi.json).
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace("/client/v4", "");
    calls.push({ method: req.method, path, auth: req.headers.get("authorization") });
    if (fail429 > 0) {
      fail429--;
      return fail(429, 10000, "rate limited");
    }
    if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return fail(400, 1000, "Invalid API Token");
    if (path === "/user/tokens/verify") return ok({ id: "tok1", status: "active" });
    if (path === "/zones") {
      const page = Number(url.searchParams.get("page") ?? 1);
      const per = 2; // force pagination in the client
      return ok(zones.slice((page - 1) * per, page * per), {
        result_info: { page, total_pages: Math.ceil(zones.length / per) },
      });
    }
    const m = path.match(/^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/);
    if (!m) return fail(404, 7003, "No route for the URI");
    const [, zone, id] = m;
    if (!id && req.method === "GET") {
      const name = url.searchParams.get("name.exact");
      return ok([...records.values()].filter((r) => r.zone === zone && r.name === name));
    }
    if (!id && req.method === "POST") {
      const b = (await req.json()) as Omit<Rec, "id" | "zone">;
      const r = { ...b, id: `rec${++recSeq}`, zone: zone as string };
      records.set(r.id, r);
      return ok(r);
    }
    const r = id ? records.get(id) : undefined;
    if (!r) return fail(404, 81044, "Record does not exist.");
    if (req.method === "DELETE") {
      records.delete(r.id);
      return ok({ id: r.id });
    }
    if (req.method === "PATCH") {
      Object.assign(r, await req.json());
      return ok(r);
    }
    return fail(405, 10000, "method not allowed");
  },
});

const dir = mkdtempSync(join(tmpdir(), "panel-cf-"));
let db: Db;
let dns: DnsProvider;
const errors: string[] = [];
const caught = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    errors.push((e as Error).message);
    return e as Error;
  }
  throw new Error("expected rejection");
};
const seedForeign = (name: string, zone = "z-example") => {
  const id = `foreign${++recSeq}`;
  records.set(id, { id, type: "A", name, content: "192.0.2.1", proxied: true, zone });
};

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  // Until the dns migration is generated (coordinator/site worker), create the table here; same SQL drizzle-kit emits.
  db.$client.run(`CREATE TABLE IF NOT EXISTS dns_record (
    hostname text PRIMARY KEY NOT NULL, zone_id text NOT NULL, record_id text NOT NULL,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL)`);
  db.insert(user).values({ id: "u1", email: "dev@example.com", name: "dev" }).run();
  dns = createDnsProvider({ db, secret: SECRET, baseUrl: `${server.url.origin}/client/v4`, retryDelayMs: 5 });
});
afterAll(() => {
  server.stop(true);
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  fail429 = 0;
  calls.length = 0;
});

describe("not configured", () => {
  test("ensure/delete throw DnsNotConfiguredError, verify reports it", async () => {
    expect(await caught(dns.ensureTunnelCname("a.example.com", TUNNEL))).toBeInstanceOf(DnsNotConfiguredError);
    expect(await dns.verify()).toEqual({ ok: false, message: expect.stringContaining("not set") });
    expect(calls).toHaveLength(0);
  });
});

describe("verify", () => {
  test("invalid token → ok:false with Cloudflare code", async () => {
    setSetting({ db, secret: SECRET }, "cloudflare.api_token", "wrongToken_abcdefghijklmnop", "u1");
    const r = await dns.verify();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("1000");
    expect(r.message).not.toContain("wrongToken");
  });
  test("valid token (token change applies without restart) → ok:true with zone count", async () => {
    setSetting({ db, secret: SECRET }, "cloudflare.api_token", TOKEN, "u1");
    expect(await dns.verify()).toEqual({ ok: true, message: "token is active; 4 zone(s) accessible" });
    expect(calls[0]).toEqual({ method: "GET", path: "/user/tokens/verify", auth: `Bearer ${TOKEN}` });
  });
  test("POST /cloudflare/verify route returns the provider result", async () => {
    const res = await createCloudflareDevRoutes({ dns }).handle(
      new Request("http://localhost/cloudflare/verify", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe("ensureTunnelCname", () => {
  test("zone = longest label-aligned suffix", async () => {
    await dns.ensureTunnelCname("sub.a.example.com", TUNNEL);
    await dns.ensureTunnelCname("x.deep.example.com", TUNNEL);
    const zoneOf = (h: string) => db.select().from(dnsRecord).where(eq(dnsRecord.hostname, h)).get()?.zoneId;
    expect(zoneOf("sub.a.example.com")).toBe("z-example");
    expect(zoneOf("x.deep.example.com")).toBe("z-deep");
    expect((await caught(dns.ensureTunnelCname("foo.notexample.org", TUNNEL))).message).toContain("no Cloudflare zone");
  });

  test("creates proxied CNAME with comment, stores row + audit; second call idempotent", async () => {
    const first = await dns.ensureTunnelCname("App.Example.com", TUNNEL);
    expect(first.created).toBe(true);
    const rec = records.get(first.recordId);
    expect(rec).toMatchObject({ type: "CNAME", name: "app.example.com", content: TARGET, proxied: true });
    expect(rec?.comment).toBe(MANAGED_COMMENT);
    const row = db.select().from(dnsRecord).where(eq(dnsRecord.hostname, "app.example.com")).get();
    expect(row).toMatchObject({ zoneId: "z-example", recordId: first.recordId });
    const audit = db.select().from(auditLog).where(eq(auditLog.action, "dns.create")).all();
    expect(audit.some((a) => a.target === "app.example.com")).toBe(true);

    calls.length = 0;
    expect(await dns.ensureTunnelCname("app.example.com", TUNNEL)).toEqual({
      recordId: first.recordId,
      created: false,
    });
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
    expect(calls.some((c) => c.path === "/zones")).toBe(false); // zones served from cache
  });

  test("managed record pointing at an old tunnel is repointed", async () => {
    const { recordId } = await dns.ensureTunnelCname("move.example.com", "old-tunnel");
    expect(await dns.ensureTunnelCname("move.example.com", TUNNEL)).toEqual({ recordId, created: false });
    expect(records.get(recordId)?.content).toBe(TARGET);
  });

  test("foreign record (root, www, anything) → DnsConflictError, untouched", async () => {
    seedForeign("example.com");
    seedForeign("www.example.com");
    for (const h of ["example.com", "www.example.com"]) {
      const e = await caught(dns.ensureTunnelCname(h, TUNNEL));
      expect(e).toBeInstanceOf(DnsConflictError);
      expect(e.message).toContain(h);
    }
    expect([...records.values()].filter((r) => r.name === "www.example.com")).toHaveLength(1);
    expect(db.select().from(dnsRecord).where(eq(dnsRecord.hostname, "www.example.com")).get()).toBeUndefined();
  });

  test("retries once on 429", async () => {
    fail429 = 1;
    expect((await dns.ensureTunnelCname("retry.example.com", TUNNEL)).created).toBe(true);
    expect(calls[0]?.path).toContain("/dns_records");
    expect(calls[1]?.path).toBe(calls[0]?.path);
  });

  test("two 429s → error with op + hostname + code", async () => {
    fail429 = 2;
    const e = await caught(dns.ensureTunnelCname("busy.example.com", TUNNEL));
    expect(e.message).toBe("cloudflare list records busy.example.com: HTTP 429 code 10000: rate limited");
  });
});

describe("deleteManaged", () => {
  test("deletes managed record + row, audits", async () => {
    const { recordId } = await dns.ensureTunnelCname("gone.example.com", TUNNEL);
    await dns.deleteManaged("gone.example.com");
    expect(records.has(recordId)).toBe(false);
    expect(db.select().from(dnsRecord).where(eq(dnsRecord.hostname, "gone.example.com")).get()).toBeUndefined();
    expect(db.select().from(auditLog).where(eq(auditLog.action, "dns.delete")).all()).toHaveLength(1);
  });
  test("ignores foreign records", async () => {
    calls.length = 0;
    await dns.deleteManaged("www.example.com");
    expect(calls).toHaveLength(0);
    expect([...records.values()].some((r) => r.name === "www.example.com")).toBe(true);
  });
  test("404 from Cloudflare (already gone) still removes the row", async () => {
    const { recordId } = await dns.ensureTunnelCname("stale.example.com", TUNNEL);
    records.delete(recordId);
    await dns.deleteManaged("stale.example.com");
    expect(db.select().from(dnsRecord).where(eq(dnsRecord.hostname, "stale.example.com")).get()).toBeUndefined();
  });
});

describe("secrecy", () => {
  test("token never appears in thrown messages or logs", () => {
    expect(errors.length).toBeGreaterThan(0);
    for (const m of errors) expect(m).not.toContain(TOKEN);
    for (const l of readLogs({ limit: 2000 })) expect(l.msg).not.toContain(TOKEN);
    const meta = JSON.stringify(db.select().from(auditLog).all());
    expect(meta).not.toContain(TOKEN);
  });
});

describe("fake provider", () => {
  test("create, idempotent, foreign conflict, delete", async () => {
    const fake = createFakeDnsProvider();
    const a = await fake.ensureTunnelCname("a.example.com", TUNNEL);
    expect(a.created).toBe(true);
    expect(await fake.ensureTunnelCname("a.example.com", TUNNEL)).toEqual({ ...a, created: false });
    fake.seedForeign("www.example.com");
    expect(await caught(fake.ensureTunnelCname("www.example.com", TUNNEL))).toBeInstanceOf(DnsConflictError);
    await fake.deleteManaged("www.example.com");
    expect(fake.records.has("www.example.com")).toBe(true);
    await fake.deleteManaged("a.example.com");
    expect(fake.records.has("a.example.com")).toBe(false);
  });
});
