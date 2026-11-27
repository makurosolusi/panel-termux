// Doctor facts (PLAN/07 §3.1, §3.3): everything doctor and (0.5.1) init need to know about the phone, gathered
// read-only through CliHost + SystemAdapters. No file is created or written here (K12); `.env` values stay in memory.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { TermuxExecError } from "../server/exec/termux.exec";
import type { SuperviseState } from "../server/system/system.types";
import { ENV_VARS } from "../shared/env.schema";
import { type CliExecOptions, type CliHost, type ProcInfo, probePaths } from "./cli.host";
import { type EnvFileValues, readEnvFile } from "./env.file";

/** dpkg packages doctor asks about. */
export const PROBED_PACKAGES = ["termux-services", "cloudflared", "postgresql", "termux-api"] as const;
/** dpkg state of a package: `broken` = present but not fully installed (half-installed, unpacked, …). */
export type PackageState = "installed" | "broken" | "missing";
/** Packages that must be held (`apt-mark hold`, C15). */
export const HELD_PACKAGES = ["cloudflared", "postgresql"] as const;
/** Android apps checked with `cmd package list packages`. */
export const ANDROID_APPS = { boot: "com.termux.boot", api: "com.termux.api" } as const;
/** runit services doctor reports. */
export const SERVICES = ["panel", "pm2", "cloudflared", "postgres"] as const;
/** Binary names that are a panel server process (PLAN/07 §3.1 `panel_instances`). */
const PANEL_BINARIES = new Set(["panel", "panel.prev", "panel.new", "panel-android-arm64"]);
/** CLI subcommands: a process running one of them is not a server. */
const CLI_COMMANDS = new Set(["doctor", "docs", "env", "rollback", "init", "upgrade", "help"]);
/** Bun loads these from the cwd and they override `.env` (debate D8). */
const EXTRA_ENV = /^\.env\.(local|development|production|test|.+\.local)$/;
/** A Termux:Boot script that starts termux-services (doctor's check and init's boot step). */
export const BOOT_STARTS_SERVICES = /service-daemon|ensure-services|start-services/;
const PANEL_HEALTH_TIMEOUT_MS = 3000;
const CMD_TIMEOUT_MS = 5000;
const CMD = "/system/bin/cmd";
const DEFAULT_PORT = Number(ENV_VARS.find((v) => v.name === "PORT")?.default);
const DEFAULT_DATA_DIR = ENV_VARS.find((v) => v.name === "PANEL_DATA_DIR")?.default ?? "data";

/** Everything doctor checks, as plain facts (null = could not be determined). */
export type DoctorProbe = {
  mode: CliHost["mode"];
  arch: string;
  termuxEnv: CliHost["termuxEnv"];
  isTermux: boolean;
  freeBytes: number | null;
  files: { apt: boolean; pacman: boolean; node: boolean; pm2Runtime: boolean; binary: boolean; cfCert: boolean };
  packages: Record<(typeof PROBED_PACKAGES)[number], PackageState>;
  held: string[] | null;
  apps: Record<keyof typeof ANDROID_APPS, boolean | null>;
  pgDataMajor: string | null;
  pgBinMajor: string | null;
  daemonAlive: boolean;
  services: Record<(typeof SERVICES)[number], SuperviseState | null>;
  cfDownFile: boolean;
  cfRunScript: string | null;
  cfConfig: string | null;
  env: EnvFileValues | null;
  port: number;
  dataDir: string;
  envExtraFiles: string[];
  dataDirMode: number | null;
  panelProcs: ProcInfo[];
  panelHealth: number | null;
  /** Host of APP_BASE_URL when it is a public https URL, and its GET status (null = unreachable). */
  publicHost: string | null;
  publicStatus: number | null;
  bootScript: boolean;
};

// Missing file, or a folder where a file was expected (a boot dir entry): no content.
const UNREADABLE = new Set(["ENOENT", "EISDIR"]);
const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (UNREADABLE.has((e as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error(`doctor: read ${file} failed: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`, {
      cause: e,
    });
  }
};
// Sorted: readdir order is filesystem-dependent and these names reach doctor output and --json.
const listOrEmpty = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);

/** `exec` that turns a missing tool or timeout into null (a probe answer, not a doctor failure). */
async function tryExec(host: CliHost, tool: string, args: string[], opts: CliExecOptions = {}) {
  try {
    return await host.exec(tool, args, opts);
  } catch (e) {
    if (e instanceof TermuxExecError) return null; // missing command / timeout: the check reports "unknown"
    throw e;
  }
}

/** `dpkg -s` (LC_ALL=C, L8) `Status: <want> <flag> <state>`: `hold ok installed` is installed; no dpkg = missing. */
export async function dpkgState(host: CliHost, pkg: string): Promise<PackageState> {
  const r = await tryExec(host, "dpkg", ["-s", pkg], { lcAllC: true });
  const status = r?.code === 0 ? /^Status: (\S+) (\S+) (\S+)$/m.exec(r.stdout) : null;
  if (!status || status[3] === "not-installed" || status[3] === "config-files") return "missing";
  return status[2] === "ok" && status[3] === "installed" ? "installed" : "broken";
}

