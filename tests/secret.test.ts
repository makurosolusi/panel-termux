import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateSecret } from "@/server/secret";

const root = mkdtempSync(join(tmpdir(), "panel-secret-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("loadOrCreateSecret", () => {
  test("creates 32-byte secret with 600/700 modes and reuses it", () => {
    const dir = join(root, "data");
    const s1 = loadOrCreateSecret(dir);
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dir, "secret")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(loadOrCreateSecret(dir)).toBe(s1);
  });
});
