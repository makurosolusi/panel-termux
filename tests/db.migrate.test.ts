import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, openDb } from "@/server/db/client";
import { embeddedMigrations, runMigrations } from "@/server/db/migrate";

const root = mkdtempSync(join(tmpdir(), "panel-db-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const freshDb = (): Db => {
  const dir = join(root, String(n++));
  mkdirSync(dir);
  return openDb(dir);
};

type Internals = { dialect: { migrate(m: unknown[], s: unknown, c: object): void }; session: unknown };
/** Applies only the first `count` embedded migrations (a DB as an older panel left it). */
const migrateTo = (db: Db, count: number) => {
  const i = db as unknown as Internals;
  i.dialect.migrate(embeddedMigrations().slice(0, count), i.session, {});
};

const columns = (db: Db, table: string) =>
  (db.$client.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const exists = (db: Db, name: string) =>
  db.$client.query("SELECT name FROM sqlite_master WHERE name = ?").get(name) !== null;

/** Data a v0.2.2 panel (schema 0005) could hold. test-only fixture values. */
function seed022(db: Db) {
  const q = (sql: string, ...args: (string | number | null)[]) => db.$client.query(sql).run(...args);
  q("INSERT INTO user (id, name, email, role) VALUES ('u1', 'Admin', 'admin@example.test', 'admin')");
  q("INSERT INTO audit_log (actor_id, action, target) VALUES ('u1', 'site.create', 'blog')");
  q("INSERT INTO audit_log (actor_id, action) VALUES (NULL, 'backup.run')");
  q("INSERT INTO audit_log (actor_id, action) VALUES (NULL, 'user.delete')");
  q("INSERT INTO site (name, port, runtime, managed, dir) VALUES ('blog', 3001, 'native', 1, '/sites/blog')");
  q(
    "INSERT INTO job (id, kind, target, status, steps, actor_id, started_at) VALUES ('j1', 'site.create', 'blog', 'failed', ?, 'u1', ?)",
    JSON.stringify([{ key: "env", label: "Write env", status: "done" }]),
    Date.now(),
  );
  q(
    "INSERT INTO deploy (id, site_name, kind, status, sha256, size_bytes, runtime, job_id, at) VALUES ('d1', 'blog', 'deploy', 'succeeded', 'ab', 10, 'native', 'j1', ?)",
    Date.now(),
  );
  q(
    "INSERT INTO backup_run (id, trigger, status, items, started_at) VALUES ('b1', 'schedule', 'succeeded', ?, ?)",
    JSON.stringify([{ kind: "panel", name: "panel", key: "k", sizeBytes: 1, ok: true, error: null }]),
    Date.now(),
  );
}

describe("runMigrations", () => {
  test("applies embedded migrations idempotently and records schema_version", () => {
    expect(embeddedMigrations().length).toBeGreaterThan(0);
    const db = freshDb();
    const v1 = runMigrations(db);
    const v2 = runMigrations(db); // second run must be a no-op
    expect(v2).toBe(v1);
    expect(v1).toBe("0009_user_locale");
    const row = db.$client.query("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe(v1);
    const applied = db.$client.query("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number };
    expect(applied.n).toBe(embeddedMigrations().length);
    // 0005_drop_invites: the invite table from the invite-only era is gone.
    expect(exists(db, "allowed_email")).toBe(false);
    expect((db.$client.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    db.$client.close();
  });

  test("upgrades a v0.2.2 database with data (0005 → 0009) and backfills the audit actor", () => {
    const db = freshDb();
    migrateTo(db, 6);
    expect(exists(db, "backup_restore")).toBe(false);
    seed022(db);

    runMigrations(db);

    // 0006
    expect(columns(db, "audit_log")).toEqual(
      expect.arrayContaining(["actor_kind", "actor_label", "actor_email", "ip_masked", "user_agent", "request_id"]),
    );
    const audit = db.$client
      .query("SELECT action, actor_kind, actor_label, actor_email FROM audit_log ORDER BY id")
      .all();
    expect(audit).toEqual([
      { action: "site.create", actor_kind: "user", actor_label: "Admin", actor_email: "admin@example.test" },
      { action: "backup.run", actor_kind: "system", actor_label: null, actor_email: null },
      { action: "user.delete", actor_kind: "unknown", actor_label: null, actor_email: null },
    ]);
    expect(db.$client.query("SELECT includes_secrets, panel_version, pruned_at FROM backup_run").get()).toEqual({
      includes_secrets: 0,
      panel_version: null,
      pruned_at: null,
    });
    expect(columns(db, "backup_restore")).toContain("target_db");
    // 0007
    expect(db.$client.query("SELECT health_path, health_expect, health_timeout_sec FROM site").get()).toEqual({
      health_path: "/",
      health_expect: "lt500",
      health_timeout_sec: 60,
    });
    expect(db.$client.query("SELECT input, resolved_by FROM job").get()).toEqual({ input: null, resolved_by: null });
    expect(columns(db, "deploy")).toEqual(
      expect.arrayContaining(["file_name", "finished_at", "bin_ino", "bin_mtime_ms"]),
    );
    expect(exists(db, "job_target_started_idx")).toBe(true);
    // 0008
    for (const t of ["metric_sample", "check_result", "problem_event"]) expect(exists(db, t)).toBe(true);
    const ddl = db.$client.query("SELECT sql FROM sqlite_master WHERE name = 'check_result'").get() as { sql: string };
    expect(ddl.sql).toContain("WITHOUT ROWID");

    // 0009: locale column, null for old accounts; no alerts configured → no language row (default en).
    expect(db.$client.query("SELECT locale FROM user").get()).toEqual({ locale: null });
    expect(db.$client.query("SELECT 1 FROM setting WHERE key = 'alerts.language'").get()).toBeNull();

    // Old rows still read through drizzle with the new schema.
    expect(db.query.site.findFirst().sync()?.healthExpect).toBe("lt500");
    expect(db.query.backupRun.findFirst().sync()?.includesSecrets).toBe(false);

    // Re-run is a no-op (journal) and the data is untouched.
    runMigrations(db);
    expect((db.$client.query("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(3);
    db.$client.close();
  });

  test("problem_event allows one open event per key", () => {
    const db = freshDb();
    runMigrations(db);
    const ins = db.$client.query(
      "INSERT INTO problem_event (key, code, kind, target, severity, params, opened_at, last_seen_at, closed_at) VALUES ('c:t', 'c', 'k', 't', 'warning', '{}', 1, 1, ?)",
    );
    ins.run(5);
    ins.run(null);
    expect(() => ins.run(null)).toThrow(/UNIQUE/);
    db.$client.close();
  });

  test("0008 statements are safe to execute twice (IF NOT EXISTS)", () => {
    const db = freshDb();
    runMigrations(db);
    const m0008 = embeddedMigrations()[8];
    expect(() => {
      for (const stmt of m0008?.sql ?? []) db.$client.run(stmt);
    }).not.toThrow();
    db.$client.close();
  });

  const languageRow = (db: Db) => db.$client.query("SELECT value FROM setting WHERE key = 'alerts.language'").get();

  test("0009 keeps Telegram in Indonesian for panels with alerts set up before 0.6.0 (E11)", () => {
    for (const key of ["alerts.telegram_bot_token", "alerts.telegram_chat_id"]) {
      const db = freshDb();
      migrateTo(db, 9);
      db.$client.query("INSERT INTO setting (key, value) VALUES (?, 'x')").run(key); // test-only value
      runMigrations(db);
      expect(languageRow(db)).toEqual({ value: "id" });
      db.$client.close();
    }
  });

  test("0009 backfill is idempotent and never overrides a chosen language", () => {
    const db = freshDb();
    migrateTo(db, 9);
    db.$client.run("INSERT INTO setting (key, value) VALUES ('alerts.telegram_chat_id', '-100123')");
    db.$client.run("INSERT INTO setting (key, value) VALUES ('alerts.language', 'en')");
    runMigrations(db);
    expect(languageRow(db)).toEqual({ value: "en" });
    const backfill = embeddedMigrations()[9]?.sql.at(-1) ?? "";
    expect(backfill).toContain("INSERT OR IGNORE");
    db.$client.run("DELETE FROM setting WHERE key = 'alerts.language'");
    db.$client.run(backfill);
    db.$client.run(backfill);
    expect(db.$client.query("SELECT COUNT(*) AS n FROM setting WHERE key = 'alerts.language'").get()).toEqual({ n: 1 });
    expect(languageRow(db)).toEqual({ value: "id" });
    db.$client.close();
  });

  test("0009 on a fresh panel: no language row, so the default (en) applies", () => {
    const db = freshDb();
    runMigrations(db);
    expect(languageRow(db)).toBeNull();
    expect(columns(db, "user")).toContain("locale");
    db.$client.close();
  });
});
