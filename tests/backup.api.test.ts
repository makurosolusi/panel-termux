import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { createAuth } from "@/server/auth/auth.service";
import { createBackupRoutes } from "@/server/backup/backup.routes";
import { backupServiceFor } from "@/server/backup/backup.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, backupRun, user } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { type SettingKey, setSetting } from "@/server/settings.service";
import { createFakeSystem } from "@/server/system/system.fake";
import type { BackupRun, BackupStatus } from "@/shared/backup.types";
import type { Page } from "@/shared/dev.types";
import type { Role } from "@/shared/roles";
import { startMockS3 } from "./backup.s3mock";

// test-only dummy values
const BASE = "http://localhost";
const SECRET = "0123456789abcdef".repeat(4);
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: [] };
const BUCKET = "bkt";
const PREFIX = "pt/";
const KEY_ID = "AKIDTESTONLY0001";
const S3_SECRET = "TestOnlySecretAccessKey0123456789abcdef";

const dir = mkdtempSync(join(tmpdir(), "panel-backup-"));
const tmp = join(dir, "backup-tmp");
const system = createFakeSystem({ home: join(dir, "home") });
const s3 = startMockS3(BUCKET);
const realDump = system.postgres.dump;
let db: Db;
let api: { handle(req: Request): Promise<Response> };
let admin: string;
let plain: string;
let adminId: string;
const texts: string[] = [];

