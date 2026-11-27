import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, job, siteHostname } from "@/server/db/schema";
import { HEALTH_TIMING } from "@/server/deploy/health.check";
import type { Page } from "@/shared/dev.types";
import type { Job, Site, SiteDetail, SiteEnvSaved } from "@/shared/site.types";
import { fakeElf, GLIBC_LINKER } from "./deploy.fixture";
import { SECRET_VALUE, siteHarness } from "./site.harness";

const h = siteHarness();
const { home, system, fakeDns, cfg, appsJson, read, call, json, startJob, stepStatus, dbs } = h;
const codes = (j: Job) => j.steps.map((s) => `${s.key}:${s.code}`);
const solusiDir = join(home, "sites", "makuro-solusi");
const savedTiming = { ...HEALTH_TIMING };
const realNet = { ...system.net };
const realProcs = system.pm2.procs;
/** Port 3005 (solusi) answers `status`; everything else as the fake does. */
const serve3005 = (status: number | null) => {
  system.net.isListening = async (p) => p === 3005 || realNet.isListening(p);
  system.net.httpStatus = async (p, ...rest) => (p === 3005 ? status : realNet.httpStatus(p, ...rest));
};

beforeAll(async () => {
  Object.assign(HEALTH_TIMING, { pollMs: 5, pm2EveryMs: 40, settleMs: 10, probeTimeoutMs: 50 });
  const j = await startJob("POST", "/sites", {
    name: "shop",
    hostname: "shop.example.test",
    database: true,
    env: { API_SECRET: SECRET_VALUE },
  });
  expect(j.status).toBe("succeeded");
  writeFileSync(join(solusiDir, "app"), fakeElf({ interp: GLIBC_LINKER }));
  writeFileSync(join(solusiDir, ".env"), "PORT=3005\nOLD_SECRET=keepme123\n");
  await json(
    await call("POST", "/sites/adopt", { hostname: "solusi.contoh.test", app: "makuro-solusi", name: "solusi" }),
    201,
  );
});
afterAll(() => Object.assign(HEALTH_TIMING, savedTiming));

