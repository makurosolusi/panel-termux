import { afterEach, describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatDuration,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatTemperature,
} from "@/shared/format.number";
import { setActiveLocale } from "@/shared/i18n";
import * as web from "@/web/shared/format";

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

describe("format.number (en)", () => {
  test("formatBytes", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(1023, "en")).toBe("1,023 B");
    expect(formatBytes(1.5 * KiB, "en")).toBe("1.5 KB");
    expect(formatBytes(512 * MiB, "en")).toBe("512 MB");
    expect(formatBytes(64 * GiB, "en")).toBe("64.0 GB");
    expect(formatBytes(1.25 * 1024 * GiB, "en")).toBe("1.3 TB");
    expect(formatBytes(-1, "en")).toBe("–");
    expect(formatMegabytes(3776, "en")).toBe("3.7 GB");
  });

  test("formatNumber / formatPercent / formatTemperature use English separators", () => {
    expect(formatNumber(12345.6, 1, "en")).toBe("12,345.6");
    expect(formatNumber(1234567, 0, "en")).toBe("1,234,567");
    expect(formatNumber(-1234.5, 1, "en")).toBe("-1,234.5");
    expect(formatNumber(Number.NaN, 0, "en")).toBe("–");
    expect(formatPercent(42.25, 1, "en")).toBe("42.3%");
    expect(formatTemperature(36.5, "en")).toBe("36.5 °C");
  });

  test("formatDuration: d / h / min / s", () => {
    expect(formatDuration(0, "en")).toBe("0 s");
    expect(formatDuration(59, "en")).toBe("59 s");
    expect(formatDuration(60, "en")).toBe("1 min");
    expect(formatDuration(437, "en")).toBe("7 min 17 s");
    expect(formatDuration(3_600, "en")).toBe("1 h");
    expect(formatDuration(119_340, "en")).toBe("1 d 9 h");
    expect(formatDuration(-5, "en")).toBe("–");
  });
});

describe("format.number (id)", () => {
  test("formatBytes: one decimal below 100 for B/KB/MB, always one for GB/TB", () => {
    expect(formatBytes(0, "id")).toBe("0 B");
    expect(formatBytes(1023, "id")).toBe("1.023 B");
    expect(formatBytes(1.5 * KiB, "id")).toBe("1,5 KB");
    expect(formatBytes(KiB, "id")).toBe("1 KB");
    expect(formatBytes(512 * MiB, "id")).toBe("512 MB");
    expect(formatBytes(64 * GiB, "id")).toBe("64,0 GB");
    expect(formatBytes(232 * GiB, "id")).toBe("232,0 GB");
    expect(formatBytes(1.25 * 1024 * GiB, "id")).toBe("1,3 TB");
    expect(formatBytes(-1, "id")).toBe("–");
    expect(formatBytes(Number.NaN, "id")).toBe("–");
  });

  test("formatMegabytes", () => {
    expect(formatMegabytes(3776, "id")).toBe("3,7 GB");
    expect(formatMegabytes(512, "id")).toBe("512 MB");
  });

  test("formatNumber / formatPercent use Indonesian separators", () => {
    expect(formatNumber(12345.6, 1, "id")).toBe("12.345,6");
    expect(formatNumber(1234567, 0, "id")).toBe("1.234.567");
    expect(formatNumber(2.5, 2, "id")).toBe("2,5");
    expect(formatNumber(-1234.5, 1, "id")).toBe("-1.234,5");
    expect(formatNumber(-0.01, 0, "id")).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY, 0, "id")).toBe("–");
    expect(formatPercent(42.25, 0, "id")).toBe("42%");
    expect(formatPercent(42.25, 1, "id")).toBe("42,3%");
    expect(formatPercent(Number.NaN, 0, "id")).toBe("–");
  });

  test("formatDuration: two largest units", () => {
    expect(formatDuration(0, "id")).toBe("0 dtk");
    expect(formatDuration(59, "id")).toBe("59 dtk");
    expect(formatDuration(60, "id")).toBe("1 mnt");
    expect(formatDuration(437, "id")).toBe("7 mnt 17 dtk");
    expect(formatDuration(119_340, "id")).toBe("1 hari 9 jam");
    expect(formatDuration(3_600, "id")).toBe("1 jam");
    expect(formatDuration(-5, "id")).toBe("–");
  });

  test("formatTemperature", () => {
    expect(formatTemperature(36.5, "id")).toBe("36,5 °C");
    expect(formatTemperature(36, "id")).toBe("36 °C");
    expect(formatTemperature(null, "id")).toBe("–");
  });
});

describe("web format.ts follows the active locale", () => {
  const prevTz = process.env.TZ;
  afterEach(() => {
    setActiveLocale("en"); // module singleton: back to the default for later files
    process.env.TZ = prevTz;
  });
  // 00:05:09 local in Asia/Jakarta (UTC+7)
  const AT = "2026-11-26T17:05:09Z";

  test("en: 24-hour clock at 00:05, never 24:05 or 12:05 AM", () => {
    process.env.TZ = "Asia/Jakarta"; // test-only
    expect(web.formatClock(AT)).toBe("00:05:09");
    // ICU versions join date and time with ", " or " at "; the 24-hour time is what this pins
    expect(web.formatDateTime(AT)).toMatch(/^Nov 27, 2026(,| at) 00:05$/);
    expect(web.formatDateTime(AT, true)).toMatch(/^Nov 27, 2026(,| at) 00:05:09$/);
    expect(web.formatDate(AT)).toBe("Nov 27, 2026");
    expect(web.formatDate(AT, "long")).toBe("November 27, 2026");
    expect(web.formatDayLabel(AT)).toBe("Friday, Nov 27, 2026");
  });

  test("id: same instants in Indonesian", () => {
    process.env.TZ = "Asia/Jakarta"; // test-only
    setActiveLocale("id");
    expect(web.formatClock(AT)).toBe("00.05.09");
    expect(web.formatDateTime(AT)).toBe("27 Nov 2026, 00.05");
    expect(web.formatDate(AT, "long")).toBe("27 November 2026");
  });

  test("en: numbers, durations and relative time", () => {
    expect(web.formatBytes(1.5 * KiB)).toBe("1.5 KB");
    expect(web.formatDuration(0)).toBe("0 s");
    expect(web.formatLoad([0.5, 1, 1.25])).toBe("0.50 · 1.00 · 1.25");
    setActiveLocale("id");
    expect(web.formatBytes(1.5 * KiB)).toBe("1,5 KB");
    expect(web.formatLoad([0.5, 1, 1.25])).toBe("0,50 · 1,00 · 1,25");
  });
});
