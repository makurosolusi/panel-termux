import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTermuxHost,
  detectCliHost,
  FakeScenarioError,
  listProcs,
  NotTermuxError,
  pidAlive,
  probePaths,
  runVisible,
} from "@/cli/cli.host";
import { createFakeHost, FAKE_DAEMON_PID, FAKE_PANEL_PID } from "@/cli/cli.host.fake";
import { readEnvFile } from "@/cli/env.file";
import { TermuxExecError } from "@/server/exec/termux.exec";
import { scrubPanelEnv } from "@/server/main";
import { ENV_VARS } from "@/shared/env.schema";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-host-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = () => {
  const d = join(tmp, String(n++));
  mkdirSync(d, { recursive: true });
  return d;
};

describe("detectCliHost (K13, D1)", () => {
  const KEYS = ["PREFIX", "TERMUX_VERSION", "PANEL_CLI_FAKE", "PANEL_CLI_FAKE_RECORD"] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.PREFIX = fresh(); // empty prefix: no pkg/apt
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("PREFIX with bin/pkg but no bin/sv is Termux (bare Termux)", async () => {
    const prefix = process.env.PREFIX as string;
    mkdirSync(join(prefix, "bin"));
    writeFileSync(join(prefix, "bin", "pkg"), "#!/bin/sh\n");
    const host = await detectCliHost();
    expect(host.mode).toBe("termux");
    expect(host.paths.prefix).toBe(prefix);
    expect(host.paths.svdir).toBe(join(prefix, "var", "service"));
  });

  test("bin/apt alone is Termux", async () => {
    const prefix = process.env.PREFIX as string;
    mkdirSync(join(prefix, "bin"));
    writeFileSync(join(prefix, "bin", "apt"), "#!/bin/sh\n");
    expect((await detectCliHost()).mode).toBe("termux");
  });

  test("TERMUX_VERSION alone is Termux", async () => {
    process.env.TERMUX_VERSION = "0.118.3";
    expect((await detectCliHost()).mode).toBe("termux");
  });

  test("neither and no PANEL_CLI_FAKE: not Termux", async () => {
    await expect(detectCliHost()).rejects.toBeInstanceOf(NotTermuxError);
    await expect(detectCliHost()).rejects.toThrow("bukan Termux");
  });

  test("PANEL_CLI_FAKE picks the fake host only when named; unknown scenario is an error", async () => {
    process.env.PANEL_CLI_FAKE = "ready";
    const host = await detectCliHost();
    expect(host.mode).toBe("fake");
    expect(existsSync(probePaths(host.paths).sv)).toBe(true);
    process.env.PANEL_CLI_FAKE = "bogus";
    await expect(detectCliHost()).rejects.toBeInstanceOf(FakeScenarioError);
  });
});

describe("scrubPanelEnv (K11b, D3)", () => {
  test("removes every ENV_VARS key and keeps PATH, LD_PRELOAD, ANDROID_*", () => {
    const env: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      LD_PRELOAD: "/x/libtermux-exec.so",
      ANDROID_ROOT: "/system",
      BOOTCLASSPATH: "/apex/x.jar",
    };
    for (const v of ENV_VARS) env[v.name] = "sentinel"; // test-only
    scrubPanelEnv(env);
    for (const v of ENV_VARS) expect(env).not.toHaveProperty(v.name);
    expect(env).toEqual({
      PATH: "/usr/bin",
      LD_PRELOAD: "/x/libtermux-exec.so",
      ANDROID_ROOT: "/system",
      BOOTCLASSPATH: "/apex/x.jar",
    });
  });
});

describe("termux host pieces", () => {
  test("kill -0: own pid alive, absurd pid not", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 12345)).toBe(false);
  });

  test("listProcs: includes self where /proc exists, empty elsewhere", () => {
    const procs = listProcs();
    if (existsSync("/proc")) expect(procs.some((p) => p.pid === process.pid)).toBe(true);
    else expect(procs).toEqual([]);
  });

  test("run: exit code returned, onLine gets each stdout line (D14)", async () => {
    const lines: string[] = [];
    const sh = Bun.which("sh") as string;
    expect(await runVisible(sh, ["-c", "printf 'a\\nhttps://x\\nlast'"], { onLine: (l) => lines.push(l) })).toBe(0);
    expect(lines).toEqual(["a", "https://x", "last"]);
    expect(await runVisible(sh, ["-c", "exit 3"], { stdio: "ignore" })).toBe(3);
  });

  test("termux host reads paths from HOME/PREFIX/SVDIR", () => {
    const host = createTermuxHost();
    expect(host.mode).toBe("termux");
    expect(host.paths.panelDir).toBe(join(host.paths.home, "panel"));
    expect(host.freeBytes(tmp)).toBeGreaterThan(0);
  });
});

