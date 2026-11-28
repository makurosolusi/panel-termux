import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  childEnv,
  confirmAnswer,
  createTermuxHost,
  detectCliHost,
  FakeScenarioError,
  NotTermuxError,
  pathsFrom,
  probePaths,
  RUN_TIMEOUT_EXIT,
  runVisible,
} from "@/cli/cli.host";
import {
  createFakeHost,
  FAKE_DAEMON_PID,
  FAKE_DPKG_AUDIT,
  FAKE_NEW_VERSION,
  FAKE_OLD_VERSION,
  FAKE_PANEL_PID,
} from "@/cli/cli.host.fake";
import { listProcs, pidAlive, procExeId } from "@/cli/cli.host.proc";
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
    await expect(detectCliHost()).rejects.toThrow("not Termux");
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
    lines.length = 0; // cloudflared logs its login URL on stderr
    expect(await runVisible(sh, ["-c", "echo https://login >&2"], { onLine: (l) => lines.push(l) })).toBe(0);
    expect(lines).toEqual(["https://login"]);
    expect(await runVisible(sh, ["-c", "exit 3"], { stdio: "ignore" })).toBe(3);
  });

  test("run: timeoutMs kills the child and returns RUN_TIMEOUT_EXIT", async () => {
    const sh = Bun.which("sh") as string;
    expect(await runVisible(sh, ["-c", "sleep 5"], { stdio: "ignore", timeoutMs: 50 })).toBe(RUN_TIMEOUT_EXIT);
    expect(await runVisible(sh, ["-c", "exit 0"], { stdio: "ignore", timeoutMs: 5000 })).toBe(0);
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

  test("records argv and env key NAMES only (plus LC_ALL/SVDIR/LOGDIR values), also to the record file", async () => {
    const recordFile = join(fresh(), "rec.jsonl");
    const host = createFakeHost("ready", { root: fresh(), recordFile });
    const { svdir, logdir } = host.paths;
    await host.exec("sv", ["-w", "130", "restart", "panel"], { env: { SVDIR: "/x", SENTINEL_KEY: "s3cr3t-value" } });
    expect(await host.run("pkg", ["install", "x"], { env: { A: "1" }, lcAllC: true })).toBe(0);
    expect(host.records).toEqual([
      {
        kind: "exec",
        argv: ["sv", "-w", "130", "restart", "panel"],
        envKeys: ["LOGDIR", "SENTINEL_KEY", "SVDIR"],
        vars: { SVDIR: svdir, LOGDIR: logdir },
      },
      {
        kind: "run",
        argv: ["pkg", "install", "x"],
        envKeys: ["A", "LC_ALL", "LOGDIR", "SVDIR"],
        vars: { LC_ALL: "C", SVDIR: svdir, LOGDIR: logdir },
      },
    ]);
    const text = readFileSync(recordFile, "utf8");
    expect(text).not.toContain("s3cr3t-value");
    expect(
      text
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l)),
    ).toEqual(JSON.parse(JSON.stringify(host.records)));
  });

  test("unknown tools fail like a missing command and are still recorded", async () => {
    const host = createFakeHost("ready", { root: fresh() });
    const prev = probePaths(host.paths).prev;
    await expect(host.exec(prev, ["-v"])).rejects.toBeInstanceOf(TermuxExecError);
    expect(host.records.map((r) => r.argv[0])).toEqual([prev]);
  });

  test("confirm answers come from the queue (booleans or typed text); empty queue = EOF = no", async () => {
    const host = createFakeHost("ready", { root: fresh(), tty: true, answers: [true, false, "", "", "ya"] });
    expect(host.tty.isTty).toBe(true);
    expect(await host.tty.confirm("lanjut?")).toBe(true);
    expect(await host.tty.confirm("lanjut?")).toBe(false);
    expect(await host.tty.confirm("lanjut?", true)).toBe(true); // Enter = default
    expect(await host.tty.confirm("lanjut?")).toBe(false);
    expect(await host.tty.confirm("lanjut?")).toBe(true);
    expect(await host.tty.confirm("lanjut?", true)).toBe(false); // EOF
  });

  test("ask and secret read the same queue; EOF = null", async () => {
    const host = createFakeHost("fresh", { root: fresh(), answers: ["panel.contoh.com", "rahasia"] });
    expect(await host.tty.ask("Alamat:")).toBe("panel.contoh.com");
    expect(await host.tty.secret("Secret:")).toBe("rahasia");
    expect(await host.tty.ask("lagi:")).toBeNull();
  });

  test("fetch: offline by default (rejects), canned when given; every URL is recorded", async () => {
    const offline = createFakeHost("fresh", { root: fresh() });
    await expect(offline.fetch("https://github.com/x/SHA256SUMS")).rejects.toThrow("offline");
    const online = createFakeHost("fresh", {
      root: fresh(),
      fetch: async (url) => new Response(url.endsWith("SHA256SUMS") ? "abc  panel\n" : "", { status: 200 }),
    });
    expect(await (await online.fetch("https://h/SHA256SUMS")).text()).toBe("abc  panel\n");
    expect(offline.records).toEqual([{ kind: "fetch", argv: ["https://github.com/x/SHA256SUMS"], envKeys: [] }]);
  });

  test("execAnswers override a canned answer, undefined falls through", async () => {
    const host = createFakeHost("ready", {
      root: fresh(),
      execAnswers: (tool, args) =>
        tool === "apt-get" && args[0] === "-s" ? { code: 0, stdout: "Inst jq (1.7)\n", stderr: "" } : undefined,
    });
    expect((await host.exec("apt-get", ["-s", "install", "jq"])).stdout).toBe("Inst jq (1.7)\n");
    expect((await host.exec("dpkg", ["-s", "cloudflared"])).code).toBe(0);
  });
});

