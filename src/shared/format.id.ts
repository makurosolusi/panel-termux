// Indonesian number/size/duration formatting without Intl, so the server (Telegram text) and the web agree byte for
// byte whatever ICU data the runtime ships. `src/web/shared/format.ts` re-exports these.

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_PER_UNIT = 1024;
/** Index of "GB" in BYTE_UNITS: from here on sizes always show exactly one decimal. */
const FIXED_DECIMAL_FROM = 3;

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "id-ID" digits: "." groups thousands, "," before decimals; `fixed` keeps trailing zeros, otherwise they drop. */
function idDigits(n: number, digits: number, fixed: boolean): string {
  const [int = "0", frac = ""] = Math.abs(n).toFixed(digits).split(".");
  const shownFrac = fixed ? frac : frac.replace(/0+$/, "");
  const sign = n < 0 && Number(`${int}.${frac || "0"}`) !== 0 ? "-" : "";
  return `${sign}${groupThousands(int)}${shownFrac ? `,${shownFrac}` : ""}`;
}

/** Indonesian number: 12345.6 → "12.345,6" (at most `digits` decimals); non-finite → "–". */
export const formatNumber = (n: number, digits = 0): string => (Number.isFinite(n) ? idDigits(n, digits, false) : "–");

/** Percent from 0–100: 42.25 → "42%", with `digits` → "42,3%". */
export const formatPercent = (pct: number, digits = 0): string =>
  Number.isFinite(pct) ? `${formatNumber(pct, digits)}%` : "–";

/** Byte size: B/KB/MB with one decimal below 100 ("1,5 KB", "512 MB"); GB/TB always one decimal ("64,0 GB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit++;
  }
  const text =
    unit >= FIXED_DECIMAL_FROM ? idDigits(value, 1, true) : idDigits(value, unit === 0 || value >= 100 ? 0 : 1, false);
  return `${text} ${BYTE_UNITS[unit]}`;
}

/** MB value (as reported by /proc/meminfo-style APIs): 3776 → "3,7 GB", 512 → "512 MB". */
export const formatMegabytes = (mb: number): string => formatBytes(mb * BYTES_PER_UNIT * BYTES_PER_UNIT);

const DURATION_UNITS: readonly [seconds: number, unit: string][] = [
  [86_400, "hari"],
  [3_600, "jam"],
  [60, "mnt"],
  [1, "dtk"],
];

/** Duration, largest two units from the first non-zero one: 437 → "7 mnt 17 dtk", 119340 → "1 hari 9 jam". */
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

/** Temperature in °C with at most one decimal: 36.5 → "36,5 °C"; null/non-finite → "–". */
export const formatTemperature = (c: number | null): string =>
  c !== null && Number.isFinite(c) ? `${formatNumber(c, 1)} °C` : "–";
