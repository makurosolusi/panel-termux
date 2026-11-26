import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatDuration,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatTemperature,
} from "@/shared/format.id";

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

describe("format.id", () => {
  test("formatBytes: one decimal below 100 for B/KB/MB, always one for GB/TB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1.023 B");
    expect(formatBytes(1.5 * KiB)).toBe("1,5 KB");
    expect(formatBytes(KiB)).toBe("1 KB");
    expect(formatBytes(512 * MiB)).toBe("512 MB");
    expect(formatBytes(64 * GiB)).toBe("64,0 GB");
    expect(formatBytes(232 * GiB)).toBe("232,0 GB");
    expect(formatBytes(1.25 * 1024 * GiB)).toBe("1,3 TB");
    expect(formatBytes(-1)).toBe("–");
    expect(formatBytes(Number.NaN)).toBe("–");
  });

  test("formatMegabytes", () => {
    expect(formatMegabytes(3776)).toBe("3,7 GB");
    expect(formatMegabytes(512)).toBe("512 MB");
  });

  test("formatNumber / formatPercent use Indonesian separators", () => {
    expect(formatNumber(12345.6, 1)).toBe("12.345,6");
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(2.5, 2)).toBe("2,5");
    expect(formatNumber(-1234.5, 1)).toBe("-1.234,5");
    expect(formatNumber(-0.01)).toBe("0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("–");
    expect(formatPercent(42.25)).toBe("42%");
    expect(formatPercent(42.25, 1)).toBe("42,3%");
    expect(formatPercent(Number.NaN)).toBe("–");
  });

  test("formatDuration: two largest units", () => {
    expect(formatDuration(437)).toBe("7 mnt 17 dtk");
    expect(formatDuration(119_340)).toBe("1 hari 9 jam");
    expect(formatDuration(3_600)).toBe("1 jam");
    expect(formatDuration(0)).toBe("0 dtk");
    expect(formatDuration(-5)).toBe("–");
  });

  test("formatTemperature", () => {
    expect(formatTemperature(36.5)).toBe("36,5 °C");
    expect(formatTemperature(36)).toBe("36 °C");
    expect(formatTemperature(null)).toBe("–");
  });
});