describe("env", () => {
  test("Simpan writes .env only: keys back, values never, audit keys only", async () => {
    const res = await call("PUT", "/sites/shop/env", { set: { NEW_TOKEN: SECRET_VALUE }, unset: ["API_SECRET"] });
    const text = await res.clone().text();
    expect(await json<SiteEnvSaved>(res)).toEqual({
      envKeys: ["PORT", "DATABASE_URL", "NEW_TOKEN"],
      restartPending: false,
    });
    expect(text).not.toContain("s3cr3t");
    expect(read(join(home, "sites", "shop", ".env"))).toContain("NEW_TOKEN='s3cr3t \\$value with spaces'");
    const audit = h.db.select().from(auditLog).where(eq(auditLog.action, "site.env_update")).all();
    expect(audit.at(-1)?.meta).toEqual({ set: ["NEW_TOKEN"], unset: ["API_SECRET"], restart: false });
    expect(JSON.stringify(audit)).not.toContain("s3cr3t");
  });

  test("locked keys and unrepresentable values refused", async () => {
    expect(await json(await call("PUT", "/sites/shop/env", { set: { PORT: "1" } }), 400)).toMatchObject({
      error: "env_locked",
      keys: ["PORT"],
    });
    expect(await json(await call("PUT", "/sites/shop/env", { set: {}, unset: ["DATABASE_URL"] }), 400)).toMatchObject({
      error: "env_locked",
      keys: ["DATABASE_URL"],
    });
    expect(await json(await call("PUT", "/sites/shop/env", { set: { A: "x\ny" } }), 400)).toMatchObject({
      error: "invalid_env",
      key: "A",
      reason: "multiline",
    });
    expect(await json(await call("PUT", "/sites/shop/env", { set: {}, unset: ["1x"] }), 400)).toMatchObject({
      reason: "key",
    });
  });

  test("adopted site: PORT editable, restartPending once .env is newer than the app start", async () => {
    const r = await json<SiteEnvSaved>(await call("PUT", "/sites/solusi/env", { set: { FEATURE: "on" } }));
    expect(r).toEqual({ envKeys: ["PORT", "OLD_SECRET", "FEATURE"], restartPending: true });
    const d = await json<SiteDetail>(await call("GET", "/sites/solusi"));
    expect(d).toMatchObject({ lockedEnvKeys: [], restartPending: true, managed: false, scriptRuntime: "grun" });
  });

  test("Simpan dan mulai ulang: env_write → app_restart → health, prev copy removed", async () => {
    serve3005(200);
    try {
      const j = await startJob("PUT", "/sites/solusi/env", { set: { FEATURE: "off" }, unset: [], restart: true });
      expect(j).toMatchObject({ kind: "site.env", status: "succeeded" });
      // Journal holds key names only.
      expect(h.db.select().from(job).where(eq(job.id, j.id)).get()?.input).toEqual({
        site: "solusi",
        set: ["FEATURE"],
        unset: [],
      });
      expect(codes(j)).toEqual(["env_write:env_updated", "app_restart:app_restarted", "health:healthy"]);
    } finally {
      Object.assign(system.net, realNet);
    }
    expect(read(join(solusiDir, ".env"))).toContain("FEATURE=off");
    expect(existsSync(join(solusiDir, ".env.panel-prev"))).toBe(false);
    expect((await json<SiteDetail>(await call("GET", "/sites/solusi"))).restartPending).toBe(false);
  });

  test("health fails → old .env bytes back, app restarted on them, rolled_back", async () => {
    const before = readFileSync(join(solusiDir, ".env"));
    serve3005(200);
    system.pm2.procs = async () =>
      (await realProcs()).map((p) => (p.name === "makuro-solusi" ? { ...p, status: "errored" as const } : p));
    try {
      const j = await startJob("PUT", "/sites/solusi/env", { set: { FEATURE: "broken" }, unset: [], restart: true });
      expect(j).toMatchObject({ status: "rolled_back", error: { code: "app_errored" }, appLogApp: "makuro-solusi" });
      expect(stepStatus(j)).toEqual({ env_write: "rolled_back", app_restart: "rolled_back", health: "failed" });
    } finally {
      Object.assign(system.net, realNet);
      system.pm2.procs = realProcs;
    }
    expect(readFileSync(join(solusiDir, ".env")).equals(before)).toBe(true);
    expect(existsSync(join(solusiDir, ".env.panel-prev"))).toBe(false);
  });
});

describe("restart, settings, health", () => {
  test("restart job + audit; pm2 down → 409 pm2_not_running and statuses unknown", async () => {
    serve3005(200);
    try {
      const j = await startJob("POST", "/sites/solusi/restart");
      expect(j).toMatchObject({ kind: "site.restart", status: "succeeded" });
      expect(codes(j)).toEqual(["app_restart:app_restarted", "health:healthy"]);
    } finally {
      Object.assign(system.net, realNet);
    }
    expect(h.db.select().from(auditLog).where(eq(auditLog.action, "site.restart")).all()).toHaveLength(1);
    await system.runit.control("pm2", "stop");
    try {
      expect(await json(await call("POST", "/sites/solusi/restart"), 409)).toMatchObject({ error: "pm2_not_running" });
      const sites = await json<Site[]>(await call("GET", "/sites"));
      expect(sites.map((s) => [s.name, s.appStatus, s.restarts])).toEqual([
        ["shop", "unknown", null],
        ["solusi", "unknown", null],
      ]);
      expect((await json<SiteDetail>(await call("GET", "/sites/solusi"))).deployBlocker).toBe("pm2_not_running");
    } finally {
      await system.runit.control("pm2", "start");
    }
  });

  test("PATCH settings validates bounds; GET health probes path with Host = first domain", async () => {
    const d = await json<SiteDetail>(
      await call("PATCH", "/sites/solusi/settings", {
        health: { path: "/api/health", expect: "2xx3xx", timeoutSec: 30 },
      }),
    );
    expect(d.health).toEqual({ path: "/api/health", expect: "2xx3xx", timeoutSec: 30 });
    for (const [health, field] of [
      [{ path: "nope" }, "path"],
      [{ expect: "any" }, "expect"],
      [{ timeoutSec: 5 }, "timeoutSec"],
      [{ timeoutSec: 301 }, "timeoutSec"],
    ] as const)
      expect(await json(await call("PATCH", "/sites/solusi/settings", { health }), 400)).toMatchObject({
        error: "invalid_settings",
        field,
      });
    const seen: unknown[] = [];
    system.net.isListening = async () => true;
    system.net.httpStatus = async (...args) => {
      seen.push(args);
      return 404;
    };
    try {
      expect(await json(await call("GET", "/sites/solusi/health"))).toMatchObject({
        ok: false, // 404 is not 2xx/3xx
        status: 404,
        path: "/api/health",
      });
    } finally {
      Object.assign(system.net, realNet);
    }
    expect(seen).toEqual([[3005, "/api/health", 5000, "solusi.contoh.test"]]);
  });
});