async function cookieFor(auth: ReturnType<typeof createAuth>, email: string, role: Role): Promise<[string, string]> {
  const id = crypto.randomUUID();
  db.insert(user).values({ id, email, name: role, role }).run();
  const s = await (await auth.$context).internalAdapter.createSession(id);
  if (!s) throw new Error(`createSession for ${email} returned null`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(s.token));
  const v = `${s.token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
  return [`better-auth.session_token=${encodeURIComponent(v)}`, id];
}

async function call(method: string, path: string, cookie = admin): Promise<Response> {
  const res = await api.handle(new Request(`${BASE}/api/panel/backups${path}`, { method, headers: { cookie } }));
  texts.push(`${res.headers.get("location") ?? ""} ${await res.clone().text()}`);
  return res;
}
const json = async <T>(res: Response, status = 200): Promise<T> => {
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status });
  return JSON.parse(text) as T;
};
const set = (k: SettingKey, v: string | null) => setSetting({ db, secret: SECRET }, k, v, adminId);
const backup = () => backupServiceFor({ db, secret: SECRET, dataDir: dir, system });

async function runOnce(): Promise<BackupRun> {
  const { runId } = await json<{ runId: string }>(await call("POST", "/run"), 202);
  await backup().idle();
  const page = await json<Page<BackupRun>>(await call("GET", "/?pageSize=100"));
  const run = page.items.find((r) => r.id === runId);
  if (!run) throw new Error(`run ${runId} missing from list`);
  return run;
}

beforeAll(async () => {
  db = openDb(dir);
  runMigrations(db);
  // ponytail: until the backup_run migration is generated (wkr-deploy-api-01 runs db:generate), create the
  // table here; IF NOT EXISTS makes this a no-op once the real migration exists.
  db.$client.run(`CREATE TABLE IF NOT EXISTS backup_run (id text PRIMARY KEY NOT NULL, trigger text NOT NULL,
    status text NOT NULL, items text NOT NULL, error text, actor_id text REFERENCES user(id) ON DELETE set null,
    started_at integer NOT NULL, finished_at integer)`);
  const auth = createAuth({ db, env, secret: SECRET });
  api = new Elysia({ prefix: "/api" }).use(createBackupRoutes({ auth, db, secret: SECRET, dataDir: dir, system }));
  [admin, adminId] = await cookieFor(auth, "admin@x.io", "admin");
  [plain] = await cookieFor(auth, "plain@x.io", "user");
});
afterAll(() => {
  s3.stop();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const tmpEmpty = () => !existsSync(tmp) || readdirSync(tmp).length === 0;

test("non-admin is rejected", async () => {
  expect((await call("GET", "/status", plain)).status).toBe(403);
  expect((await call("POST", "/run", "")).status).toBe(401);
});

test("not configured: status lists missing keys, run is 400 with them", async () => {
  const st = await json<BackupStatus>(await call("GET", "/status"));
  const missing = ["backup.s3_endpoint", "backup.s3_bucket", "backup.s3_access_key_id", "backup.s3_secret_access_key"];
  expect(st).toMatchObject({ configured: false, missing, hourLocal: 3, nextRunAt: null, retentionDays: 14 });
  const body = await json<{ error: string; missing: string[] }>(await call("POST", "/run"), 400);
  expect(body).toMatchObject({ error: "not_configured", missing });
});

describe("configured", () => {
  beforeAll(() => {
    set("backup.s3_endpoint", s3.endpoint);
    set("backup.s3_bucket", BUCKET);
    set("backup.s3_access_key_id", KEY_ID);
    set("backup.s3_secret_access_key", S3_SECRET);
    set("backup.prefix", PREFIX);
    set("backup.retention_days", "7");
  });

  test("run uploads every database + panel.db, removes temp files, prunes only old keys under the prefix", async () => {
    const old = new Date(Date.now() - 8 * 86_400_000);
    const seed = (k: string, lastModified: Date) => s3.objects.set(k, { body: new Uint8Array([1]), lastModified });
    seed(`${PREFIX}2020-01-01/000000-old.dump`, old);
    seed(`${PREFIX}recent.dump`, new Date());
    seed("other/ancient.dump", old);
    seed("pt-sibling/ancient.dump", old); // shares the string start but not the folder prefix

    const run = await runOnce();
    expect(run).toMatchObject({ trigger: "manual", status: "succeeded", error: null });
    expect(run.items.map((i) => [i.kind, i.name, i.ok])).toEqual([
      ["database", "adminneo", true],
      ["database", "solusi", true],
      ["panel", "panel", true],
    ]);
    const stem = /^pt\/\d{4}-\d{2}-\d{2}\/\d{6}-/;
    for (const i of run.items) {
      expect(i.key).toMatch(stem);
      expect(i.key.endsWith(i.kind === "panel" ? "-panel.db" : `-${i.name}.dump`)).toBe(true);
      expect(s3.objects.get(i.key)?.body.length).toBe(i.sizeBytes as number);
    }
    const panelObj = s3.objects.get(run.items[2]?.key as string)?.body as Uint8Array;
    expect(new TextDecoder().decode(panelObj.subarray(0, 15))).toBe("SQLite format 3");
    expect(run.items[0]?.restoreHint).toMatch(/^pg_restore -U postgres -d adminneo --clean \d{6}-adminneo\.dump$/);
    expect(run.items[2]?.restoreHint).toContain(`${join(dir, "panel.db")}`);
    expect(tmpEmpty()).toBe(true);

    expect(s3.objects.has(`${PREFIX}2020-01-01/000000-old.dump`)).toBe(false);
    expect(s3.objects.has(`${PREFIX}recent.dump`)).toBe(true);
    expect(s3.objects.has("other/ancient.dump")).toBe(true);
    expect(s3.objects.has("pt-sibling/ancient.dump")).toBe(true);
    expect(s3.requests.filter((r) => r.method === "DELETE").every((r) => r.key.startsWith(PREFIX))).toBe(true);

    const audit = db.select().from(auditLog).where(eq(auditLog.action, "backup.run")).all();
    expect(audit.at(-1)).toMatchObject({ actorId: adminId, target: run.id });
    const st = await json<BackupStatus>(await call("GET", "/status"));
    expect(st).toMatchObject({ configured: true, missing: [], running: false, lastRun: { id: run.id } });
    expect(st.nextRunAt).not.toBeNull();
  });

  test("one failing dump makes the run partial; the others still upload", async () => {
    system.postgres.dump = async (name, file) => {
      if (name === "solusi") throw new Error("pg_dump solusi exited 1: boom");
      return realDump(name, file);
    };
    try {
      const run = await runOnce();
      expect(run.status).toBe("partial");
      expect(run.items.map((i) => [i.name, i.ok])).toEqual([
        ["adminneo", true],
        ["solusi", false],
        ["panel", true],
      ]);
      expect(run.items[1]?.error).toContain("solusi");
      expect(run.items[1]?.sizeBytes).toBeNull();
      expect(tmpEmpty()).toBe(true);
    } finally {
      system.postgres.dump = realDump;
    }
  });

  test("S3 upload failures are reported with the S3 code; every item failing = failed", async () => {
    s3.setFailPut(() => true);
    try {
      const run = await runOnce();
      expect(run.status).toBe("failed");
      expect(run.items.every((i) => !i.ok && i.error?.includes("InternalError"))).toBe(true);
      expect(tmpEmpty()).toBe(true);
    } finally {
      s3.setFailPut(null);
    }
  });

  test("a second run while one is in progress is 409 busy", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    system.postgres.dump = async (name, file) => {
      await gate;
      return realDump(name, file);
    };
    try {
      await json(await call("POST", "/run"), 202);
      expect((await json<BackupStatus>(await call("GET", "/status"))).running).toBe(true);
      expect(await json<{ error: string }>(await call("POST", "/run"), 409)).toMatchObject({ error: "busy" });
    } finally {
      release();
      system.postgres.dump = realDump;
      await backup().idle();
    }
  });

  test("download redirects to a 15-minute presigned URL and is audited", async () => {
    const run = await runOnce();
    const item = run.items[0];
    const res = await call("GET", `/${run.id}/items/0/download`);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith(`${s3.endpoint}/${BUCKET}/${item?.key}?`)).toBe(true);
    expect(new URL(loc).searchParams.get("X-Amz-Expires")).toBe("900");
    expect(await (await fetch(loc)).text()).toBe("PGDMP fake dump of adminneo\n");
    const a = db.select().from(auditLog).where(eq(auditLog.action, "backup.download")).all();
    expect(a.at(-1)).toMatchObject({ actorId: adminId, target: item?.key });

    expect((await call("GET", `/${run.id}/items/9/download`)).status).toBe(404);
    expect((await call("GET", `/${run.id}/items/x/download`)).status).toBe(404);
    expect((await call("GET", "/nope/items/0/download")).status).toBe(404);
  });

  test("scheduler starts a run when the configured local hour is crossed", async () => {
    set("backup.hour", "3");
    const before = db.select().from(backupRun).all().length;
    const times = [new Date(2026, 10, 26, 2, 59), new Date(2026, 10, 26, 3, 0), new Date(2026, 10, 26, 3, 1)];
    let i = 0;
    const stop = backup().startScheduler(5, () => times[Math.min(i++, times.length - 1)] as Date);
    try {
      await Bun.sleep(40);
      await backup().idle();
    } finally {
      stop();
    }
    const rows = db.select().from(backupRun).all();
    expect(rows.length).toBe(before + 1);
    expect(rows.find((r) => r.trigger === "schedule")).toMatchObject({ status: "succeeded", actorId: null });
  });

  test("secrets never appear in responses, logs or audit", () => {
    const audit = JSON.stringify(db.select().from(auditLog).all());
    const logs = JSON.stringify(readLogs({ limit: 2000 }));
    for (const blob of [texts.join("\n"), logs, audit]) expect(blob).not.toContain(S3_SECRET);
    expect(texts.join("\n") + logs + audit).not.toContain(SECRET);
  });
});
