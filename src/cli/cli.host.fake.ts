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
  readFileSync,
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
import type { SuperviseState, SystemAdapters } from "../server/system/system.types";
import { ENV_VARS } from "../shared/env.schema";
import {
  type CliHost,
  type CliPaths,
  childEnv,
  confirmAnswer,
  confirmOnTty,
  type FakeScenarioName,
  type ProcInfo,
  pathsFrom,
  probePaths,
} from "./cli.host";
import { execEffect, FAKE_DAEMON_PID, FAKE_PG_MAJOR, readDpkg, runEffect, seedDpkg } from "./cli.host.fake.install";

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
  /** host.link refuses with EACCES like Android app storage (E9); default true. */
  linkFails?: boolean;
};

/** Pid of the fake runsvdir (service-daemon pidfile) and of the supervised panel (= createFakeSystem `panelPid`). */
export { FAKE_DAEMON_PID };
export const FAKE_PANEL_PID = 1002;
/** Free space every scenario reports (above the 1 GB warning). */
export const FAKE_FREE_BYTES = 3_100_000_000;
/** Panel versions /api/health answers in the init scenarios (older / newer than this build). */
export const FAKE_OLD_VERSION = "0.4.0";
export const FAKE_NEW_VERSION = "99.0.0";
/** `dpkg --audit` of `fresh-resume`: an interrupted `pkg upgrade` (non-empty = dpkg needs --configure -a). */
export const FAKE_DPKG_AUDIT =
  "The following packages are only half configured:\n libandroid-support  Android support\n";
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
// test-only: deploy/sv/panel/run as shipped by 0.3.0–0.5.0 (install-phone.sh), the run script POCO has (E18, C23)
const PANEL_RUN_050 = `${SH}# runit (termux-services) run script of the panel. Installed by scripts/install-phone.sh into
# $PREFIX/var/service/panel/run; stdout+stderr go to the svlogger in log/run.
# Bun auto-loads .env from the working directory; PANEL_DATA_DIR defaults to ./data.
exec 2>&1
cd "\${HOME:-/data/data/com.termux/files/home}/panel" || exit 1
exec ./panel
`;

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
  if (has("postgresql")) files[p.pgVersion] = `${FAKE_PG_MAJOR}\n`;
  const panelRun = scenario === "poco" ? PANEL_RUN_050 : `${SH}cd "$HOME/panel" || exit 1\nexec ./panel\n`;
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
  seedDpkg(paths, f.packages, f.held);
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

/**
 * Canned answer of one read-only probe; packages and holds come from the sandbox dpkg status (seeded from the
 * scenario, changed by the fake pkg/apt-mark). Tools the phone lacks fail like runTermux (TermuxExecError).
 */
function answer(scenario: FakeScenarioName, paths: CliPaths, tool: string, args: readonly string[]): ExecResult {
  const f = FACTS[scenario];
  const name = basename(tool);
  const db = readDpkg(paths);
  if (name === "dpkg" && args[0] === "-s") {
    const pkg = args[1] ?? "";
    const want = db.get(pkg);
    return want
      ? ok(`Package: ${pkg}\nStatus: ${want} ok installed\n`)
      : { code: 1, stdout: "", stderr: `dpkg-query: package '${pkg}' is not installed\n` };
  }
  if (name === "dpkg" && args[0] === "--audit") return ok(f.audit ?? "");
  if (name === "apt-mark" && args[0] === "showhold")
    return ok(
      [...db]
        .filter(([, w]) => w === "hold")
        .map(([n]) => `${n}\n`)
        .join(""),
    );
  if (name === "cmd" && args.slice(0, 3).join(" ") === "package list packages") {
    const want = args[3] ?? "";
    return ok(
      f.apps
        .filter((a) => a.startsWith(want))
        .map((a) => `package:${a}\n`)
        .join(""),
    );
  }
  if (name === "postgres" && args[0] === "--version" && db.has("postgresql"))
    return ok(`postgres (PostgreSQL) ${FAKE_PG_MAJOR}.5\n`);
  throw new TermuxExecError(`exec ${tool} failed: fake ${scenario}: no such command`);
}

/**
 * runit as the fake runsvdir leaves it on disk (phones without a ready service set): a folder is supervised once
 * runsvdir runs; `supervise/stat` (written by the fake `sv up`) wins, else a `down` file means down.
 */
