import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSystem, type FakeOptions } from "@/server/system/system.fake";
import { Pm2UnavailableError } from "@/server/system/system.types";

const root = mkdtempSync(join(tmpdir(), "panel-fake-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fake = (opts: FakeOptions = {}) => createFakeSystem({ home: join(root, `h${n++}`), ...opts });

const reasonOf = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e) => (e instanceof Pm2UnavailableError ? e.reason : String(e)),
  );

describe("default fake (Android-like data)", () => {
  test("apps: modules flagged, cpu null, cwd in sandbox, glibc app, app without binary, errored app", async () => {
    const sys = fake();
    const procs = await sys.pm2.procs();
    const by = (name: string) => procs.find((p) => p.name === name);
    expect(procs.every((p) => p.cpu === null)).toBe(true);
    expect(by("pm2-guard")).toMatchObject({ module: true, args: ["infinity"] });
    expect(by("pm2-logrotate")?.module).toBe(true);
    expect(by("kasir-lama")).toMatchObject({ status: "errored", pid: null });
    const grun = by("makuro-solusi");
    expect(grun?.execPath?.endsWith("/bin/grun")).toBe(true);
    expect(grun?.cwd?.startsWith(sys.home)).toBe(true);
    expect(existsSync(join(grun?.cwd ?? "", "app"))).toBe(true);
    expect(existsSync(by("demo-api")?.execPath ?? "")).toBe(false);
    expect((await sys.pm2.list()).find((a) => a.name === "makuro-solusi")).not.toHaveProperty("cwd");
  });

  test("device load is Android-like, a domain fails, postgres up", async () => {
    const sys = fake();
    expect((await sys.device.read()).load).toEqual([20.87, 20.73, 20.01]);
    expect((await sys.cloudflared.probe("old.contoh.test")).status).toBe(502);
    expect(await sys.postgres.serverVersion()).toBe("18.7");
  });

  test("supervise mirrors runit state; panelPid fakes supervise/pid", async () => {
    const sys = fake({ panelPid: process.pid });
    expect(await sys.runit.supervise("panel")).toEqual({ state: "run", pid: process.pid });
    expect(await sys.runit.supervise("crond")).toEqual({ state: "down", pid: null });
    expect(await sys.runit.supervise("nope")).toBeNull();
    expect((await sys.runit.list()).find((s) => s.name === "crond")?.downSec).toEqual(expect.any(Number));
  });
});

describe("pm2 behaviours (PLAN/03 C18)", () => {
  test("supervisorDown: every pm2 call throws service_down until runit pm2 starts", async () => {
    const sys = fake({ supervisorDown: true });
    expect(await reasonOf(sys.pm2.list())).toBe("service_down");
    expect(await reasonOf(sys.pm2.control("adminneo", "restart"))).toBe("service_down");
    expect(await reasonOf(sys.pm2.startFromEcosystem("/x", "shop"))).toBe("service_down");
    expect((await sys.runit.control("pm2", "start"))?.state).toBe("run");
    expect((await sys.pm2.list()).length).toBeGreaterThan(0);
  });

  test("stopping runit pm2 makes pm2 unavailable", async () => {
    const sys = fake();
    await sys.runit.control("pm2", "stop");
    expect(await reasonOf(sys.pm2.readLog("adminneo", "out", 5))).toBe("service_down");
  });

  test("exitsOnZeroAppsAtStart: runit pm2 stays down when only modules are left", async () => {
    const sys = fake({ exitsOnZeroAppsAtStart: true });
    for (const a of await sys.pm2.list()) if (!a.module) await sys.pm2.remove(a.name);
    await sys.runit.control("pm2", "restart");
    expect((await sys.runit.supervise("pm2"))?.state).toBe("down");
    expect(await reasonOf(sys.pm2.list())).toBe("service_down");
  });

  test("onlineWithoutPid: restarted app is online without a pid", async () => {
    const sys = fake({ onlineWithoutPid: true });
    expect(await sys.pm2.control("adminneo", "restart")).toMatchObject({ status: "online", pid: null });
  });

  test("runtimeExitsOnMissingNativeScript: loads the real ecosystem; a missing script kills the runtime", async () => {
    const sys = fake({ runtimeExitsOnMissingNativeScript: true });
    const sites = join(sys.home, "sites");
    const eco = join(sites, "ecosystem.config.js");
    writeFileSync(join(sites, "shop.run"), "#!/bin/sh\n");
    const entry = (name: string, script: string) => ({ name, cwd: sites, script, env: { PORT: "3010" } });
    writeFileSync(join(sites, "apps.json"), JSON.stringify([entry("shop", "./shop.run")]));
    expect(await sys.pm2.startFromEcosystem(eco, "shop")).toMatchObject({ name: "shop", status: "online", port: 3010 });
    expect((await sys.pm2.procs()).find((p) => p.name === "shop")?.execPath).toBe(join(sites, "shop.run"));
    expect(await sys.pm2.startFromEcosystem(eco, "absent")).toBeNull();

    writeFileSync(join(sites, "apps.json"), JSON.stringify([entry("shop", "./shop.run"), entry("blog", "./run")]));
    expect(await reasonOf(sys.pm2.startFromEcosystem(eco, "blog"))).toBe("service_down");
    expect((await sys.runit.supervise("pm2"))?.state).toBe("down");
    await sys.runit.control("pm2", "start");
    expect((await sys.pm2.list()).every((a) => a.status !== "online")).toBe(true);
  });
});

describe("fake postgres + archive", () => {
  test("dump → verify → restore into a new database → drop", async () => {
    const sys = fake();
    const file = join(sys.home, "solusi.dump");
    await sys.postgres.dump("solusi", file);
    await sys.postgres.verifyDump(file);
    expect(await sys.postgres.restoreInto(file, "restore_solusi", "solusi")).toEqual({ tableCount: 3 });
    expect((await sys.postgres.listDatabases()).map((d) => d.name)).toContain("restore_solusi");
    await sys.postgres.dropDatabase("restore_solusi");
    expect((await sys.postgres.listDatabases()).map((d) => d.name)).not.toContain("restore_solusi");
    writeFileSync(join(sys.home, "bad.dump"), "nope");
    await expect(sys.postgres.verifyDump(join(sys.home, "bad.dump"))).rejects.toThrow("not a dump");
    await sys.postgres.dumpGlobals(join(sys.home, "globals.sql"));
    expect(existsSync(join(sys.home, "globals.sql"))).toBe(true);
  });

  test("archive uses the host tar", async () => {
    const sys = fake();
    const file = join(sys.home, "sites.tgz");
    expect(await sys.archive.create(file, join(sys.home, "sites"), ["ecosystem.config.js"])).toEqual({ warning: null });
    await sys.archive.list(file);
  });
});
