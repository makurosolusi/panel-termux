import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateSecret } from "@/server/secret";

const root = mkdtempSync(join(tmpdir(), "panel-secret-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("loadOrCreateSecret", () => {
  test("creates 32-byte secret with 600/700 modes, then reuses it with created=false", () => {
    const dir = join(root, "data");
    const first = loadOrCreateSecret(dir);
    expect(first.created).toBe(true);
    expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dir, "secret")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(loadOrCreateSecret(dir)).toEqual({ secret: first.secret, created: false });
  });

  test("a lost file yields a new, different key flagged as created", () => {
    const dir = join(root, "lost");
    const old = loadOrCreateSecret(dir).secret;
    rmSync(join(dir, "secret"));
    const again = loadOrCreateSecret(dir);
    expect(again.created).toBe(true);
    expect(again.secret).not.toBe(old);
  });

  test("an unusable existing file throws and is never overwritten", () => {
    const dir = join(root, "short");
    loadOrCreateSecret(dir);
    writeFileSync(join(dir, "secret"), "abc");
    expect(() => loadOrCreateSecret(dir)).toThrow(/too short/);
    expect(readFileSync(join(dir, "secret"), "utf8")).toBe("abc");
  });
});
