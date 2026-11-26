import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { markDataKeyExported } from "@/server/data-key.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, backupRun, site, user } from "@/server/db/schema";
import { getSetup, type SetupDeps, setDismissed, setManual } from "@/server/dev/setup.service";
import { accessSeen } from "@/server/http/api.handler";
import { setSetting } from "@/server/settings.service";
import type { SetupItem } from "@/shared/dev.types";

// test-only dummy values
const SECRET = "0123456789abcdef".repeat(4);
const OTHER_SECRET = "abcdef0123456789".repeat(4);
const dir = mkdtempSync(join(tmpdir(), "panel-setup-"));
let db: Db;
let backupConfigured = false;
let appsJson = false;

const deps = (over: Partial<SetupDeps> = {}): SetupDeps => ({
  db,
  secret: SECRET,
  appBaseUrl: "https://panel.example.test",
  createdThisBoot: false,
  backup: { status: () => ({ configured: backupConfigured }) as never },
  integration: { snapshot: () => ({ ecosystemIncludesAppsJson: appsJson, ready: false }) },
  ...over,
});
const items = (d = deps()) => Object.fromEntries(getSetup(d).items.map((i) => [i.key, i])) as Record<string, SetupItem>;

beforeAll(() => {
  accessSeen.at = null; // process-wide; other test files may have set it
  db = openDb(dir);
  runMigrations(db);
  db.insert(user).values({ id: "root", email: "root@example.com", name: "Root", role: "super_admin" }).run();
});
afterAll(() => {
  accessSeen.at = null;
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /dev/setup checklist", () => {
  test("levels and order follow the §3.1 table; fresh instance is incomplete", () => {
    const s = getSetup(deps());
    expect(s.items.map((i) => [i.key, i.level])).toEqual([
      ["access", "required"],
      ["secret_saved", "required"],
      ["backup", "required"],
      ["cloudflare_token", "recommended"],
      ["apps_json", "recommended"],
      ["first_site", "recommended"],
      ["admins", "optional"],
    ]);
    expect(s.items.every((i) => !i.done)).toBe(true);
    expect(s).toMatchObject({ dismissedAt: null, complete: false });
  });

  test("access: done from lastSeenAt; not applicable on an http base", () => {
    expect(items(deps({ appBaseUrl: "http://localhost:3200" })).access).toMatchObject({ applicable: false });
    accessSeen.at = new Date();
    expect(items().access).toMatchObject({ done: true, source: "auto", applicable: true });
    accessSeen.at = null;
  });

  test("secret_saved: manual tick counts until the data key changes; export counts always", () => {
    setManual(deps(), "root", "secret_saved", true);
    expect(items().secret_saved).toMatchObject({ done: true, source: "manual" });
    expect(items(deps({ secret: OTHER_SECRET })).secret_saved).toMatchObject({ done: false });
    expect(db.select().from(auditLog).where(eq(auditLog.action, "setup.update")).all().at(-1)).toMatchObject({
      actorId: "root",
      meta: { key: "secret_saved", done: true },
    });
    setManual(deps(), "root", "secret_saved", false);
    expect(items().secret_saved?.done).toBe(false);
    markDataKeyExported(db, "root");
    expect(items(deps({ secret: OTHER_SECRET })).secret_saved).toMatchObject({ done: true, source: "auto" });
  });

  test("access manual tick", () => {
    expect(setManual(deps(), "root", "access", true).items[0]).toMatchObject({ done: true, source: "manual" });
  });

  test("backup: needsFirstRun until a run succeeded", () => {
    backupConfigured = true;
    expect(items().backup).toMatchObject({ done: false, needsFirstRun: true });
    db.insert(backupRun)
      .values({ id: "r1", trigger: "manual", status: "succeeded", items: [], startedAt: new Date() })
      .run();
    expect(items().backup).toMatchObject({ done: true, needsFirstRun: false });
  });

  test("complete ignores the optional item; other items follow settings, files and rows", () => {
    expect(getSetup(deps()).complete).toBe(false);
    setSetting({ db, secret: SECRET }, "cloudflare.api_token", "cfTok_0123456789abcdefghij", "root"); // test-only
    appsJson = true;
    db.insert(site)
      .values({ name: "blog", port: 3001, app: "blog", database: null, runtime: "native", managed: false, dir: "/x" })
      .run();
    const s = getSetup(deps());
    expect(s.items.find((i) => i.key === "admins")?.done).toBe(false);
    expect(s.complete).toBe(true);
    db.insert(user).values({ id: "a1", email: "a@x.io", name: "A", role: "admin" }).run();
    expect(items().admins?.done).toBe(true);
  });

  test("dismiss round-trip", () => {
    expect(setDismissed(deps(), true).dismissedAt).toEqual(expect.any(String));
    expect(setDismissed(deps(), false).dismissedAt).toBeNull();
  });
});
