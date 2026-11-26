import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth } from "@/server/auth/auth.service";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { user } from "@/server/db/schema";
import { COOKIE_FILE, DEMO_SUPER_ADMIN_EMAIL, seedDemo } from "../scripts/demo-seed";

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
    expect(counts).toMatchObject({ user: 5, session: 3, site: 3, job: 7, deploy: 4, backup_run: 5, backup_restore: 3 });
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
