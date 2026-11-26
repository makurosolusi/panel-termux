// Client-side log buffer for LogViewer / useLogFollow (PLAN/01 §3.4): capped, oldest first, with a running `seq`.
import type { LogLine } from "@/shared/log.types";

/** Most lines kept in the browser (and in the DOM). */
export const LOG_MAX_LINES = 2_000;
/** Characters of one line shown on screen; the rest only goes to Copy/Download. */
export const LOG_LINE_DISPLAY_MAX = 4_000;

/** A buffered line; `seq` increases forever within one buffer so "new lines" counts never go negative. */
export type BufferedLogLine = LogLine & { seq: number };

/** Removes ANSI colour/cursor escape sequences. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ESC control character is the point
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/** `reset` drops `prev` but `seq` keeps counting from prev's last seq, so "new lines" never goes negative. */
export function appendLogLines(
  prev: readonly BufferedLogLine[],
  chunk: { lines: readonly LogLine[]; reset: boolean },
  max: number = LOG_MAX_LINES,
): BufferedLogLine[] {
  if (chunk.lines.length === 0 && !chunk.reset) return prev as BufferedLogLine[];
  const nextSeq = (prev.at(-1)?.seq ?? -1) + 1;
  const added = chunk.lines.map((line, i) => ({ ...line, seq: nextSeq + i }));
  const all = chunk.reset ? added : [...prev, ...added];
  return all.length > max ? all.slice(all.length - max) : all;
}

/** Lines containing `query` (case-insensitive substring, ANSI ignored); blank query keeps all. */
export function filterLogLines(lines: readonly BufferedLogLine[], query: string): BufferedLogLine[] {
  const q = query.trim().toLowerCase();
  if (!q) return lines as BufferedLogLine[];
  return lines.filter((l) => stripAnsi(l.text).toLowerCase().includes(q));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD HH:MM:SS" of an ISO timestamp, or null when invalid. */
function localStamp(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Plain text for Copy/Download: "2026-11-26 21:54:07 teks" (local time); lines without `at` are text only. */
export function logToText(lines: readonly LogLine[]): string {
  return lines
    .map((l) => {
      const text = stripAnsi(l.text);
      const stamp = l.at ? localStamp(l.at) : null;
      return stamp ? `${stamp} ${text}` : text;
    })
    .join("\n");
}

/** `<label-slug>-YYYYMMDD-HHmm.log` in local time. */
export function logFileName(label: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "log"}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.log`;
}
