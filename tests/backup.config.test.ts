import { describe, expect, test } from "bun:test";
import { isDue, nextRunAt, runKeyStem } from "@/server/backup/backup.config";
import { InvalidSettingError, SETTINGS } from "@/server/settings.service";

// Local-time constructors keep these independent of the machine's time zone.
const at = (d: number, h: number, m = 0, s = 0) => new Date(2026, 10, d, h, m, s);

describe("nextRunAt", () => {
  test("later today when the hour is still ahead", () => {
    expect(nextRunAt(3, at(26, 1, 30))).toEqual(at(26, 3));
  });
  test("tomorrow when the hour passed or is exactly now", () => {
    expect(nextRunAt(3, at(26, 3, 0, 1))).toEqual(at(27, 3));
    expect(nextRunAt(3, at(26, 3))).toEqual(at(27, 3));
    expect(nextRunAt(0, at(26, 23, 59))).toEqual(at(27, 0));
  });
  test("crosses month end", () => {
    expect(nextRunAt(3, at(30, 4))).toEqual(new Date(2026, 11, 1, 3));
  });
});

describe("isDue", () => {
  test("only when the hour boundary falls in (prev, now]", () => {
    expect(isDue(3, at(26, 2, 59), at(26, 3))).toBe(true);
    expect(isDue(3, at(26, 3), at(26, 3, 1))).toBe(false); // boundary was the previous tick
    expect(isDue(3, at(26, 3, 30), at(26, 3, 31))).toBe(false); // booted mid-hour: no run
    expect(isDue(null, at(26, 2, 59), at(26, 3))).toBe(false); // off
  });
});

test("runKeyStem uses local date folder and HHMMSS", () => {
  expect(runKeyStem("panel-termux/", at(6, 3, 4, 5))).toBe("panel-termux/2026-11-06/030405-");
});

describe("backup setting validators", () => {
  const v = (k: keyof typeof SETTINGS, x: string) => SETTINGS[k].validate(x);
  test("hour", () => {
    expect(["0", "23", "off"].map((x) => v("backup.hour", x))).toEqual([null, null, null]);
    for (const x of ["24", "-1", "3.5", "OFF"]) expect(v("backup.hour", x)).not.toBeNull();
  });
  test("retention 1-365", () => {
    expect(v("backup.retention_days", "1")).toBeNull();
    expect(v("backup.retention_days", "365")).toBeNull();
    for (const x of ["0", "366", "7d"]) expect(v("backup.retention_days", x)).not.toBeNull();
  });
  test("prefix must end with / and stay relative", () => {
    expect(v("backup.prefix", "panel-termux/")).toBeNull();
    expect(v("backup.prefix", "a/b/")).toBeNull();
    for (const x of ["nope", "/abs/", "a//b/", "a/../", "../"]) expect(v("backup.prefix", x)).not.toBeNull();
  });
  test("endpoint is an http(s) origin without credentials", () => {
    expect(v("backup.s3_endpoint", "https://abc.r2.cloudflarestorage.com")).toBeNull();
    for (const x of ["ftp://x", "https://u:p@x.io", "https://x.io/bucket", "not a url"])
      expect(v("backup.s3_endpoint", x)).not.toBeNull();
  });
  test("credentials are secret settings", () => {
    expect(SETTINGS["backup.s3_access_key_id"].secret).toBe(true);
    expect(SETTINGS["backup.s3_secret_access_key"].secret).toBe(true);
    expect(InvalidSettingError).toBeDefined();
  });
});
