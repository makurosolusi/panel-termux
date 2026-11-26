import { homedir } from "node:os";
import { join } from "node:path";
import type { App, AppStatus, ControlAction, LogStream } from "../../shared/panel.types";
import { PM2_GUARD_NAME } from "../../shared/site.types";
import { runTermux } from "../exec/termux.exec";
import { tailFile } from "./file.tail";
import { unixSocketAlive } from "./net.termux";
import { type Pm2Adapter, type Pm2Proc, Pm2UnavailableError, SystemError } from "./system.types";

export type { Pm2Proc } from "./system.types";

const BYTES_PER_MB = 1024 * 1024;
const MS_PER_SEC = 1000;
/** `pm2 jlist` boots node + talks RPC; slow phones need a few seconds. */
const PM2_TIMEOUT_MS = 20_000;

const STATUS: Record<string, AppStatus> = {
  online: "online",
  stopped: "stopped",
  stopping: "stopped",
  errored: "errored",
  launching: "launching",
  "waiting restart": "launching",
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

function portOf(env: Record<string, unknown>): number | null {
  const p = Number(env.PORT);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : null;
}

const HOST_PORT_ARG = /^(?:[\w.-]+|\[[\da-fA-F:]+\]):(\d{2,5})$/;
const PORT_EQ_ARG = /^--port=(\d{2,5})$/;

/** Port from app args: `-S 127.0.0.1:8080` (php), `--port 3000`, `--port=3000`, `-p 3000`. */
export function portFromArgs(args: readonly string[]): number | null {
  for (const [i, a] of args.entries()) {
    const m = a.match(HOST_PORT_ARG) ?? a.match(PORT_EQ_ARG);
    const raw = m ? m[1] : a === "--port" || a === "-p" ? args[i + 1] : undefined;
    const p = portOf({ PORT: raw });
    if (p !== null) return p;
  }
  return null;
}

/**
 * Parses `pm2 jlist` stdout, keeping only whitelisted fields (the raw JSON carries each app's env,
 * i.e. secrets). pm2 may print warning lines before the JSON, so the last line starting with `[` is used.
 * Parse errors never include the raw text.
 */
export function parsePm2Jlist(stdout: string, nowMs = Date.now()): Pm2Proc[] {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("[{") || l.trim() === "[]");
  if (line === undefined) throw new SystemError("pm2 jlist: no JSON array in output");
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch (e) {
    throw new SystemError(`pm2 jlist: invalid JSON (${(e as Error).name})`);
  }
  if (!Array.isArray(data)) throw new SystemError("pm2 jlist: output is not an array");
  return data.map((raw): Pm2Proc => {
    const p = obj(raw);
    const env = obj(p.pm2_env);
    const monit = obj(p.monit);
    const status = STATUS[String(env.status)] ?? "unknown";
    const online = status === "online";
    const pid = num(p.pid);
    const mem = num(monit.memory);
    const started = num(env.pm_uptime);
    const name = String(p.name ?? "");
    const args = Array.isArray(env.args) ? env.args.filter((x): x is string => typeof x === "string") : [];
    return {
      name,
      status,
      pid: pid && pid > 0 ? pid : null,
      memoryMb: online && mem !== null ? Math.round((mem / BYTES_PER_MB) * 10) / 10 : null,
      // Android hides other processes' /proc/<pid>/stat, so pm2's cpu figure is meaningless there.
      cpu: null,
      restarts: num(env.restart_time) ?? 0,
      uptimeSec: online && started ? Math.max(0, Math.floor((nowMs - started) / MS_PER_SEC)) : null,
      // Env PORT first; otherwise the listen address in args (on Android /proc/net/tcp is EACCES).
      port: portOf(obj(env.env)) ?? portOf(env) ?? portFromArgs(args),
      module: env.pmx_module === true || name === PM2_GUARD_NAME,
      outLog: str(env.pm_out_log_path),
      errLog: str(env.pm_err_log_path),
      cwd: str(env.pm_cwd),
      execPath: str(env.pm_exec_path),
      args,
      startedAtMs: started,
    };
  });
}

/** Public view of a process (drops paths, script and args). */
export const toApp = ({
  outLog: _o,
  errLog: _e,
  cwd: _c,
  execPath: _x,
  args: _a,
  startedAtMs: _s,
  ...app
}: Pm2Proc): App => app;

/** Options of createTermuxPm2. `isSupervisorUp`: runit `pm2` is `run` (true/false), or null when no such service. */
export type TermuxPm2Options = { pm2Home?: string; isSupervisorUp?: () => Promise<boolean | null> };

/**
 * Real pm2 adapter. It never starts a pm2 daemon: any pm2 CLI call without a reachable daemon spawns one outside
 * runit, so before each call it throws Pm2UnavailableError when runit `pm2` is not `run` ("service_down") or
 * `$PM2_HOME/rpc.sock` does not accept connections (missing or stale after a crash: "no_daemon").
 */
export function createTermuxPm2({
  pm2Home = process.env.PM2_HOME || join(homedir(), ".pm2"),
  isSupervisorUp = async () => null,
}: TermuxPm2Options = {}): Pm2Adapter {
  async function pm2(args: string[]): Promise<string> {
    if ((await isSupervisorUp()) === false) throw new Pm2UnavailableError("service_down");
    if (!(await unixSocketAlive(join(pm2Home, "rpc.sock")))) throw new Pm2UnavailableError("no_daemon");
    const r = await runTermux("pm2", args, { timeoutMs: PM2_TIMEOUT_MS });
    if (r.code !== 0) throw new SystemError(`pm2 ${args[0]} exited ${r.code}`);
    return r.stdout;
  }

  const procs = async (): Promise<Pm2Proc[]> => parsePm2Jlist(await pm2(["jlist"]));

  const find = async (name: string) => (await procs()).find((p) => p.name === name) ?? null;

  return {
    async list() {
      return (await procs()).map(toApp);
    },
    procs,
    async control(name: string, action: ControlAction) {
      if (!(await find(name))) return null;
      await pm2([action, name]);
      const p = await find(name);
      return p ? toApp(p) : null;
    },
    async readLog(name: string, stream: LogStream, lines: number) {
      const p = await find(name);
      if (!p) return null;
      const fallback = join(pm2Home, "logs", `${name}-${stream === "out" ? "out" : "error"}.log`);
      const path = (stream === "out" ? p.outLog : p.errLog) ?? fallback;
      return (await tailFile(path, lines)) ?? [];
    },
    async remove(name: string) {
      if (!(await find(name))) return false;
      await pm2(["delete", name]);
      return true;
    },
    async startFromEcosystem(ecosystem: string, name: string) {
      await pm2(["start", ecosystem, "--only", name]);
      const p = await find(name);
      return p ? toApp(p) : null;
    },
  };
}
