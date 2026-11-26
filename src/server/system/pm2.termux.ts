import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { App, AppStatus, ControlAction, LogStream } from "../../shared/panel.types";
import { runTermux } from "../exec/termux.exec";
import { tailFile } from "./file.tail";
import { type Pm2Adapter, SystemError } from "./system.types";

/** App plus its log paths (internal; paths are never sent to clients). */
export type Pm2Proc = App & { outLog: string | null; errLog: string | null };

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
    return {
      name: String(p.name ?? ""),
      status,
      pid: pid && pid > 0 ? pid : null,
      memoryMb: online && mem !== null ? Math.round((mem / BYTES_PER_MB) * 10) / 10 : null,
      cpu: online ? num(monit.cpu) : null,
      restarts: num(env.restart_time) ?? 0,
      uptimeSec: online && started ? Math.max(0, Math.floor((nowMs - started) / MS_PER_SEC)) : null,
      // Env PORT first; otherwise the listen address in args (on Android /proc/net/tcp is EACCES).
      port:
        portOf(obj(env.env)) ??
        portOf(env) ??
        portFromArgs(Array.isArray(env.args) ? env.args.filter((x): x is string => typeof x === "string") : []),
      outLog: str(env.pm_out_log_path),
      errLog: str(env.pm_err_log_path),
    };
  });
}

const toApp = ({ outLog: _o, errLog: _e, ...app }: Pm2Proc): App => app;

/** Real pm2 adapter. Never starts a pm2 daemon: without `$PM2_HOME/rpc.sock` the app list is empty. */
export function createTermuxPm2(pm2Home = process.env.PM2_HOME || join(homedir(), ".pm2")): Pm2Adapter {
  async function pm2(args: string[]): Promise<string> {
    const r = await runTermux("pm2", args, { timeoutMs: PM2_TIMEOUT_MS });
    if (r.code !== 0) throw new SystemError(`pm2 ${args[0]} exited ${r.code}`);
    return r.stdout;
  }

  async function procs(): Promise<Pm2Proc[]> {
    if (!existsSync(join(pm2Home, "rpc.sock"))) return [];
    return parsePm2Jlist(await pm2(["jlist"]));
  }

  const find = async (name: string) => (await procs()).find((p) => p.name === name) ?? null;

  return {
    async list() {
      return (await procs()).map(toApp);
    },
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
  };
}
