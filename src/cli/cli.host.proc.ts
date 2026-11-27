// /proc and local-health probes of the real Termux host (CliHost.proc, CliHost.health); split from cli.host.ts.
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FileId, PanelHealth, ProcInfo } from "./cli.host";

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

const HEALTH_TIMEOUT_MS = 1000;

/** /api/health on 127.0.0.1; refused, timeout, non-2xx or no JSON = null (not an error: the panel may be down). */
export async function localHealth(port: number): Promise<PanelHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown; bootId?: unknown };
    return { version: typeof body.version === "string" ? body.version : "", bootId: body.bootId };
  } catch {
    return null; // not answering is an answer here (K20 falls back to app_meta)
  }
}

/** dev+ino of `/proc/<pid>/exe` (stat follows the link); null when the process is gone or not ours. */
export function procExeId(pid: number): FileId | null {
  try {
    const s = statSync(join(PROC, String(pid), "exe"));
    return { dev: s.dev, ino: s.ino };
  } catch (e) {
    if (GONE.has((e as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error(`stat ${PROC}/${pid}/exe failed: ${(e as Error).message}`, { cause: e });
  }
}
