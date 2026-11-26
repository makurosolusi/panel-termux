import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelegramClient } from "@/server/alerts/telegram.client";
import { snippetCurrent } from "@/server/sites/integration.service";
import { FAKE_S3_DIR } from "@/server/system/external.fake";
import { createFakeSystem, FAKE_SCENARIO_FILE, type FakeOptions, fakeEcosystem } from "@/server/system/system.fake";
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

    // The shipped template skips an entry whose script is missing (B18): no crash, the app is just not loaded.
    writeFileSync(join(sites, "apps.json"), JSON.stringify([entry("shop", "./shop.run"), entry("blog", "./run")]));
    expect(await sys.pm2.startFromEcosystem(eco, "blog")).toBeNull();
    expect((await sys.runit.supervise("pm2"))?.state).toBe("run");

    // An old ecosystem that spreads apps.json unfiltered kills the runtime (E1).
    writeFileSync(eco, 'module.exports = { apps: [...require("./apps.json")] };\n');
    expect(await reasonOf(sys.pm2.startFromEcosystem(eco, "blog"))).toBe("service_down");
    expect((await sys.runit.supervise("pm2"))?.state).toBe("down");
    await sys.runit.control("pm2", "start");
    expect((await sys.pm2.list()).every((a) => a.status !== "online")).toBe(true);
  });
});

describe("demo-ready fake (W9)", () => {
  test("sandbox ecosystem is the shipped template with sandbox paths, so the snippet check passes", async () => {
    const sys = fake();
    const eco = readFileSync(join(sys.home, "sites", "ecosystem.config.js"), "utf8");
    const shipped = readFileSync(join(import.meta.dir, "..", "deploy", "pm2", "ecosystem.config.js"), "utf8");
    expect(eco).toBe(fakeEcosystem(sys.home));
    expect(snippetCurrent(eco)).toBe(true);
    const differing = eco.split("\n").filter((l, i) => l !== shipped.split("\n")[i]);
    expect(differing).toEqual([
      `const SITES = ${JSON.stringify(join(sys.home, "sites"))};`,
      `const PREFIX = ${JSON.stringify(join(sys.home, "usr"))};`,
    ]);
    expect(existsSync(join(sys.home, "usr", "bin", "sleep"))).toBe(true);
  });

  test("ports of online pm2 apps accept TCP and answer HTTP; stopping closes them", async () => {
    const sys = fake();
    expect(await sys.net.isListening(3006)).toBe(true); // adminneo online
    expect(await sys.net.httpStatus(3006, "/")).toBe(200);
    expect(await sys.net.isListening(3008)).toBe(false); // kasir-lama errored
    await sys.pm2.control("adminneo", "stop");
    expect(await sys.net.isListening(3006)).toBe(false);
    await sys.pm2.control("adminneo", "start");
    expect(await sys.net.isListening(3006)).toBe(true);
  });

  test("a managed site started from the ecosystem listens on its .env PORT (deploy health check passes)", async () => {
    const sys = fake();
    const sites = join(sys.home, "sites");
    const dir = join(sites, "kedai");
    mkdirSync(dir);
    writeFileSync(join(dir, ".env"), "TZ=Asia/Jakarta\nPORT=3012\n");
    writeFileSync(join(sites, "apps.json"), JSON.stringify([{ name: "kedai", cwd: dir, script: "./run" }]));
    expect(await sys.net.isListening(3012)).toBe(false);
    const a = await sys.pm2.startFromEcosystem(join(sites, "ecosystem.config.js"), "kedai");
    expect(a).toMatchObject({ name: "kedai", status: "online", port: null });
    expect(await sys.net.isListening(3012)).toBe(true);
    expect((await sys.pm2.procs()).find((p) => p.name === "kedai")).not.toHaveProperty("listen");
  });

  test("runnable apps.json entries are online at start (pm2-runtime boot); missing binaries are not", async () => {
    const home = join(root, `h${n++}`);
    const sites = join(home, "sites");
    for (const name of ["toko", "kosong"]) mkdirSync(join(sites, name), { recursive: true });
    writeFileSync(join(sites, "toko", "run"), "#!/bin/sh\n");
    writeFileSync(join(sites, "toko", ".env"), "PORT=3010\n");
    const entries = ["toko", "kosong"].map((name) => ({ name, cwd: join(sites, name), script: "./run" }));
    writeFileSync(join(sites, "apps.json"), JSON.stringify(entries));
    const sys = createFakeSystem({ home });
    const names = (await sys.pm2.list()).map((a) => a.name);
    expect(names).toContain("toko");
    expect(names).not.toContain("kosong");
    expect(await sys.net.isListening(3010)).toBe(true);
  });

  test("scenario file overrides battery and databases; a broken one throws with the path", async () => {
    const home = join(root, `h${n++}`);
    mkdirSync(home);
    const databases = [{ name: "toko_kopi", owner: "toko_kopi", sizeBytes: 1 }];
    writeFileSync(join(home, FAKE_SCENARIO_FILE), JSON.stringify({ battery: { percent: 22 }, databases }));
    const sys = createFakeSystem({ home });
    expect((await sys.device.read()).battery).toMatchObject({ percent: 22, charging: false, status: "discharging" });
    expect(await sys.postgres.listDatabases()).toEqual(databases);
    writeFileSync(join(home, FAKE_SCENARIO_FILE), "{");
    expect(() => createFakeSystem({ home })).toThrow(FAKE_SCENARIO_FILE);
  });
});