async function androidApp(host: CliHost, id: string): Promise<boolean | null> {
  const r = await tryExec(host, CMD, ["package", "list", "packages", id], { timeoutMs: CMD_TIMEOUT_MS });
  if (r?.code !== 0) return null;
  return r.stdout.split("\n").some((l) => l.trim() === `package:${id}`);
}

async function pgBinMajor(host: CliHost): Promise<string | null> {
  const r = await tryExec(host, "postgres", ["--version"]);
  return r?.code === 0 ? (/\)\s*(\d+)/.exec(r.stdout)?.[1] ?? null) : null;
}

/** Server processes of this user other than doctor itself (cmdline without a CLI command, or `serve`). */
function panelProcs(host: CliHost): ProcInfo[] {
  return host.proc.list().filter((p) => {
    if (p.pid === host.proc.selfPid || p.uid !== host.proc.uid) return false;
    const name = p.exe.split("/").pop() ?? "";
    return PANEL_BINARIES.has(name) && !CLI_COMMANDS.has(p.cmdline[1] ?? "serve");
  });
}

function daemonAlive(host: CliHost, pidFile: string): boolean {
  const pid = Number(readOrNull(pidFile)?.trim());
  return Number.isInteger(pid) && pid > 0 && host.proc.alive(pid);
}

/** Hostname of an https APP_BASE_URL (not localhost), else null. */
function publicHostOf(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  const u = new URL(url);
  return u.protocol === "https:" && u.hostname !== "localhost" ? u.hostname : null;
}

function modeOf(dir: string): number | null {
  try {
    return statSync(dir).mode & 0o777;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`doctor: stat ${dir} failed: ${(e as Error).message}`, { cause: e });
  }
}

/** Gathers every DoctorProbe fact; independent probes run in parallel. Never writes. */
export async function collectDoctorProbe(host: CliHost): Promise<DoctorProbe> {
  const { paths } = host;
  const p = probePaths(paths);
  const system = host.system();
  const env = readEnvFile(p.envFile);
  const port = Number(env?.PORT?.trim() || DEFAULT_PORT);
  const svc = (name: string) => join(paths.svdir, name);
  const publicHost = publicHostOf(env?.APP_BASE_URL);
  const [packages, held, boot, api, binMajor, services, health, pub] = await Promise.all([
    Promise.all(PROBED_PACKAGES.map(async (k) => [k, await dpkgState(host, k)] as const)),
    tryExec(host, "apt-mark", ["showhold"]),
    androidApp(host, ANDROID_APPS.boot),
    androidApp(host, ANDROID_APPS.api),
    pgBinMajor(host),
    Promise.all(SERVICES.map(async (s) => [s, await system.runit.supervise(s)] as const)),
    Number.isInteger(port) ? system.net.httpStatus(port, "/api/health", PANEL_HEALTH_TIMEOUT_MS) : null,
    publicHost ? system.cloudflared.probe(publicHost) : null,
  ]);
  const dataDir = resolve(paths.panelDir, env?.PANEL_DATA_DIR?.trim() || DEFAULT_DATA_DIR);
  return {
    mode: host.mode,
    arch: host.arch,
    termuxEnv: host.termuxEnv,
    isTermux: existsSync(p.pkg) || existsSync(p.apt) || Boolean(host.termuxEnv.TERMUX_VERSION),
    freeBytes: existsSync(paths.home) ? host.freeBytes(paths.home) : null,
    files: {
      apt: existsSync(p.apt),
      pacman: existsSync(p.pacman),
      node: existsSync(p.node),
      pm2Runtime: existsSync(p.pm2Runtime),
      binary: existsSync(p.binary),
      cfCert: existsSync(join(p.cloudflaredDir, "cert.pem")),
    },
    packages: Object.fromEntries(packages) as DoctorProbe["packages"],
    held:
      held?.code === 0
        ? held.stdout
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        : null,
    apps: { boot, api },
    pgDataMajor: readOrNull(p.pgVersion)?.trim().split(".")[0] || null,
    pgBinMajor: binMajor,
    daemonAlive: daemonAlive(host, p.daemonPid),
    services: Object.fromEntries(services) as DoctorProbe["services"],
    cfDownFile: existsSync(join(svc("cloudflared"), "down")),
    cfRunScript: readOrNull(join(svc("cloudflared"), "run")),
    cfConfig: readOrNull(join(p.cloudflaredDir, "config.yml")),
    env,
    port,
    dataDir,
    envExtraFiles: listOrEmpty(paths.panelDir).filter((n) => EXTRA_ENV.test(n)),
    dataDirMode: modeOf(dataDir),
    panelProcs: panelProcs(host),
    panelHealth: health,
    publicHost,
    publicStatus: pub?.status ?? null,
    bootScript: listOrEmpty(p.bootDir).some((n) => BOOT_STARTS_SERVICES.test(readOrNull(join(p.bootDir, n)) ?? "")),
  };
}
