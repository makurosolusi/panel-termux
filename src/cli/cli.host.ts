// CliHost (PLAN/07 §7.1, K13, D1, D14, D15): everything the CLI asks of the phone, so tests and PANEL_CLI_FAKE swap
// one object. The CLI never uses the server's mode picker: it picks fake when `sv` is missing and logs to stdout.
import { existsSync, linkSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExecOptions, type ExecResult, resolveArgv, runTermux, termuxPrefix } from "../server/exec/termux.exec";
import { createTermuxSystem } from "../server/system/system.select";
import type { SystemAdapters } from "../server/system/system.types";
import { ENV_VARS } from "../shared/env.schema";
import type { LinkFn } from "../shared/file.link";
import { listProcs, localHealth, pidAlive, procExeId } from "./cli.host.proc";
import { tr } from "./cli.locale";
import { ttyAsk, ttySecret } from "./cli.prompt";

/** Base folders; every other probe path derives from these (probePaths). */
export type CliPaths = { home: string; prefix: string; svdir: string; logdir: string; panelDir: string };

/** Termux app variables doctor reads (`termux_source`, `pkg_manager_apt`); unset = undefined. */
export type TermuxEnv = { TERMUX_VERSION?: string; TERMUX_APK_RELEASE?: string; TERMUX_APP_PACKAGE_MANAGER?: string };

/** One process from /proc (processes whose `exe` link is unreadable, i.e. other users', are left out). */
export type ProcInfo = { pid: number; uid: number; exe: string; cmdline: string[] };

/**
 * Options of CliHost.run (D14): `inherit` = the user sees the tool (pkg, npm), `ignore` = silent (service-daemon);
 * `onLine` pipes stdout and stderr and gets each line after it is echoed to stderr (cloudflared login URL). No timeout.
 */
export type RunOptions = {
  stdio?: "inherit" | "ignore";
  env?: Record<string, string | undefined>;
  cwd?: string;
  onLine?: (line: string) => void;
  /** Kills the child after this many ms; `runVisible` then returns RUN_TIMEOUT_EXIT. */
  timeoutMs?: number;
  /** `LC_ALL=C` for the child: apt/dpkg output parsed by the CLI must not be translated (lab L8). */
  lcAllC?: boolean;
};

/** CliHost.exec options: runTermux's plus `lcAllC` (see RunOptions). */
export type CliExecOptions = ExecOptions & { lcAllC?: boolean };

/** /api/health of the local panel (K20): the running version and its boot id. */
export type PanelHealth = { version: string; bootId?: unknown };

/** Device + inode of a file (K21: is the process runit supervises this very file?). */
export type FileId = { dev: number; ino: number };

/**
 * Fake scenarios selectable with PANEL_CLI_FAKE (D1: `nosv` = Termux without termux-services). 0.5.1 init (PLAN/07
 * §16 W0): `upgrade` = older panel installed, `downgrade` = newer one, `fresh-pg` = fresh + PostgreSQL data,
 * `fresh-resume` = interrupted fresh install (binary + panel service, no user data), `upgrade-partial` = this binary
 * already installed but runit still runs the old file.
 */
