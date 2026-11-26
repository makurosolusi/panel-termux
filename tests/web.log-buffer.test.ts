import { describe, expect, test } from "bun:test";
import type { LogLine } from "@/shared/log.types";
import { appendLogLines, filterLogLines, LOG_MAX_LINES, logToText, stripAnsi } from "@/web/components/log.buffer";

const lines = (...texts: string[]): LogLine[] => texts.map((text) => ({ at: null, text }));

describe("appendLogLines", () => {
  test("appends with increasing seq and trims from the front to max", () => {
    const a = appendLogLines([], { lines: lines("a", "b", "c"), reset: false }, 4);
    expect(a.map((l) => [l.seq, l.text])).toEqual([
      [0, "a"],
      [1, "b"],
      [2, "c"],
    ]);
    const b = appendLogLines(a, { lines: lines("d", "e", "f"), reset: false }, 4);
    expect(b.map((l) => [l.seq, l.text])).toEqual([
      [2, "c"],
      [3, "d"],
      [4, "e"],
      [5, "f"],
    ]);
  });

  test("reset drops previous lines but seq keeps counting", () => {
    const a = appendLogLines([], { lines: lines("a", "b"), reset: false });
    const b = appendLogLines(a, { lines: lines("new"), reset: true });
    expect(b).toEqual([{ at: null, text: "new", seq: 2 }]);
    expect(appendLogLines(b, { lines: [], reset: true })).toEqual([]);
  });

  test("empty chunk without reset keeps the same array (no re-render)", () => {
    const a = appendLogLines([], { lines: lines("a"), reset: false });
    expect(appendLogLines(a, { lines: [], reset: false })).toBe(a);
  });

  test("default cap is LOG_MAX_LINES", () => {
    const many = lines(...Array.from({ length: LOG_MAX_LINES + 5 }, (_, i) => `l${i}`));
    const buf = appendLogLines([], { lines: many, reset: false });
    expect(buf).toHaveLength(LOG_MAX_LINES);
    expect(buf[0]?.text).toBe("l5");
    expect(buf.at(-1)?.seq).toBe(LOG_MAX_LINES + 4);
  });
});

describe("filter, text, ANSI", () => {
  test("filterLogLines is case-insensitive substring; blank query keeps all", () => {
    const buf = appendLogLines([], { lines: lines("Error: boom", "ok", "\x1b[31mERROR\x1b[0m red"), reset: false });
    expect(filterLogLines(buf, "error").map((l) => l.seq)).toEqual([0, 2]);
    expect(filterLogLines(buf, "  ")).toBe(buf);
    expect(filterLogLines(buf, "nothing")).toEqual([]);
  });

  test("logToText uses local time and leaves lines without at as text", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Asia/Jakarta"; // test-only: UTC+7, restored below so other files keep the host zone
    try {
      const text = logToText([
        { at: "2026-11-26T14:54:07.123Z", text: "started" },
        { at: null, text: "\x1b[1mplain\x1b[0m" },
      ]);
      expect(text).toBe("2026-11-26 21:54:07 started\nplain");
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  test("stripAnsi", () => {
    expect(stripAnsi("\x1b[32mgreen\x1b[0m \x1b[1;31mx\x1b[K")).toBe("green x");
  });
});
