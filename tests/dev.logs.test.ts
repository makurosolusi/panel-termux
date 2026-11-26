import { expect, test } from "bun:test";
import { decryptSecret, encryptSecret } from "@/server/crypto.service";
import { logRequest, type RequestRecord, requestLevel, requestStats } from "@/server/http/request.log";
import { LOG_RING_SIZE, log, readLogs } from "@/server/log.service";
import { logChunk } from "@/server/panel/panel.service";

test("ring buffer keeps only the newest LOG_RING_SIZE entries, newest first", () => {
  const n = LOG_RING_SIZE + 5;
  const realLog = console.log;
  console.log = () => {}; // test-only: silence stdout for the flood
  try {
    for (let i = 0; i < n; i++) log.info(`ring-${i}`);
  } finally {
    console.log = realLog;
  }
  const all = readLogs({ limit: LOG_RING_SIZE * 2 });
  expect(all).toHaveLength(LOG_RING_SIZE);
  expect(all[0]?.msg).toBe(`ring-${n - 1}`);
  expect(all.at(-1)?.msg).toBe(`ring-${n - LOG_RING_SIZE}`);
  expect(readLogs({ limit: 3 }).map((e) => e.msg)).toEqual([`ring-${n - 1}`, `ring-${n - 2}`, `ring-${n - 3}`]);
  expect(readLogs({ limit: 10, level: "warn" })).toEqual([]);
});

test("encryptSecret round-trips, uses a fresh IV, rejects tampering and wrong secret", () => {
  const secret = "ab".repeat(32); // test-only
  const a = encryptSecret(secret, "hello");
  expect(a).not.toContain("hello");
  expect(encryptSecret(secret, "hello")).not.toBe(a);
  expect(decryptSecret(secret, a)).toBe("hello");
  expect(() => decryptSecret("cd".repeat(32), a)).toThrow(/authentication failed/);
  const parts = a.split(".");
  parts[3] = Buffer.from("tampered").toString("base64");
  expect(() => decryptSecret(secret, parts.join("."))).toThrow(/authentication failed/);
  expect(() => decryptSecret(secret, "plain")).toThrow(/unsupported format/);
});

test("request log levels (K16): quiet reads and anonymous noise at debug, 5xx warn, the rest info", () => {
  const r = (over: Partial<RequestRecord>): RequestRecord => ({
    method: "GET",
    path: "/api/panel/overview",
    status: 200,
    ms: 1,
    userId: "u1",
    ...over,
  });
  expect(requestLevel(r({}))).toBe("debug");
  expect(requestLevel(r({ method: "HEAD", status: 304 }))).toBe("debug");
  expect(requestLevel(r({ method: "POST" }))).toBe("info");
  expect(requestLevel(r({ status: 404 }))).toBe("info"); // signed-in 404 is worth a line
  for (const status of [401, 403, 404, 421])
    expect(requestLevel(r({ method: "POST", status, userId: null }))).toBe("debug");
  expect(requestLevel(r({ method: "POST", status: 403 }))).toBe("info"); // role 403 of a signed-in user
  expect(requestLevel(r({ method: "POST", status: 409 }))).toBe("info");
  expect(requestLevel(r({ status: 502 }))).toBe("warn");
  expect(requestLevel(r({ path: "/api/health", method: "POST", status: 400 }))).toBe("debug");
});

test("requestStats: unhandled5m counts exactly-500 only, errorCount5m all 5xx, both age out after 5 min", () => {
  const t = Date.now();
  const before = requestStats(t);
  const silence = console.error;
  console.error = () => {}; // test-only: warn lines go to stderr
  try {
    for (const status of [500, 500, 502, 503])
      logRequest({ method: "GET", path: "/api/x", status, ms: 1, userId: null }, t);
  } finally {
    console.error = silence;
  }
  const after = requestStats(t);
  expect(after.unhandled5m - before.unhandled5m).toBe(2);
  expect(after.errorCount5m - before.errorCount5m).toBe(4);
  expect(requestStats(t + 5 * 60_000 + 1)).toMatchObject({ unhandled5m: 0, errorCount5m: 0 });
});

test("logChunk anchor: grown file → only the new tail; anchor gone → reset", () => {
  const base = ["a", "b", "c", "d"];
  const first = logChunk(base, 4, null, []);
  const anchor = Buffer.from(first.cursor, "base64url").toString().split(":")[1] as string;
  const grown = logChunk(["b", "c", "d", "e", "f"], 4, { anchor }, []);
  expect(grown.lines.map((l) => l.text)).toEqual(["e", "f"]);
  expect(grown.reset).toBe(false);
  const rotated = logChunk(["x", "y"], 4, { anchor }, []);
  expect(rotated).toMatchObject({ reset: true, lines: [{ text: "x" }, { text: "y" }] });
});