export const FAKE_SCENARIOS = [
  "fresh",
  "ready",
  "poco",
  "nosv",
  "upgrade",
  "downgrade",
  "fresh-pg",
  "fresh-resume",
  "upgrade-partial",
] as const;
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
  /** link(2) for linkOrCopy (E9: Termux refuses it with EACCES; the fake does too unless `linkFails: false`). */
  link: LinkFn;
  /** System adapters for this mode, created on first call (createTermuxSystem / createFakeSystem, never the server mode picker). */
  system: () => SystemAdapters;
  /** Drops the cached adapters so the next system() sees tools installed meanwhile (K13: after the package step). */
  resetSystem: () => void;
  /**
   * Short probe: argv only, 10 s timeout, output captured (runTermux). Child env = childEnv(): no ENV_VARS keys
   * (K11b), SVDIR/LOGDIR always explicit (lab: empty in a non-login ssh), LC_ALL=C with `lcAllC`.
   */
  exec: (tool: string, args?: readonly string[], opts?: CliExecOptions) => Promise<ExecResult>;
  /** Long step with visible stdio, no timeout; resolves to the exit code (D14). Child env as in exec. */
  run: (tool: string, args?: readonly string[], opts?: RunOptions) => Promise<number>;
  /** HTTPS for init's self check (K19); the fake answers canned responses and records the URL. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** GET 127.0.0.1:<port>/api/health, 1 s; null = not answering (K20). */
  health: (port: number) => Promise<PanelHealth | null>;
  /** This running binary (process.execPath; the fake may point it elsewhere): what init would install. */
  selfPath: string;
  /**
   * Terminal questions. `confirm` default = `defaultYes` (Enter); `ask` = one visible line, `secret` = no echo;
   * both null at EOF. `ask` also reads one stdin line when there is no TTY (`--ssh-key -`).
   */
  tty: {
    isTty: boolean;
    confirm: (question: string, defaultYes?: boolean) => Promise<boolean>;
    ask: (question: string) => Promise<string | null>;
    secret: (question: string) => Promise<string | null>;
  };
  proc: {
    selfPid: number;
    uid: number;
    list: () => ProcInfo[];
    alive: (pid: number) => boolean;
    /** dev+ino of /proc/<pid>/exe's target; null when unreadable or gone (K21, C21). */
    exeId: (pid: number) => FileId | null;
  };
}

/** Thrown when the CLI runs outside Termux without PANEL_CLI_FAKE (exit 1). */
export class NotTermuxError extends Error {}
/** Thrown for an unknown PANEL_CLI_FAKE value or a malformed PANEL_CLI_FAKE_ANSWERS (exit 2). */
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

/** y/ya/yes = yes, n/no/tidak = no, empty line = `defaultYes`; anything else (or EOF) = no. */
export function confirmAnswer(answer: string | null, defaultYes = false): boolean {
  const a = answer?.trim() ?? null;
  if (a === "") return defaultYes;
  return /^(y|ya|yes)$/i.test(a ?? "");
}

/** Asks on the terminal with `[Y/n]` or `[y/N]` (the capital letter = what Enter means). */
export async function confirmOnTty(question: string, defaultYes = false): Promise<boolean> {
  return confirmAnswer(await ttyAsk(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"}`), defaultYes);
}

/**
 * Env of every CLI child: `base` (default the already scrubbed process.env) without ENV_VARS keys (K11b, also when
 * a caller passes its own env), SVDIR/LOGDIR from `paths`, and LC_ALL=C when asked.
 */
export function childEnv(
  paths: CliPaths,
  base: Record<string, string | undefined> = process.env,
  lcAllC = false,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base, SVDIR: paths.svdir, LOGDIR: paths.logdir };
  for (const v of ENV_VARS) delete env[v.name];
  if (lcAllC) env.LC_ALL = "C";
  return env;
}

/** Echoes every line of `stream` to our stderr (the user sees it) and hands it to `onLine`; the last one too. */
async function eachLine(stream: ReadableStream, onLine: (line: string) => void): Promise<void> {
  let rest = "";
  const emit = (line: string) => {
    process.stderr.write(`${line}\n`);
    onLine(line);
  };
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) emit(line);
  }
  if (rest) emit(rest);
}

/** Exit code `runVisible` returns for a child killed by `timeoutMs` (same as coreutils `timeout`). */
export const RUN_TIMEOUT_EXIT = 124;

/**
 * Runs a Termux tool with stdio per RunOptions; spawn failure throws with the command name (Rule 11). With `onLine`
 * both stdout and stderr are piped: cloudflared prints its login URL on stderr.
 */
export async function runVisible(tool: string, args: readonly string[] = [], opts: RunOptions = {}): Promise<number> {
  const argv = resolveArgv(tool, args);
  const stdio = opts.stdio ?? "inherit";
  const out = opts.onLine ? "pipe" : stdio;
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(argv, { env: opts.env ?? process.env, cwd: opts.cwd, stdin: stdio, stdout: out, stderr: out });
  } catch (e) {
    throw new Error(`run ${tool} failed to spawn: ${(e as Error).message}`, { cause: e });
  }
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs)
    : undefined;
  const { onLine } = opts;
  try {
    if (onLine)
      await Promise.all(
        [proc.stdout, proc.stderr].map((s) => (s instanceof ReadableStream ? eachLine(s, onLine) : undefined)),
      );
    const code = await proc.exited;
    return timedOut ? RUN_TIMEOUT_EXIT : code;
  } finally {
    clearTimeout(timer);
  }
}