describe("fake host: init scenarios (PLAN/07 §16 W0)", () => {
  const exists = (host: ReturnType<typeof createFakeHost>, ...parts: string[]) =>
    existsSync(join(host.paths.home, ...parts));

  test("health answers the scenario version on the panel port only, nothing without runit", async () => {
    expect((await createFakeHost("upgrade", { root: fresh() }).health(3200))?.version).toBe(FAKE_OLD_VERSION);
    expect((await createFakeHost("downgrade", { root: fresh() }).health(3200))?.version).toBe(FAKE_NEW_VERSION);
    expect((await createFakeHost("poco", { root: fresh() }).health(3200))?.version).toBe("0.5.0");
    expect(await createFakeHost("upgrade", { root: fresh() }).health(3300)).toBeNull();
    expect(await createFakeHost("nosv", { root: fresh() }).health(3200)).toBeNull();
    expect(await createFakeHost("fresh", { root: fresh() }).health(3200)).toBeNull();
  });

  test("upgrade: $PREFIX/bin/panel links to the binary; poco has no link (as on POCO)", () => {
    const up = createFakeHost("upgrade", { root: fresh() });
    expect(readFileSync(join(up.paths.prefix, "bin", "panel"), "utf8")).toContain("fake panel");
    expect(existsSync(join(createFakeHost("poco", { root: fresh() }).paths.prefix, "bin", "panel"))).toBe(false);
  });

  test("fresh-pg: PostgreSQL data without a panel", () => {
    const host = createFakeHost("fresh-pg", { root: fresh() });
    const p = probePaths(host.paths);
    expect(existsSync(p.pgVersion)).toBe(true);
    expect(existsSync(p.binary)).toBe(false);
    expect(exists(host, ".cloudflared")).toBe(false);
  });

  test("fresh-resume: binary + panel service (down) + runsvdir, no user data, dpkg --audit not empty", async () => {
    const host = createFakeHost("fresh-resume", { root: fresh() });
    const p = probePaths(host.paths);
    expect(existsSync(p.binary)).toBe(true);
    expect(existsSync(join(host.paths.svdir, "panel", "run"))).toBe(true);
    expect(existsSync(join(host.paths.svdir, "panel", "down"))).toBe(true);
    expect(host.proc.alive(FAKE_DAEMON_PID)).toBe(true);
    for (const d of [".cloudflared", ".pm2", "sites"]) expect(exists(host, d)).toBe(false);
    expect(existsSync(p.pgVersion)).toBe(false);
    expect((await host.exec("dpkg", ["--audit"])).stdout).toBe(FAKE_DPKG_AUDIT);
    expect((await createFakeHost("ready", { root: fresh() }).exec("dpkg", ["--audit"])).stdout).toBe("");
  });

  test("upgrade-partial: the binary is selfPath, but runit's process runs another inode (K21)", () => {
    const self = join(fresh(), "self-panel");
    writeFileSync(self, "\x7fELF self\n"); // test-only
    const host = createFakeHost("upgrade-partial", { root: fresh(), selfPath: self });
    const binary = probePaths(host.paths).binary;
    expect(readFileSync(binary, "utf8")).toBe("\x7fELF self\n");
    expect(host.selfPath).toBe(self);
    const file = statSync(binary);
    expect(host.proc.exeId(FAKE_PANEL_PID)).not.toEqual({ dev: file.dev, ino: file.ino });
    const up = createFakeHost("upgrade", { root: fresh() });
    const upFile = statSync(probePaths(up.paths).binary);
    expect(up.proc.exeId(FAKE_PANEL_PID)).toEqual({ dev: upFile.dev, ino: upFile.ino });
    expect(up.proc.exeId(4242)).toBeNull();
  });

  test("asking a fresh sandbox for adapters adds no user data to it (C20)", async () => {
    for (const scenario of ["fresh", "fresh-pg", "fresh-resume"] as const) {
      const host = createFakeHost(scenario, { root: fresh() });
      host.system();
      host.resetSystem();
      await host.system().runit.list();
      for (const d of [".cloudflared", ".pm2", "sites"]) expect(exists(host, d)).toBe(false);
    }
  });
});

