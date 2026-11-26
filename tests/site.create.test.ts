import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, job } from "@/server/db/schema";
import { FAKE_TUNNEL_ID } from "@/server/system/system.fake";
import type { Job, Site, SiteCheckResult, SiteDetail } from "@/shared/site.types";
import { SECRET_VALUE, siteHarness } from "./site.harness";

// test-only: the panel's own address (read from the process env by the site service when the API is built)
const savedEnv = { APP_BASE_URL: process.env.APP_BASE_URL, PORT: process.env.PORT };
process.env.APP_BASE_URL = "https://panel.example.test";
process.env.PORT = "3002";
afterAll(() => Object.assign(process.env, savedEnv));

const h = siteHarness();
const { home, system, fakeDns, realValidate, cfg, appsJson, read, call, json, waitJob, startJob, stepStatus, dbs } = h;
const codes = (j: Job) => Object.fromEntries(j.steps.map((s) => [s.key, s.code]));

describe("access control", () => {
  const endpoints: [string, string, unknown][] = [
    ["GET", "/sites", undefined],
    ["GET", "/sites/discovered", undefined],
    ["GET", "/sites/suggest-port", undefined],
    ["POST", "/sites/check", { name: "a" }],
    ["POST", "/sites", {}],
    ["POST", "/sites/adopt", {}],
    ["GET", "/sites/x1", undefined],
    ["PATCH", "/sites/x1/settings", {}],
    ["GET", "/sites/x1/health", undefined],
    ["POST", "/sites/x1/restart", undefined],
    ["PUT", "/sites/x1/env", { set: {} }],
    ["POST", "/sites/x1/hostnames", { hostnames: ["a.b.cd"] }],
    ["DELETE", "/sites/x1/hostnames/a.b.cd", undefined],
    ["DELETE", "/sites/x1", undefined],
    ["GET", "/jobs", undefined],
    ["GET", "/jobs/active", undefined],
    ["GET", "/jobs/x", undefined],
    ["POST", "/jobs/x/recover", undefined],
    ["GET", "/integration", undefined],
    ["POST", "/integration/verify", undefined],
  ];
  test.each(endpoints)("%s %s → 401 anon, 403 user", async (method, path, body) => {
    expect(await json(await call(method, path, body, ""), 401)).toEqual({ error: "unauthorized" });
    expect(await json(await call(method, path, body, h.userCookie), 403)).toEqual({ error: "forbidden" });
  });
});

describe("check + suggest-port", () => {
  const check = async (b: object) => json<SiteCheckResult>(await call("POST", "/sites/check", b));
  const issues = (r: SiteCheckResult) => r.issues.map((i) => `${i.field}:${i.code}`);

  test("coded issues per field (0.2.x message kept)", async () => {
    expect(await check({ name: "shop", hostname: "shop.example.test" })).toEqual({ ok: true, issues: [], notes: [] });
    const r = await check({ name: "Bad_Name", hostname: "nope", port: 80 });
    expect(issues(r)).toEqual(["name:name_invalid", "hostname:hostname_invalid", "port:port_out_of_range"]);
    expect(r.issues[2]).toMatchObject({ params: { from: 3001, to: 3999 }, message: expect.any(String) });
    expect(issues(await check({ name: "adminneo", hostname: "solusi.example.test", port: 3005 }))).toEqual([
      "name:name_taken",
      "hostname:hostname_in_use",
      "port:port_in_use",
    ]);
    mkdirSync(join(home, "sites", "leftover"));
    expect(issues(await check({ name: "leftover", hostname: "x.example.test", port: 1.5 }))).toEqual([
      "name:name_folder_exists",
      "port:port_invalid",
    ]);
  });

  test("pm2-guard reserved; panel host/port refused; duplicates in one request", async () => {
    const r = await check({
      name: "pm2-guard",
      hostname: "panel.example.test",
      extraHostnames: ["a.example.test", "A.example.test"],
      port: 3002,
    });
    expect(issues(r)).toEqual([
      "name:name_reserved",
      "hostname:hostname_self",
      "hostname:hostname_duplicate",
      "port:port_panel",
    ]);
    expect(r.issues[2]?.hostname).toBe("a.example.test");
    expect(issues(await check({ scope: "hostname", hostname: "new.example.test" }))).toEqual([]);
  });

  test("suggestion skips the panel's port, ingress/pm2 ports and live listeners", async () => {
    // 3001 listening (fake), 3002 = panel PORT, 3005/3006/3007/3999 taken by ingress/pm2.
    expect(await json(await call("GET", "/sites/suggest-port"))).toEqual({ port: 3003 });
  });
});

