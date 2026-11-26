import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHealthCache } from "@/server/panel/domain.health";
import { parseIngress } from "@/server/system/cloudflared.termux";
import { parseBattery, parseMeminfo } from "@/server/system/device.termux";
import { tailFile } from "@/server/system/file.tail";
import { type Pm2Proc, parsePm2Jlist, portFromArgs, toApp } from "@/server/system/pm2.termux";
import { parsePsqlDatabases } from "@/server/system/postgres.termux";
import { parseSuperviseStat, parseSvStatus } from "@/server/system/runit.termux";

const dir = mkdtempSync(join(tmpdir(), "panel-parse-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("parseSvStatus", () => {
  test("run/down/finish/fail lines", () => {
    const out = [
      "run: sshd: (pid 1234) 102345s; run: log: (pid 1200) 102346s",
      "run: postgres: (pid 2222) 50s, normally down",
      "down: crond: 12s, normally up; run: log: (pid 9) 99s",
      "down: old: 5s, normally up, want up",
      "run: pm2: (pid 77) 3s, want down",
      "finish: flappy: (pid 88) 1s",
      "down: ssh-agent: 128024s; run: log: (pid 10604) 128024s",
      "fail: ghost: unable to change to service directory: file does not exist",
      "warning: half: unable to open supervise/ok: file does not exist",
      "",
    ].join("\n");
    expect(parseSvStatus(out)).toEqual([
      { name: "sshd", state: "run", pid: 1234, uptimeSec: 102345, downSec: null, wantUp: true },
      { name: "postgres", state: "run", pid: 2222, uptimeSec: 50, downSec: null, wantUp: true },
      { name: "crond", state: "down", pid: null, uptimeSec: null, downSec: 12, wantUp: false },
      { name: "old", state: "down", pid: null, uptimeSec: null, downSec: 5, wantUp: true },
      { name: "pm2", state: "run", pid: 77, uptimeSec: 3, downSec: null, wantUp: false },
      { name: "flappy", state: "finish", pid: 88, uptimeSec: null, downSec: null, wantUp: true },
      { name: "ssh-agent", state: "down", pid: null, uptimeSec: null, downSec: 128024, wantUp: false },
      { name: "ghost", state: "unknown", pid: null, uptimeSec: null, downSec: null, wantUp: false },
      { name: "half", state: "unknown", pid: null, uptimeSec: null, downSec: null, wantUp: false },
    ]);
  });

  test("absolute service path prints basename", () => {
    expect(parseSvStatus("run: /x/var/service/sshd: (pid 1) 2s")[0]?.name).toBe("sshd");
  });
});

test("parseSuperviseStat (runsv supervise/stat, captured on POCO)", () => {
  expect(parseSuperviseStat("run\n")).toBe("run");
  expect(parseSuperviseStat("down\n")).toBe("down");
  expect(parseSuperviseStat("run, want down\n")).toBe("run");
  expect(parseSuperviseStat("finish, paused")).toBe("finish");
  expect(parseSuperviseStat("")).toBe("unknown");
});

test("portFromArgs", () => {
  expect(portFromArgs(["-d", "x=y", "-S", "127.0.0.1:8080", "/docroot"])).toBe(8080);
  expect(portFromArgs(["--port", "3000"])).toBe(3000);
  expect(portFromArgs(["--port=3001"])).toBe(3001);
  expect(portFromArgs(["-p", "3002"])).toBe(3002);
  expect(portFromArgs(["[::1]:3003"])).toBe(3003);
  expect(portFromArgs(["./server", "C:/x", "-p", "abc"])).toBeNull();
});

