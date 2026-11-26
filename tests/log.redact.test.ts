import { describe, expect, test } from "bun:test";
import { redactLines } from "@/server/system/log.redact";

// test-only fake secrets
const BOT_TOKEN = "123456789:AAH-fake_token_value_for_tests_000000";
const one = (line: string, extra: string[] = []) => redactLines([line], extra).lines[0];

describe("redactLines", () => {
  test("masks credentials in URLs of any scheme", () => {
    expect(one("db postgres://app:s3cr3t@127.0.0.1:5432/app")).toBe("db postgres://***:***@127.0.0.1:5432/app");
    expect(one("GET https://bob:hunter2@example.test/x")).toBe("GET https://***:***@example.test/x");
    expect(one("redis://cache.local:6379")).toBe("redis://cache.local:6379");
  });

  test("masks Authorization headers and bearer tokens", () => {
    expect(one("Authorization: Bearer abcdefgh12345678")).toBe("Authorization: Bearer ***");
    expect(one('{"authorization":"Basic dXNlcjpwYXNz"}')).toBe('{"authorization":"Basic ***"}');
    expect(one("sent Bearer eyJhbGciOi.payload.sig")).toBe("sent Bearer ***");
  });

  test("masks secret-named key/value pairs, JSON included, and keeps ordinary words", () => {
    expect(one('{"password":"x1"}')).toBe('{"password":"***"}');
    expect(one('{"apiKey": "abc-123", "user": "ana"}')).toBe('{"apiKey": "***", "user": "ana"}');
    expect(one("token=abc next")).toBe("token=*** next");
    expect(one("DB_PASSWORD='p@ss'")).toBe("DB_PASSWORD='***'");
    expect(one("tokenizer ready")).toBe("tokenizer ready");
  });

  test("masks Telegram bot tokens", () => {
    const out = one(`fetch https://api.telegram.org/bot${BOT_TOKEN}/sendMessage failed`);
    expect(out).not.toContain(BOT_TOKEN);
    expect(out).not.toContain("AAH-fake");
  });

  test("masks exact env values (longest first) and counts every masked value", () => {
    const env = ["supersecretvalue", "supersecret", "abc"]; // "abc" is too short to mask
    const r = redactLines(["start supersecretvalue and supersecret", "abc stays", "token=zzz"], env);
    expect(r.lines).toEqual(["start *** and ***", "abc stays", "token=***"]);
    expect(r.redacted).toBe(3);
    expect(r.lines.join("\n")).not.toContain("supersecret");
  });

  test("special regex characters in env values are matched literally", () => {
    expect(one("pw a.b*c(d) end", ["a.b*c(d)"])).toBe("pw *** end");
    expect(one("pw aXbbc(d) end", ["a.b*c(d)"])).toBe("pw aXbbc(d) end");
  });

  test("clean lines are untouched and not counted", () => {
    const r = redactLines(["GET /api/health 200 3ms", "server listening on :3000"]);
    expect(r.lines).toEqual(["GET /api/health 200 3ms", "server listening on :3000"]);
    expect(r.redacted).toBe(0);
  });
});
