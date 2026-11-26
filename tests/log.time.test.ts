import { describe, expect, test } from "bun:test";
import { splitLogTimestamp } from "@/shared/log.time";

describe("splitLogTimestamp", () => {
  test("svlogd -tt stamp → UTC ISO with milliseconds, rest is the text", () => {
    expect(splitLogTimestamp("2026-11-26_13:54:24.23463 pesan")).toEqual({
      at: "2026-11-26T13:54:24.234Z",
      text: "pesan",
    });
    // Real line shape from the phone (panel log under runit): the inner ISO stamp stays part of the text.
    expect(splitLogTimestamp("2026-11-26_14:11:39.19130 2026-11-26T14:11:39.188Z INFO [panel] up")).toEqual({
      at: "2026-11-26T14:11:39.191Z",
      text: "2026-11-26T14:11:39.188Z INFO [panel] up",
    });
    expect(splitLogTimestamp("2026-01-02_03:04:05.5 x").at).toBe("2026-01-02T03:04:05.500Z");
    expect(splitLogTimestamp("2026-01-02_03:04:05.123456789 ").text).toBe("");
  });

  test.each([
    "2026-11-26 13:54:24: pm2 line without zone",
    "",
    "2026-13-26_13:54:24.23463 month 13",
    "2026-02-30_10:00:00.1 no such day",
    "2026-11-26_24:00:00.1 hour 24",
    "2026-11-26_13:54:24.23463", // no separating space
  ])("%p → at null, text untouched", (raw) => {
    expect(splitLogTimestamp(raw)).toEqual({ at: null, text: raw });
  });
});
