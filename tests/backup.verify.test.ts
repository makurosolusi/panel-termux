import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { verifyBackupTarget } from "@/server/backup/backup.verify";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, user } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { setSetting } from "@/server/settings.service";
import { startMockS3 } from "./backup.s3mock";

// test-only dummy values
const SECRET = "0123456789abcdef".repeat(4);
const S3_SECRET = "VerifyTestOnlySecret0123456789";
const dir = mkdtempSync(join(tmpdir(), "panel-verify-"));
const s3 = startMockS3("bkt");
let db: Db;
const deps = () => ({ db, secret: SECRET });
const verify = (draft = {}, timeoutMs?: number) => verifyBackupTarget(deps(), "u1", draft, timeoutMs);

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  db.insert(user).values({ id: "u1", email: "root@x.io", name: "root", role: "super_admin" }).run();
});
beforeEach(() => s3.setFaults({}));
afterAll(() => {
  s3.stop();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

test("nothing stored and no draft: not_configured, every step skipped, still audited", async () => {
  const v = await verify();
  expect(v).toMatchObject({ ok: false, code: "not_configured", failedStep: null, detail: null });
  expect(v.steps.map((s) => s.code)).toEqual(["skipped", "skipped", "skipped"]);
  expect(db.select().from(auditLog).where(eq(auditLog.action, "backup.verify")).all()).toHaveLength(1);
});

test("a full draft works without stored settings: write → stat → delete, probe removed, no listing", async () => {
  const draft = {
    endpoint: s3.endpoint,
    bucket: "bkt",
    accessKeyId: "AKIDTEST0001",
    secretAccessKey: S3_SECRET,
    prefix: "p/",
  };
  const v = await verify(draft);
  expect(v).toMatchObject({ ok: true, code: "ok", failedStep: null });
  expect(v.steps).toEqual([
    { step: "write", ok: true, code: "ok" },
    { step: "read", ok: true, code: "ok" },
    { step: "delete", ok: true, code: "ok" },
  ]);
  const put = s3.requests.find((r) => r.method === "PUT");
  expect(put?.key).toMatch(/^p\/\.panel-termux-check-[0-9a-f-]{36}$/);
  expect(s3.objects.size).toBe(0);
  expect(s3.requests.map((r) => r.method)).toEqual(["PUT", "HEAD", "DELETE"]);
});

test("stored settings fill what the draft lacks; S3 codes map per step", async () => {
  for (const [k, v] of [
    ["backup.s3_endpoint", s3.endpoint],
    ["backup.s3_bucket", "bkt"],
    ["backup.s3_access_key_id", "AKIDTEST0001"],
    ["backup.s3_secret_access_key", S3_SECRET],
  ] as const)
    setSetting(deps(), k, v, "u1");
  expect((await verify()).code).toBe("ok");
  expect(await verify({ bucket: "nope" })).toMatchObject({ code: "bucket_not_found", failedStep: "write" });

  s3.setFaults({ denyPut: () => true });
  const w = await verify();
  expect(w).toMatchObject({ ok: false, code: "write_denied", failedStep: "write" });
  expect(w.steps.map((s) => s.code)).toEqual(["write_denied", "skipped", "skipped"]);

  s3.setFaults({ denyDelete: () => true });
  const d = await verify();
  expect(d).toMatchObject({ code: "delete_denied", failedStep: "delete" });
  expect(d.steps.map((s) => s.ok)).toEqual([true, true, false]);

  s3.setFaults({ truncatePut: () => true });
  expect(await verify()).toMatchObject({ code: "read_failed", failedStep: "read" });

  s3.setFaults({ failPut: () => true });
  expect(await verify()).toMatchObject({ code: "s3_error", failedStep: "write" });
});

test("unreachable endpoint and timeout", async () => {
  expect(await verify({ endpoint: "http://127.0.0.1:1" })).toMatchObject({ code: "unreachable", failedStep: "write" });
  s3.setFaults({ hang: () => true });
  const t = await verify({}, 200);
  expect(t).toMatchObject({ code: "timeout", failedStep: "write" });
  expect(t.ms).toBeLessThan(2_000);
});

test("audit records ok + code only; the secret key never reaches detail, audit or logs", async () => {
  const rows = db.select().from(auditLog).where(eq(auditLog.action, "backup.verify")).all();
  expect(rows.at(-1)?.meta).toEqual({ ok: false, code: "timeout" });
  expect(rows.at(-2)).toMatchObject({ actorId: "u1", target: "bkt" });
  expect(JSON.stringify(rows) + JSON.stringify(readLogs({ limit: 2000 }))).not.toContain(S3_SECRET);
});
