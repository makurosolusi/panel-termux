// Fake CliHost (PLAN/07 §7.1, C16): a sandbox HOME/PREFIX on disk per scenario plus canned answers for every
// §3.1 probe, so `PANEL_CLI_FAKE=<scenario> panel doctor|init` runs on macOS/CI. Records exec/run argv, env KEY
// names (never values; LC_ALL/SVDIR/LOGDIR values too, they are not secret) and fetch URLs for the D3 test;
// PANEL_CLI_FAKE_RECORD=<file> appends them as JSON lines.
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { type ExecResult, TermuxExecError } from "../server/exec/termux.exec";
import { createFakeSystem, FAKE_TUNNEL_ID } from "../server/system/system.fake";
import type { SystemAdapters } from "../server/system/system.types";
import { ENV_VARS } from "../shared/env.schema";
import {
  type CliHost,
  childEnv,
  confirmAnswer,
  confirmOnTty,
  type FakeScenarioName,
  type ProcInfo,
  pathsFrom,
  probePaths,
} from "./cli.host";

/** One recorded call: argv as asked (tool first; fetch = [url]), env key names, and the non-secret LC_ALL/SVDIR/LOGDIR. */
export type ExecRecord = {
  kind: "exec" | "run" | "fetch";
  argv: string[];
  envKeys: string[];
  vars?: { LC_ALL?: string; SVDIR?: string; LOGDIR?: string };
};

/** Fake host plus what tests inspect. */
export type FakeHost = CliHost & { scenario: FakeScenarioName; records: ExecRecord[] };

/** A scripted answer: boolean for confirm, string for ask/secret/confirm (y/n/empty), null = EOF. */
export type FakeAnswer = boolean | string | null;

/**
 * `root` = sandbox (HOME = root, PREFIX = root/usr like createFakeSystem; default a temp dir removed on exit);
 * files already there are kept, so tests may arrange them first. `tty`/`answers` drive questions (queue; empty
 * queue = EOF). `selfPath` = the binary init would install (default process.execPath). `execAnswers` overrides a
 * canned probe answer (return undefined to fall through), e.g. `apt-get -s` text. `fetch` answers HTTPS (default:
 * offline, rejects like a network failure).
 */
export type FakeHostOptions = {
  root?: string;
  tty?: boolean;
  answers?: FakeAnswer[];
  recordFile?: string;
  selfPath?: string;
  execAnswers?: (tool: string, args: readonly string[]) => ExecResult | undefined;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
};

/** Pid of the fake runsvdir (service-daemon pidfile) and of the supervised panel (= createFakeSystem `panelPid`). */
export const FAKE_DAEMON_PID = 900;
export const FAKE_PANEL_PID = 1002;
/** Free space every scenario reports (above the 1 GB warning). */
export const FAKE_FREE_BYTES = 3_100_000_000;
/** Panel versions /api/health answers in the init scenarios (older / newer than this build). */
export const FAKE_OLD_VERSION = "0.4.0";
export const FAKE_NEW_VERSION = "99.0.0";
/** `dpkg --audit` of `fresh-resume`: an interrupted `pkg upgrade` (non-empty = dpkg needs --configure -a). */
export const FAKE_DPKG_AUDIT =
  "The following packages are only half configured:\n libandroid-support  Android support\n";
/** PostgreSQL major in PG_VERSION and `postgres --version` (they match: `postgres_major` ok). */
const PG_MAJOR = "17";
const PANEL_HOST = "panel.contoh.com";
const PANEL_PORT = Number(ENV_VARS.find((v) => v.name === "PORT")?.default);

const ALL_PACKAGES = ["termux-services", "cloudflared", "nodejs-lts", "postgresql", "termux-api"];
const HELD = ["cloudflared", "postgresql"];
const APPS = ["com.termux.boot", "com.termux.api"];
/**
 * Per scenario: Termux packages, holds, Android apps; `services` = termux-services set up and runsvdir alive with
 * every service dir; `panel` = installed panel with user data (binary, .env, ~/.cloudflared, ~/sites); `version` =
 * /api/health answer; `link` = `$PREFIX/bin/panel` → binary; `self` = binary is a copy of selfPath; `stale` = runit's
 * panel process runs another file; `resume` = runsvdir + binary + `$SVDIR/panel` (down) only; `audit` = dpkg --audit.
 */
