import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { createAuth } from "@/server/auth/auth.service";
import { createBackupDevRoutes, createBackupRoutes } from "@/server/backup/backup.routes";
import { backupServiceFor } from "@/server/backup/backup.service";
import { encryptSecret } from "@/server/crypto.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, backupRun, session, setting, user } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import { type SettingKey, setSetting } from "@/server/settings.service";
import { createFakeSystem } from "@/server/system/system.fake";
import type { BackupManifest, BackupRun, BackupStatus, BackupVerify } from "@/shared/backup.types";
import type { Page } from "@/shared/dev.types";
import type { Role } from "@/shared/roles";
import { startMockS3 } from "./backup.s3mock";

// test-only dummy values
const BASE = "http://localhost";
const SECRET = "0123456789abcdef".repeat(4);
const SUPER_ADMIN_EMAILS = ["root@x.io"];
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS };
const BUCKET = "bkt";
const PREFIX = "pt/";
const KEY_ID = "AKIDTESTONLY0001";
const S3_SECRET = "TestOnlySecretAccessKey0123456789abcdef";
const GB = 1024 ** 3;

const dir = mkdtempSync(join(tmpdir(), "panel-backup-"));
const tmp = join(dir, "backup-tmp");
const home = join(dir, "home");
const system = createFakeSystem({ home });
const s3 = startMockS3(BUCKET);
const realDump = system.postgres.dump;
let free = 10 * GB;
let db: Db;
let api: { handle(req: Request): Promise<Response> };
let admin: string;
let root: string;
let plain: string;
let adminId: string;
let rootId: string;
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

async function call(method: string, path: string, cookie = admin, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { origin: BASE, "x-requested-with": "XMLHttpRequest", cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  const url = path.startsWith("/dev") ? `${BASE}/api${path}` : `${BASE}/api/panel/backups${path}`;
  const res = await api.handle(
    new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  texts.push(`${res.headers.get("location") ?? ""} ${await res.clone().text()}`);
  return res;
}
const json = async <T>(res: Response, status = 200): Promise<T> => {
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status });
  return JSON.parse(text) as T;
};
const errOf = async (res: Response, status: number) => (await json<{ error: string }>(res, status)).error;
const firstGood = () => db.select().from(backupRun).where(eq(backupRun.status, "succeeded")).get() as RunRow;
type RunRow = typeof backupRun.$inferSelect;
const set = (k: SettingKey, v: string | null) => setSetting({ db, secret: SECRET }, k, v, adminId);
const backup = () => backupServiceFor({ db, secret: SECRET, dataDir: dir, system, freeBytes: () => free });
const body = (key: string) => s3.objects.get(key)?.body as Uint8Array;
const text = (key: string) => new TextDecoder().decode(body(key));

async function runOnce(): Promise<BackupRun> {
  const { runId } = await json<{ runId: string }>(await call("POST", "/run"), 202);
  await backup().idle();
  const page = await json<Page<BackupRun>>(await call("GET", "/?pageSize=100"));
  const run = page.items.find((r) => r.id === runId);
  if (!run) throw new Error(`run ${runId} missing from list`);
  return run;
}
const item = (run: BackupRun, kind: string, name = kind) => {
  const i = run.items.find((x) => x.kind === kind && x.name === name);
  if (!i) throw new Error(`no ${kind}/${name} in run ${run.id}`);
  return i;
};

