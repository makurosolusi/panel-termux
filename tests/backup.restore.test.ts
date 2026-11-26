import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { restoreTargetName } from "@/server/backup/backup.restore";
import { backupServiceFor } from "@/server/backup/backup.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, backupRestore, backupRun, site, user } from "@/server/db/schema";
import { ApiError } from "@/server/routes/http.error";
import { type SettingKey, setSetting } from "@/server/settings.service";
import { createFakeSystem } from "@/server/system/system.fake";
import { SQL_IDENT_RE } from "@/server/system/system.types";
import { startMockS3 } from "./backup.s3mock";

// test-only dummy values
const SECRET = "0123456789abcdef".repeat(4);
const GB = 1024 ** 3;
const dir = mkdtempSync(join(tmpdir(), "panel-restore-"));
const system = createFakeSystem({ home: join(dir, "home") });
const s3 = startMockS3("bkt");
let free = 10 * GB;
let db: Db;
let runId = "";
const PAGE = { page: 1, pageSize: 20, offset: 0 };
const svc = () => backupServiceFor({ db, secret: SECRET, dataDir: dir, system, freeBytes: () => free });
const fails = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  expect(e).toMatchObject({ status, code });
};
const runRow = () => db.select().from(backupRun).where(eq(backupRun.id, runId)).get() as typeof backupRun.$inferSelect;
const dbIndex = (name: string) => runRow().items.findIndex((i) => i.kind === "database" && i.name === name);
async function restore(name: string) {
  const started = await svc().restores.start("u1", runId, String(dbIndex(name)));
  await svc().idle();
  return {
    started,
    row: svc()
      .restores.list(PAGE)
      .items.find((r) => r.id === started.restoreId),
  };
}

