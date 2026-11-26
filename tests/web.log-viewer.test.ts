import { describe, expect, test } from "bun:test";
import type { BufferedLogLine } from "@/web/components/log.buffer";
import { cutLogText, daySeparatorSeqs, splitHighlight } from "@/web/components/log-lines";
import { logFileName } from "@/web/components/log-viewer";

// test-only: local-time ISO strings so day boundaries do not depend on the runner's time zone
const localIso = (y: number, mo: number, d: number, h: number) => new Date(y, mo - 1, d, h).toISOString();
const line = (seq: number, at: string | null, text = "x"): BufferedLogLine => ({ seq, at, text });

describe("splitHighlight", () => {
  test("marks every case-insensitive match, keeping original casing", () => {
    expect(splitHighlight("Error: disk error", "ERROR")).toEqual([
      { text: "Error", hit: true },
      { text: ": disk ", hit: false },
      { text: "error", hit: true },
    ]);
  });

  test("empty query or no match leaves the text whole", () => {
    expect(splitHighlight("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(splitHighlight("abc", "z")).toEqual([{ text: "abc", hit: false }]);
  });

  test("adjacent matches do not overlap", () => {
    expect(splitHighlight("aaaa", "aa")).toEqual([
      { text: "aa", hit: true },
      { text: "aa", hit: true },
    ]);
  });
});

describe("cutLogText", () => {
  test("cuts past the limit and reports the hidden length", () => {
    expect(cutLogText("abcdefgh", 5)).toEqual({ shown: "abcde", cut: 3 });
  });

  test("short text is kept and ANSI codes are stripped", () => {
    expect(cutLogText("\x1b[31mred\x1b[0m", 5)).toEqual({ shown: "red", cut: 0 });
  });

  test("default limit is 4000 characters", () => {
    expect(cutLogText("a".repeat(4_001)).cut).toBe(1);
    expect(cutLogText("a".repeat(4_000)).cut).toBe(0);
  });
});

describe("daySeparatorSeqs", () => {
  test("separator only where the local day changes between dated lines", () => {
    const lines = [
      line(1, localIso(2026, 11, 26, 22)),
      line(2, null),
      line(3, localIso(2026, 11, 26, 23)),
      line(4, null),
      line(5, localIso(2026, 11, 27, 1)),
      line(6, localIso(2026, 11, 27, 2)),
    ];
    expect([...daySeparatorSeqs(lines)]).toEqual([5]);
  });

  test("no dated lines or invalid dates → no separators", () => {
    expect(daySeparatorSeqs([line(1, null), line(2, "not a date"), line(3, null)]).size).toBe(0);
  });
});

describe("logFileName", () => {
  test("slug of the label plus local YYYYMMDD-HHmm", () => {
    expect(logFileName("Log sshd", new Date(2026, 10, 26, 9, 5))).toBe("log-sshd-20261126-0905.log");
  });

  test("label without usable characters falls back to 'log'", () => {
    expect(logFileName("—", new Date(2026, 0, 2, 3, 4))).toBe("log-20260102-0304.log");
  });
});
