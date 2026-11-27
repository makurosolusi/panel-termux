// Fake CliHost (PLAN/07 §7.1, C16): a sandbox HOME/PREFIX on disk per scenario plus canned answers for every
// §3.1 probe, so `PANEL_CLI_FAKE=<scenario> panel doctor` runs on macOS/CI. Records exec/run argv and env KEY
// names only (never values) for the D3 test; PANEL_CLI_FAKE_RECORD=<file> appends them as JSON lines.
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { TermuxExecError } from "../server/exec/termux.exec";
import { createFakeSystem, FAKE_TUNNEL_ID } from "../server/system/system.fake";
import type { SystemAdapters } from "../server/system/system.types";
import { ENV_VARS } from "../shared/env.schema";
import { type CliHost, confirmOnTty, type FakeScenarioName, type ProcInfo, pathsFrom, probePaths } from "./cli.host";

/** One recorded exec/run: argv as asked (tool first) and the names of the env keys the child would get. */
export type ExecRecord = { kind: "exec" | "run"; argv: string[]; envKeys: string[] };

/** Fake host plus what tests inspect. */
export type FakeHost = CliHost & { scenario: FakeScenarioName; records: ExecRecord[] };

/**
 * `root` = sandbox (HOME = root, PREFIX = root/usr like createFakeSystem; default a temp dir removed on exit);
 * files already there are kept, so tests may arrange them first. `tty`/`answers` drive confirmations.
 */
export type FakeHostOptions = { root?: string; tty?: boolean; answers?: boolean[]; recordFile?: string };

/** Pid of the fake runsvdir (service-daemon pidfile) and of the supervised panel (= createFakeSystem `panelPid`). */
export const FAKE_DAEMON_PID = 900;
export const FAKE_PANEL_PID = 1002;
/** Free space every scenario reports (above the 1 GB warning). */
export const FAKE_FREE_BYTES = 3_100_000_000;
/** PostgreSQL major in PG_VERSION and `postgres --version` (they match: `postgres_major` ok). */
const PG_MAJOR = "17";
const PANEL_HOST = "panel.contoh.com";
const PANEL_PORT = Number(ENV_VARS.find((v) => v.name === "PORT")?.default);

const ALL_PACKAGES = ["termux-services", "cloudflared", "nodejs-lts", "postgresql", "termux-api"];
/** Termux packages, holds and Android apps per scenario; `services` = termux-services set up and runsvdir alive. */
const FACTS: Record<
  FakeScenarioName,
  { packages: string[]; held: string[]; apps: string[]; services: boolean; panel: boolean }
> = {
  fresh: { packages: [], held: [], apps: [], services: false, panel: false },
  nosv: {
    packages: ALL_PACKAGES.filter((p) => p !== "termux-services"),
    held: ["cloudflared", "postgresql"],
    apps: ["com.termux.boot", "com.termux.api"],
    services: false,
    panel: true,
  },
  ready: {
    packages: ALL_PACKAGES,
    held: ["cloudflared", "postgresql"],
    apps: ["com.termux.boot", "com.termux.api"],
    services: true,
    panel: true,
  },
  poco: {
    packages: ALL_PACKAGES,
    held: ["cloudflared", "postgresql"],
    apps: ["com.termux.boot", "com.termux.api"],
    services: true,
    panel: true,
  },
};

// test-only values: a complete, non-placeholder .env (fake mode never reads a real one)
const FAKE_ENV = `APP_BASE_URL=https://${PANEL_HOST}
GOOGLE_CLIENT_ID=fake-client.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=fake-client-secret
SUPER_ADMIN_EMAILS=admin@contoh.com
`;
const FAKE_CONFIG = `tunnel: ${FAKE_TUNNEL_ID}
credentials-file: /fake/.cloudflared/${FAKE_TUNNEL_ID}.json

ingress:
  - hostname: ${PANEL_HOST}
    service: http://localhost:${PANEL_PORT}
  - hostname: solusi.contoh.test
    service: http://localhost:3005
  - service: http_status:404
`;
const SH = "#!/data/data/com.termux/files/usr/bin/sh\n";

/** Sandbox files of a scenario: path → content (mode 755 for bin/ and run scripts). */
function scenarioFiles(scenario: FakeScenarioName, root: string): Record<string, string> {
  const f = FACTS[scenario];
  const paths = pathsFrom(root, join(root, "usr"));
  const p = probePaths(paths);
  const has = (pkg: string) => f.packages.includes(pkg);
  const files: Record<string, string> = { [p.pkg]: SH, [p.apt]: SH };
  if (has("termux-services")) files[p.sv] = SH;
  if (has("nodejs-lts")) files[p.node] = SH;
  if (has("nodejs-lts")) files[p.pm2Runtime] = "#!/usr/bin/env node\n";
  if (has("postgresql")) files[p.pgVersion] = `${PG_MAJOR}\n`;
  if (f.services) {
    files[p.daemonPid] = `${FAKE_DAEMON_PID}\n`;
    files[join(paths.svdir, "panel", "run")] = `${SH}cd "$HOME/panel" || exit 1\nexec ./panel\n`;
    files[join(paths.svdir, "panel", "supervise", "pid")] = `${FAKE_PANEL_PID}\n`;
    files[join(paths.svdir, "pm2", "run")] = `${SH}exec pm2-runtime start ecosystem.config.js --no-auto-exit\n`;
    files[join(paths.svdir, "cloudflared", "run")] = `${SH}exec cloudflared tunnel --no-autoupdate run ${scenario}\n`;
    files[join(paths.svdir, "postgres", "run")] = `${SH}exec postgres\n`;
    files[join(p.bootDir, "start-services")] = `${SH}. $PREFIX/etc/profile.d/start-services.sh\n`;
  }
  if (f.panel) {
    files[p.binary] = "\x7fELF fake panel\n";
    files[p.envFile] = FAKE_ENV;
    files[join(p.cloudflaredDir, "cert.pem")] = "fake cert\n";
    files[join(p.cloudflaredDir, "config.yml")] = FAKE_CONFIG;
    files[join(root, "sites", "apps.json")] = "[]\n"; // a booted panel has made it (ensureAppsJson)
  }
  return files;
}

