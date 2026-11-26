import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { candidateOf } from "@/server/sites/adopt.candidates";
import type { Pm2Proc } from "@/server/system/system.types";
import type { Discovered, SiteDetail } from "@/shared/site.types";
import { ANDROID_LINKER, fakeElf, GLIBC_LINKER } from "./deploy.fixture";
import { siteHarness } from "./site.harness";

// test-only: the panel serves old.contoh.test and listens on 3006 (db.contoh.test's port) → both are `self`
const savedEnv = { APP_BASE_URL: process.env.APP_BASE_URL, PORT: process.env.PORT };
process.env.APP_BASE_URL = "https://old.contoh.test";
process.env.PORT = "3006";
afterAll(() => Object.assign(process.env, savedEnv));

const h = siteHarness();
const { home, system, call, json } = h;
const sites = join(home, "sites");

beforeAll(() => writeFileSync(join(sites, "makuro-solusi", "app"), fakeElf({ interp: GLIBC_LINKER })));

describe("discovered", () => {
  test("ingress: panel host/port flagged self; apps: modules and pm2-guard hidden", async () => {
    const d = await json<Discovered>(await call("GET", "/sites/discovered"));
    expect(d.ingress).toEqual([
      { hostname: "db.contoh.test", port: 3006, app: null, self: true, match: null, blockers: ["self"] },
      { hostname: "old.contoh.test", port: 3999, app: null, self: true, match: null, blockers: ["self"] },
      {
        hostname: "solusi.contoh.test",
        port: 3005,
        app: "makuro-solusi",
        self: false,
        match: "makuro-solusi",
        blockers: [],
      },
    ]);
    expect(d.apps.map((a) => a.name)).toEqual(["adminneo", "demo-api", "kasir-lama", "makuro-solusi"]);
    const app = (n: string) => d.apps.find((a) => a.name === n);
    expect(app("makuro-solusi")).toEqual({
      name: "makuro-solusi",
      status: "online",
      cwd: realpathSync(join(sites, "makuro-solusi")),
      port: 3005,
      portSource: "pm2_env",
      runtime: "grun",
      scriptRuntime: "grun",
      blockers: [],
      warnings: [],
    });
    expect(app("adminneo")).toMatchObject({
      port: 3006,
      portSource: "pm2_args",
      scriptRuntime: "other",
      blockers: ["no_binary"],
      warnings: ["script_other"],
    });
    expect(app("kasir-lama")?.blockers).toEqual(["outside_sites_dir"]); // its folder does not exist
  });

  test("pm2 down → 503 pm2_unavailable", async () => {
    await system.runit.control("pm2", "stop");
    try {
      expect(await json(await call("GET", "/sites/discovered"), 503)).toMatchObject({
        error: "pm2_unavailable",
        reason: "service_down",
      });
      expect(
        await json(await call("POST", "/sites/adopt", { hostname: "solusi.contoh.test", app: "makuro-solusi" }), 409),
      ).toMatchObject({ error: "pm2_not_running" });
    } finally {
      await system.runit.control("pm2", "start");
    }
  });
});

