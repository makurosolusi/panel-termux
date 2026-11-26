import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog } from "@/server/db/schema";
import { FAKE_TUNNEL_ID } from "@/server/system/system.fake";
import type { Site, SiteCheckResult, SiteDetail } from "@/shared/site.types";
import { SECRET_VALUE, siteHarness } from "./site.harness";

const h = siteHarness();
const { home, system, fakeDns, realValidate, cfg, appsJson, read, call, json, waitJob, startJob, stepStatus, dbs } = h;

describe("access control", () => {
  const endpoints: [string, string, unknown][] = [
    ["GET", "/sites", undefined],
    ["GET", "/sites/discovered", undefined],
    ["GET", "/sites/suggest-port", undefined],
    ["POST", "/sites/check", { name: "a" }],
    ["POST", "/sites", {}],
    ["POST", "/sites/adopt", {}],
    ["GET", "/sites/x1", undefined],
    ["PUT", "/sites/x1/env", { set: {} }],
    ["POST", "/sites/x1/hostnames", { hostname: "a.b.cd" }],
    ["DELETE", "/sites/x1/hostnames/a.b.cd", undefined],
    ["DELETE", "/sites/x1", undefined],
    ["GET", "/jobs", undefined],
    ["GET", "/jobs/x", undefined],
    ["GET", "/integration", undefined],
  ];
  test.each(endpoints)("%s %s → 401 anon, 403 user", async (method, path, body) => {
    expect(await json(await call(method, path, body, ""), 401)).toEqual({ error: "unauthorized" });
    expect(await json(await call(method, path, body, h.userCookie), 403)).toEqual({ error: "forbidden" });
  });

  test("dev cloudflare verify is super_admin only", async () => {
    expect((await call("POST", "/cloudflare/verify", undefined, "", "dev")).status).toBe(401);
    expect((await call("POST", "/cloudflare/verify", undefined, h.admin, "dev")).status).toBe(403);
    expect(await json(await call("POST", "/cloudflare/verify", undefined, h.root, "dev"))).toEqual({
      ok: true,
      message: "fake DNS provider",
    });
  });
});

describe("check + suggest-port", () => {
  test("issues per field", async () => {
    const check = async (b: object) => json<SiteCheckResult>(await call("POST", "/sites/check", b));
    const codes = (r: SiteCheckResult) => r.issues.map((i) => `${i.field}:${i.code}`);
    expect(await check({ name: "shop", hostname: "shop.example.test" })).toEqual({ ok: true, issues: [] });
    expect(codes(await check({ name: "Bad_Name", hostname: "nope", port: 80 }))).toEqual([
      "name:invalid",
      "hostname:invalid",
      "port:out_of_range",
    ]);
    expect(codes(await check({ name: "adminneo", hostname: "solusi.example.test", port: 3005 }))).toEqual([
      "name:taken",
      "hostname:in_use",
      "port:in_use",
    ]);
    expect(codes(await check({ name: "shop", hostname: "Shop.Example.Test", port: 3001 }))).toEqual(["port:in_use"]);
    mkdirSync(join(home, "sites", "leftover"));
    expect(codes(await check({ name: "leftover", hostname: "x.example.test", port: 1.5 }))).toEqual([
      "name:folder_exists",
      "port:invalid",
    ]);
  });

  test("suggest skips ingress/pm2 ports and live listeners", async () => {
    // 3001 listening (fake), 3005/3006/3007/3999 taken by ingress/pm2.
    expect(await json(await call("GET", "/sites/suggest-port"))).toEqual({ port: 3002 });
  });
});

