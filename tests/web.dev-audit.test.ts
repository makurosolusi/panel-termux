import { describe, expect, test } from "bun:test";
import type { AuditAction } from "@/shared/audit.types";
import type { DevAuditEntry } from "@/shared/dev.types";
import {
  auditActor,
  auditDevice,
  auditExportUrl,
  auditListUrl,
  describeAudit,
  invalidDateRange,
  isAuditFiltered,
} from "@/web/dev/audit.describe";

// /dev/audit: actor names, device labels, one sentence per action, filters (split from web.dev.test.ts).
// test-only fixture
const entry = (over: Partial<DevAuditEntry>): DevAuditEntry => ({
  id: 1,
  at: "2026-11-26T07:00:00Z",
  actor: { id: "u1", name: "Citra" },
  actorKind: "user",
  actorLabel: "Citra",
  actorEmail: "citra@x.co",
  actorDeleted: false,
  action: "auth.sign_in",
  target: null,
  meta: null,
  ipMasked: "203.0.113.x",
  userAgent: "Firefox",
  requestId: "r1",
  ...over,
});

describe("auditActor", () => {
  test("live user → name", () => expect(auditActor(entry({}))).toBe("Citra"));
  test("deleted user → label survives with (deleted)", () =>
    expect(auditActor(entry({ actor: null, actorDeleted: true }))).toBe("Citra (deleted)"));
  test("system → System", () => expect(auditActor(entry({ actor: null, actorKind: "system" }))).toBe("System"));
  test("unknown → Unknown", () =>
    expect(auditActor(entry({ actor: null, actorKind: "unknown", actorLabel: null }))).toBe("Unknown"));
  test("0.2.x row without actorKind: user when actor present, else unknown", () => {
    expect(auditActor(entry({ actorKind: undefined }))).toBe("Citra");
    expect(auditActor(entry({ actor: null, actorKind: undefined }))).toBe("Unknown");
  });
});

describe("auditDevice (E10: old rows normalized on read)", () => {
  test.each([
    ["Chrome di Android", "Chrome · Android"], // 0.5.x row
    ["Chrome · Android", "Chrome · Android"], // 0.6.0 row
    ["Perangkat tidak dikenal", "Unknown device"], // 0.5.x unknown
    [null, "Unknown device"], // 0.6.0 unknown, request still known by its IP
  ] as const)("%p → %s", (ua, text) => expect(auditDevice(entry({ userAgent: ua }))).toBe(text));
  test("row without a request (no IP, no label) → null, not 'Unknown device'", () =>
    expect(auditDevice(entry({ ipMasked: null, userAgent: null }))).toBeNull());
});