beforeAll(async () => {
  db = openDb(dir);
  runMigrations(db);
  db.insert(user).values({ id: "u1", email: "a@x.io", name: "Admin", role: "admin" }).run();
  const set = (k: SettingKey, v: string) => setSetting({ db, secret: SECRET }, k, v, "u1");
  set("backup.s3_endpoint", s3.endpoint);
  set("backup.s3_bucket", "bkt");
  set("backup.s3_access_key_id", "AKIDTEST0001");
  set("backup.s3_secret_access_key", "RestoreTestOnlySecret0123");
  runId = svc().start("manual", "u1").runId;
  await svc().idle();
});
afterAll(() => {
  s3.stop();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("restoreTargetName", () => {
  const at = new Date(2026, 10, 27, 9, 5);
  test("<name>_r<yyyymmddHHMM>, then _2, _3 on collision", () => {
    expect(restoreTargetName("shop", at, new Set())).toBe("shop_r202611270905");
    expect(restoreTargetName("shop", at, new Set(["shop_r202611270905"]))).toBe("shop_r202611270905_2");
    expect(restoreTargetName("shop", at, new Set(["shop_r202611270905", "shop_r202611270905_2"]))).toBe(
      "shop_r202611270905_3",
    );
  });
  test("long or odd names are cut and cleaned into a valid identifier ≤ 63", () => {
    const n = restoreTargetName("x".repeat(80), at, new Set());
    expect(n.length).toBeLessThanOrEqual(63);
    expect(n).toMatch(SQL_IDENT_RE);
    expect(restoreTargetName("9-Odd.Name", at, new Set())).toMatch(/^db_9_odd_name_r/);
  });
});

describe("restore into a new database", () => {
  test("refuses non-database items, unknown items, pruned items and too little space", async () => {
    await fails(svc().restores.start("u1", runId, "0"), 400, "not_database"); // globals
    await fails(svc().restores.start("u1", runId, "99"), 404, "not_found");
    await fails(svc().restores.start("u1", "nope", "1"), 404, "not_found");
    free = 100;
    await fails(svc().restores.start("u1", runId, String(dbIndex("solusi"))), 409, "insufficient_space");
    free = 10 * GB;
    expect(db.select().from(backupRestore).all()).toHaveLength(0); // refused before insert
  });

  test("downloads, checks sha256, restores with the source owner, records tables; status + audit", async () => {
    const { started, row } = await restore("solusi");
    expect(started.targetDb).toMatch(/^solusi_r\d{12}$/);
    expect(row).toMatchObject({ status: "succeeded", tableCount: 3, sourceName: "solusi", errorCode: null });
    expect(row).toMatchObject({ inUse: false, droppedAt: null, actor: { id: "u1", name: "Admin" } });
    const target = (await system.postgres.listDatabases()).find((d) => d.name === started.targetDb);
    expect(target?.owner).toBe("solusi");
    expect(svc().status().lastRestoreTest).toMatchObject({ sourceName: "solusi" });
    expect(svc().status().restoring).toBe(false);
    const a = db.select().from(auditLog).where(eq(auditLog.action, "backup.restore")).all();
    expect(a.at(-1)).toMatchObject({ actorId: "u1", target: started.targetDb, meta: { runId, item: "solusi" } });
  });

  test("checksum mismatch and a missing object fail with their codes", async () => {
    const r = runRow();
    const i = dbIndex("adminneo");
    const tampered = r.items.map((x, idx) => (idx === i ? { ...x, sha256: "0".repeat(64) } : x));
    db.update(backupRun).set({ items: tampered }).where(eq(backupRun.id, runId)).run();
    expect((await restore("adminneo")).row).toMatchObject({ status: "failed", errorCode: "checksum_mismatch" });
    db.update(backupRun).set({ items: r.items }).where(eq(backupRun.id, runId)).run();

    const body = s3.objects.get(r.items[i]?.key as string);
    s3.objects.delete(r.items[i]?.key as string);
    expect((await restore("adminneo")).row).toMatchObject({ status: "failed", errorCode: "download_failed" });
    if (body) s3.objects.set(r.items[i]?.key as string, body);
  });

  test("a restored test DB is skipped by backups until a site uses it", async () => {
    const target = svc()
      .restores.list(PAGE)
      .items.find((r) => r.status === "succeeded")?.targetDb as string;
    const names = async () => {
      const id = svc().start("manual", "u1").runId;
      await svc().idle();
      const row = db.select().from(backupRun).where(eq(backupRun.id, id)).get();
      return row?.items.filter((i) => i.kind === "database").map((i) => i.name);
    };
    expect(await names()).not.toContain(target);
    db.insert(site)
      .values({ name: "shop", port: 3100, database: target, runtime: "native", managed: true, dir: "~/sites/shop" })
      .run();
    expect(await names()).toContain(target);
  });

  test("drop: typed confirm, refused while a site uses it, then drops only the database; once", async () => {
    const r = svc()
      .restores.list(PAGE)
      .items.find((x) => x.status === "succeeded");
    if (!r) throw new Error("no succeeded restore");
    expect(r.inUse).toBe(true);
    await fails(svc().restores.drop("u1", r.id, "wrong"), 400, "confirm_mismatch");
    await fails(svc().restores.drop("u1", r.id, r.targetDb), 409, "in_use");
    db.delete(site).where(eq(site.name, "shop")).run();
    await svc().restores.drop("u1", r.id, r.targetDb);
    expect((await system.postgres.listDatabases()).some((d) => d.name === r.targetDb)).toBe(false);
    expect(
      svc()
        .restores.list(PAGE)
        .items.find((x) => x.id === r.id)?.droppedAt,
    ).not.toBeNull();
    await fails(svc().restores.drop("u1", r.id, r.targetDb), 409, "already_dropped");
    await fails(svc().restores.drop("u1", "nope", "x"), 404, "not_found");
    const a = db.select().from(auditLog).where(eq(auditLog.action, "backup.restore_drop")).all();
    expect(a.at(-1)).toMatchObject({ actorId: "u1", target: r.targetDb });
  });

  test("a restore left running by a restart is marked failed: interrupted at the next start", () => {
    db.insert(backupRestore)
      .values({
        id: "stuck",
        runId,
        itemIndex: 1,
        sourceName: "adminneo",
        targetDb: "adminneo_r202601010000",
        status: "running",
        startedAt: new Date(),
      })
      .run();
    const db2 = openDb(dir); // a fresh Db = a fresh backup service, as after a panel restart
    try {
      backupServiceFor({ db: db2, secret: SECRET, dataDir: dir, system });
      const row = db.select().from(backupRestore).where(eq(backupRestore.id, "stuck")).get();
      expect(row).toMatchObject({ status: "failed", error: "interrupted by panel restart" });
    } finally {
      db2.$client.close();
    }
  });
});
