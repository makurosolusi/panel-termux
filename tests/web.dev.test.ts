import { afterEach, describe, expect, test } from "bun:test";
import type { AuditAction } from "@/shared/audit.types";
import type { DevAuditEntry, DevLogEntry, DevUser } from "@/shared/dev.types";
import {
  auditActor,
  auditExportUrl,
  auditListUrl,
  describeAudit,
  invalidDateRange,
  isAuditFiltered,
} from "@/web/dev/audit.describe";
import { devErrorMessage, devFetch, devUrl } from "@/web/dev/dev.api";
import { levelParam, toViewerLines } from "@/web/dev/logs.page";
import { lastSeenText, userActions } from "@/web/dev/users.list";
import { ApiError as DevApiError, errorFromResponse, redirectFor } from "@/web/shared/api.client";
import { formatBytes, formatDateTime, formatUptime, usedPercent } from "@/web/shared/format";
import { formatLocaleForFile } from "./i18n.fixture";

formatLocaleForFile("id"); // Indonesian literals below until wave 1 migrates this file

describe("errorFromResponse / redirectFor / devErrorMessage", () => {
  test.each([
    [401, "unauthorized", "/login"],
    [403, "forbidden", "/login"], // B20
    [400, "client", null],
    [409, "client", null],
    [500, "server", null],
    [503, "server", null],
  ] as const)("HTTP %d → %s, redirect %p", (status, kind, to) => {
    // the panel's own 401 always carries this body; a bodyless 401 is Cloudflare Access (web.api-client.test.ts)
    const err = errorFromResponse(status, status === 401 ? { error: "unauthorized" } : null);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(redirectFor(err)).toBe(to);
  });

  test("reads code and message from the error body", () => {
    const err = errorFromResponse(409, { error: "exists", message: "site exists" });
    expect(err.code).toBe("exists");
    expect(err.serverMessage).toBe("site exists");
  });

  test("ignores bodies that are not { error: string }", () => {
    expect(errorFromResponse(400, { error: 42 }).code).toBeNull();
    expect(errorFromResponse(400, "oops").code).toBeNull();
  });

  test("known code → Indonesian message", () =>
    expect(devErrorMessage(errorFromResponse(409, { error: "protected" }))).toContain("dilindungi"));
  test("unknown 4xx code → server message", () =>
    expect(devErrorMessage(errorFromResponse(400, { error: "invalid_value", message: "must be a URL" }))).toBe(
      "must be a URL",
    ));
  test("network and 5xx → per-kind message", () => {
    expect(devErrorMessage(new DevApiError("network", null, null, null))).toContain("terhubung");
    expect(devErrorMessage(errorFromResponse(500, { error: "boom", message: "stack" }))).toContain("gangguan");
  });
  test("non-DevApiError → generic", () =>
    expect(devErrorMessage(new Error("x"))).toBe(
      "Permintaan tidak berhasil. Coba lagi; bila terus gagal, muat ulang halaman.",
    ));
});

describe("devUrl", () => {
  test("drops empty params", () =>
    expect(devUrl("/users", { page: 2, pageSize: 20, q: "", x: undefined, y: null })).toBe(
      "/api/dev/users?page=2&pageSize=20",
    ));
  test("encodes values", () => expect(devUrl("/logs", { q: "a b&c" })).toBe("/api/dev/logs?q=a+b%26c"));
  test("no query → bare path", () => expect(devUrl("/health")).toBe("/api/dev/health"));
});

describe("devFetch", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const stub = (impl: () => Promise<Response>) => {
    globalThis.fetch = Object.assign(impl, { preconnect: realFetch.preconnect });
  };

  test("rejected fetch → network error", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = await devFetch("GET", "/api/dev/health").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DevApiError);
    expect((err as DevApiError).kind).toBe("network");
  });

  test("409 with body → client error carrying the code", async () => {
    stub(() => Promise.resolve(Response.json({ error: "exists", message: "dup" }, { status: 409 })));
    const err = (await devFetch("PATCH", "/api/dev/users/u1", { role: "admin" }).catch(
      (e: unknown) => e,
    )) as DevApiError;
    expect([err.kind, err.code]).toEqual(["client", "exists"]);
  });

  test("204 → undefined; 200 → parsed JSON", async () => {
    stub(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(await devFetch("DELETE", "/api/dev/users/u1")).toBeUndefined();
    stub(() => Promise.resolve(Response.json({ ok: 1 })));
    expect(await devFetch<{ ok: number }>("GET", "/api/dev/health")).toEqual({ ok: 1 });
  });

  test("200 with non-JSON body → server error, not silent null", async () => {
    stub(() => Promise.resolve(new Response("<html>", { status: 200 })));
    const err = (await devFetch("GET", "/api/dev/health").catch((e: unknown) => e)) as DevApiError;
    expect([err.kind, err.code]).toEqual(["server", "invalid_json"]);
  });
});

