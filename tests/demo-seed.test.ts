import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth } from "@/server/auth/auth.service";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import type { BackupItemRow } from "@/server/db/schema";
import { user } from "@/server/db/schema";
import { BATTERY_DANGER_PERCENT } from "@/server/panel/overview.problems";
import { SETTINGS } from "@/server/settings.registry";
import { candidateOf } from "@/server/sites/adopt.candidates";
import { snippetCurrent } from "@/server/sites/integration.service";
import { FAKE_S3_DIR } from "@/server/system/external.fake";
import { createFakeSystem, FAKE_HOME_DIR } from "@/server/system/system.fake";
import { COOKIE_FILE, DEMO_SUPER_ADMIN_EMAIL, seedDemo } from "../scripts/demo-seed";
import { DEMO_BUCKET } from "../scripts/demo-seed.sandbox";

const BASE = "http://localhost:3415"; // test-only
const root = mkdtempSync(join(tmpdir(), "demo-seed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Cookies = Record<"user" | "admin" | "super_admin", string>;
const readCookies = (dir: string) => JSON.parse(readFileSync(join(dir, COOKIE_FILE), "utf8")) as Cookies;

/** Role Better Auth resolves for `cookie` against the seeded DB (null = cookie rejected). */
async function roleOf(dir: string, cookie: string): Promise<string | null> {
  const db = openDb(dir);
  try {
    const secret = readFileSync(join(dir, "secret"), "utf8").trim();
    const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x" };
    const auth = createAuth({ db, secret, env: { ...env, SUPER_ADMIN_EMAILS: [DEMO_SUPER_ADMIN_EMAIL] } });
    const s = await auth.api.getSession({ headers: new Headers({ cookie }) });
    return (s?.user as { role?: string } | undefined)?.role ?? null;
  } finally {
    db.$client.close();
  }
}

describe("scripts/demo-seed", () => {
  const dir = join(root, "demo");

  test("seeds every page's data and writes signed cookies (mode 600) for the three roles", async () => {
    const counts = await seedDemo({ dataDir: dir, baseUrl: BASE });
    expect(counts).toMatchObject({
      user: 5,
      session: 3,
      site: 3,
      job: 7,
      deploy: 4,
      backup_run: 5,
      backup_restore: 3,
      setting: 5,
    });
    expect(counts.problem_event).toBe(7);
    expect(counts.audit_log).toBeGreaterThanOrEqual(20);
    expect(counts.metric_sample).toBeGreaterThan(1000); // 7 days at 10 min
    expect(statSync(join(dir, COOKIE_FILE)).mode & 0o777).toBe(0o600);
    const cookies = readCookies(dir);
    expect(Object.keys(cookies).sort()).toEqual(["admin", "super_admin", "user"]);
    for (const role of ["user", "admin", "super_admin"] as const) expect(await roleOf(dir, cookies[role])).toBe(role);
  });

  test("covers the job, backup and site states the pages show", () => {
    const db = openDb(dir);
    const col = (q: string) => (db.$client.query(q).all() as { v: string }[]).map((r) => r.v).sort();
    expect(col("SELECT DISTINCT status AS v FROM job")).toEqual(["failed", "interrupted", "rolled_back", "succeeded"]);
    expect(col("SELECT DISTINCT status AS v FROM backup_run")).toEqual(["failed", "partial", "succeeded"]);
    expect(col("SELECT name AS v FROM site WHERE managed = 0")).toEqual(["makuro-solusi"]);
    expect(col("SELECT id AS v FROM deploy WHERE bin_ino IS NOT NULL")).toEqual(["dep-demo-05"]);
    db.$client.close();
  });

  test("audit rows look like the server's: device label 'Browser di OS', revoke names its user (QA N3, m3)", () => {
    const db = openDb(dir);
    const rows = db.$client.query("SELECT action, target, meta, user_agent AS ua FROM audit_log").all() as {
      action: string;
      target: string | null;
      meta: string | null;
      ua: string | null;
    }[];
    db.$client.close();
    for (const r of rows) if (r.ua !== null) expect(r.ua).toMatch(/^\S+ di \S+/);
    const revoke = rows.find((r) => r.action === "session.revoke");
    expect(JSON.parse(revoke?.meta ?? "{}")).toMatchObject({
      scope: "user",
      revoked: 2,
      targetEmail: "tamu@contoh.com",
    });
    expect(rows.find((r) => r.action === "log.download")?.target).toMatch(/^app:[\w-]+:(out|err)$/);
  });

  test("fake HOME matches the rows: pm2 runs toko-kopi on its port, rollback has app.prev, pm2 setup passes", async () => {
    const home = join(dir, FAKE_HOME_DIR);
    const sys = createFakeSystem({ home, offline: true }); // what boot builds for this data dir
    expect((await sys.pm2.list()).find((a) => a.name === "toko-kopi")).toMatchObject({ status: "online" });
    expect(await sys.net.isListening(3010)).toBe(true); // deploy/restart health checks can pass
    expect(await sys.net.isListening(3011)).toBe(false); // blog was never deployed
    expect(existsSync(join(home, "sites", "toko-kopi", "app.prev"))).toBe(true);
    expect(snippetCurrent(readFileSync(join(home, "sites", "ecosystem.config.js"), "utf8"))).toBe(true);
    const db = openDb(dir);
    try {
      const live = db.$client.query("SELECT bin_ino AS ino FROM deploy WHERE id = 'dep-demo-05'").get() as {
        ino: number;
      };
      expect(live.ino).toBe(statSync(join(home, "sites", "toko-kopi", "app")).ino);
      const dirs = (db.$client.query("SELECT dir FROM site").all() as { dir: string }[]).map((r) => r.dir);
      expect(dirs.every((d) => d.startsWith(join(home, "sites")))).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  test("PLAN/02 §6 scenario: battery 22 % warning, held failing domain, adoptable app", async () => {
    const sys = createFakeSystem({ home: join(dir, FAKE_HOME_DIR) });
    const battery = (await sys.device.read()).battery;
    expect(battery).toMatchObject({ percent: 22, charging: false, status: "discharging" });
    const warnAt = Number(SETTINGS["monitor.battery_warn_percent"].default);
    expect((battery?.percent ?? 0) < warnAt && (battery?.percent ?? 0) >= BATTERY_DANGER_PERCENT).toBe(true);
    // old.contoh.test fails (502) and points at the errored kasir-lama → its problem is held behind the app's.
    const old = (await sys.cloudflared.listIngress()).find((r) => r.hostname === "old.contoh.test");
    const procs = await sys.pm2.procs();
    expect(procs.find((p) => p.port === old?.port)).toMatchObject({ name: "kasir-lama", status: "errored" });
    expect((await sys.cloudflared.probe("old.contoh.test")).status).toBe(502);
    const api = procs.find((p) => p.name === "demo-api");
    if (!api) throw new Error("demo-api missing from the fake pm2");
    const cand = candidateOf(api, realpathSync(join(dir, FAKE_HOME_DIR, "sites")), new Set([3007]));
    expect(cand).toMatchObject({ blockers: [], runtime: "native", port: 3007 });
  });

  test("backups and databases agree: every uploaded item is in the fake bucket with its sha256", async () => {
    const db = openDb(dir);
    const runs = db.$client.query("SELECT items, started_at AS at FROM backup_run").all() as { items: string }[];
    const restores = db.$client.query("SELECT target_db AS t FROM backup_restore WHERE dropped_at IS NULL").all();
    const times = db.$client.query("SELECT started_at AS v FROM job UNION ALL SELECT at FROM deploy").all();
    db.$client.close();
    const names = (await createFakeSystem({ home: join(dir, FAKE_HOME_DIR) }).postgres.listDatabases()).map(
      (d) => d.name,
    );
    const items = runs.flatMap((r) => JSON.parse(r.items) as BackupItemRow[]);
    for (const i of items.filter((x) => x.ok)) {
      const body = readFileSync(join(dir, FAKE_HOME_DIR, FAKE_S3_DIR, DEMO_BUCKET, i.key));
      expect(createHash("sha256").update(body).digest("hex")).toBe(i.sha256 as string);
    }
    for (const i of items.filter((x) => x.kind === "database")) expect(names).toContain(i.name);
    expect(new Set(items.map((i) => `${i.kind}/${i.name}`)).size).toBe(7); // one name per item, as a real run
    for (const r of restores as { t: string }[]) expect(names).toContain(r.t);
    for (const { v } of times as { v: number }[]) expect(v % 60_000).toBe(0); // no odd seconds
  });

  test("job steps carry the params their messages need", () => {
    const db = openDb(dir);
    const steps = (db.$client.query("SELECT steps FROM job").all() as { steps: string }[]).flatMap(
      (r) => JSON.parse(r.steps) as { code: string | null; params: object }[],
    );
    db.$client.close();
    const needs = ["folder_created", "env_written", "ingress_added", "dns_created", "tunnel_restarted", "staged"];
    for (const st of steps.filter((x) => needs.includes(x.code ?? "")))
      expect(Object.keys(st.params).length).toBeGreaterThan(0);
  });

  test("rerun is idempotent: same counts, fresh sessions, old cookies rejected", async () => {
    const before = readCookies(dir);
    const counts = await seedDemo({ dataDir: dir, baseUrl: BASE });
    expect(counts).toMatchObject({ user: 5, session: 3, site: 3, job: 7, deploy: 4, backup_run: 5 });
    const after = readCookies(dir);
    expect(after.admin).not.toBe(before.admin);
    expect(await roleOf(dir, before.admin)).toBeNull();
    expect(await roleOf(dir, after.admin)).toBe("admin");
    expect(statSync(join(dir, COOKIE_FILE)).mode & 0o777).toBe(0o600);
  });

  test("refuses ./data and ~/panel without touching them", async () => {
    await expect(seedDemo({ dataDir: "./data", baseUrl: BASE })).rejects.toThrow(/refusing/);
    await expect(seedDemo({ dataDir: "data/sub", baseUrl: BASE })).rejects.toThrow(/refusing/);
    await expect(seedDemo({ dataDir: "~/panel".replace("~", process.env.HOME ?? ""), baseUrl: BASE })).rejects.toThrow(
      /refusing/,
    );
  });

  test("refuses a panel.db with users and no demo marker", async () => {
    const prodDir = mkdtempSync(join(root, "prod-"));
    const db = openDb(prodDir);
    runMigrations(db);
    db.insert(user).values({ id: "u1", email: "nyata@x.io", name: "Nyata" }).run(); // test-only
    db.$client.close();
    await expect(seedDemo({ dataDir: prodDir, baseUrl: BASE })).rejects.toThrow(/no demo marker/);
    const check = openDb(prodDir);
    expect((check.$client.query("SELECT count(*) AS n FROM user").get() as { n: number }).n).toBe(1);
    check.$client.close();
  });
});