describe("hostnames", () => {
  test("three domains in one job → one cloudflared restart; legacy {hostname} still accepted", async () => {
    const names = ["a.shop.example.test", "b.shop.example.test", "c.shop.example.test"];
    const j = await startJob("POST", "/sites/shop/hostnames", { hostnames: names });
    expect(j.status).toBe("succeeded");
    expect(codes(j)).toEqual([
      "validate:validated",
      "ingress:ingress_added",
      "dns:dns_created",
      "tunnel_restart:tunnel_restarted",
      "domain_probe:domain_reachable",
    ]);
    for (const n of names) expect(read(cfg)).toContain(`hostname: ${n}`);
    const legacy = await startJob("POST", "/sites/solusi/hostnames", { hostname: "two.example.test" });
    expect(legacy.status).toBe("succeeded");
    expect(await json(await call("POST", "/sites/shop/hostnames", { hostnames: [] }), 400)).toMatchObject({
      error: "invalid_hostname",
    });
  });

  test("remove: ingress → restart → dns; last refused; hand-written only with confirm=<hostname>", async () => {
    const j = await startJob("DELETE", "/sites/shop/hostnames/c.shop.example.test");
    expect(codes(j)).toEqual(["ingress:ingress_removed", "tunnel_restart:tunnel_restarted", "dns:dns_deleted"]);
    expect(read(cfg)).not.toContain("c.shop.example.test");
    expect(fakeDns.records.has("c.shop.example.test")).toBe(false);
    expect(await json(await call("DELETE", "/sites/solusi/hostnames/solusi.contoh.test"), 409)).toMatchObject({
      error: "hand_written",
      hostname: "solusi.contoh.test",
    });
    const detail = await json<SiteDetail>(await call("GET", "/sites/solusi"));
    expect(detail.dns.map((d) => [d.hostname, d.handWritten])).toEqual([
      ["solusi.contoh.test", true],
      ["two.example.test", false],
    ]);
    const wrong = "/sites/solusi/hostnames/solusi.contoh.test?confirm=two.example.test";
    expect(await json(await call("DELETE", wrong), 409)).toMatchObject({ error: "hand_written" });
    const savedCfg = read(cfg) as string;
    const j2 = await startJob("DELETE", "/sites/solusi/hostnames/solusi.contoh.test?confirm=solusi.contoh.test");
    expect(codes(j2)).toEqual(["ingress:ingress_removed", "tunnel_restart:tunnel_restarted", "dns:dns_none_owned"]);
    expect(read(cfg)).not.toContain("solusi.contoh.test");
    expect(await json(await call("DELETE", "/sites/solusi/hostnames/two.example.test"), 400)).toMatchObject({
      error: "last_hostname",
    });
    // Put the hand-written rule back: the adopted-delete test below needs it.
    writeFileSync(cfg, savedCfg);
    h.db
      .insert(siteHostname)
      .values({ hostname: "solusi.contoh.test", siteName: "solusi", ingressManaged: false, dnsManaged: false })
      .run();
  });
});

