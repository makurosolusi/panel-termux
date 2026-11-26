import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/server/db/client";
import { embeddedMigrations, runMigrations } from "@/server/db/migrate";

const dir = mkdtempSync(join(tmpdir(), "panel-db-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("runMigrations", () => {
  test("applies embedded migrations idempotently and records schema_version", () => {
    expect(embeddedMigrations().length).toBeGreaterThan(0);
    const db = openDb(dir);
    const v1 = runMigrations(db);
    const v2 = runMigrations(db); // second run must be a no-op
    expect(v2).toBe(v1);
    const row = db.$client.query("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe(v1);
    const applied = db.$client.query("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number };
    expect(applied.n).toBe(embeddedMigrations().length);
    // 0005_drop_invites: the invite table from the invite-only era is gone.
    expect(db.$client.query("SELECT name FROM sqlite_master WHERE name = 'allowed_email'").get()).toBeNull();
    expect((db.$client.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    db.$client.close();
  });
});
