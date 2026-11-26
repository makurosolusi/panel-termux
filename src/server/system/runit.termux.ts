import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ControlAction, ServiceState } from "../../shared/panel.types";
import { runTermux, termuxPrefix } from "../exec/termux.exec";
import { tailFile } from "./file.tail";
import { type RunitAdapter, type RunitService, SystemError } from "./system.types";

const STATUS_LINE = /^(run|down|finish|fail|warning): ([^:]+): (.*)$/;
const PID_UPTIME = /^\(pid (\d+)\) (\d+)s/;
const DOWN_SECS = /^(\d+)s/;
/** Service directory names under SVDIR (no path separators, no dot entries). */
const SERVICE_NAME_RE = /^(?!\.{1,2}$)[\w.@-]+$/;
/** sv waits up to 7 s for the state change by default; leave headroom. */
const SV_TIMEOUT_MS = 15_000;

/**
 * Parses `sv status` output (one line per service, e.g. `run: sshd: (pid 12) 34s; run: log: ...`).
 * Only the main service part (before `;`) counts; `fail:`/`warning:` lines become state "unknown".
 */
export function parseSvStatus(stdout: string): RunitService[] {
  const out: RunitService[] = [];
  for (const raw of stdout.split("\n")) {
    const m = raw.split(";")[0]?.trim().match(STATUS_LINE);
    if (!m) continue;
    const [, kind, path, rest] = m as unknown as [string, string, string, string];
    const name = path.split("/").pop() ?? path;
    if (kind === "fail" || kind === "warning") {
      out.push({ name, state: "unknown", pid: null, uptimeSec: null, downSec: null, wantUp: false });
      continue;
    }
    const state = kind as ServiceState;
    const pu = rest.match(PID_UPTIME);
    const down = state === "down" ? rest.match(DOWN_SECS) : null;
    const running = state === "run" || state === "finish";
    const wantUp = rest.includes("want up") ? true : rest.includes("want down") ? false : running;
    out.push({
      name,
      state,
      pid: pu ? Number(pu[1]) : null,
      uptimeSec: state === "run" && pu ? Number(pu[2]) : null,
      downSec: down ? Number(down[1]) : null,
      wantUp,
    });
  }
  return out;
}

/** Parses runsv `supervise/stat` ("run", "down", "finish", optionally followed by ", want up" etc.). */
export function parseSuperviseStat(text: string): ServiceState {
  const word = text.trim().split(",")[0];
  return word === "run" || word === "down" || word === "finish" ? word : "unknown";
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SystemError(`read ${path}: ${(e as Error).message}`, { cause: e });
  }
}

/** Real runit adapter: `sv` with SVDIR=$PREFIX/var/service, logs from $PREFIX/var/log/sv/<name>/current. */
export function createTermuxRunit(prefix = termuxPrefix()): RunitAdapter {
  const svdir = join(prefix, "var", "service");
  const env = { ...process.env, SVDIR: svdir };
  const exists = (name: string) => existsSync(join(svdir, name));

  async function sv(args: string[]): Promise<string> {
    const r = await runTermux("sv", args, { env, timeoutMs: SV_TIMEOUT_MS });
    // `sv status` exits non-zero when any service fails; its stdout is still meaningful.
    if (r.code !== 0 && args[0] !== "status") {
      throw new SystemError(`sv ${args.join(" ")} exited ${r.code}: ${(r.stdout + r.stderr).trim().slice(0, 300)}`);
    }
    return r.stdout;
  }

  async function status(names: string[]): Promise<RunitService[]> {
    if (names.length === 0) return [];
    return parseSvStatus(await sv(["status", ...names]));
  }

  return {
    async list() {
      let names: string[];
      try {
        names = readdirSync(svdir, { withFileTypes: true })
          .filter((d) => d.isDirectory() || d.isSymbolicLink())
          .map((d) => d.name)
          .sort();
      } catch (e) {
        throw new SystemError(`list runit services in ${svdir}: ${(e as Error).message}`, { cause: e });
      }
      return status(names);
    },
    async supervise(name: string) {
      if (!SERVICE_NAME_RE.test(name) || !exists(name)) return null;
      const dir = join(svdir, name, "supervise");
      const [stat, pid] = await Promise.all([readOptional(join(dir, "stat")), readOptional(join(dir, "pid"))]);
      // No stat file = runsv is not supervising this directory, so nothing runs it.
      const state = stat === null ? "unknown" : parseSuperviseStat(stat);
      const n = Number(pid?.trim());
      return { state, pid: state === "run" && Number.isInteger(n) && n > 0 ? n : null };
    },
    async control(name: string, action: ControlAction) {
      if (!exists(name)) return null;
      await sv([action, name]);
      return (await status([name]))[0] ?? null;
    },
    async readLog(name: string, lines: number) {
      if (!exists(name)) return null;
      return (await tailFile(join(prefix, "var", "log", "sv", name, "current"), lines)) ?? [];
    },
  };
}