describe("delete", () => {
  test("dropping a site database while a backup runs → 409 busy_backup; keeping it is allowed through", async () => {
    const backup = h.api.decorator.backup;
    const realBusy = backup.busy;
    backup.busy = () => true;
    try {
      expect(await json(await call("DELETE", "/sites/shop?confirm=shop"), 409)).toMatchObject({ error: "busy_backup" });
      expect(h.db.select().from(job).where(eq(job.kind, "site.delete")).all()).toEqual([]);
    } finally {
      backup.busy = realBusy;
    }
  });

  test("managed: typed confirm; apps.json entry first; DNS failure non-fatal → dns_left", async () => {
    expect(await json(await call("DELETE", "/sites/shop"), 400)).toMatchObject({ error: "confirm_mismatch" });
    writeFileSync(appsJson, JSON.stringify([{ name: "keep" }, { name: "shop", script: "./run" }]));
    const realDelete = fakeDns.deleteManaged;
    fakeDns.deleteManaged = async () => {
      throw new Error("cloudflare delete record: HTTP 502");
    };
    const sites = h.api.decorator.sites;
    const realIntegration = sites.getIntegration;
    sites.getIntegration = async () => ({ ...(await realIntegration()), checks: [] }); // let the upload start
    const upload = await json<{ uploadId: string }>(
      await call("POST", "/sites/shop/uploads", { sizeBytes: 10, fileName: "app" }),
      201,
    );
    sites.getIntegration = realIntegration;
    let j: Job;
    try {
      j = await startJob("DELETE", "/sites/shop?keepData=1&confirm=shop");
    } finally {
      fakeDns.deleteManaged = realDelete;
    }
    expect(j.status).toBe("succeeded");
    expect(j.steps.map((s) => s.key)).toEqual([
      "validate",
      "apps_remove",
      "ingress",
      "tunnel_restart",
      "dns",
      "app_remove",
      "database_drop",
      "folder_remove",
    ]);
    expect(j.steps.find((s) => s.key === "dns")).toMatchObject({ status: "done", code: "dns_left" });
    expect(codes(j).filter((c) => c.startsWith("tunnel_restart"))).toEqual(["tunnel_restart:tunnel_restarted"]);
    expect(JSON.parse(read(appsJson) as string)).toEqual([{ name: "keep" }]);
    expect(existsSync(join(home, "sites", "shop"))).toBe(true); // keepData
    expect(await dbs()).not.toContain("shop");
    expect(read(cfg)).not.toContain("shop.example.test");
    // onSiteDeleted: the site's pending upload went with it.
    expect(await json(await call("GET", `/uploads/${upload.uploadId}`), 404)).toMatchObject({
      error: "upload_expired",
    });
  });

  test("adopted: no typed confirm; hand-written rule, pm2 app and folder untouched", async () => {
    const j = await startJob("DELETE", "/sites/solusi");
    expect(j.status).toBe("succeeded");
    expect(stepStatus(j)).toMatchObject({ apps_remove: "skipped", app_remove: "skipped", folder_remove: "skipped" });
    expect(read(cfg)).toContain("solusi.contoh.test");
    expect(existsSync(join(solusiDir, "app"))).toBe(true);
    expect((await system.pm2.list()).some((a) => a.name === "makuro-solusi")).toBe(true);
  });
});

describe("jobs", () => {
  test("filters by target/kind/status; bad filter → 400; unknown → 404", async () => {
    const page = await json<Page<Job>>(await call("GET", "/jobs?target=shop&kind=site.create"));
    expect(page.items.map((j) => [j.kind, j.target])).toEqual([["site.create", "shop"]]);
    const all = await json<Page<Job>>(await call("GET", "/jobs?pageSize=2"));
    expect(all.items).toHaveLength(2);
    expect(all.total).toBeGreaterThan(5);
    const rolled = await json<Page<Job>>(await call("GET", "/jobs?status=rolled_back"));
    expect(rolled.items.map((j) => j.kind)).toEqual(["site.env"]);
    expect(await json(await call("GET", "/jobs?kind=nope"), 400)).toMatchObject({ error: "invalid_filter" });
    expect(await json(await call("GET", "/jobs/nope"), 404)).toMatchObject({ error: "not_found" });
  });
});