function materialize(scenario: FakeScenarioName, root: string): void {
  for (const [file, content] of Object.entries(scenarioFiles(scenario, root))) {
    if (existsSync(file)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { mode: file.endsWith(".env") ? 0o600 : 0o755 });
  }
  if (FACTS[scenario].panel) {
    const data = probePaths(pathsFrom(root, "")).dataDir;
    mkdirSync(data, { recursive: true });
    chmodSync(data, 0o700);
  }
}

const tempRoots: string[] = [];
function tempRoot(): string {
  if (tempRoots.length === 0)
    process.on("exit", () => {
      for (const d of tempRoots) rmSync(d, { recursive: true, force: true });
    });
  const dir = mkdtempSync(join(tmpdir(), "panel-cli-fake-"));
  tempRoots.push(dir);
  return dir;
}

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** Canned answer of one probe command; tools the scenario lacks fail like runTermux (TermuxExecError). */
function answer(scenario: FakeScenarioName, tool: string, args: readonly string[]) {
  const f = FACTS[scenario];
  const name = basename(tool);
  if (name === "dpkg" && args[0] === "-s") {
    const pkg = args[1] ?? "";
    return f.packages.includes(pkg)
      ? ok(`Package: ${pkg}\nStatus: ${f.held.includes(pkg) ? "hold" : "install"} ok installed\n`)
      : { code: 1, stdout: "", stderr: `dpkg-query: package '${pkg}' is not installed\n` };
  }
  if (name === "apt-mark" && args[0] === "showhold") return ok(f.held.map((p) => `${p}\n`).join(""));
  if (name === "cmd" && args.slice(0, 3).join(" ") === "package list packages") {
    const want = args[3] ?? "";
    return ok(
      f.apps
        .filter((a) => a.startsWith(want))
        .map((a) => `package:${a}\n`)
        .join(""),
    );
  }
  if (name === "postgres" && args[0] === "--version" && f.packages.includes("postgresql"))
    return ok(`postgres (PostgreSQL) ${PG_MAJOR}.5\n`);
  if (name === "sv" && f.packages.includes("termux-services")) return ok();
  throw new TermuxExecError(`exec ${tool} failed: fake ${scenario}: no such command`);
}

/** Fake system: createFakeSystem over the sandbox; without termux-services runit and the panel do not answer. */
function fakeSystem(scenario: FakeScenarioName, root: string): SystemAdapters {
  const f = FACTS[scenario];
  const system = createFakeSystem({
    home: root,
    offline: true,
    integration: scenario === "poco" ? "poco" : f.panel ? "ready" : "no_sites_dir",
    listeningPorts: f.services ? [PANEL_PORT] : [],
    panelPid: FAKE_PANEL_PID,
  });
  if (f.services) return system;
  return {
    ...system,
    runit: { ...system.runit, list: async () => [], supervise: async () => null, control: async () => null },
  };
}

/** Fake host for `scenario` (PANEL_CLI_FAKE, tests). */
export function createFakeHost(scenario: FakeScenarioName, opts: FakeHostOptions = {}): FakeHost {
  const root = opts.root ?? tempRoot();
  materialize(scenario, root);
  const paths = pathsFrom(root, join(root, "usr"));
  const f = FACTS[scenario];
  const records: ExecRecord[] = [];
  const record = (kind: ExecRecord["kind"], tool: string, args: readonly string[], env?: object) => {
    const rec: ExecRecord = { kind, argv: [tool, ...args], envKeys: Object.keys(env ?? process.env).sort() };
    records.push(rec);
    if (opts.recordFile) appendFileSync(opts.recordFile, `${JSON.stringify(rec)}\n`);
  };
  const answers = [...(opts.answers ?? [])];
  const uid = process.getuid?.() ?? -1;
  const panelProc = (pid: number, cmdline: string[]): ProcInfo => ({
    pid,
    uid,
    exe: probePaths(paths).binary,
    cmdline,
  });
  const alive = new Set(f.services ? [FAKE_DAEMON_PID, FAKE_PANEL_PID, process.pid] : [process.pid]);
  let system: SystemAdapters | undefined;
  return {
    scenario,
    records,
    mode: "fake",
    paths,
    arch: "arm64",
    termuxEnv: { TERMUX_VERSION: "0.118.3", TERMUX_APK_RELEASE: "F_DROID" },
    freeBytes: () => FAKE_FREE_BYTES,
    system: () => (system ??= fakeSystem(scenario, root)),
    async exec(tool, args = [], execOpts = {}) {
      record("exec", tool, args, execOpts.env);
      return answer(scenario, tool, args);
    },
    async run(tool, args = [], runOpts = {}) {
      record("run", tool, args, runOpts.env);
      return 0;
    },
    tty: {
      isTty: opts.tty ?? process.stdin.isTTY === true,
      confirm: async (q) => (opts.answers ? (answers.shift() ?? false) : confirmOnTty(q)),
    },
    proc: {
      selfPid: process.pid,
      uid,
      list: () => [
        ...(f.services ? [panelProc(FAKE_PANEL_PID, ["./panel"])] : []),
        panelProc(process.pid, ["./panel", "doctor"]),
      ],
      alive: (pid) => alive.has(pid),
    },
  };
}
