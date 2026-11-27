// Number/size/duration formatting per locale without Intl, so the server (Telegram text) and the web agree byte for
// byte whatever ICU data the runtime ships (DECISIONS E4). Every function takes the locale explicitly; the web binds
// the active one in `src/web/shared/format.ts`.
import type { Locale } from "./locale";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_PER_UNIT = 1024;
/** Index of "GB" in BYTE_UNITS: from here on sizes always show exactly one decimal. */
const FIXED_DECIMAL_FROM = 3;

/** Thousands and decimal separators: en "1,234.5", id "1.234,5". */
const SEPARATORS: Record<Locale, { group: string; decimal: string }> = {
  en: { group: ",", decimal: "." },
  id: { group: ".", decimal: "," },
};

/** Duration units, largest first: en "1 d 9 h", "7 min 17 s"; id "1 hari 9 jam", "7 mnt 17 dtk". */
const DURATION_UNITS: Record<Locale, readonly [seconds: number, unit: string][]> = {
  en: [
    [86_400, "d"],
    [3_600, "h"],
    [60, "min"],
    [1, "s"],
  ],
  id: [
    [86_400, "hari"],
    [3_600, "jam"],
    [60, "mnt"],
    [1, "dtk"],
  ],
};

/** Digits with the locale's separators; `fixed` keeps trailing zeros, otherwise they drop. */
function digitsOf(n: number, digits: number, fixed: boolean, locale: Locale): string {
  const { group, decimal } = SEPARATORS[locale];
  const [int = "0", frac = ""] = Math.abs(n).toFixed(digits).split(".");
  const shownFrac = fixed ? frac : frac.replace(/0+$/, "");
  const sign = n < 0 && Number(`${int}.${frac || "0"}`) !== 0 ? "-" : "";
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, group)}${shownFrac ? `${decimal}${shownFrac}` : ""}`;
}

/** Number with at most `digits` decimals: en 12345.6 → "12,345.6", id → "12.345,6"; non-finite → "–". */
export const formatNumber = (n: number, digits: number, locale: Locale): string =>
  Number.isFinite(n) ? digitsOf(n, digits, false, locale) : "–";

/** Percent from 0–100: 42.25 → "42%", with 1 digit → en "42.3%", id "42,3%". */
export const formatPercent = (pct: number, digits: number, locale: Locale): string =>
  Number.isFinite(pct) ? `${formatNumber(pct, digits, locale)}%` : "–";

/** Byte size: B/KB/MB with one decimal below 100 ("1.5 KB", "512 MB"); GB/TB always one decimal ("64.0 GB"). */
export function formatBytes(bytes: number, locale: Locale): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit++;
  }
  const text =
    unit >= FIXED_DECIMAL_FROM
      ? digitsOf(value, 1, true, locale)
      : digitsOf(value, unit === 0 || value >= 100 ? 0 : 1, false, locale);
  return `${text} ${BYTE_UNITS[unit]}`;
}

/** MB value (as reported by /proc/meminfo-style APIs): 3776 → "3.7 GB", 512 → "512 MB". */
export const formatMegabytes = (mb: number, locale: Locale): string =>
  formatBytes(mb * BYTES_PER_UNIT * BYTES_PER_UNIT, locale);

/** Duration, largest two units from the first non-zero one: en 437 → "7 min 17 s", 119340 → "1 d 9 h", 0 → "0 s". */
export function formatDuration(totalSec: number, locale: Locale): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "–";
  const units = DURATION_UNITS[locale];
  let rest = Math.floor(totalSec);
  const parts: string[] = [];
  for (const [size, unit] of units) {
    const n = Math.floor(rest / size);
    rest %= size;
    if (n > 0 || parts.length > 0) parts.push(n > 0 ? `${n} ${unit}` : "");
    if (parts.length === 2) break;
  }
  return parts.filter(Boolean).join(" ") || `0 ${units.at(-1)?.[1]}`;
}

/** Temperature in °C with at most one decimal: en 36.5 → "36.5 °C", id "36,5 °C"; null/non-finite → "–". */
export const formatTemperature = (c: number | null, locale: Locale): string =>
  c !== null && Number.isFinite(c) ? `${formatNumber(c, 1, locale)} °C` : "–";
