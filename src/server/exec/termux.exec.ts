import { closeSync, openSync, readSync } from "node:fs";

/** Termux install prefix; override with env PREFIX. */
export const termuxPrefix = (): string => process.env.PREFIX || "/data/data/com.termux/files/usr";

const DEFAULT_TIMEOUT_MS = 10_000;
const SHEBANG_READ_BYTES = 256;
const ENV_SHEBANG = /^#!\s*\/usr\/bin\/env\s+(?:-S\s+)?(\S+)(.*)$/;

/** Result of a finished Termux command. */
export type ExecResult = { code: number; stdout: string; stderr: string };

/** Options for runTermux. */
/** `input` is written to the child's stdin (e.g. a psql script holding a password, kept off argv). */
export type ExecOptions = {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  cwd?: string;
  input?: string;
};

/** Thrown when a command cannot be spawned or times out; message names the command. */
export class TermuxExecError extends Error {}

function readHead(file: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(SHEBANG_READ_BYTES);
    const n = readSync(fd, buf, 0, SHEBANG_READ_BYTES, 0);
    return buf.subarray(0, n).toString("latin1");
  } catch (e) {
    throw new TermuxExecError(`cannot read ${file}: ${(e as Error).message}`, { cause: e });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Turns a tool name/path + args into an argv runnable from a glibc process: absolute `$PREFIX/bin/<tool>`,
 * and for `#!/usr/bin/env X` scripts (Android has no /usr/bin/env) `[$PREFIX/bin/X, ...envArgs, script, ...args]`.
 */
export function resolveArgv(tool: string, args: readonly string[] = [], prefix = termuxPrefix()): string[] {
  if (!tool) throw new TermuxExecError("empty command");
  const bin = tool.startsWith("/") ? tool : `${prefix}/bin/${tool}`;
  const firstLine = readHead(bin).split("\n")[0] ?? "";
  const m = firstLine.match(ENV_SHEBANG);
  if (!m) return [bin, ...args];
  const interp = m[1] as string;
  const extra = (m[2] ?? "").trim().split(/\s+/).filter(Boolean);
  return [interp.startsWith("/") ? interp : `${prefix}/bin/${interp}`, ...extra, bin, ...args];
}

/** Runs a Termux tool (argv only, never a shell string) with a timeout. Non-zero exit is returned, not thrown. */
export async function runTermux(
  tool: string,
  args: readonly string[] = [],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let argv: string[];
  try {
    argv = resolveArgv(tool, args);
  } catch (e) {
    throw new TermuxExecError(`exec ${tool} failed: ${(e as Error).message}`, { cause: e });
  }
  let proc: Bun.Subprocess<"pipe" | "ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(argv, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdin: opts.input === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
  } catch (e) {
    throw new TermuxExecError(`exec ${tool} failed to spawn: ${(e as Error).message}`, { cause: e });
  }
  if (opts.input !== undefined && proc.stdin) {
    proc.stdin.write(opts.input);
    proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (proc.signalCode === "SIGKILL") throw new TermuxExecError(`exec ${tool} timed out after ${timeoutMs}ms`);
  return { code, stdout, stderr };
}