describe("fake host scenarios", () => {
  test("ready: packages installed and held, apps present, runit + panel answer", async () => {
    const host = createFakeHost("ready", { root: fresh() });
    expect((await host.exec("dpkg", ["-s", "cloudflared"])).code).toBe(0);
    expect((await host.exec("apt-mark", ["showhold"])).stdout).toBe("cloudflared\npostgresql\n");
    expect((await host.exec("/system/bin/cmd", ["package", "list", "packages", "com.termux.boot"])).stdout).toBe(
      "package:com.termux.boot\n",
    );
    expect((await host.exec("postgres", ["--version"])).stdout).toContain("PostgreSQL) 17.");
    const p = probePaths(host.paths);
    expect(readFileSync(p.pgVersion, "utf8").trim()).toBe("17");
    expect(readFileSync(p.daemonPid, "utf8").trim()).toBe(String(FAKE_DAEMON_PID));
    expect(host.proc.alive(FAKE_DAEMON_PID)).toBe(true);
    expect(await host.system().runit.supervise("panel")).toMatchObject({ state: "run", pid: FAKE_PANEL_PID });
    expect(await host.system().net.httpStatus(3200, "/api/health")).toBe(200);
    expect(statSync(p.envFile).mode & 0o777).toBe(0o600);
    expect(statSync(p.dataDir).mode & 0o777).toBe(0o700);
    expect(host.proc.list().filter((x) => x.pid !== host.proc.selfPid)).toHaveLength(1);
  });

  test("fresh: nothing installed, no services, no panel", async () => {
    const host = createFakeHost("fresh", { root: fresh() });
    const p = probePaths(host.paths);
    expect((await host.exec("dpkg", ["-s", "termux-services"])).code).toBe(1);
    expect((await host.exec("apt-mark", ["showhold"])).stdout).toBe("");
    expect(existsSync(p.pkg)).toBe(true);
    expect(existsSync(p.binary)).toBe(false);
    expect(existsSync(p.envFile)).toBe(false);
    expect(host.proc.alive(FAKE_DAEMON_PID)).toBe(false);
  });

  test("nosv: Termux without termux-services, runit and sv do not answer (D1)", async () => {
    const host = createFakeHost("nosv", { root: fresh() });
    expect((await host.exec("dpkg", ["-s", "termux-services"])).code).toBe(1);
    expect((await host.exec("dpkg", ["-s", "cloudflared"])).code).toBe(0);
    expect(existsSync(probePaths(host.paths).sv)).toBe(false);
    expect(await host.system().runit.supervise("panel")).toBeNull();
    await expect(host.exec("sv", ["status", "panel"])).rejects.toBeInstanceOf(TermuxExecError);
  });

  test("poco: the poco integration sandbox (old ecosystem)", () => {
    const host = createFakeHost("poco", { root: fresh() });
    expect(host.system().mode).toBe("fake");
    expect(host.scenario).toBe("poco");
  });

  test("files arranged before creation are kept", () => {
    const root = fresh();
    mkdirSync(join(root, "panel"), { recursive: true });
    writeFileSync(join(root, "panel", ".env"), "APP_BASE_URL=https://panel.example.com\n");
    const host = createFakeHost("ready", { root });
    expect(readFileSync(probePaths(host.paths).envFile, "utf8")).toBe("APP_BASE_URL=https://panel.example.com\n");
  });

  test("records argv and env key NAMES only, also to the record file", async () => {
    const recordFile = join(fresh(), "rec.jsonl");
    const host = createFakeHost("ready", { root: fresh(), recordFile });
    await host.exec("sv", ["-w", "130", "restart", "panel"], { env: { SVDIR: "/x", SENTINEL_KEY: "s3cr3t-value" } });
    expect(await host.run("pkg", ["install", "x"], { env: { A: "1" } })).toBe(0);
    expect(host.records).toEqual([
      { kind: "exec", argv: ["sv", "-w", "130", "restart", "panel"], envKeys: ["SENTINEL_KEY", "SVDIR"] },
      { kind: "run", argv: ["pkg", "install", "x"], envKeys: ["A"] },
    ]);
    const text = readFileSync(recordFile, "utf8");
    expect(text).not.toContain("s3cr3t-value");
    expect(
      text
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l)),
    ).toEqual(host.records);
  });

  test("unknown tools fail like a missing command and are still recorded", async () => {
    const host = createFakeHost("ready", { root: fresh() });
    const prev = probePaths(host.paths).prev;
    await expect(host.exec(prev, ["-v"])).rejects.toBeInstanceOf(TermuxExecError);
    expect(host.records.map((r) => r.argv[0])).toEqual([prev]);
  });

  test("confirm answers come from the queue; tty is settable", async () => {
    const host = createFakeHost("ready", { root: fresh(), tty: true, answers: [true, false] });
    expect(host.tty.isTty).toBe(true);
    expect(await host.tty.confirm("lanjut?")).toBe(true);
    expect(await host.tty.confirm("lanjut?")).toBe(false);
    expect(await host.tty.confirm("lanjut?")).toBe(false);
  });
});

describe("readEnvFile (K11a)", () => {
  test("missing file is null", () => {
    expect(readEnvFile(join(fresh(), ".env"))).toBeNull();
  });

  test("decodes ENV_VARS keys only, last line wins, unknown keys ignored", () => {
    const file = join(fresh(), ".env");
    writeFileSync(
      file,
      'APP_BASE_URL=https://a.test\nexport PORT="3300"\nOTHER=x\nAPP_BASE_URL=https://b.test # c\nGOOGLE_CLIENT_ID=\n',
    );
    expect(readEnvFile(file)).toEqual({ APP_BASE_URL: "https://b.test", PORT: "3300", GOOGLE_CLIENT_ID: "" });
  });
});
