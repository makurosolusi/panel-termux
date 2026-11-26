import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { listAudit, pruneAudit, recordAudit } from "@/server/audit.service";
import { syncUserRole } from "@/server/auth/access.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, user } from "@/server/db/schema";
import { runWithRequest } from "@/server/http/request.context";

const dir = mkdtempSync(join(tmpdir(), "panel-audit-"));
let db: Db;
const PAGE = { page: 1, pageSize: 50, offset: 0 };
const DAY = 86_400_000;

beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db.delete(auditLog).run();
  db.delete(user).run();
});

const addUser = (id: string, name = `name-${id}`) =>
  db
    .insert(user)
    .values({ id, email: `${id}@x.io`, name }) // test-only
    .run();

describe("recordAudit", () => {
  test("fills actor snapshot and request context", () => {
    addUser("a1", "Ani");
    const ctx = { requestId: "req-1", ipMasked: "203.0.113.x", userAgent: "Chrome on Android" };
    runWithRequest(ctx, () => recordAudit(db, { actorId: "a1", action: "settings.update", target: "x" }));
    const row = db.select().from(auditLog).get();
    expect(row).toMatchObject({
      actorId: "a1",
      actorKind: "user",
      actorLabel: "Ani",
      actorEmail: "a1@x.io",
      ipMasked: "203.0.113.x",
      userAgent: "Chrome on Android",
      requestId: "req-1",
    });
  });

  test("outside a request and without actor → system, context null", () => {
    recordAudit(db, { actorId: null, action: "backup.run" });
    expect(db.select().from(auditLog).get()).toMatchObject({
      actorKind: "system",
      actorLabel: null,
      ipMasked: null,
      requestId: null,
    });
  });
});

describe("listAudit", () => {
  test("label survives deletion and the entry is flagged actorDeleted", () => {
    addUser("gone", "Budi");
    addUser("live", "Citra");
    recordAudit(db, { actorId: "gone", action: "site.create" });
    recordAudit(db, { actorId: "live", action: "site.delete" });
    db.delete(user).where(eq(user.id, "gone")).run();
    const items = listAudit(db, PAGE).items;
    const gone = items.find((i) => i.action === "site.create");
    expect(gone).toMatchObject({ actor: null, actorKind: "user", actorLabel: "Budi", actorDeleted: true });
    const live = items.find((i) => i.action === "site.delete");
    expect(live).toMatchObject({ actor: { id: "live", name: "Citra" }, actorDeleted: false });
  });

  test("action OR with prefixes (escaped), actor and date range", () => {
    addUser("u");
    const at = (iso: string) => new Date(iso);
    const rows: [string, string | null, Date][] = [
      ["backup.run", null, at("2026-11-01T10:00:00Z")],
      ["backup.restore_drop", "u", at("2026-11-02T10:00:00Z")],
      ["backupXrun", null, at("2026-11-03T10:00:00Z")],
      ["a_b.x", null, at("2026-10-01T10:00:00Z")],
      ["aXb.x", null, at("2026-10-01T10:00:00Z")],
      ["auth.sign_in", "u", at("2026-11-04T10:00:00Z")],
      ["site.create", "u", at("2026-11-05T10:00:00Z")],
    ];
    for (const [action, actorId, when] of rows) db.insert(auditLog).values({ action, actorId, at: when }).run();
    const actions = (f: Parameters<typeof listAudit>[2]) =>
      listAudit(db, PAGE, f)
        .items.map((i) => i.action)
        .sort();

    expect(actions({ action: ["backup."] })).toEqual(["backup.restore_drop", "backup.run"]);
    // `_` in a prefix is literal, not a LIKE wildcard.
    expect(actions({ action: ["a_b."] })).toEqual(["a_b.x"]);
    expect(actions({ action: ["backup.", "auth.sign_in"] })).toEqual([
      "auth.sign_in",
      "backup.restore_drop",
      "backup.run",
    ]);
    expect(actions({ action: "site.create" })).toEqual(["site.create"]);
    expect(actions({ actorId: "u" })).toEqual(["auth.sign_in", "backup.restore_drop", "site.create"]);
    expect(actions({ from: at("2026-11-02T00:00:00Z"), to: at("2026-11-04T10:00:00Z") })).toEqual([
      "backup.restore_drop",
      "backupXrun",
    ]);
    expect(actions({ excludePrefixes: ["backup.", "a_b."] })).toEqual([
      "aXb.x",
      "auth.sign_in",
      "backupXrun",
      "site.create",
    ]);
    expect(listAudit(db, { page: 1, pageSize: 2, offset: 0 }).total).toBe(7);
  });
});

describe("pruneAudit", () => {
  test("deletes rows older than retention and records audit.prune", () => {
    const now = new Date("2026-11-27T00:00:00Z");
    db.insert(auditLog)
      .values([
        { action: "site.create", at: new Date(now.getTime() - 366 * DAY) },
        { action: "site.create", at: new Date(now.getTime() - 364 * DAY) },
      ])
      .run();
    expect(pruneAudit(db, 365, now)).toBe(1);
    const left = db.select().from(auditLog).all();
    expect(left.map((r) => r.action).sort()).toEqual(["audit.prune", "site.create"]);
    expect(left.find((r) => r.action === "audit.prune")).toMatchObject({ actorKind: "system", meta: { deleted: 1 } });
    expect(pruneAudit(db, 365, now)).toBe(0);
    expect(db.select().from(auditLog).all()).toHaveLength(2);
  });
});

describe("user.role_sync", () => {
  test("a role change by SUPER_ADMIN_EMAILS is audited as system; no change → no row", () => {
    addUser("boss");
    syncUserRole(db, "boss", ["boss@x.io"]);
    syncUserRole(db, "boss", ["boss@x.io"]);
    const rows = db.select().from(auditLog).where(eq(auditLog.action, "user.role_sync")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: "system",
      target: "boss",
      meta: { from: "user", to: "super_admin", reason: "super_admin_emails" },
    });
  });
});