describe("adopt", () => {
  const adopt = (body: object) => call("POST", "/sites/adopt", body);

  test("refusals: self, guard, reserved name, unknown app, blocked app, hostname without rule", async () => {
    expect(await json(await adopt({ hostname: "old.contoh.test", app: "makuro-solusi" }), 409)).toMatchObject({
      error: "self_hostname",
    });
    expect(
      await json(await adopt({ hostname: "solusi.contoh.test", app: "pm2-guard", name: "guarded" }), 404),
    ).toMatchObject({
      error: "app_not_found",
    });
    expect(
      await json(await adopt({ hostname: "solusi.contoh.test", app: "makuro-solusi", name: "pm2-guard" }), 400),
    ).toMatchObject({ error: "name_reserved" });
    expect(await json(await adopt({ hostname: "solusi.contoh.test", app: "nope" }), 404)).toMatchObject({
      error: "app_not_found",
    });
    expect(await json(await adopt({ hostname: "solusi.contoh.test", app: "adminneo" }), 409)).toMatchObject({
      error: "adopt_blocked",
      blockers: ["no_binary"],
    });
    expect(await json(await adopt({ hostname: "x.example.test", app: "makuro-solusi" }), 400)).toMatchObject({
      error: "invalid_hostname",
    });
  });

  test("success: data from pm2 (dir = real cwd, runtime from ELF, port from ingress); name defaults to the app", async () => {
    const d = await json<SiteDetail>(await adopt({ hostname: "Solusi.Contoh.Test", app: "makuro-solusi" }), 201);
    expect(d).toMatchObject({
      name: "makuro-solusi",
      app: "makuro-solusi",
      managed: false,
      runtime: "grun",
      port: 3005,
      dir: realpathSync(join(sites, "makuro-solusi")),
      hostnames: ["solusi.contoh.test"],
      health: { path: "/", expect: "lt500", timeoutSec: 60 },
      appStatus: "online",
    });
    expect(h.db.select().from(auditLog).where(eq(auditLog.action, "site.adopt")).all()).toHaveLength(1);
    expect(
      await json(await adopt({ hostname: "solusi.contoh.test", app: "makuro-solusi", name: "again" }), 409),
    ).toMatchObject({
      error: "app_in_use",
      site: "makuro-solusi",
    });
    const d2 = await json<Discovered>(await call("GET", "/sites/discovered"));
    expect(d2.apps.map((a) => a.name)).not.toContain("makuro-solusi");
    expect(d2.ingress.map((i) => i.hostname)).not.toContain("solusi.contoh.test");
  });
});

describe("candidateOf", () => {
  const dir = mkdtempSync(join(tmpdir(), "panel-adopt-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const root = realpathSync(dir);
  const proc = (over: Partial<Pm2Proc>): Pm2Proc => ({
    name: "blog",
    status: "online",
    pid: 1,
    memoryMb: 1,
    cpu: null,
    restarts: 0,
    uptimeSec: 1,
    port: null,
    module: false,
    outLog: null,
    errLog: null,
    cwd: join(root, "blog"),
    execPath: join(root, "blog", "app"),
    args: [],
    startedAtMs: 1,
    ...over,
  });
  beforeAll(() => {
    mkdirSync(join(root, "blog"));
    writeFileSync(join(root, "blog", "app"), fakeElf({ interp: ANDROID_LINKER }));
    // test-only secret
    writeFileSync(join(root, "blog", ".env"), 'DB_PASSWORD=adopt-dotenv-pw-7731\nPORT="4100"\nAPI_KEY=k3y-abcdef\n');
  });

  test("port only from the PORT line of .env; no other value leaves the function or reaches the log", () => {
    const c = candidateOf(proc({}), root, new Set([4100]));
    expect(c).toMatchObject({ runtime: "native", scriptRuntime: "native", port: 4100, portSource: "dotenv" });
    expect(c.blockers).toEqual([]);
    expect(c.warnings).toEqual([]);
    const out = JSON.stringify(c) + JSON.stringify(readLogs({ limit: 2000 }));
    expect(out).not.toContain("adopt-dotenv-pw-7731");
    expect(out).not.toContain("k3y-abcdef");
  });

  test("glibc-runner → grun (mismatch with a native binary); other script; module; bad name; unknown port", () => {
    const runner = candidateOf(proc({ execPath: "/usr/bin/glibc-runner", port: 4200 }), root, new Set([4100]));
    expect(runner).toMatchObject({ scriptRuntime: "grun", portSource: "pm2_env" });
    expect(runner.warnings).toEqual(["runtime_script_mismatch", "port_mismatch"]);
    expect(candidateOf(proc({ execPath: "/usr/bin/node" }), root, new Set([4100])).warnings).toEqual(["script_other"]);
    expect(candidateOf(proc({ module: true, name: "Bad_Name" }), root, new Set()).blockers).toEqual([
      "pm2_module",
      "name_invalid",
    ]);
    expect(candidateOf(proc({ cwd: "/tmp", args: ["--port", "4300"], port: 4300 }), root, new Set())).toMatchObject({
      blockers: ["outside_sites_dir"],
      portSource: "pm2_args",
    });
    rmSync(join(root, "blog", ".env"));
    expect(candidateOf(proc({}), root, new Set()).warnings).toEqual(["port_unknown"]);
  });
});