/** Real Termux host. */
export function createTermuxHost(): CliHost {
  const home = process.env.HOME || homedir();
  const paths = pathsFrom(home, termuxPrefix(), process.env);
  let system: SystemAdapters | undefined;
  return {
    mode: "termux",
    paths,
    arch: process.arch,
    termuxEnv: process.env as TermuxEnv,
    freeBytes: (path) => {
      const s = statfsSync(path);
      return s.bavail * s.bsize;
    },
    link: linkSync,
    system: () => (system ??= createTermuxSystem()),
    resetSystem: () => {
      system = undefined;
    },
    exec: (tool, args, { lcAllC, ...opts } = {}) =>
      runTermux(tool, args, { ...opts, env: childEnv(paths, opts.env, lcAllC) }),
    run: (tool, args, { lcAllC, ...opts } = {}) =>
      runVisible(tool, args, { ...opts, env: childEnv(paths, opts.env, lcAllC) }),
    fetch: (url, init) => fetch(url, init),
    health: localHealth,
    selfPath: process.execPath,
    tty: {
      isTty: process.stdin.isTTY === true,
      confirm: confirmOnTty,
      ask: ttyAsk,
      secret: ttySecret,
    },
    proc: {
      selfPid: process.pid,
      uid: process.getuid?.() ?? -1,
      list: listProcs,
      alive: pidAlive,
      exeId: procExeId,
    },
  };
}

/** PANEL_CLI_FAKE_ANSWERS: a JSON array of strings/booleans/null (FakeAnswer); unset = none, anything else exit 2. */
function fakeAnswers(json: string | undefined): (string | boolean | null)[] | undefined {
  if (!json) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch (e) {
    const why = (e as Error).message;
    throw new FakeScenarioError(
      tr(`PANEL_CLI_FAKE_ANSWERS is not JSON: ${why}`, `PANEL_CLI_FAKE_ANSWERS bukan JSON: ${why}`),
    );
  }
  const answer = (a: unknown) => a === null || typeof a === "string" || typeof a === "boolean";
  if (!Array.isArray(v) || !v.every(answer))
    throw new FakeScenarioError(
      tr(
        "PANEL_CLI_FAKE_ANSWERS must be a JSON array of text, true/false or null",
        "PANEL_CLI_FAKE_ANSWERS harus array JSON berisi teks, true/false atau null",
      ),
    );
  return v;
}

/**
 * Mode detection (K13, D1): PANEL_CLI_FAKE → fake host; else Termux when `$PREFIX/bin/pkg` or `apt` exists or
 * TERMUX_VERSION is set (no `sv` needed: a bare Termux has none); else NotTermuxError. Reads process.env.
 */
export async function detectCliHost(): Promise<CliHost> {
  const fake = process.env.PANEL_CLI_FAKE;
  if (fake) {
    if (!(FAKE_SCENARIOS as readonly string[]).includes(fake))
      throw new FakeScenarioError(
        tr(
          `PANEL_CLI_FAKE="${fake}" is unknown (choices: ${FAKE_SCENARIOS.join(", ")})`,
          `PANEL_CLI_FAKE="${fake}" tidak dikenal (pilihan: ${FAKE_SCENARIOS.join(", ")})`,
        ),
      );
    const { createFakeHost } = await import("./cli.host.fake");
    const answers = fakeAnswers(process.env.PANEL_CLI_FAKE_ANSWERS);
    // scripted answers stand in for a terminal (shell tests run with stdin </dev/null)
    return createFakeHost(fake as FakeScenarioName, {
      recordFile: process.env.PANEL_CLI_FAKE_RECORD,
      ...(answers ? { answers, tty: true } : {}),
    });
  }
  const p = probePaths(pathsFrom("", termuxPrefix()));
  if (existsSync(p.pkg) || existsSync(p.apt) || process.env.TERMUX_VERSION) return createTermuxHost();
  throw new NotTermuxError(
    tr(
      `This is not Termux: ${p.pkg} and ${p.apt} are missing, TERMUX_VERSION is not set`,
      `Ini bukan Termux: ${p.pkg} dan ${p.apt} tidak ada, TERMUX_VERSION tidak diset`,
    ),
  );
}