describe("formatters", () => {
  test.each([
    [0, "0 B"],
    [1023, "1.023 B"],
    [1536, "1,5 KB"],
    [5 * 1024 ** 3, "5,0 GB"], // D16: GB/TB always one decimal
    [150 * 1024 ** 2, "150 MB"],
    [-1, "–"],
  ] as const)("formatBytes(%d) = %s", (n, s) => expect(formatBytes(n)).toBe(s));
  test.each([
    [0, "0 dtk"],
    [42, "42 dtk"],
    [437, "7 mnt 17 dtk"],
    [3725, "1 jam 2 mnt"],
    [3600, "1 jam"],
    [90061, "1 hari 1 jam"],
    [119_340, "1 hari 9 jam"],
    [86400 * 3 + 59, "3 hari"],
    [-1, "–"],
  ] as const)("formatUptime(%d) = %s", (n, s) => expect(formatUptime(n)).toBe(s));
  test("usedPercent", () => {
    expect(usedPercent(25, 100)).toBe(75);
    expect(usedPercent(0, 0)).toBe(0);
    expect(usedPercent(200, 100)).toBe(0);
  });
  test("formatDateTime handles null/invalid", () => {
    expect(formatDateTime(null)).toBe("–");
    expect(formatDateTime("nope")).toBe("–");
    expect(formatDateTime("2026-11-26T07:05:00Z")).toContain("2026");
  });
});

// test-only fixtures
const user = (over: Partial<DevUser>): DevUser => ({
  id: "u2",
  email: "u@x.co",
  name: "U",
  image: null,
  role: "user",
  createdAt: "2026-01-01T00:00:00Z",
  lastSeenAt: null,
  activeSessions: 1,
  isEnvSuperAdmin: false,
  ...over,
});

describe("user actions", () => {
  test("yourself: locked, nothing offered (server answers 409 protected/self)", () =>
    expect(userActions(user({ id: "me" }), "me")).toEqual({
      locked: "self",
      role: false,
      revoke: false,
      delete: false,
    }));
  test("env super admin: only sign-out from all devices (K21)", () =>
    expect(userActions(user({ isEnvSuperAdmin: true, role: "super_admin" }), "me")).toEqual({
      locked: "env",
      role: false,
      revoke: true,
      delete: false,
    }));
  test("env super admin who is yourself stays locked as self", () =>
    expect(userActions(user({ id: "me", isEnvSuperAdmin: true }), "me").locked).toBe("self"));
  test("other user / admin: everything", () => {
    expect(userActions(user({}), "me")).toEqual({ locked: null, role: true, revoke: true, delete: true });
    expect(userActions(user({ role: "admin" }), "me").delete).toBe(true);
  });
});

