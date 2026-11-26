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

/** Compact uptime, largest two units: 90061 → "1h 1j", 3725 → "1j 2m", 42 → "42d" (hari/jam/menit/detik). */
export function formatUptime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "–";
  const s = Math.floor(totalSec);
  const parts: [number, string][] = [
    [Math.floor(s / 86_400), "h"],
    [Math.floor((s % 86_400) / 3_600), "j"],
    [Math.floor((s % 3_600) / 60), "m"],
    [s % 60, "d"],
  ];
  const first = parts.findIndex(([n]) => n > 0);
  if (first === -1) return "0d";
  return parts
    .slice(first, first + 2)
    .filter(([n]) => n > 0)
    .map(([n, u]) => `${n}${u}`)
    .join(" ");
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
