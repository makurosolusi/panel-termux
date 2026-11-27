// CliHost (PLAN/07 §7.1, K13, D1, D14, D15): everything the CLI asks of the phone, so tests and PANEL_CLI_FAKE swap
// one object. The CLI never uses the server's mode picker: it picks fake when `sv` is missing and logs to stdout.
import { existsSync, readdirSync, readFileSync, readlinkSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExecOptions, type ExecResult, resolveArgv, runTermux, termuxPrefix } from "../server/exec/termux.exec";
import { createTermuxSystem } from "../server/system/system.select";
import type { SystemAdapters } from "../server/system/system.types";

/** Base folders; every other probe path derives from these (probePaths). */
export type CliPaths = { home: string; prefix: string; svdir: string; logdir: string; panelDir: string };

/** Termux app variables doctor reads (`termux_source`, `pkg_manager_apt`); unset = undefined. */
export type TermuxEnv = { TERMUX_VERSION?: string; TERMUX_APK_RELEASE?: string; TERMUX_APP_PACKAGE_MANAGER?: string };

/** One process from /proc (processes whose `exe` link is unreadable, i.e. other users', are left out). */
export type ProcInfo = { pid: number; uid: number; exe: string; cmdline: string[] };

/**
 * Options of CliHost.run (D14): `inherit` = the user sees the tool (pkg, npm), `ignore` = silent (service-daemon);
 * `onLine` pipes stdout and gets each line after it is echoed to stderr (cloudflared login URL). No timeout.
 */
export type RunOptions = {
  stdio?: "inherit" | "ignore";
  env?: Record<string, string | undefined>;
  cwd?: string;
  onLine?: (line: string) => void;
};

/** Fake scenarios selectable with PANEL_CLI_FAKE (D1: `nosv` = Termux without termux-services). */
export const FAKE_SCENARIOS = ["fresh", "ready", "poco", "nosv"] as const;
/** One PANEL_CLI_FAKE scenario. */
export type FakeScenarioName = (typeof FAKE_SCENARIOS)[number];

/** What the CLI may ask of the phone. Two implementations: termux (below) and fake (cli.host.fake.ts). */
export interface CliHost {
  mode: "termux" | "fake";
  paths: CliPaths;
  arch: string;
  termuxEnv: TermuxEnv;
  /** Free bytes on the filesystem holding `path` (statfs). */
  freeBytes: (path: string) => number;
  /** System adapters for this mode, created on first call (createTermuxSystem / createFakeSystem, never the server mode picker). */
  system: () => SystemAdapters;
  /** Short probe: argv only, 10 s timeout, output captured (runTermux). Env = the scrubbed process.env (K11b). */
  exec: (tool: string, args?: readonly string[], opts?: ExecOptions) => Promise<ExecResult>;
  /** Long step with visible stdio, no timeout; resolves to the exit code (D14). */
  run: (tool: string, args?: readonly string[], opts?: RunOptions) => Promise<number>;
  tty: { isTty: boolean; confirm: (question: string) => Promise<boolean> };
  proc: { selfPid: number; uid: number; list: () => ProcInfo[]; alive: (pid: number) => boolean };
}

/** Thrown when the CLI runs outside Termux without PANEL_CLI_FAKE (exit 1). */
export class NotTermuxError extends Error {}
/** Thrown for an unknown PANEL_CLI_FAKE value (exit 2). */
export class FakeScenarioError extends Error {}

/** Files the probes and the fake agree on (one place, so the fake answers exactly what doctor reads). */
export function probePaths(p: CliPaths) {
  return {
    pkg: join(p.prefix, "bin", "pkg"),
    apt: join(p.prefix, "bin", "apt"),
    pacman: join(p.prefix, "bin", "pacman"),
    sv: join(p.prefix, "bin", "sv"),
    node: join(p.prefix, "bin", "node"),
    pm2Runtime: join(p.prefix, "lib", "node_modules", "pm2", "bin", "pm2-runtime"),
    pgVersion: join(p.prefix, "var", "lib", "postgresql", "PG_VERSION"),
    // termux-services keeps runsvdir's pid here (service-daemon); confirm on POCO in QA §9.3
    daemonPid: join(p.prefix, "var", "run", "service-daemon.pid"),
    binary: join(p.panelDir, "panel"),
    prev: join(p.panelDir, "panel.prev"),
    envFile: join(p.panelDir, ".env"),
    dataDir: join(p.panelDir, "data"),
    cloudflaredDir: join(p.home, ".cloudflared"),
    bootDir: join(p.home, ".termux", "boot"),
  };
}

/** Base paths from the environment: HOME, PREFIX, SVDIR/LOGDIR as termux-services sets them. */
export function pathsFrom(home: string, prefix: string, env: Record<string, string | undefined> = {}): CliPaths {
  return {
    home,
    prefix,
    svdir: env.SVDIR || join(prefix, "var", "service"),
    logdir: env.LOGDIR || join(prefix, "var", "log"),
    panelDir: join(home, "panel"),
  };
}