describe("childEnv (K11b, lab: SVDIR/LOGDIR empty in a non-login ssh)", () => {
  const paths = pathsFrom("/h", "/p");
  test("SVDIR/LOGDIR always from paths, ENV_VARS keys dropped even from a caller env, LC_ALL=C on request", () => {
    const base: Record<string, string | undefined> = { PATH: "/bin", SVDIR: "", LC_ALL: "id_ID.UTF-8" };
    for (const v of ENV_VARS) base[v.name] = "sentinel"; // test-only
    const env = childEnv(paths, base, true);
    expect(env).toEqual({ PATH: "/bin", SVDIR: "/p/var/service", LOGDIR: "/p/var/log", LC_ALL: "C" });
    expect(childEnv(paths, { LC_ALL: "id_ID.UTF-8" }).LC_ALL).toBe("id_ID.UTF-8");
  });

  test("the termux host passes childEnv to the child", async () => {
    const host = createTermuxHost();
    const sh = Bun.which("sh") as string;
    const r = await host.exec(sh, ["-c", 'printf "%s|%s|%s" "$SVDIR" "$LOGDIR" "$LC_ALL"'], {
      env: { PATH: process.env.PATH },
      lcAllC: true,
    });
    expect(r.stdout).toBe(`${host.paths.svdir}|${host.paths.logdir}|C`);
  });
});

describe("confirmAnswer", () => {
  test("y/ya/yes yes; n/tidak/other no; empty = default; EOF = no", () => {
    for (const a of ["y", "Ya", "YES"]) expect(confirmAnswer(a)).toBe(true);
    for (const a of ["n", "tidak", "x"]) expect(confirmAnswer(a, true)).toBe(false);
    expect(confirmAnswer("", true)).toBe(true);
    expect(confirmAnswer("  ")).toBe(false);
    expect(confirmAnswer(null, true)).toBe(false);
  });
});

describe("procExeId", () => {
  test("own process where /proc exists; gone pid is null", () => {
    if (existsSync("/proc")) expect(procExeId(process.pid)).toMatchObject({ ino: expect.any(Number) });
    expect(procExeId(2 ** 22 + 12345)).toBeNull();
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
