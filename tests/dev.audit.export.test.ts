import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, user } from "@/server/db/schema";
import { csvCell, exportAuditCsv, parseAuditFilter } from "@/server/dev/audit.export";

const dir = mkdtempSync(join(tmpdir(), "panel-audit-csv-"));
let db: Db;
beforeAll(() => {
  db = openDb(dir);
  runMigrations(db);
  db.insert(user).values({ id: "root", email: "root@example.com", name: "Root", role: "super_admin" }).run();
});
afterAll(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const seed = (action: string, at: Date, target: string) =>
  db
    .insert(auditLog)
    .values({ actorId: "root", actorLabel: "Root", action, target, at, meta: { secret: "x" } })
    .run();
const filter = (qs: string) => parseAuditFilter(new URLSearchParams(qs));
const lines = async (res: Response) => (await res.text()).trimEnd().split("\r\n");

describe("csvCell", () => {
  test("quotes, doubles quotes, neutralises formula starts", () => {
    expect(["=1+1", "+1", "-1", "@a", "\tx", "plain", 'say "hi"', null].map(csvCell)).toEqual([
      `"'=1+1"`,
      `"'+1"`,
      `"'-1"`,
      `"'@a"`,
      `"'\tx"`,
      `"plain"`,
      `"say ""hi"""`,
      `""`,
    ]);
  });
});

describe("parseAuditFilter", () => {
  test("repeatable action; to covers the whole local day", () => {
    const f = filter("action=a.&action=b&from=2026-01-10&to=2026-01-11");
    expect(f).toMatchObject({ action: ["a.", "b"], from: new Date(2026, 0, 10), to: new Date(2026, 0, 12) });
    expect(() => filter("to=2026-13-01")).toThrow(expect.objectContaining({ status: 400, code: "invalid_date" }));
  });
});

describe("exportAuditCsv", () => {
  test("fixed header, filters, formula-safe, no meta column, audited", async () => {
    seed("csv.a", new Date(2026, 1, 1, 9), '=HYPERLINK("x")');
    seed("csv.b", new Date(2026, 1, 2, 9), "@evil");
    seed("csv.c", new Date(2026, 2, 1, 9), "plain");
    const res = exportAuditCsv(db, "root", filter("action=csv.&to=2026-02-28"), new Date(2026, 10, 27));
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="audit-20261127.csv"');
    const out = await lines(res);
    expect(out).toEqual([
      "waktu,aktor,email_aktor,aksi,target,ip_tersamar,request_id",
      `"${new Date(2026, 1, 2, 9).toISOString()}","Root","","csv.b","'@evil","",""`,
      `"${new Date(2026, 1, 1, 9).toISOString()}","Root","","csv.a","'=HYPERLINK(""x"")","",""`,
    ]);
    const row = db.select().from(auditLog).where(eq(auditLog.action, "audit.export")).get();
    expect(row).toMatchObject({ actorId: "root", meta: { rows: 2, action: ["csv."] } });
  });

  test("rows of the current second (this export's own audit.export too) stay out of the window", async () => {
    const now = new Date();
    seed("late.row", now, "now");
    const out = await lines(exportAuditCsv(db, "root", filter("action=late.row&action=audit.export"), now));
    expect(out).toHaveLength(1); // header only
  });

  test("caps at the 10,000 newest rows", async () => {
    const at = new Date(2025, 0, 1).getTime();
    const ins = db.$client.prepare("insert into audit_log (action, actor_kind, at) values ('cap.row', 'system', ?)");
    db.$client.transaction(() => {
      for (let i = 0; i <= 10_000; i++) ins.run(at + i * 1000);
    })();
    const out = await lines(exportAuditCsv(db, "root", filter("action=cap.row")));
    expect(out).toHaveLength(10_001); // header + 10,000
    expect(out[1]).toStartWith(`"${new Date(at + 10_000_000).toISOString()}","system"`);
    expect(out.at(-1)).toStartWith(`"${new Date(at + 1000).toISOString()}"`);
  });
});