const PROC = "/proc";
// A process can exit or be another user's between readdir and read: skip those, rethrow anything else.
const GONE = new Set(["ENOENT", "ESRCH", "EACCES", "EPERM"]);

function readProc(pid: number): ProcInfo | null {
  const dir = join(PROC, String(pid));
  try {
    const uid = Number(/^Uid:\s+(\d+)/m.exec(readFileSync(join(dir, "status"), "utf8"))?.[1] ?? -1);
    const cmdline = readFileSync(join(dir, "cmdline"), "utf8").split("\0").filter(Boolean);
    return { pid, uid, exe: readlinkSync(join(dir, "exe")), cmdline };
  } catch (e) {
    if (GONE.has((e as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error(`read ${dir} failed: ${(e as Error).message}`, { cause: e });
  }
}

/** Processes visible in /proc (empty where there is no /proc, e.g. macOS). */
export function listProcs(): ProcInfo[] {
  if (!existsSync(PROC)) return [];
  return readdirSync(PROC)
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
    .sort((a, b) => a - b) // readdir order is filesystem-dependent; pids reach doctor output
    .map(readProc)
    .filter((p): p is ProcInfo => p !== null);
}

/** `kill -0`: true when `pid` exists (EPERM = exists, other user). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "ESRCH") return code === "EPERM";
    throw new Error(`kill -0 ${pid} failed: ${(e as Error).message}`, { cause: e });
  }
}

/** y/ya/yes on a line from the terminal = yes; anything else (or EOF) = no. */
export async function confirmOnTty(question: string): Promise<boolean> {
  const answer = prompt(`${question} [y/N]`);
  return /^(y|ya|yes)$/i.test(answer?.trim() ?? "");
}

/** Runs a Termux tool with stdio per RunOptions; spawn failure throws with the command name (Rule 11). */
export async function runVisible(tool: string, args: readonly string[] = [], opts: RunOptions = {}): Promise<number> {
  const argv = resolveArgv(tool, args);
  const stdio = opts.stdio ?? "inherit";
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(argv, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdin: stdio,
      stdout: opts.onLine ? "pipe" : stdio,
      stderr: stdio,
    });
  } catch (e) {
    throw new Error(`run ${tool} failed to spawn: ${(e as Error).message}`, { cause: e });
  }
  if (opts.onLine && proc.stdout instanceof ReadableStream) {
    let rest = "";
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        process.stderr.write(`${line}\n`);
        opts.onLine(line);
      }
    }
    if (rest) opts.onLine(rest);
  }
  return proc.exited;
}

/** Real Termux host. */
export function createTermuxHost(): CliHost {
  const home = process.env.HOME || homedir();
  let system: SystemAdapters | undefined;
  return {
    mode: "termux",
    paths: pathsFrom(home, termuxPrefix(), process.env),
    arch: process.arch,
    termuxEnv: process.env as TermuxEnv,
    freeBytes: (path) => {
      const s = statfsSync(path);
      return s.bavail * s.bsize;
    },
    system: () => (system ??= createTermuxSystem()),
    exec: (tool, args, opts) => runTermux(tool, args, opts),
    run: (tool, args, opts) => runVisible(tool, args, opts),
    tty: { isTty: process.stdin.isTTY === true, confirm: confirmOnTty },
    proc: { selfPid: process.pid, uid: process.getuid?.() ?? -1, list: listProcs, alive: pidAlive },
  };
}

/**
 * Mode detection (K13, D1): PANEL_CLI_FAKE → fake host; else Termux when `$PREFIX/bin/pkg` or `apt` exists or
 * TERMUX_VERSION is set (no `sv` needed: a bare Termux has none); else NotTermuxError. Reads process.env.
 */
export async function detectCliHost(): Promise<CliHost> {
  const fake = process.env.PANEL_CLI_FAKE;
  if (fake) {
    if (!(FAKE_SCENARIOS as readonly string[]).includes(fake))
      throw new FakeScenarioError(`PANEL_CLI_FAKE="${fake}" tidak dikenal (pilihan: ${FAKE_SCENARIOS.join(", ")})`);
    const { createFakeHost } = await import("./cli.host.fake");
    return createFakeHost(fake as FakeScenarioName, { recordFile: process.env.PANEL_CLI_FAKE_RECORD });
  }
  const p = probePaths(pathsFrom("", termuxPrefix()));
  if (existsSync(p.pkg) || existsSync(p.apt) || process.env.TERMUX_VERSION) return createTermuxHost();
  throw new NotTermuxError(`Ini bukan Termux: ${p.pkg} dan ${p.apt} tidak ada, TERMUX_VERSION tidak diset`);
}
