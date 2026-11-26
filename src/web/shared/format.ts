import { idShell } from "@/web/i18n/id.shell";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_PER_UNIT = 1024;

/** Human-readable byte size with Indonesian decimal comma, e.g. 1536 → "1,5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: digits })} ${BYTE_UNITS[unit]}`;
}

const DURATION_UNITS: readonly [seconds: number, unit: string][] = [
  [86_400, "hari"],
  [3_600, "jam"],
  [60, "mnt"],
  [1, "dtk"],
];

/** Duration, largest two non-zero units, unambiguous Indonesian: 437 → "7 mnt 17 dtk", 119340 → "1 hari 9 jam". */
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "–";
  let rest = Math.floor(totalSec);
  const parts: string[] = [];
  for (const [size, unit] of DURATION_UNITS) {
    const n = Math.floor(rest / size);
    rest %= size;
    if (n > 0 || parts.length > 0) parts.push(n > 0 ? `${n} ${unit}` : "");
    if (parts.length === 2) break;
  }
  return parts.filter(Boolean).join(" ") || "0 dtk";
}

/** Uptime of a process/device; same format as `formatDuration`. */
export const formatUptime = formatDuration;

/** MB value (as reported by /proc/meminfo-style APIs) with auto unit: 3776 → "3,7 GB", 512 → "512 MB". */
export const formatMegabytes = (mb: number): string => formatBytes(mb * BYTES_PER_UNIT * BYTES_PER_UNIT);

/** Indonesian number: 12345.6 → "12.345,6" (at most `digits` decimals). */
export const formatNumber = (n: number, digits = 0): string =>
  Number.isFinite(n) ? n.toLocaleString("id-ID", { maximumFractionDigits: digits }) : "–";

/** Percent from 0–100: 42.25 → "42%", with `digits` → "42,3%". */
export const formatPercent = (pct: number, digits = 0): string =>
  Number.isFinite(pct) ? `${formatNumber(pct, digits)}%` : "–";

/**
 * Relative time in Indonesian for an ISO string or Date: "baru saja" (< 10 dtk), "3 dtk lalu", "5 mnt lalu",
 * "2 jam lalu", "kemarin", "4 hari lalu"; older than a week → the local date. Future times count as "baru saja".
 */
export function formatRelative(at: string | Date | null, now: Date = new Date()): string {
  if (at === null) return "–";
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "–";
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  const t = idShell.time;
  if (sec < 10) return t.justNow;
  if (sec < 86_400) return t.ago(formatDuration(sec).split(" ").slice(0, 2).join(" "));
  const days = Math.floor(sec / 86_400);
  if (days === 1) return t.yesterday;
  if (days < 7) return t.ago(`${days} hari`);
  return d.toLocaleDateString("id-ID", { dateStyle: "medium" });
}

/** Share of used space in percent (0–100) for a progress bar; 0 when total is unknown. */
export const usedPercent = (free: number, total: number): number =>
  total > 0 ? Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100))) : 0;

/** Local date-time for an ISO string, e.g. "26 Nov 2026, 14.05" (`seconds` adds ":07"); "–" for null/invalid. */
export function formatDateTime(iso: string | null, seconds = false): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: seconds ? "medium" : "short" });
}

/** Load averages with Indonesian decimals, e.g. [0.5, 1, 1.25] → "0,50 · 1,00 · 1,25". */
export const formatLoad = (load: readonly number[]): string =>
  load.map((n) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })).join(" · ");

/** Semantic tone of a load/usage figure. */
export type LoadTone = "success" | "warning" | "danger" | "neutral";

/** Load per core at/above which the device counts as busy (warning) or overloaded (danger). */
export const LOAD_PER_CORE_WARN = 0.7;
export const LOAD_PER_CORE_DANGER = 1;

/**
 * 1-minute load average put in context: with a known core count → "17,6 / 8 inti" and a tone from load per
 * core; without → just the number, neutral.
 */
export function formatLoadPerCore(load1: number, cores: number | null | undefined): { text: string; tone: LoadTone } {
  if (!Number.isFinite(load1) || load1 < 0) return { text: "–", tone: "neutral" };
  const value = formatNumber(load1, 1);
  if (!cores || cores <= 0) return { text: value, tone: "neutral" };
  const perCore = load1 / cores;
  const tone = perCore >= LOAD_PER_CORE_DANGER ? "danger" : perCore >= LOAD_PER_CORE_WARN ? "warning" : "success";
  return { text: `${value} / ${cores} inti`, tone };
}