type Facts = {
  packages: string[];
  held: string[];
  apps: string[];
  services: boolean;
  panel: boolean;
  version?: string;
  link?: boolean;
  self?: boolean;
  stale?: boolean;
  resume?: boolean;
  audit?: string;
};
const READY: Facts = { packages: ALL_PACKAGES, held: HELD, apps: APPS, services: true, panel: true };
const FACTS: Record<FakeScenarioName, Facts> = {
  fresh: { packages: [], held: [], apps: [], services: false, panel: false },
  nosv: { ...READY, packages: ALL_PACKAGES.filter((p) => p !== "termux-services"), services: false },
  ready: { ...READY, version: pkg.version },
  poco: { ...READY, version: "0.5.0" }, // POCO today: 0.5.0, no $PREFIX/bin/panel
  upgrade: { ...READY, version: FAKE_OLD_VERSION, link: true },
  downgrade: { ...READY, version: FAKE_NEW_VERSION, link: true },
  "upgrade-partial": { ...READY, version: FAKE_OLD_VERSION, link: true, self: true, stale: true },
  "fresh-pg": { packages: ["postgresql"], held: [], apps: [], services: false, panel: false },
  "fresh-resume": {
    packages: ["termux-services", "nodejs-lts"],
    held: [],
    apps: [],
    services: false,
    panel: false,
    resume: true,
    audit: FAKE_DPKG_AUDIT,
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
  const panelRun = `${SH}cd "$HOME/panel" || exit 1\nexec ./panel\n`;
  if (f.services) {
    files[p.daemonPid] = `${FAKE_DAEMON_PID}\n`;
    files[join(paths.svdir, "panel", "run")] = panelRun;
    files[join(paths.svdir, "panel", "supervise", "pid")] = `${FAKE_PANEL_PID}\n`;
    files[join(paths.svdir, "pm2", "run")] = `${SH}exec pm2-runtime start ecosystem.config.js --no-auto-exit\n`;
    files[join(paths.svdir, "cloudflared", "run")] = `${SH}exec cloudflared tunnel --no-autoupdate run ${scenario}\n`;
    files[join(paths.svdir, "postgres", "run")] = `${SH}exec postgres\n`;
    files[join(p.bootDir, "start-services")] = `${SH}. $PREFIX/etc/profile.d/start-services.sh\n`;
  }
  if (f.resume) {
    files[p.daemonPid] = `${FAKE_DAEMON_PID}\n`;
    files[join(paths.svdir, "panel", "run")] = panelRun;
    files[join(paths.svdir, "panel", "down")] = "";
  }
  if (f.panel) {
    files[p.envFile] = FAKE_ENV;
    files[join(p.cloudflaredDir, "cert.pem")] = "fake cert\n";
    files[join(p.cloudflaredDir, "config.yml")] = FAKE_CONFIG;
    files[join(root, "sites", "apps.json")] = "[]\n"; // a booted panel has made it (ensureAppsJson)
  }
  if ((f.panel || f.resume) && !f.self) files[p.binary] = "\x7fELF fake panel\n";
  return files;
}

/** Installs `selfPath` as the sandbox binary: hard link (no copy of a 100 MB binary), copy across filesystems. */
function installSelf(selfPath: string, binary: string): void {
  if (existsSync(binary)) return;
  mkdirSync(dirname(binary), { recursive: true });
  try {
    linkSync(selfPath, binary);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    copyFileSync(selfPath, binary);
  }
}

function materialize(scenario: FakeScenarioName, root: string, selfPath: string): void {
  for (const [file, content] of Object.entries(scenarioFiles(scenario, root))) {
    if (existsSync(file)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { mode: file.endsWith(".env") ? 0o600 : 0o755 });
  }
  const f = FACTS[scenario];
  const paths = pathsFrom(root, join(root, "usr"));
  const p = probePaths(paths);
  if (f.self) installSelf(selfPath, p.binary);
  const link = join(paths.prefix, "bin", "panel");
  if (f.link && !existsSync(link)) symlinkSync(p.binary, link);
  if (f.panel) {
    mkdirSync(p.dataDir, { recursive: true });
    chmodSync(p.dataDir, 0o700);
  }
}

const tempRoots: string[] = [];
function tempDir(prefix: string): string {
  if (tempRoots.length === 0)
    process.on("exit", () => {
      for (const d of tempRoots) rmSync(d, { recursive: true, force: true });
    });
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** Canned answer of one probe command; tools the scenario lacks fail like runTermux (TermuxExecError). */
function answer(scenario: FakeScenarioName, tool: string, args: readonly string[]): ExecResult {
  const f = FACTS[scenario];
  const name = basename(tool);
  if (name === "dpkg" && args[0] === "-s") {
    const pkg = args[1] ?? "";
    return f.packages.includes(pkg)
      ? ok(`Package: ${pkg}\nStatus: ${f.held.includes(pkg) ? "hold" : "install"} ok installed\n`)
      : { code: 1, stdout: "", stderr: `dpkg-query: package '${pkg}' is not installed\n` };
  }
  if (name === "dpkg" && args[0] === "--audit") return ok(f.audit ?? "");
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

/**
 * Fake system: createFakeSystem; without termux-services runit and the panel do not answer. createFakeSystem seeds
 * its home (~/.cloudflared/config.yml, pm2 run, tools): phones without user data get a separate home, so asking for
 * the adapters never turns a fresh sandbox into one with user data (C20).
 */
function fakeSystem(scenario: FakeScenarioName, root: string): SystemAdapters {
  const f = FACTS[scenario];
  const system = createFakeSystem({
    home: f.panel ? root : tempDir("panel-cli-fake-system-"),
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

const offline = async (url: string): Promise<Response> => {
  throw new TypeError(`fetch ${url} failed: fake host is offline`);
};

/** Fake host for `scenario` (PANEL_CLI_FAKE, tests). */
export function createFakeHost(scenario: FakeScenarioName, opts: FakeHostOptions = {}): FakeHost {
  const root = opts.root ?? tempDir("panel-cli-fake-");
  const selfPath = opts.selfPath ?? process.execPath;
  materialize(scenario, root, selfPath);
  const paths = pathsFrom(root, join(root, "usr"));
  const binary = probePaths(paths).binary;
  const f = FACTS[scenario];
  const records: ExecRecord[] = [];
  const record = (kind: ExecRecord["kind"], argv: string[], env?: Record<string, string | undefined>) => {
    const rec: ExecRecord = { kind, argv, envKeys: env ? Object.keys(env).sort() : [] };
    if (env) rec.vars = { LC_ALL: env.LC_ALL, SVDIR: env.SVDIR, LOGDIR: env.LOGDIR };
    records.push(rec);
    if (opts.recordFile) appendFileSync(opts.recordFile, `${JSON.stringify(rec)}\n`);
  };
  const scripted = opts.answers !== undefined;
  const answers = [...(opts.answers ?? [])];
  const next = (): FakeAnswer => (answers.length > 0 ? (answers.shift() ?? null) : null);
  const text = (a: FakeAnswer) => (typeof a === "boolean" ? (a ? "y" : "n") : a);
  const uid = process.getuid?.() ?? -1;
  const panelProc = (pid: number, cmdline: string[]): ProcInfo => ({ pid, uid, exe: binary, cmdline });
  const alive = new Set(f.services ? [FAKE_DAEMON_PID, FAKE_PANEL_PID, process.pid] : [process.pid]);
  if (f.resume) alive.add(FAKE_DAEMON_PID);
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
    resetSystem: () => {
      system = undefined;
    },
    async exec(tool, args = [], { lcAllC, ...execOpts } = {}) {
      record("exec", [tool, ...args], childEnv(paths, execOpts.env, lcAllC));
      return opts.execAnswers?.(tool, args) ?? answer(scenario, tool, args);
    },
    async run(tool, args = [], { lcAllC, ...runOpts } = {}) {
      record("run", [tool, ...args], childEnv(paths, runOpts.env, lcAllC));
      return 0;
    },
    async fetch(url, init) {
      record("fetch", [url]);
      return (opts.fetch ?? offline)(url, init);
    },
    health: async (port) =>
      f.services && f.version && port === PANEL_PORT ? { version: f.version, bootId: crypto.randomUUID() } : null,
    selfPath,
    tty: {
      isTty: opts.tty ?? process.stdin.isTTY === true,
      confirm: async (q, defaultYes = false) => {
        if (!scripted) return confirmOnTty(q, defaultYes);
        const a = next();
        return typeof a === "boolean" ? a : confirmAnswer(a, defaultYes);
      },
      ask: async (q) => (scripted ? text(next()) : prompt(q)),
      secret: async (q) => (scripted ? text(next()) : prompt(q)),
    },
    proc: {
      selfPid: process.pid,
      uid,
      list: () => [
        ...(f.services ? [panelProc(FAKE_PANEL_PID, ["./panel"])] : []),
        panelProc(process.pid, ["./panel", "doctor"]),
      ],
      alive: (pid) => alive.has(pid),
      exeId: (pid) => {
        if (pid !== FAKE_PANEL_PID || !f.services || !existsSync(binary)) return null;
        const s = statSync(binary);
        return f.stale ? { dev: s.dev, ino: s.ino + 1 } : { dev: s.dev, ino: s.ino };
      },
    },
  };
}