describe("lastSeenText (day resolution, local days)", () => {
  const now = new Date(2026, 10, 27, 9, 0);
  test.each([
    [null, "Belum pernah aktif"],
    ["nope", "Belum pernah aktif"],
    [new Date(2026, 10, 27, 0, 5).toISOString(), "Aktif hari ini"],
    [new Date(2026, 10, 26, 23, 59).toISOString(), "Aktif kemarin"],
    [new Date(2026, 10, 20, 12).toISOString(), "Aktif 7 hari lalu"],
  ] as const)("%p → %s", (iso, text) => expect(lastSeenText(iso, now)).toBe(text));
});

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
  test("deleted user → label survives with (terhapus)", () =>
    expect(auditActor(entry({ actor: null, actorDeleted: true }))).toBe("Citra (terhapus)"));
  test("system → Sistem", () => expect(auditActor(entry({ actor: null, actorKind: "system" }))).toBe("Sistem"));
  test("unknown → Tidak diketahui", () =>
    expect(auditActor(entry({ actor: null, actorKind: "unknown", actorLabel: null }))).toBe("Tidak diketahui"));
  test("0.2.x row without actorKind: user when actor present, else unknown", () => {
    expect(auditActor(entry({ actorKind: undefined }))).toBe("Citra");
    expect(auditActor(entry({ actor: null, actorKind: undefined }))).toBe("Tidak diketahui");
  });
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
      "Citra mengubah peran budi@x.co: Pengguna → Admin",
    ],
    [{ action: "user.delete", meta: null }, "Citra menghapus akun pengguna lain"],
    [
      { action: "settings.update", target: "backup.hour", meta: { reset: true } },
      "Citra mengembalikan Jam cadangan harian ke bawaan",
    ],
    [
      {
        action: "backup.run",
        actor: null,
        actorKind: "system" as const,
        meta: { trigger: "schedule", status: "succeeded" },
      },
      "Sistem menjalankan cadangan terjadwal",
    ],
    [{ action: "service.stop", target: "sshd" }, "Citra menghentikan layanan sshd"],
    [{ action: "session.revoke", meta: { scope: "others", count: 2 } }, "Citra keluar dari perangkat lain (2 sesi)"],
    [
      { action: "session.revoke", meta: { scope: "user", revoked: 2, targetEmail: "rina@contoh.test" } },
      "Citra mengeluarkan rina@contoh.test dari 2 sesi",
    ],
    [{ action: "session.revoke", meta: { scope: "user" } }, "Citra mengeluarkan pengguna lain dari semua sesinya"],
    [{ action: "log.download", target: "app:kasir-lama:err" }, "Citra mengunduh log error aplikasi kasir-lama"],
    [{ action: "log.download", target: "app:blog:out" }, "Citra mengunduh log aplikasi blog"],
    [{ action: "log.download", target: "service:sshd" }, "Citra mengunduh log layanan sshd"],
    [{ action: "log.download", target: "web" }, "Citra mengunduh log web"],
    [
      { action: "hostname.add", target: "blog", meta: { hostnames: ["a.x.co"] } },
      "Citra menambah domain a.x.co ke situs blog",
    ],
    [{ action: "auth.sign_in", actor: null, actorDeleted: true }, "Citra (terhapus) masuk"],
    [{ action: "integration.restore", meta: { file: "pm2_run" } }, "Citra membatalkan perbaikan run script pm2"],
  ] as const)("%o → %s", (over, text) => expect(describeAudit(entry(over as Partial<DevAuditEntry>)).text).toBe(text));

  test("unknown/retired action → fallback with the raw action", () =>
    expect(describeAudit(entry({ action: "invite.create" })).text).toBe("Citra menjalankan invite.create"));
  test("unknown setting key falls back to the key itself", () =>
    expect(describeAudit(entry({ action: "settings.update", target: "x.y", meta: {} })).text).toBe(
      "Citra mengubah x.y",
    ));
  test("tones: destructive danger, failed backup danger, ordinary neutral", () => {
    expect(describeAudit(entry({ action: "user.delete" })).tone).toBe("danger");
    expect(describeAudit(entry({ action: "backup.run", meta: { status: "failed" } }))).toEqual({
      text: "Citra menjalankan cadangan, tetapi gagal",
      tone: "danger",
    });
    expect(describeAudit(entry({})).tone).toBe("neutral");
    expect(describeAudit(entry({ action: "cloudflare.verify", meta: { ok: false, code: "cf_unauthorized" } }))).toEqual(
      {
        text: "Citra menguji token Cloudflare: gagal",
        tone: "warning",
      },
    );
    expect(describeAudit(entry({ action: "cloudflare.verify", meta: { ok: true } })).tone).toBe("neutral");
    expect(describeAudit(entry({ action: "integration.pm2_restart", meta: { missing: 2 } }))).toEqual({
      text: "Citra memulai ulang pm2 dari kartu Persiapan, 2 aplikasi tidak berjalan lagi",
      tone: "warning",
    });
    const fix = (m: Record<string, unknown>) => describeAudit(entry({ action: "integration.fix", meta: m })).text;
    expect(fix({ file: "ecosystem" })).toBe("Citra memperbaiki integrasi pm2 (ecosystem.config.js)");
    expect(fix({ key: "sites_dir_create" })).toBe("Citra memperbaiki integrasi pm2 (folder situs)");
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

describe("panel log page", () => {
  test.each([
    [null, "info"],
    ["error", "error"],
    ["warn", "warn"],
    ["loud", "info"],
  ] as const)("?level=%p → %s", (raw, level) => expect(levelParam(raw)).toBe(level));

  const e = (msg: string, at = "2026-11-26T07:00:00Z"): DevLogEntry => ({ at, level: "info", msg });
  test("newest-first API entries become oldest-first lines", () =>
    expect(toViewerLines([], [e("b"), e("a")]).map((l) => [l.text, l.seq])).toEqual([
      ["a", 0],
      ["b", 1],
    ]));
  test("next poll keeps seq of lines already shown; new lines continue the count", () => {
    const first = toViewerLines([], [e("b"), e("a")]);
    const next = toViewerLines(first, [e("d"), e("c"), e("b"), e("a")]);
    expect(next.map((l) => [l.text, l.seq])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ]);
  });
  test("ring rolled past the last line: seq still grows", () => {
    const first = toViewerLines([], [e("a")]);
    expect(toViewerLines(first, [e("z")])[0]?.seq).toBe(1);
  });
});