const clean = (entry: string) => entry.replace(/^\.\//, "").replace(/\/$/, "");
/** Entries of a tar.gz object, via the host tar. */
async function tarEntries(key: string): Promise<string[]> {
  const f = join(dir, "list.tgz");
  writeFileSync(f, body(key));
  const out = await Bun.$`tar -tzf ${f}`.text();
  return out.trim().split("\n").map(clean);
}

beforeAll(async () => {
  db = openDb(dir);
  runMigrations(db);
  backup(); // first call wins: the test freeBytes stub is in place for the routes too
  const auth = createAuth({ db, env, secret: SECRET });
  const deps = { auth, db, secret: SECRET, dataDir: dir, system };
  api = new Elysia({ prefix: "/api" }).use(createBackupRoutes(deps)).use(createBackupDevRoutes(deps));
  [admin, adminId] = await cookieFor(auth, "admin@x.io", "admin");
  [root, rootId] = await cookieFor(auth, "root@x.io", "super_admin");
  [plain] = await cookieFor(auth, "plain@x.io", "user");
  // A site folder: binaries/deps/temp files at site level are skipped, nested look-alikes are kept (K20).
  const s = join(home, "sites", "shop");
  for (const d of ["app.prev", "node_modules/x", "data/app", "web/node_modules"])
    mkdirSync(join(s, d), { recursive: true });
  for (const f of ["app", ".env", "upload.tmp", "chunk.part", "data/app/keep.txt", "web/node_modules/k.js"])
    writeFileSync(join(s, f), "x");
  writeFileSync(join(home, "sites", "apps.json"), "[]");
  writeFileSync(join(home, ".cloudflared", "config.yml.bak1"), "tunnel: old\n");
  writeFileSync(join(home, ".cloudflared", "cert.pem"), "CERT");
  writeFileSync(join(dir, "secret"), SECRET);
});
afterAll(() => {
  s3.stop();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const tmpEmpty = () => !existsSync(tmp) || readdirSync(tmp).length === 0;

test("non-admin is rejected; verify is super_admin only", async () => {
  expect((await call("GET", "/status", plain)).status).toBe(403);
  expect((await call("POST", "/run", "")).status).toBe(401);
  expect((await call("POST", "/dev/backup/verify", admin)).status).toBe(403);
});

test("not configured: status lists missing keys, run is 400 with them, verify says not_configured", async () => {
  const st = await json<BackupStatus>(await call("GET", "/status"));
  const missing = ["backup.s3_endpoint", "backup.s3_bucket", "backup.s3_access_key_id", "backup.s3_secret_access_key"];
  expect(st).toMatchObject({ configured: false, missing, keyMismatch: false, nextRunAt: null, retentionDays: 14 });
  expect(st).toMatchObject({ keepMinRuns: 3, maxItemMb: 2048, includeSecrets: false, restoring: false });
  expect(st.excluded).toEqual(["site_binaries", "cloudflared_cert", "secrets_off"]);
  const res = await json<{ error: string; missing: string[] }>(await call("POST", "/run"), 400);
  expect(res).toMatchObject({ error: "not_configured", missing });
  const v = await json<BackupVerify>(await call("POST", "/dev/backup/verify", root));
  expect(v).toMatchObject({ ok: false, code: "not_configured", failedStep: null });
});

describe("configured", () => {
  beforeAll(() => {
    set("backup.s3_endpoint", s3.endpoint);
    set("backup.s3_bucket", BUCKET);
    set("backup.s3_access_key_id", KEY_ID);
    set("backup.s3_secret_access_key", S3_SECRET);
    set("backup.prefix", PREFIX);
  });

  test("full run: every item in order, checked, hashed, sizes match; checksums + manifest last; no listing", async () => {
    s3.objects.set(`${PREFIX}unrecorded.dump`, { body: new Uint8Array([1]), lastModified: new Date(0) });
    const run = await runOnce();
    expect(run).toMatchObject({ trigger: "manual", status: "succeeded", error: null, includesSecrets: false });
    expect(run.items.map((i) => `${i.kind}:${i.name}`)).toEqual([
      "globals:globals",
      "database:adminneo",
      "database:solusi",
      "sites:sites",
      "cloudflared:cloudflared",
      "panel:panel",
      "checksums:checksums",
      "manifest:manifest",
    ]);
    const stem = run.items[0]?.key.replace(/globals\.sql$/, "") as string;
    expect(stem).toMatch(/^pt\/\d{4}-\d{2}-\d{2}\/\d{6}-$/);
    for (const i of run.items) {
      expect(i).toMatchObject({ ok: true, checked: true, pruned: false, errorCode: null });
      expect(body(i.key).length).toBe(i.sizeBytes as number);
      expect(i.sha256).toBe(new Bun.CryptoHasher("sha256").update(body(i.key)).digest("hex"));
    }
    expect(text(`${stem}panel.db`).slice(0, 15)).toBe("SQLite format 3");
    const sums = text(`${stem}SHA256SUMS`).trim().split("\n");
    expect(sums).toHaveLength(6);
    expect(sums).toContain(`${item(run, "database", "solusi").sha256}  ${stem.split("/").pop()}solusi.dump`);

    const m = JSON.parse(text(`${stem}manifest.json`)) as BackupManifest;
    expect(m).toMatchObject({ format: 1, runId: run.id, postgresVersion: "18.7", includesSecrets: false });
    expect(m.paths).toMatchObject({
      dataDir: dir,
      sitesDir: join(home, "sites"),
      cloudflaredDir: join(home, ".cloudflared"),
    });
    expect(m.tunnel?.ref).toBe("00000000-0000-4000-8000-000000000000");
    expect(m.items.map((i) => i.kind)).toContain("checksums");
    expect(m.restoreOrder[0]).toBe("sites");
    expect(JSON.stringify(m)).not.toContain(S3_SECRET);

    const sites = await tarEntries(item(run, "sites").key);
    expect(sites).toContain("apps.json");
    expect(sites).toContain("ecosystem.config.js");
    expect(sites.filter((e) => e.startsWith("shop/")).sort()).toEqual(
      ["shop/.env", "shop/data", "shop/data/app", "shop/data/app/keep.txt"]
        .concat(["shop/web", "shop/web/node_modules", "shop/web/node_modules/k.js"])
        .sort(),
    );
    expect((await tarEntries(item(run, "cloudflared").key)).sort()).toEqual(["config.yml", "config.yml.bak1"]);
    expect(item(run, "database", "adminneo").restoreHint).toMatch(
      /^pg_restore -U postgres --create .* \d{6}-adminneo\.dump$/,
    );
    expect(item(run, "sites").restoreHint).toContain(join(home, "sites"));
    expect(item(run, "panel").restoreHint).toContain(join(dir, "panel.db"));
    expect(tmpEmpty()).toBe(true);

    expect(s3.requests.some((r) => r.key === "")).toBe(false); // never lists the bucket
    expect(s3.objects.has(`${PREFIX}unrecorded.dump`)).toBe(true); // unrecorded objects are never deleted
    const audit = db.select().from(auditLog).where(eq(auditLog.action, "backup.run")).all();
    expect(audit.at(-1)).toMatchObject({ actorId: adminId, target: run.id });
    const st = await json<BackupStatus>(await call("GET", "/status"));
    expect(st).toMatchObject({ configured: true, running: false, lastRun: { id: run.id } });
    expect(st.lastGood?.map((g) => `${g.kind}:${g.name}`)).toHaveLength(6);
    const good = st.lastGood?.find((g) => g.kind === "database" && g.name === "solusi");
    expect(good).toMatchObject({ runId: run.id, itemIndex: 2, checked: true });
    expect(good?.restoreHint).toBe(item(run, "database", "solusi").restoreHint);
    // perf: lastGood is reused between ticks, and a finished run refreshes it
    expect(backup().status().lastGood).toBe(backup().status().lastGood);
    const before = backup().status().lastGood;
    const next = await runOnce();
    expect(backup().status().lastGood).not.toBe(before);
    expect(
      backup()
        .status()
        .lastGood?.find((g) => g.name === "solusi")?.runId,
    ).toBe(next.id);
  });

  test("failures per item: produce, check, size cap, space, upload, stat mismatch; all failing = failed", async () => {
    system.postgres.dump = async (name, file) => {
      if (name === "solusi") throw new Error("pg_dump solusi exited 1: boom");
      if (name === "adminneo") return writeFileSync(file, "not a dump");
      return realDump(name, file);
    };
    s3.setFaults({ truncatePut: (k) => k.endsWith("cloudflared.tar.gz"), failPut: (k) => k.endsWith("globals.sql") });
    try {
      const run = await runOnce();
      expect(run.status).toBe("partial");
      expect(item(run, "globals").errorCode).toBe("upload_failed");
      expect(item(run, "globals").error).toContain("InternalError");
      const solusi = item(run, "database", "solusi");
      expect(solusi).toMatchObject({ ok: false, errorCode: "produce_failed", sizeBytes: null });
      expect(item(run, "database", "adminneo")).toMatchObject({ ok: false, errorCode: "check_failed", checked: false });
      expect(item(run, "cloudflared").errorCode).toBe("upload_mismatch");
      expect(s3.objects.has(item(run, "cloudflared").key)).toBe(false);
      expect(text(item(run, "checksums").key)).not.toContain("solusi");
      expect(tmpEmpty()).toBe(true);

      set("backup.max_item_mb", "1");
      system.postgres.dump = async (_n, file) => writeFileSync(file, `PGDMP${"x".repeat(1024 * 1024)}`);
      s3.setFaults({});
      // 270 MB: enough for adminneo (8 MB estimate + 256 MB margin), not for solusi (24.5 MB + 256 MB).
      free = 270 * 1024 * 1024;
      const r2 = await runOnce();
      expect(item(r2, "database", "adminneo").errorCode).toBe("too_large");
      expect(item(r2, "database", "solusi").errorCode).toBe("insufficient_space");

      // Every upload failing = failed, and a failed run never prunes.
      s3.setFaults({ failPut: () => true });
      const deletes = s3.requests.filter((r) => r.method === "DELETE").length;
      const r3 = await runOnce();
      expect(r3.status).toBe("failed");
      expect(s3.requests.filter((r) => r.method === "DELETE").length).toBe(deletes);
    } finally {
      system.postgres.dump = realDump;
      s3.setFaults({});
      set("backup.max_item_mb", null);
      free = 10 * GB;
    }
  });

  test("a second run or a restore while one is in progress is 409 busy; busy() covers both", async () => {
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
      expect(backup().busy()).toBe(true);
      expect((await json<BackupStatus>(await call("GET", "/status"))).running).toBe(true);
      expect(await errOf(await call("POST", "/run"), 409)).toBe("busy");
      expect(await errOf(await call("POST", `/${firstGood().id}/items/1/restore`), 409)).toBe("busy");
    } finally {
      release();
      system.postgres.dump = realDump;
      await backup().idle();
    }
    expect(backup().busy()).toBe(false);
  });

  test("download: presigned 15 min, audited; 404s; pruned = 410", async () => {
    const run = await runOnce();
    const i = item(run, "database", "adminneo");
    const res = await call("GET", `/${run.id}/items/1/download`);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith(`${s3.endpoint}/${BUCKET}/${i.key}?`)).toBe(true);
    expect(new URL(loc).searchParams.get("X-Amz-Expires")).toBe("900");
    expect(await (await fetch(loc)).text()).toBe("PGDMP fake dump of adminneo\n");
    const a = db.select().from(auditLog).where(eq(auditLog.action, "backup.download")).all();
    expect(a.at(-1)).toMatchObject({ actorId: adminId, target: i.key });
    expect((await call("GET", `/${run.id}/items/99/download`)).status).toBe(404);
    expect((await call("GET", `/${run.id}/items/x/download`)).status).toBe(404);
    expect((await call("GET", "/nope/items/0/download")).status).toBe(404);

    const items = run.items.map(({ restoreHint: _, ...x }, idx) => (idx === 1 ? { ...x, pruned: true } : x));
    db.update(backupRun).set({ items }).where(eq(backupRun.id, run.id)).run();
    expect(await errOf(await call("GET", `/${run.id}/items/1/download`), 410)).toBe("pruned");
  });

  test("include_secrets: secrets item; download needs super_admin + fresh session; off again = pruned", async () => {
    set("backup.include_secrets", "on");
    const run = await runOnce();
    expect(run.includesSecrets).toBe(true);
    const sec = item(run, "secrets");
    expect(sec.ok).toBe(true);
    expect(await tarEntries(sec.key)).toContain("secret");
    const idx = run.items.indexOf(sec);
    const dl = (cookie: string) => call("GET", `/${run.id}/items/${idx}/download`, cookie);
    const signedInAt = (at: Date) => db.update(session).set({ createdAt: at }).where(eq(session.userId, rootId)).run();
    expect(await errOf(await dl(admin), 403)).toBe("forbidden");
    expect((await dl(root)).status).toBe(302);
    signedInAt(new Date(Date.now() - 60 * 60_000));
    expect(await errOf(await dl(root), 403)).toBe("reauth_required");
    signedInAt(new Date());

    set("backup.include_secrets", "off");
    const next = await runOnce();
    expect(next.items.some((i) => i.kind === "secrets")).toBe(false);
    expect(s3.objects.has(sec.key)).toBe(false); // secrets go once the switch is off, regardless of age
    const pruned = db.select().from(backupRun).where(eq(backupRun.id, run.id)).get();
    expect(pruned?.items[idx]?.pruned).toBe(true);
  });

  test("key mismatch: status reports it (no 500), run and download are 409, verify says unreadable", async () => {
    const row = db.select().from(setting).where(eq(setting.key, "backup.s3_secret_access_key")).get();
    const foreign = encryptSecret("f".repeat(64), "other-key-value"); // as if data/secret was replaced
    db.update(setting).set({ value: foreign }).where(eq(setting.key, "backup.s3_secret_access_key")).run();
    try {
      const st = await json<BackupStatus>(await call("GET", "/status"));
      expect(st).toMatchObject({ keyMismatch: true, configured: true, nextRunAt: null });
      expect(await errOf(await call("POST", "/run"), 409)).toBe("key_mismatch");
      expect(await errOf(await call("GET", `/${firstGood().id}/items/1/download`), 409)).toBe("key_mismatch");
      const v = await json<BackupVerify>(await call("POST", "/dev/backup/verify", root));
      expect(v).toMatchObject({ ok: false, code: "unreadable" });
    } finally {
      if (row) db.update(setting).set({ value: row.value }).where(eq(setting.key, row.key)).run();
    }
  });

  test("restore routes: start 202 + list page; delete needs the typed name; 404 for unknown", async () => {
    const res = await call("POST", `/${firstGood().id}/items/1/restore`);
    const started = await json<{ restoreId: string; targetDb: string }>(res, 202);
    await backup().idle();
    const page = await json<Page<{ id: string; status: string }>>(await call("GET", "/restores"));
    expect(page.items.find((r) => r.id === started.restoreId)?.status).toBe("succeeded");
    const del = (id: string, confirm: string) => call("DELETE", `/restores/${id}/database`, admin, { confirm });
    expect(await errOf(await del(started.restoreId, "x"), 400)).toBe("confirm_mismatch");
    expect((await del(started.restoreId, started.targetDb)).status).toBe(204);
    expect((await del("nope", "x")).status).toBe(404);
  });

  test("secrets never appear in responses, logs or audit", () => {
    const audit = JSON.stringify(db.select().from(auditLog).all());
    const logs = JSON.stringify(readLogs({ limit: 2000 }));
    for (const blob of [texts.join("\n"), logs, audit]) expect(blob).not.toContain(S3_SECRET);
    expect(texts.join("\n") + logs + audit).not.toContain(SECRET);
  });
});