describe("create job", () => {
  test("two domains, one cloudflared restart; folder, db, .env, ingress, DNS; no apps.json entry yet (D5)", async () => {
    const before = read(cfg) as string;
    const appsBefore = read(appsJson);
    const restarts: string[] = [];
    const realControl = system.runit.control;
    system.runit.control = async (name, action) => {
      restarts.push(`${name}:${action}`);
      return realControl(name, action);
    };
    let j: Job;
    try {
      j = await startJob("POST", "/sites", {
        name: "shop",
        hostname: "shop.example.test",
        extraHostnames: ["www.shop.example.test"],
        database: true,
        env: { API_SECRET: SECRET_VALUE, QUOTE: "it's" },
      });
    } finally {
      system.runit.control = realControl;
    }
    expect(j).toMatchObject({ kind: "site.create", target: "shop", status: "succeeded", error: null });
    expect(codes(j)).toEqual({
      validate: "validated",
      folder: "folder_created",
      database: "database_created",
      env_write: "env_written",
      ingress: "ingress_added",
      dns: "dns_created",
      tunnel_restart: "tunnel_restarted",
      domain_probe: "domain_reachable",
    });
    expect(j.steps.find((s) => s.key === "ingress")?.params).toEqual({
      hostnames: "shop.example.test, www.shop.example.test",
    });
    expect(restarts).toEqual(["cloudflared:restart"]);
    const siteDir = join(home, "sites", "shop");
    expect(statSync(siteDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(siteDir, ".env")).mode & 0o777).toBe(0o600);
    const envText = read(join(siteDir, ".env")) as string;
    expect(envText).toMatch(
      /^API_SECRET='s3cr3t \\\$value with spaces'\nQUOTE="it's"\nPORT=3003\nDATABASE_URL=postgresql:\/\/shop:[0-9a-f]{48}@127\.0\.0\.1:5432\/shop\n$/,
    );
    expect(read(appsJson)).toBe(appsBefore);
    expect(read(cfg)).toBe(
      before.replace(
        "  - service: http_status:404",
        "  - hostname: shop.example.test\n    service: http://localhost:3003\n" +
          "  - hostname: www.shop.example.test\n    service: http://localhost:3003\n  - service: http_status:404",
      ),
    );
    for (const host of ["shop.example.test", "www.shop.example.test"])
      expect(fakeDns.records.get(host)).toMatchObject({ managed: true, target: `${FAKE_TUNNEL_ID}.cfargotunnel.com` });
    expect(await dbs()).toContain("shop");
    // The journal is non-secret: names, hostnames, port, flag. Neither job JSON nor row holds a value.
    const row = h.db.select().from(job).where(eq(job.id, j.id)).get();
    expect(row?.input).toEqual({
      name: "shop",
      hostnames: ["shop.example.test", "www.shop.example.test"],
      port: 3003,
      database: true,
    });
    const password = envText.match(/shop:([0-9a-f]+)@/)?.[1] as string;
    for (const text of [JSON.stringify(j), JSON.stringify(row)]) {
      expect(text).not.toContain(password);
      expect(text).not.toContain("s3cr3t");
    }
  });

  test("list + detail: 0.3.0 fields, no env values", async () => {
    const [s] = await json<Site[]>(await call("GET", "/sites"));
    expect(s).toEqual(
      expect.objectContaining({
        name: "shop",
        port: 3003,
        hostnames: ["shop.example.test", "www.shop.example.test"],
        database: "shop",
        managed: true,
        app: "shop",
        appStatus: "not_deployed",
        restarts: null,
        lastDeploy: null,
      }),
    );
    const res = await call("GET", "/sites/shop");
    const text = await res.clone().text();
    const d = await json<SiteDetail>(res);
    expect(d).toMatchObject({
      envKeys: ["API_SECRET", "QUOTE", "PORT", "DATABASE_URL"],
      lockedEnvKeys: ["PORT", "DATABASE_URL"],
      pm2EnvKeys: [],
      restartPending: false,
      health: { path: "/", expect: "lt500", timeoutSec: 60 },
      binary: { live: null, previous: null },
      scriptRuntime: null,
      deployBlocker: "integration", // the sandbox ecosystem still has the 0.2.x spread
      activeJob: null,
    });
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("postgresql://");
    const audit = h.db.select().from(auditLog).where(eq(auditLog.action, "site.create")).all();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("s3cr3t");
  });

  test("request-time validation → 400 with codes", async () => {
    expect(
      await json(await call("POST", "/sites", { name: "shop", hostname: "a.example.test", database: false }), 400),
    ).toMatchObject({ error: "invalid_site" });
    const env = (e: object) =>
      call("POST", "/sites", { name: "z1", hostname: "a.example.test", database: false, env: e });
    expect(await json(await env({ PORT: "1" }), 400)).toMatchObject({ error: "invalid_env", key: "PORT" });
    expect(await json(await env({ K: "a\nb" }), 400)).toMatchObject({
      error: "invalid_env",
      key: "K",
      reason: "multiline",
    });
    expect(await json(await env({ K: `'"` }), 400)).toMatchObject({ reason: "quote" });
    expect(await json(await call("POST", "/sites", { name: "z1", hostname: "a.example.test" }), 400)).toMatchObject({
      error: "invalid_database",
    });
  });

  test("ingress rejected → every earlier step rolled back, byte-identical files", async () => {
    const [cfgBefore, appsBefore] = [read(cfg), read(appsJson)];
    system.cloudflared.validate = async () => ({ ok: false, message: "error parsing ingress rules" });
    try {
      const j = await startJob("POST", "/sites", { name: "bad6", hostname: "bad6.example.test", database: true });
      expect(j.status).toBe("rolled_back");
      expect(j.error).toMatchObject({ code: "ingress_rejected", detail: expect.stringContaining("error parsing") });
      expect(stepStatus(j)).toEqual({
        validate: "rolled_back",
        folder: "rolled_back",
        database: "rolled_back",
        env_write: "rolled_back",
        ingress: "failed",
        dns: "pending",
        tunnel_restart: "pending",
        domain_probe: "pending",
      });
    } finally {
      system.cloudflared.validate = realValidate;
    }
    expect([read(cfg), read(appsJson)]).toEqual([cfgBefore, appsBefore]);
    expect(existsSync(join(home, "sites", "bad6"))).toBe(false);
    expect(await dbs()).not.toContain("bad6");
  });

  test("DNS conflict → dns_conflict {hostname}, ingress rolled back", async () => {
    const cfgBefore = read(cfg);
    fakeDns.seedForeign("taken.example.test");
    const j = await startJob("POST", "/sites", { name: "bad7", hostname: "taken.example.test", database: true });
    expect(j.status).toBe("rolled_back");
    expect(j.error).toMatchObject({ code: "dns_conflict", params: { hostname: "taken.example.test" } });
    expect(stepStatus(j)).toMatchObject({ ingress: "rolled_back", dns: "failed", tunnel_restart: "pending" });
    expect(read(cfg)).toBe(cfgBefore);
    expect(existsSync(join(home, "sites", "bad7"))).toBe(false);
    expect(fakeDns.records.get("taken.example.test")?.managed).toBe(false);
  });

  test("DNS not configured → dns_no_token skipped, job succeeds, record not owned", async () => {
    h.setDnsConfigured(false);
    try {
      const j = await startJob("POST", "/sites", { name: "nodns", hostname: "nodns.example.test", database: false });
      expect(j.status).toBe("succeeded");
      expect(j.steps.find((s) => s.key === "dns")).toMatchObject({ status: "skipped", code: "dns_no_token" });
      expect(j.steps.find((s) => s.key === "database")).toMatchObject({ status: "skipped", code: "database_skipped" });
    } finally {
      h.setDnsConfigured(true);
    }
    expect((await json<SiteDetail>(await call("GET", "/sites/nodns"))).dns).toEqual([
      { hostname: "nodns.example.test", managed: false },
    ]);
  });

  test("second mutating request while a job runs → 409 busy carrying the job", async () => {
    const first = await call("POST", "/sites", { name: "busy1", hostname: "busy1.example.test", database: false });
    expect(first.status).toBe(202);
    const { jobId } = (await first.json()) as { jobId: string };
    expect(await json(await call("GET", "/jobs/active"))).toMatchObject({ job: { id: jobId, kind: "site.create" } });
    expect(
      await json(await call("POST", "/sites", { name: "busy2", hostname: "busy2.example.test", database: false }), 409),
    ).toMatchObject({ error: "busy", job: { id: jobId, kind: "site.create", target: "busy1" } });
    expect(await json(await call("DELETE", "/sites/shop?confirm=shop"), 409)).toMatchObject({ error: "busy" });
    await waitJob(jobId);
    expect(await json(await call("GET", "/jobs/active"))).toEqual({ job: null });
  });
});
