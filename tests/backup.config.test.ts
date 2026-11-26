import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDue, nextRunAt, readBackupConfig, runKeyStem } from "@/server/backup/backup.config";
import { backupScheduler, backupServiceFor } from "@/server/backup/backup.service";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, backupRun, user } from "@/server/db/schema";
import { InvalidSettingError, SETTINGS, type SettingKey, setSetting } from "@/server/settings.service";
import { createFakeSystem } from "@/server/system/system.fake";
import { startMockS3 } from "./backup.s3mock";

// Local-time constructors keep these independent of the machine's time zone.
const at = (d: number, h: number, m = 0, s = 0) => new Date(2026, 10, d, h, m, s);

describe("nextRunAt", () => {
  test("later today when the hour is still ahead", () => {
    expect(nextRunAt(3, at(26, 1, 30))).toEqual(at(26, 3));
  });
  test("tomorrow when the hour passed or is exactly now", () => {
    expect(nextRunAt(3, at(26, 3, 0, 1))).toEqual(at(27, 3));
    expect(nextRunAt(3, at(26, 3))).toEqual(at(27, 3));
    expect(nextRunAt(0, at(26, 23, 59))).toEqual(at(27, 0));
  });
  test("crosses month end", () => {
    expect(nextRunAt(3, at(30, 4))).toEqual(new Date(2026, 11, 1, 3));
  });
});

describe("isDue", () => {
  test("only when the hour boundary falls in (prev, now]", () => {
    expect(isDue(3, at(26, 2, 59), at(26, 3))).toBe(true);
    expect(isDue(3, at(26, 3), at(26, 3, 1))).toBe(false); // boundary was the previous tick
    expect(isDue(3, at(26, 3, 30), at(26, 3, 31))).toBe(false); // booted mid-hour: no run
    expect(isDue(null, at(26, 2, 59), at(26, 3))).toBe(false); // off
  });
});

test("runKeyStem uses local date folder and HHMMSS", () => {
  expect(runKeyStem("panel-termux/", at(6, 3, 4, 5))).toBe("panel-termux/2026-11-06/030405-");
});

describe("backup setting validators", () => {
  const v = (k: keyof typeof SETTINGS, x: string) => SETTINGS[k].validate(x);
  test("hour", () => {
    expect(["0", "23", "off"].map((x) => v("backup.hour", x))).toEqual([null, null, null]);
    for (const x of ["24", "-1", "3.5", "OFF"]) expect(v("backup.hour", x)).not.toBeNull();
  });
  test("retention 1-365", () => {
    expect(v("backup.retention_days", "1")).toBeNull();
    expect(v("backup.retention_days", "365")).toBeNull();
    for (const x of ["0", "366", "7d"]) expect(v("backup.retention_days", x)).not.toBeNull();
  });
  test("prefix must end with / and stay relative", () => {
    expect(v("backup.prefix", "panel-termux/")).toBeNull();
    expect(v("backup.prefix", "a/b/")).toBeNull();
    for (const x of ["nope", "/abs/", "a//b/", "a/../", "../"]) expect(v("backup.prefix", x)).not.toBeNull();
  });
  test("endpoint is an http(s) origin without credentials", () => {
    expect(v("backup.s3_endpoint", "https://abc.r2.cloudflarestorage.com")).toBeNull();
    for (const x of ["ftp://x", "https://u:p@x.io", "https://x.io/bucket", "not a url"])
      expect(v("backup.s3_endpoint", x)).not.toBeNull();
  });
  test("credentials are secret settings", () => {
    expect(SETTINGS["backup.s3_access_key_id"].secret).toBe(true);
    expect(SETTINGS["backup.s3_secret_access_key"].secret).toBe(true);
    expect(InvalidSettingError).toBeDefined();
  });
});

describe("daily scheduler tick", () => {
  // test-only dummy values
  const SECRET = "0123456789abcdef".repeat(4);
  const dir = mkdtempSync(join(tmpdir(), "panel-sched-"));
  const db = openDb(dir);
  runMigrations(db);
  const s3 = startMockS3("bkt");
  const deps = { db, secret: SECRET };
  afterAll(() => {
    s3.stop();
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads keep_min_runs / max_item_mb / include_secrets settings with defaults", () => {
    expect(readBackupConfig(deps)).toMatchObject({
      keepMinRuns: 3,
      maxItemBytes: 2048 * 1024 * 1024,
      includeSecrets: false,
    });
  });

  test("runs at the hour, records lastTickAt, prunes the audit log when the local date changes", async () => {
    db.insert(user).values({ id: "u1", email: "a@x.io", name: "a", role: "admin" }).run();
    const set = (k: SettingKey, v: string) => setSetting(deps, k, v, "u1");
    set("backup.s3_endpoint", s3.endpoint);
    set("backup.s3_bucket", "bkt");
    set("backup.s3_access_key_id", "AKIDTEST0001");
    set("backup.s3_secret_access_key", "SchedTestOnlySecret0123");
    set("backup.hour", "3");
    db.insert(auditLog)
      .values({ action: "auth.sign_in", at: new Date(2020, 0, 1) })
      .run();
    const backup = backupServiceFor({ ...deps, dataDir: dir, system: createFakeSystem({ home: join(dir, "home") }) });
    const times = [at(26, 2, 59), at(26, 3), at(27, 0, 1)];
    let i = 0;
    const stop = backup.startScheduler(5, () => times[Math.min(i++, times.length - 1)] as Date);
    try {
      await Bun.sleep(40);
      await backup.idle();
    } finally {
      stop();
    }
    const rows = db.select().from(backupRun).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: "schedule", actorId: null });
    expect(backupScheduler.lastTickAt()).toEqual(at(27, 0, 1));
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .some((r) => r.at.getFullYear() === 2020),
    ).toBe(false);
  });
});
