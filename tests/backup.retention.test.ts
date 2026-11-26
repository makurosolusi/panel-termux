import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "bun";
import { eq } from "drizzle-orm";
import { applyPrune, type PruneRun, planPrune } from "@/server/backup/backup.retention";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, type BackupItemRow, backupRun } from "@/server/db/schema";
import { startMockS3 } from "./backup.s3mock";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 27, 12);
const opts = { retentionDays: 7, keepMinRuns: 3, includeSecrets: false };

type K = BackupItemRow["kind"];
const it = (runId: string, kind: K, name: string = kind, ok = true, pruned = false) => ({
  kind,
  name,
  key: `${runId}-${name}`,
  ok,
  pruned,
});
/** A run `daysAgo` old with one database item + checksums/manifest (and any extra items). */
const run = (id: string, daysAgo: number, status = "succeeded", extra: PruneRun["items"] = []): PruneRun => ({
  id,
  status,
  startedAt: new Date(NOW.getTime() - daysAgo * DAY),
  items: [it(id, "database", "shop"), ...extra, it(id, "checksums"), it(id, "manifest")],
});
const keys = (runs: PruneRun[], o = opts) => planPrune(runs, o, NOW).map((c) => c.key);

describe("planPrune (pure, records only)", () => {
  test("old runs go; the newest keepMinRuns succeeded runs stay even when old", () => {
    const runs = [run("a", 40), run("b", 30), run("c", 20), run("d", 10), run("e", 9)];
    expect(keys(runs)).toEqual(["a-shop", "a-checksums", "a-manifest", "b-shop", "b-checksums", "b-manifest"]);
    expect(keys(runs, { ...opts, keepMinRuns: 1 })).toHaveLength(12);
  });

  test("partial runs are not protected as runs, but the last good item per (kind,name) is", () => {
    const runs = [run("a", 30), run("x", 20, "partial", [it("x", "database", "blog")]), run("y", 1)];
    // x/blog is the only copy of blog: kept, so x's checksums/manifest stay too; x/shop has a newer copy.
    expect(keys(runs)).toEqual(["x-shop"]);
    expect(keys([...runs, run("z", 0, "succeeded", [it("z", "database", "blog")])])).toEqual([
      "x-shop",
      "x-blog",
      "x-checksums",
      "x-manifest",
    ]);
  });

  test("a deleted site's database keeps its last item forever; failed items are never candidates", () => {
    const runs = [run("a", 30, "succeeded", [it("a", "database", "gone"), it("a", "globals", "globals", false)])];
    const all = [...runs, run("b", 2), run("c", 1), run("d", 0)];
    expect(keys(all)).not.toContain("a-gone");
    expect(keys(all)).not.toContain("a-globals");
  });

  test("secrets: protected while include_secrets is on; all go, regardless of age, once off", () => {
    const runs = [run("a", 1, "succeeded", [it("a", "secrets")]), run("b", 0, "succeeded", [it("b", "secrets")])];
    expect(keys(runs, { ...opts, includeSecrets: true })).toEqual([]);
    expect(keys(runs)).toEqual(["a-secrets", "b-secrets"]);
  });

  test("insert order decides 'newest', not the (possibly wrong) clock; running and pruned rows are skipped", () => {
    // b was inserted after a but carries an older clock time: b's item is still the protected newest copy.
    const runs = [run("a", 30, "partial"), run("b", 40, "partial"), run("r", 50, "running")];
    expect(keys(runs)).toEqual(["a-shop", "a-checksums", "a-manifest"]);
    const pruned = { ...run("p", 60, "partial"), items: [it("p", "database", "shop", true, true)] };
    expect(keys([pruned, ...runs])).not.toContain("p-shop");
  });
});

describe("applyPrune", () => {
  const dir = mkdtempSync(join(tmpdir(), "panel-retention-"));
  const s3 = startMockS3("bkt");
  const cfg = { endpoint: s3.endpoint, bucket: "bkt", region: "auto", accessKeyId: "AKID", secretAccessKey: "SK" };
  const client = new S3Client(cfg);
  let db: Db;
  const insert = (r: PruneRun) => {
    db.insert(backupRun)
      .values({
        id: r.id,
        trigger: "manual",
        status: r.status as "succeeded",
        startedAt: r.startedAt,
        items: r.items as BackupItemRow[],
      })
      .run();
    for (const i of r.items) s3.objects.set(i.key, { body: new Uint8Array([1]), lastModified: new Date() });
  };
  const row = (id: string) => db.select().from(backupRun).where(eq(backupRun.id, id)).get();
  beforeAll(() => {
    db = openDb(dir);
    runMigrations(db);
  });
  afterAll(() => {
    s3.stop();
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("deletes planned objects, marks items pruned, sets pruned_at when a run is empty, audits", async () => {
    const runs = [run("a", 40), run("b", 3), run("c", 2), run("d", 1)];
    runs.forEach(insert);
    const res = await applyPrune(db, client, cfg, planPrune(runs, opts, NOW), "d");
    expect(res).toEqual({ deleted: 3, failed: 0, denied: 0 });
    expect(s3.objects.has("a-shop")).toBe(false);
    expect(s3.objects.has("b-shop")).toBe(true);
    expect(row("a")?.items.every((i) => i.pruned)).toBe(true);
    expect(row("a")?.prunedAt).toBeInstanceOf(Date);
    expect(row("b")?.prunedAt).toBeNull();
    const audit = db.select().from(auditLog).where(eq(auditLog.action, "backup.prune")).all();
    expect(audit.at(-1)).toMatchObject({ actorId: null, target: "d", meta: { deleted: 3, failed: 0, denied: 0 } });
  });

  test("AccessDenied stops the pass and flags the current manifest retention_denied (K21)", async () => {
    const runs = [run("e", 50), run("f", 45), run("g", 1)];
    runs.forEach(insert);
    s3.setFaults({ denyDelete: (k) => k === "e-checksums" });
    try {
      const plan = planPrune(runs, { ...opts, keepMinRuns: 1 }, NOW);
      const res = await applyPrune(db, client, cfg, plan, "g");
      expect(res).toEqual({ deleted: 1, failed: 0, denied: 1 });
      expect(s3.objects.has("f-shop")).toBe(true); // never attempted after the denial
      expect(row("e")?.items.map((i) => !!i.pruned)).toEqual([true, false, false]);
      expect(row("g")?.items.find((i) => i.kind === "manifest")?.warning).toBe("retention_denied");
      expect(s3.requests.some((r) => r.key === "")).toBe(false);
    } finally {
      s3.setFaults({});
    }
  });
});
