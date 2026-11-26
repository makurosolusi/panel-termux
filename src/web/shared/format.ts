// Client formatters: the pure Indonesian ones come from `src/shared/format.id.ts` (shared with the server's
// Telegram text); the ones here need the browser's locale/time zone or i18n strings.
import { formatDuration, formatNumber } from "@/shared/format.id";
import { idShell } from "@/web/i18n/id.shell";

export {
  formatBytes,
  formatDuration,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatTemperature,
} from "@/shared/format.id";

/** Uptime of a process/device; same format as `formatDuration`. */
export const formatUptime = formatDuration;

/** Whole local calendar days between two instants ("kemarin" = previous calendar day, not 24-48 h ago). */
const calendarDays = (from: Date, to: Date): number =>
  Math.round(
    (new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime() -
      new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) /
      86_400_000,
  );

/**
 * Relative time (PLAN/01 D16): within a minute either way "baru saja"; under a day up to two units without
 * seconds ("3 mnt lalu", "2 jam 5 mnt lalu"; future "dalam 57 mnt"); then by local calendar day "kemarin",
 * "4 hari lalu"; a week or older (or a future beyond a day) → "26 Nov 2026".
 */
export function formatRelative(at: string | Date | null, now: Date = new Date()): string {
  if (at === null) return "–";
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "–";
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  const t = idShell.time;
  if (Math.abs(sec) < 60) return t.justNow;
  if (sec < 0 && -sec < 86_400) return t.in(formatDuration(-sec - (-sec % 60)));
  if (sec > 0 && sec < 86_400) return t.ago(formatDuration(sec - (sec % 60)));
  const days = sec > 0 ? Math.max(1, calendarDays(d, now)) : 0;
  if (days === 1) return t.yesterday;
  if (days > 1 && days < 7) return t.ago(`${days} hari`);
  return d.toLocaleDateString("id-ID", { dateStyle: "medium" });
}

/** Local weekday + date for log day separators: "Kamis, 26 Nov 2026"; "" for null/invalid. */
export function formatDayLabel(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

/** Local wall-clock time with seconds, Indonesian dots: "21.54.07"; "" for null/invalid. */
export function formatClock(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** Share of used space in percent (0–100) for a progress bar; 0 when total is unknown. */
export const usedPercent = (free: number, total: number): number =>
  total > 0 ? Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100))) : 0;

/** Local date-time for an ISO string, e.g. "26 Nov 2026, 14.05" (`seconds` → "26 Nov 2026, 14.05.07"); "–" for null/invalid. */
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