describe("create job", () => {
  test("happy path writes folder, db, .env, apps.json, ingress, DNS", async () => {
    const before = read(cfg) as string;
    const j = await startJob("POST", "/sites", {
      name: "shop",
      hostname: "shop.example.test",
      database: true,
      env: { API_SECRET: SECRET_VALUE },
    });
    expect(j).toMatchObject({ kind: "site.create", target: "shop", status: "succeeded", error: null });
    expect(Object.values(stepStatus(j))).toEqual(Array(8).fill("done"));
    const siteDir = join(home, "sites", "shop");
    expect(statSync(siteDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(siteDir, "data")).mode & 0o777).toBe(0o700);
    expect(statSync(join(siteDir, ".env")).mode & 0o777).toBe(0o600);
    const envText = read(join(siteDir, ".env")) as string;
    expect(envText).toMatch(
      /^API_SECRET='s3cr3t \\\$value with spaces'\nPORT=3002\nDATABASE_URL=postgresql:\/\/shop:[0-9a-f]{48}@127\.0\.0\.1:5432\/shop\n$/,
    );
    expect(JSON.parse(read(appsJson) as string)).toEqual([
      { name: "shop", cwd: siteDir, script: "./app", interpreter: "none", env: { PORT: "3002" } },
    ]);
    expect(read(cfg)).toBe(
      before.replace(
        "  - service: http_status:404",
        "  - hostname: shop.example.test\n    service: http://localhost:3002\n  - service: http_status:404",
      ),
    );
    expect(read(`${cfg}.bak`)).toBe(before);
    expect(fakeDns.records.get("shop.example.test")).toMatchObject({
      managed: true,
      target: `${FAKE_TUNNEL_ID}.cfargotunnel.com`,
    });
    expect(await dbs()).toContain("shop");
    // Job log never carries the password or env values.
    expect(JSON.stringify(j)).not.toContain(envText.match(/shop:([0-9a-f]+)@/)?.[1] as string);
    expect(JSON.stringify(j)).not.toContain("s3cr3t");
  });

  test("list + detail show the site without env values", async () => {
    const sites = await json<Site[]>(await call("GET", "/sites"));
    expect(sites).toEqual([
      expect.objectContaining({
        name: "shop",
        port: 3002,
        hostnames: ["shop.example.test"],
        database: "shop",
        runtime: "native",
        managed: true,
        appStatus: "not_deployed",
      }),
    ]);
    const res = await call("GET", "/sites/shop");
    const text = await res.clone().text();
    const d = await json<SiteDetail>(res);
    expect(d.envKeys).toEqual(["API_SECRET", "PORT", "DATABASE_URL"]);
    expect(d.dns).toEqual([{ hostname: "shop.example.test", managed: true }]);
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("postgresql://");
    const audit = h.db.select().from(auditLog).where(eq(auditLog.action, "site.create")).all();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("s3cr3t");
  });

  test("request-time validation → 400", async () => {
    expect(
      await json(await call("POST", "/sites", { name: "shop", hostname: "a.example.test", database: false }), 400),
    ).toMatchObject({ error: "invalid_site" });
    expect(
      await json(
        await call("POST", "/sites", { name: "z1", hostname: "a.example.test", database: false, env: { PORT: "1" } }),
        400,
      ),
    ).toMatchObject({ error: "invalid_env" });
    expect(await json(await call("POST", "/sites", { name: "z1", hostname: "a.example.test" }), 400)).toMatchObject({
      error: "invalid_database",
    });
  });

  test("invalid ingress at step 6 rolls back folder, db, apps.json byte-identical", async () => {
    const [cfgBefore, appsBefore] = [read(cfg), read(appsJson)];
    system.cloudflared.validate = async () => ({ ok: false, message: "error parsing ingress rules" });
    try {
      const j = await startJob("POST", "/sites", { name: "bad6", hostname: "bad6.example.test", database: true });
      expect(j.status).toBe("rolled_back");
      expect(j.error).toContain("error parsing ingress rules");
      expect(stepStatus(j)).toEqual({
        validate: "rolled_back",
        folder: "rolled_back",
        database: "rolled_back",
        env: "rolled_back",
        apps: "rolled_back",
        ingress: "failed",
        dns: "pending",
        restart: "pending",
      });
    } finally {
      system.cloudflared.validate = realValidate;
    }
    expect(read(cfg)).toBe(cfgBefore);
    expect(read(appsJson)).toBe(appsBefore);
    expect(existsSync(join(home, "sites", "bad6"))).toBe(false);
    expect(await dbs()).not.toContain("bad6");
  });

  test("DnsConflictError at step 7 rolls back ingress too", async () => {
    const [cfgBefore, appsBefore] = [read(cfg), read(appsJson)];
    fakeDns.seedForeign("taken.example.test");
    const j = await startJob("POST", "/sites", { name: "bad7", hostname: "taken.example.test", database: true });
    expect(j.status).toBe("rolled_back");
    expect(stepStatus(j)).toMatchObject({ ingress: "rolled_back", dns: "failed", restart: "pending" });
    expect(read(cfg)).toBe(cfgBefore);
    expect(read(appsJson)).toBe(appsBefore);
    expect(existsSync(join(home, "sites", "bad7"))).toBe(false);
    expect(await dbs()).not.toContain("bad7");
    expect(fakeDns.records.get("taken.example.test")?.managed).toBe(false);
  });

  test("DNS not configured → step skipped, job succeeds", async () => {
    h.setDnsConfigured(false);
    try {
      const j = await startJob("POST", "/sites", { name: "nodns", hostname: "nodns.example.test", database: false });
      expect(j.status).toBe("succeeded");
      expect(j.steps.find((s) => s.key === "dns")).toMatchObject({
        status: "skipped",
        message: expect.stringContaining("/dev"),
      });
      expect(stepStatus(j).database).toBe("skipped");
    } finally {
      h.setDnsConfigured(true);
    }
    expect((await json<SiteDetail>(await call("GET", "/sites/nodns"))).dns).toEqual([
      { hostname: "nodns.example.test", managed: false },
    ]);
  });

  test("second mutating request while a job runs → 409 busy", async () => {
    const first = await call("POST", "/sites", { name: "busy1", hostname: "busy1.example.test", database: false });
    expect(first.status).toBe(202);
    expect(
      await json(await call("POST", "/sites", { name: "busy2", hostname: "busy2.example.test", database: false }), 409),
    ).toMatchObject({ error: "busy" });
    expect(await json(await call("DELETE", "/sites/shop"), 409)).toMatchObject({ error: "busy" });
    await waitJob(((await first.json()) as { jobId: string }).jobId);
  });
});