function diskSupervise(paths: CliPaths, name: string): SuperviseState | null {
  const dir = join(paths.svdir, name);
  if (!existsSync(dir) || !existsSync(probePaths(paths).daemonPid)) return null;
  const stat = join(dir, "supervise", "stat");
  const up = existsSync(stat) ? readFileSync(stat, "utf8").trim() === "run" : !existsSync(join(dir, "down"));
  return up
    ? { state: "run", pid: name === "panel" ? FAKE_PANEL_PID : FAKE_DAEMON_PID + 1 }
    : { state: "down", pid: null };
}

/**
 * Fake system: createFakeSystem; without a ready service set runit answers from disk (diskSupervise). createFakeSystem seeds
 * its home (~/.cloudflared/config.yml, pm2 run, tools): phones without user data get a separate home, so asking for
 * the adapters never turns a fresh sandbox into one with user data (C20).
 */
function fakeSystem(scenario: FakeScenarioName, root: string, paths: CliPaths): SystemAdapters {
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
    runit: {
      ...system.runit,
      list: async () => [],
      supervise: async (name) => diskSupervise(paths, name),
      control: async () => null,
    },
  };
}

/** link(2) as Termux answers it in app data (E9). */
const termuxLink = (src: string, dst: string) => {
  throw Object.assign(new Error(`EACCES: permission denied, link '${src}' -> '${dst}'`), { code: "EACCES" });
};

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
  const alive = new Set(f.services ? [FAKE_PANEL_PID, process.pid] : [process.pid]);
  const daemonPid = probePaths(paths).daemonPid;
  // a ready service set keeps createFakeSystem's runit; `sv up/restart panel` there only makes it run this version
  let restarted = false;
  const svUp = (name: string) => {
    if (f.services) restarted ||= name === "panel";
    else {
      mkdirSync(join(paths.svdir, name, "supervise"), { recursive: true });
      writeFileSync(join(paths.svdir, name, "supervise", "stat"), "run\n");
    }
  };
  let system: SystemAdapters | undefined;
  const sys = (): SystemAdapters => (system ??= fakeSystem(scenario, root, paths));
  const supervise = (name: string) => sys().runit.supervise(name);
  return {
    scenario,
    records,
    mode: "fake",
    paths,
    arch: "arm64",
    termuxEnv: { TERMUX_VERSION: "0.118.3", TERMUX_APK_RELEASE: "F_DROID" },
    freeBytes: () => FAKE_FREE_BYTES,
    link: opts.linkFails === false ? linkSync : termuxLink,
    system: sys,
    resetSystem: () => {
      system = undefined;
    },
    async exec(tool, args = [], { lcAllC, ...execOpts } = {}) {
      record("exec", [tool, ...args], childEnv(paths, execOpts.env, lcAllC));
      const canned = opts.execAnswers?.(tool, args);
      if (canned) return canned;
      if (basename(tool) === "sv" && args[0] === "status" && readDpkg(paths).has("termux-services")) {
        const svc = args[1] ?? "";
        const s = await supervise(svc);
        return ok(s?.state === "run" ? `run: ${svc}: (pid ${s.pid}) 5s\n` : `down: ${svc}: 5s\n`);
      }
      if (basename(tool) === "sv" && !readDpkg(paths).has("termux-services"))
        return answer(scenario, paths, tool, args);
      return execEffect(paths, tool, args, svUp) ?? answer(scenario, paths, tool, args);
    },
    async run(tool, args = [], { lcAllC, ...runOpts } = {}) {
      record("run", [tool, ...args], childEnv(paths, runOpts.env, lcAllC));
      return runEffect(paths, tool, args);
    },
    async fetch(url, init) {
      record("fetch", [url]);
      return (opts.fetch ?? offline)(url, init);
    },
    async health(port) {
      if (port !== PANEL_PORT) return null;
      const version = f.services ? f.version && (restarted ? pkg.version : f.version) : pkg.version;
      const up = f.services || (await supervise("panel"))?.state === "run";
      return up && version ? { version, bootId: crypto.randomUUID() } : null;
    },
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
      alive: (pid) => alive.has(pid) || (pid === FAKE_DAEMON_PID && existsSync(daemonPid)),
      exeId: (pid) => {
        if (pid !== FAKE_PANEL_PID || !f.services || !existsSync(binary)) return null;
        const s = statSync(binary);
        return f.stale && !restarted ? { dev: s.dev, ino: s.ino + 1 } : { dev: s.dev, ino: s.ino };
      },
    },
  };
}