describe("describeAudit", () => {
  // one sample per AuditAction: the Record type makes a missing action a type error
  const META: Record<AuditAction, Partial<DevAuditEntry>> = {
    "auth.sign_in": {},
    "auth.sign_out": {},
    "auth.account_created": {},
    "user.role_change": { meta: { from: "user", to: "admin", targetEmail: "budi@x.co" } },
    "user.role_sync": { meta: { from: "admin", to: "super_admin" } },
    "user.delete": { meta: { targetEmail: "budi@x.co" } },
    "user.self_delete": { meta: { targetEmail: "budi@x.co" } },
    "settings.update": { target: "backup.hour", meta: { reset: false } },
    "dns.create": { target: "blog.x.co" },
    "dns.delete": { target: "blog.x.co" },
    "service.start": { target: "sshd" },
    "service.stop": { target: "sshd" },
    "service.restart": { target: "sshd" },
    "app.start": { target: "web" },
    "app.stop": { target: "web" },
    "app.restart": { target: "web" },
    "site.create": { target: "blog" },
    "site.delete": { target: "blog" },
    "site.adopt": { target: "blog" },
    "site.env_update": { target: "blog" },
    "site.deploy": { target: "blog" },
    "site.rollback": { target: "blog" },
    "site.restart": { target: "blog" },
    "site.settings_update": { target: "blog" },
    "hostname.add": { target: "blog", meta: { hostnames: ["a.x.co", "b.x.co"] } },
    "hostname.remove": { target: "blog", meta: { hostname: "a.x.co" } },
    "backup.run": { meta: { trigger: "manual", status: "succeeded" } },
    "backup.download": { target: "db.sqlite.gz" },
    "backup.verify": { meta: { ok: true } },
    "cloudflare.verify": { meta: { ok: false, code: "cf_unauthorized" } },
    "backup.prune": { actor: null, actorKind: "system" },
    "backup.restore": { target: "blog_restore" },
    "backup.restore_drop": { target: "blog_restore" },
    "session.revoke": { meta: { scope: "user", revoked: 2 } },
    "session.revoke_all": { meta: { count: 5 } },
    "secret.mismatch": { actor: null, actorKind: "system", meta: { unreadable: 3 } },
    "secret.export": {},
    "secret.reset": {},
    "panel.start": { actor: null, actorKind: "system", meta: { version: "0.3.0" } },
    "audit.prune": { actor: null, actorKind: "system", meta: { deleted: 12 } },
    "audit.export": {},
    "log.download": { target: "web" },
    "job.recover": { target: "blog" },
    "setup.update": { target: "access", meta: { key: "access", done: true } },
    "integration.fix": { target: "ecosystem_block", meta: { key: "ecosystem_block", file: "ecosystem" } },
    "integration.restore": { target: "pm2_run", meta: { file: "pm2_run", forced: false } },
    "integration.pm2_restart": { target: "pm2", meta: { missing: 0 } },
  };
  test.each(Object.entries(META))("%s has its own sentence (no fallback, no raw action)", (action, over) => {
    const { text } = describeAudit(entry({ action, ...over }));
    expect(text).not.toContain(action);
    expect(text.length).toBeGreaterThan(5);
  });

  test.each([
    [
      { action: "user.role_change", meta: { from: "user", to: "admin", targetEmail: "budi@x.co" } },
      "Citra changed the role of budi@x.co: User → Admin", // role labels come from en.app (real English since 0a)
    ],
    [{ action: "user.delete", meta: null }, "Citra deleted the account of another user"],
    [
      { action: "settings.update", target: "backup.hour", meta: { reset: true } },
      "Citra reset Daily backup time to the default",
    ],
    [
      {
        action: "backup.run",
        actor: null,
        actorKind: "system" as const,
        meta: { trigger: "schedule", status: "succeeded" },
      },
      "The system ran a scheduled backup",
    ],
    [{ action: "service.stop", target: "sshd" }, "Citra stopped the service sshd"],
    [
      { action: "session.revoke", meta: { scope: "others", count: 1 } },
      "Citra signed out of other devices (1 session)",
    ],
    [
      { action: "audit.prune", actor: null, actorKind: "system" as const, meta: { deleted: 1 } },
      "The system deleted 1 old audit entry",
    ],
    [{ action: "secret.mismatch", meta: { unreadable: 2 } }, "Data key mismatch: 2 stored secrets can't be read"],
    [
      { action: "session.revoke", meta: { scope: "others", count: 2 } },
      "Citra signed out of other devices (2 sessions)",
    ],
    [
      { action: "session.revoke", meta: { scope: "user", revoked: 2, targetEmail: "rina@contoh.test" } },
      "Citra signed rina@contoh.test out of 2 sessions",
    ],
    [{ action: "session.revoke", meta: { scope: "user" } }, "Citra signed another user out of all sessions"],
    [{ action: "log.download", target: "app:kasir-lama:err" }, "Citra downloaded the error log of the app kasir-lama"],
    [{ action: "log.download", target: "app:blog:out" }, "Citra downloaded the log of the app blog"],
    [{ action: "log.download", target: "service:sshd" }, "Citra downloaded the log of the service sshd"],
    [{ action: "log.download", target: "web" }, "Citra downloaded the web log"],
    [
      { action: "hostname.add", target: "blog", meta: { hostnames: ["a.x.co"] } },
      "Citra added the domain a.x.co to the site blog",
    ],
    [{ action: "auth.sign_in", actor: null, actorDeleted: true }, "Citra (deleted) signed in"],
    [{ action: "integration.restore", meta: { file: "pm2_run" } }, "Citra undid the fix to pm2 run script"],
  ] as const)("%o → %s", (over, text) => expect(describeAudit(entry(over as Partial<DevAuditEntry>)).text).toBe(text));

  test("unknown/retired action → fallback with the raw action", () =>
    expect(describeAudit(entry({ action: "invite.create" })).text).toBe("Citra ran invite.create"));
  test("unknown setting key falls back to the key itself", () =>
    expect(describeAudit(entry({ action: "settings.update", target: "x.y", meta: {} })).text).toBe(
      "Citra changed x.y",
    ));
  test("tones: destructive danger, failed backup danger, ordinary neutral", () => {
    expect(describeAudit(entry({ action: "user.delete" })).tone).toBe("danger");
    expect(describeAudit(entry({ action: "backup.run", meta: { status: "failed" } }))).toEqual({
      text: "Citra ran a backup, but it failed",
      tone: "danger",
    });
    expect(describeAudit(entry({})).tone).toBe("neutral");
    expect(describeAudit(entry({ action: "cloudflare.verify", meta: { ok: false, code: "cf_unauthorized" } }))).toEqual(
      {
        text: "Citra tested the Cloudflare token: failed",
        tone: "warning",
      },
    );
    expect(describeAudit(entry({ action: "cloudflare.verify", meta: { ok: true } })).tone).toBe("neutral");
    expect(describeAudit(entry({ action: "integration.pm2_restart", meta: { missing: 2 } }))).toEqual({
      text: "Citra restarted pm2 from the Setup card; 2 apps are no longer running",
      tone: "warning",
    });
    const fix = (m: Record<string, unknown>) => describeAudit(entry({ action: "integration.fix", meta: m })).text;
    expect(fix({ file: "ecosystem" })).toBe("Citra fixed the pm2 integration (ecosystem.config.js)");
    expect(fix({ key: "sites_dir_create" })).toBe("Citra fixed the pm2 integration (sites folder)");
  });
});

