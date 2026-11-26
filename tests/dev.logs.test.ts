import { expect, test } from "bun:test";
import { decryptSecret, encryptSecret } from "@/server/crypto.service";
import { LOG_RING_SIZE, log, readLogs } from "@/server/log.service";

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
