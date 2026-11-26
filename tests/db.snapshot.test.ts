import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { SNAPSHOT_KEEP, snapshotBeforeMigrations, snapshotOnBoot } from "@/server/db/snapshot";

const root = mkdtempSync(join(tmpdir(), "panel-snap-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
/** A migrated DB with the newest migration "pending" (its journal row removed), like an upgrade boot. */
function pendingDb(): { db: Db; dir: string } {
  const dir = join(root, `d${++n}`);
  mkdirSync(dir);
  const db = openDb(dir);
  runMigrations(db);
  db.$client.run(
    "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)",
  );
  db.$client.run("INSERT INTO app_meta (key, value) VALUES ('probe', 'kept')");
  return { db, dir };
}
const at = (s: number) => new Date(2026, 10, 27, 10, 0, s);

describe("snapshotBeforeMigrations", () => {
  test("fresh install (no migrations table) → no snapshot", async () => {
    const dir = join(root, "fresh");
    mkdirSync(dir);
    expect(await snapshotBeforeMigrations(openDb(dir), dir, null)).toBeNull();
    expect(() => readdirSync(join(dir, "snapshots"))).toThrow();
  });

  test("nothing pending → no snapshot", async () => {
    const dir = join(root, "current");
    mkdirSync(dir);
    const db = openDb(dir);
    runMigrations(db);
    expect(await snapshotBeforeMigrations(db, dir, "0.3.0")).toBeNull();
  });

  test("pending migrations → readable VACUUM INTO copy, mode 600, named by version and local time", async () => {
    const { db, dir } = pendingDb();
    const file = await snapshotBeforeMigrations(db, dir, "0.2.4", at(5));
    expect(file).toBe(join(dir, "snapshots", "panel.db.0.2.4.20261127100005"));
    expect(statSync(file as string).mode & 0o777).toBe(0o600);
    const copy = new Database(file as string, { readonly: true });
    expect(copy.query("SELECT value FROM app_meta WHERE key = 'probe'").get()).toEqual({ value: "kept" });
    copy.close();
  });

  test("unknown previous version (0.2.x) is named `unknown`; only the newest 3 are kept", async () => {
    const { db, dir } = pendingDb();
    for (let s = 1; s <= 5; s++) await snapshotBeforeMigrations(db, dir, s === 5 ? null : "0.2.4", at(s));
    const left = readdirSync(join(dir, "snapshots")).sort();
    expect(left).toHaveLength(SNAPSHOT_KEEP);
    expect(left).toEqual([
      "panel.db.0.2.4.20261127100003",
      "panel.db.0.2.4.20261127100004",
      "panel.db.unknown.20261127100005",
    ]);
  });

  test("failure throws with context", async () => {
    const { db, dir } = pendingDb();
    writeFileSync(join(dir, "snapshots"), "not a directory");
    await expect(snapshotBeforeMigrations(db, dir, "0.2.4", at(1))).rejects.toThrow(
      /snapshotBeforeMigrations to .* failed/,
    );
  });

  test("a failed VACUUM leaves no partial file; an existing snapshot is never deleted", async () => {
    const { db, dir } = pendingDb();
    const file = (await snapshotBeforeMigrations(db, dir, "0.2.4", at(1))) as string;
    await expect(snapshotBeforeMigrations(db, dir, "0.2.4", at(1))).rejects.toThrow(/already exists/);
    expect(existsSync(file)).toBe(true);
    db.$client.close(); // VACUUM on a closed handle fails after the target path was chosen
    await expect(snapshotBeforeMigrations(db, dir, "0.2.4", at(2))).rejects.toThrow();
    expect(existsSync(file.replace("100001", "100002"))).toBe(false);
  });
});

describe("snapshotOnBoot", () => {
  const blocked = () => {
    const { db, dir } = pendingDb();
    writeFileSync(join(dir, "snapshots"), "x");
    return { db, dir };
  };

  test("failure waits 60 s then exits 1", async () => {
    const { db, dir } = blocked();
    const calls: string[] = [];
    await expect(
      snapshotOnBoot(db, dir, "0.2.4", {
        skip: false,
        sleep: async (ms) => calls.push(`sleep ${ms}`),
        exit: (code) => {
          calls.push(`exit ${code}`);
          throw new Error("exited");
        },
      }),
    ).rejects.toThrow("exited");
    expect(calls).toEqual(["sleep 60000", "exit 1"]);
  });

  test("PANEL_SKIP_SNAPSHOT=1 continues without a snapshot", async () => {
    const { db, dir } = blocked();
    const exit = (): never => {
      throw new Error("must not exit");
    };
    expect(await snapshotOnBoot(db, dir, "0.2.4", { skip: true, exit })).toBeNull();
  });

  test("success returns the path", async () => {
    const { db, dir } = pendingDb();
    expect(await snapshotOnBoot(db, dir, "0.2.4", { now: at(9) })).toEndWith("panel.db.0.2.4.20261127100009");
  });
});