describe("parsePm2Jlist", () => {
  const NOW = 1_800_000_000_000;
  // Sanitized capture: real jlist has many more fields, incl. full env (secrets) that must be dropped.
  const proc = (name: string, status: string, extra: Record<string, unknown> = {}) => ({
    name,
    pid: status === "online" ? 4242 : 0,
    pm_id: 1,
    monit: { memory: 64 * 1024 * 1024, cpu: 1.5 },
    pm2_env: {
      status,
      restart_time: 3,
      pm_uptime: NOW - 90_000,
      pm_out_log_path: `/h/.pm2/logs/${name}-out.log`,
      pm_err_log_path: `/h/.pm2/logs/${name}-error.log`,
      DATABASE_URL: "postgres://u:hunter2@127.0.0.1/db", // test-only fake secret
      env: { PORT: "3005", API_TOKEN: "tok_test_only" },
      ...extra,
    },
  });
  const jlist = `[PM2] Spawning PM2 daemon\n${JSON.stringify([
    proc("solusi", "online"),
    proc("idle", "stopped", { env: {} }),
    proc("weird", "one-launch-status", { env: {}, PORT: 4000 }),
    proc("php", "online", { env: {}, args: ["-S", "127.0.0.1:8080", "/srv"] }),
    // Field shapes captured from POCO's jlist (pm2 7.1.2): module, glibc site via grun, guard app.
    proc("pm2-logrotate", "online", { env: {}, pmx_module: true, pm_cwd: "/h/.pm2/modules/pm2-logrotate" }),
    proc("makuro-solusi", "online", {
      pm_cwd: "/h/sites/makuro-solusi",
      pm_exec_path: "/usr/bin/grun",
      args: ["./app", 7],
    }),
    proc("pm2-guard", "online", { env: {}, pm_exec_path: "/usr/bin/sleep", args: ["infinity"] }),
  ])}\n`;

  test("keeps only whitelisted fields", () => {
    const [a, b, c, d, mod, grun, guard] = parsePm2Jlist(jlist, NOW);
    expect(d?.port).toBe(8080);
    expect(a).toEqual({
      name: "solusi",
      status: "online",
      pid: 4242,
      memoryMb: 64,
      cpu: null, // pm2's cpu is meaningless on Android
      restarts: 3,
      uptimeSec: 90,
      port: 3005,
      module: false,
      outLog: "/h/.pm2/logs/solusi-out.log",
      errLog: "/h/.pm2/logs/solusi-error.log",
      cwd: null,
      execPath: null,
      args: [],
      startedAtMs: NOW - 90_000,
    });
    expect(mod).toMatchObject({ module: true, cwd: "/h/.pm2/modules/pm2-logrotate" });
    expect(grun).toMatchObject({
      module: false,
      cwd: "/h/sites/makuro-solusi",
      execPath: "/usr/bin/grun",
      args: ["./app"],
    });
    expect(guard).toMatchObject({ module: true, args: ["infinity"] });
    expect(b).toMatchObject({ status: "stopped", pid: null, memoryMb: null, cpu: null, uptimeSec: null, port: null });
    expect(c).toMatchObject({ status: "unknown", port: 4000 });
    expect(JSON.stringify([a, b, c])).not.toMatch(/hunter2|tok_test_only|DATABASE_URL/);
  });

  test("toApp drops internal fields", () => {
    const [a] = parsePm2Jlist(jlist, NOW);
    expect(Object.keys(toApp(a as Pm2Proc)).sort()).toEqual(
      ["cpu", "memoryMb", "module", "name", "pid", "port", "restarts", "status", "uptimeSec"].sort(),
    );
  });

  test("empty list and garbage", () => {
    expect(parsePm2Jlist("[]\n")).toEqual([]);
    expect(() => parsePm2Jlist("no json")).toThrow("no JSON array");
    const err = (() => {
      try {
        parsePm2Jlist('[{"secret":"hunter2"');
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(err).toContain("invalid JSON");
    expect(err).not.toContain("hunter2");
  });
});

test("parseIngress", () => {
  const yml = `tunnel: 00000000-0000-0000-0000-000000000000
credentials-file: /h/.cloudflared/x.json
ingress:
  - hostname: solusi.example.com
    service: http://localhost:3005
  - hostname: ssh.example.com
    service: ssh://localhost:22
  - hostname: plain.example.com
    service: https://127.0.0.1
  - hostname: gone.example.com
    service: http_status:404
  - service: http_status:404
`;
  expect(parseIngress(yml)).toEqual([
    { hostname: "solusi.example.com", service: "http://localhost:3005", port: 3005 },
    { hostname: "ssh.example.com", service: "ssh://localhost:22", port: 22 },
    { hostname: "plain.example.com", service: "https://127.0.0.1", port: 443 },
    { hostname: "gone.example.com", service: "http_status:404", port: null },
  ]);
  expect(parseIngress("tunnel: x\n")).toEqual([]);
  expect(() => parseIngress("ingress: [\n")).toThrow("invalid YAML");
});

test("parsePsqlDatabases", () => {
  expect(parsePsqlDatabases("adminneo\tpostgres\t8123456\nsolusi\tsolusi\t9000000\n")).toEqual([
    { name: "adminneo", owner: "postgres", sizeBytes: 8123456 },
    { name: "solusi", owner: "solusi", sizeBytes: 9000000 },
  ]);
  expect(parsePsqlDatabases("")).toEqual([]);
  expect(() => parsePsqlDatabases("broken\n")).toThrow("unexpected");
});

describe("device parsers", () => {
  test("termux-battery-status", () => {
    const out = `{
  "present": true,
  "health": "GOOD",
  "percentage": 56,
  "plugged": "UNPLUGGED",
  "status": "DISCHARGING",
  "temperature": 30.100000381469727,
  "current": -312000
}`;
    expect(parseBattery(out)).toEqual({
      percent: 56,
      charging: false,
      status: "discharging",
      plugged: "unplugged",
      temperatureC: 30.1,
      health: "GOOD",
    });
    expect(parseBattery('{"percentage":100,"status":"FULL","plugged":"PLUGGED_AC","temperature":28}')).toMatchObject({
      charging: true,
      status: "full",
      plugged: "ac",
    });
    expect(parseBattery('{"percentage":40,"status":"NOT_CHARGING","plugged":"PLUGGED_USB"}')).toMatchObject({
      charging: false,
      status: "not_charging",
      plugged: "usb",
      temperatureC: 0, // missing temperature: 0 until the shared type allows null (W7)
      health: null,
    });
    expect(parseBattery('{"percentage":40,"status":"WEIRD","plugged":"PLUGGED_DOCK"}')).toMatchObject({
      status: "unknown",
      plugged: "unknown",
    });
    expect(parseBattery("not json")).toBeNull();
    expect(parseBattery("{}")).toBeNull();
  });

  test("/proc/meminfo", () => {
    const mem = "MemTotal:       12058624 kB\nMemFree:          512000 kB\nMemAvailable:    3879731 kB\n";
    expect(parseMeminfo(mem)).toEqual({ totalMb: 11776, availableMb: 3789 });
    expect(() => parseMeminfo("MemTotal: 1 kB\n")).toThrow("missing fields");
  });
});

describe("tailFile", () => {
  test("last n lines, missing file → null", async () => {
    const p = join(dir, "current");
    writeFileSync(p, `${Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n")}\n`);
    expect(await tailFile(p, 3)).toEqual(["line8", "line9", "line10"]);
    expect(await tailFile(p, 100)).toHaveLength(10);
    expect(await tailFile(join(dir, "nope"), 3)).toBeNull();
  });

  test("large file drops the partial first line of the window", async () => {
    const p = join(dir, "big");
    const line = "x".repeat(99);
    writeFileSync(p, `${`${line}\n`.repeat(20_000)}last\n`);
    const lines = (await tailFile(p, 5000)) ?? [];
    expect(lines.at(-1)).toBe("last");
    expect(lines.every((l) => l === line || l === "last")).toBe(true);
  });
});

describe("health cache", () => {
  test("parallel probes, cached for 60 s, wildcard skipped", async () => {
    let t = 0;
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const check = createHealthCache(
      async () => {
        calls++;
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await Bun.sleep(5);
        inFlight--;
        return { status: 200, ms: 5 };
      },
      () => t,
    );
    const hosts = ["a.test", "b.test", "c.test", "*.wild.test"];
    const r = await check(hosts);
    expect(calls).toBe(3);
    expect(maxInFlight).toBe(3);
    expect(r.get("a.test")).toEqual({ status: 200, ms: 5, checkedAt: new Date(0).toISOString() });
    expect(r.get("*.wild.test")).toEqual({ status: null, ms: null, checkedAt: null });
    t = 59_000;
    await check(hosts);
    expect(calls).toBe(3);
    t = 61_000;
    await check(hosts);
    expect(calls).toBe(6);
  });
});
