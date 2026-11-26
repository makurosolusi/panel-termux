import { type DevLogEntry, LOG_LEVELS, type LogLevel } from "../shared/dev.types";

/** Lines kept in memory for GET /api/dev/logs; older lines only survive in runit's stdout log. */
export const LOG_RING_SIZE = 2000;

const ring: DevLogEntry[] = [];
const rank = (l: LogLevel) => LOG_LEVELS.indexOf(l);
const writeStdout = process.env.NODE_ENV !== "production";

function write(level: LogLevel, msg: string): void {
  const entry: DevLogEntry = { at: new Date().toISOString(), level, msg };
  ring.push(entry);
  if (ring.length > LOG_RING_SIZE) ring.shift();
  if (level === "debug" && !writeStdout) return;
  const line = `${entry.at} ${level.toUpperCase()} ${msg}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** Panel logger: stdout (captured by runit) + in-memory ring buffer. Callers must not pass PII or secrets. */
export const log = {
  debug: (msg: string) => write("debug", msg),
  info: (msg: string) => write("info", msg),
  warn: (msg: string) => write("warn", msg),
  error: (msg: string) => write("error", msg),
};

/** Filter for readLogs: minimum level, case-insensitive substring, max entries. */
export type LogQuery = { level?: LogLevel; q?: string; limit: number };

/** Ring buffer entries matching `query`, newest first. */
export function readLogs({ level, q, limit }: LogQuery): DevLogEntry[] {
  const min = level ? rank(level) : 0;
  const needle = q?.toLowerCase();
  const out: DevLogEntry[] = [];
  for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
    const e = ring[i] as DevLogEntry;
    if (rank(e.level) >= min && (!needle || e.msg.toLowerCase().includes(needle))) out.push(e);
  }
  return out;
}