describe("offline clients (D-W9-4)", () => {
  const target = {
    endpoint: "https://s3.contoh.test/",
    bucket: "b",
    region: "auto",
    accessKeyId: "k",
    secretAccessKey: "s",
  };

  test("only the offline fake has them; tests' plain fake keeps real clients", () => {
    expect(fake().offline).toBeUndefined();
    expect(fake({ offline: true }).offline).toBeDefined();
  });

  test("fake S3: write → stat → file → presign → delete under the sandbox; keys cannot leave the bucket", async () => {
    const sys = fake({ offline: true });
    const s3 = sys.offline?.s3(target);
    if (!s3) throw new Error("offline s3 missing");
    expect(await s3.write("p/2026/x.dump", new TextEncoder().encode("PGDMP demo"))).toBe(10);
    expect(await s3.stat("p/2026/x.dump")).toEqual({ size: 10 });
    expect(existsSync(join(sys.home, FAKE_S3_DIR, "b", "p", "2026", "x.dump"))).toBe(true);
    expect(await s3.file("p/2026/x.dump").text()).toBe("PGDMP demo");
    expect(s3.presign("p/2026/x.dump", { expiresIn: 900, method: "GET" })).toBe(
      "https://s3.contoh.test/b/p/2026/x.dump?X-Amz-Expires=900&fake=1",
    );
    await s3.delete("p/2026/x.dump");
    await expect(s3.stat("p/2026/x.dump")).rejects.toMatchObject({ code: "NoSuchKey" });
    expect(() => s3.file("../../escape")).toThrow("leaves the bucket");
  });

  test("fake Telegram answers sendMessage and getUpdates without a network call; fake DNS verifies", async () => {
    const off = fake({ offline: true }).offline;
    if (!off) throw new Error("offline clients missing");
    const tg = createTelegramClient({ token: "123:abc", fetch: off.telegramFetch }); // test-only token
    expect(await tg.sendMessage("100200300", "halo")).toBe("100200300");
    expect(await tg.listChats()).toEqual([{ id: "100200300", title: "Demo Panel", type: "private" }]);
    expect(await off.dns.verify()).toEqual({ ok: true, message: "fake DNS provider" });
    expect(await off.dns.ensureTunnelCname("a.contoh.test", "t1")).toMatchObject({ created: true });
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