describe("audit filters → query", () => {
  const p = (s: string) => new URLSearchParams(s);
  test("list URL keeps filters (action repeatable, prefix '.'), drops unrelated params, sets page", () =>
    expect(
      auditListUrl(p("action=user.&action=auth.sign_in&actorId=u1&from=2026-11-01&to=2026-11-26&x=1&page=9"), 2, 20),
    ).toBe(
      "/api/dev/audit?action=user.&action=auth.sign_in&actorId=u1&from=2026-11-01&to=2026-11-26&page=2&pageSize=20",
    ));
  test("empty values are dropped", () =>
    expect(auditListUrl(p("action=&from="), 1, 20)).toBe("/api/dev/audit?page=1&pageSize=20"));
  test("CSV export carries the same filters, no paging", () => {
    expect(auditExportUrl(p("action=backup.&from=2026-11-01&page=3"))).toBe(
      "/api/dev/audit/export.csv?action=backup.&from=2026-11-01",
    );
    expect(auditExportUrl(p(""))).toBe("/api/dev/audit/export.csv");
  });
  test("isAuditFiltered ignores page", () => {
    expect(isAuditFiltered(p("page=2"))).toBe(false);
    expect(isAuditFiltered(p("actorId=u1"))).toBe(true);
  });
  test("date range: from after to is invalid; open ends are fine", () => {
    expect(invalidDateRange("2026-11-27", "2026-11-26")).toBe(true);
    expect(invalidDateRange("2026-11-26", "2026-11-26")).toBe(false);
    expect(invalidDateRange("2026-11-26", null)).toBe(false);
  });
});
