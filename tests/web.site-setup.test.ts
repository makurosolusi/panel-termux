// Persiapan card with in-UI fixes (PLAN/06 §4): rows, fix buttons, dialog copy, diff, apply run, undo/restart text.
import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { toast } from "sonner";
import type { FixAvailability, FixBackup, FixPreview } from "@/shared/fix.types";
import type { Integration, IntegrationCheck, IntegrationCheckKey } from "@/shared/site.types";
import { idSite } from "@/web/i18n/id.site";
import { joinNames } from "@/web/i18n/id.site.setup";
import { ApiError } from "@/web/shared/api.client";
import { fixDialogTitle } from "@/web/site/fix.dialog";
import { diffLines } from "@/web/site/fix.diff";
import { restartDescription, undoDescription } from "@/web/site/setup.actions";
import {
  applicableFixes,
  checkText,
  fixSummary,
  manualOpen,
  pm2Pending,
  rowBlocked,
  rowFix,
  setupNeeded,
  visibleChecks,
} from "@/web/site/site.adopt";
import { applyFixes, fixExpect, toastFixRun, toastSiteError } from "@/web/site/site.api";

const t = idSite.setup;

// test-only fixtures
const chk = (key: IntegrationCheckKey, state: IntegrationCheck["state"] = "ok", params = {}): IntegrationCheck => ({
  key,
  state,
  params,
  detail: null,
});
const integration = (checks: IntegrationCheck[], fixes?: FixAvailability[], over: Partial<Integration> = {}) =>
  ({
    ready: false,
    checks,
    fixes,
    lastFix: null,
    appNames: ["makuro-solusi", "adminneo"],
    snippet: "// >>> panel-termux:apps v1",
    ecosystemPath: "/data/sites/ecosystem.config.js",
    ecosystemIncludesAppsJson: false,
    appsJsonExists: true,
    tunnelId: "t",
    cloudflareTokenSet: true,
    issues: ["x"],
    ...over,
  }) as Integration;
/** POCO: apps.json not loaded at all (+ old-way row from an older server), pm2 run script without the flag. */
const POCO_CHECKS = [
  chk("sites_dir"),
  chk("ecosystem_spreads_apps_json", "error"),
  chk("snippet_current", "error"),
  chk("pm2_runtime"),
  chk("pm2_auto_exit", "warning"),
];
const BLOCK: FixAvailability = {
  key: "ecosystem_block",
  checks: ["ecosystem_spreads_apps_json", "snippet_current", "apps_entries_runnable"],
  available: true,
};
const RUN: FixAvailability = { key: "pm2_auto_exit", checks: ["pm2_auto_exit"], available: true };
const preview = (over: Partial<FixPreview> = {}): FixPreview => ({
  key: "ecosystem_block",
  files: [{ file: "ecosystem", path: "/s/ecosystem.config.js", sha: "abc", changes: [] }],
  effects: { keepApps: [], addApps: [], guard: false, oldSpread: false, appliesOnRestart: false, dir: null },
  ...over,
});
const backup = (over: Partial<FixBackup> = {}): FixBackup => ({
  id: "ecosystem.20261127-101500-0123abcd",
  file: "ecosystem",
  at: "2026-11-27T10:15:00Z",
  changedSince: false,
  affectedSites: [],
  ...over,
});

const realFetch = globalThis.fetch;
const success = spyOn(toast, "success").mockImplementation(() => 1);
const warning = spyOn(toast, "warning").mockImplementation(() => 1);
const error = spyOn(toast, "error").mockImplementation(() => 1);
afterAll(() => {
  for (const s of [success, warning, error]) s.mockRestore();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const s of [success, warning, error]) s.mockClear();
});

describe("checklist rows", () => {
  test("one problem = one row: 'cara lama' folds into 'belum ikut dijalankan' with and without fixes", () => {
    expect(visibleChecks(integration(POCO_CHECKS)).map((c) => c.key)).not.toContain("snippet_current");
    const keys = visibleChecks(integration(POCO_CHECKS, [BLOCK, RUN])).map((c) => c.key);
    expect(keys).toEqual(["sites_dir", "ecosystem_spreads_apps_json", "pm2_runtime", "pm2_auto_exit"]);
  });

  test("a failing check covered by an earlier row's fix is folded too", () => {
    const i = integration([chk("snippet_current", "error"), chk("apps_entries_runnable", "error")], [BLOCK]);
    expect(visibleChecks(i).map((c) => c.key)).toEqual(["snippet_current"]);
  });

  test("POCO: Perbaiki per row and 'Perbaiki semua (2)' in checklist order", () => {
    const i = integration(POCO_CHECKS, [BLOCK, RUN]);
    expect(applicableFixes(i)).toEqual(["ecosystem_block", "pm2_auto_exit"]);
    expect(rowFix(i, chk("pm2_auto_exit", "warning"))).toBe("pm2_auto_exit");
    expect(rowFix(i, chk("sites_dir"))).toBeNull();
    expect(t.fixAll(2)).toBe("Perbaiki semua (2)");
    expect(manualOpen(i)).toBe(false);
  });

  test("panel cannot fix the file → plain reason, no button, Cara manual opens", () => {
    const i = integration(POCO_CHECKS, [{ ...BLOCK, available: false, reason: "unknown_apps_json_use" }, RUN]);
    expect(applicableFixes(i)).toEqual(["pm2_auto_exit"]);
    expect(rowBlocked(i, chk("ecosystem_spreads_apps_json", "error"))).toBe("unknown_apps_json_use");
    expect(manualOpen(i)).toBe(true);
    expect(t.unfixable.unknown_apps_json_use).toContain("tidak dikenali panel");
    expect(t.manual.title).toBe("Cara manual (untuk pengguna teknis)");
  });

  test("pending --no-auto-exit is ok + info: card may collapse, row text says when it takes effect", () => {
    const pending = chk("pm2_auto_exit", "ok", { pending: 1 });
    const i = integration([chk("ecosystem_spreads_apps_json"), pending], [], { ready: true, issues: [] });
    expect(pm2Pending(i)).toBe(true);
    expect(setupNeeded(i)).toBe(false);
    expect(checkText(pending)).toBe("Pengaman pm2 sudah dipasang. Aktif setelah HP atau pm2 dimulai ulang.");
    expect(checkText(chk("pm2_auto_exit"))).toBe(t.checks.pm2_auto_exit.ok({}));
  });

  test("copy: no-sites variant, pm2 down without a Termux command", () => {
    expect(checkText(chk("ecosystem_spreads_apps_json", "error", { noSites: 1 }))).toContain("situs pertama");
    expect(checkText(chk("pm2_runtime", "error"))).toBe("Layanan pm2 tidak berjalan, jadi semua situs ikut berhenti.");
    expect(checkText(chk("pm2_runtime", "error"))).not.toContain("sv up");
  });
});

describe("fix dialog", () => {
  test("title: the fix's own question, or 'Perbaiki n hal sekaligus?'", () => {
    expect(fixDialogTitle(["pm2_auto_exit"])).toBe("Pasang pengaman pm2?");
    expect(fixDialogTitle(["ecosystem_block", "pm2_auto_exit"])).toBe("Perbaiki 2 hal sekaligus?");
  });

  test("summary names the kept apps, the old spread and the guard", () => {
    const lines = fixSummary(
      preview({
        effects: {
          keepApps: ["makuro-solusi", "adminneo"],
          addApps: ["blog"],
          guard: true,
          oldSpread: true,
          appliesOnRestart: false,
          dir: null,
        },
      }),
    );
    expect(lines[0]).toContain("tidak dimulai ulang: makuro-solusi dan adminneo");
    expect(lines).toContain(t.dialog.ecosystem_block.oldSpread);
    expect(lines).toContain(t.dialog.ecosystem_block.guard);
    expect(lines.join(" ")).toContain("blog ikut dijalankan");
    expect(fixSummary(preview({ key: "pm2_auto_exit", files: [] }))).toEqual([t.dialog.pm2_auto_exit.body]);
    expect(
      fixSummary(preview({ key: "sites_dir_create", files: [], effects: { ...preview().effects, dir: "~/s" } })),
    ).toEqual(["Panel membuat folder `~/s` untuk situs-situsmu."]);
  });

  test("diff lines: file order, added lines numbered after their anchor, removal first", () => {
    const lines = diffLines([
      { kind: "add", afterLine: 10, lines: ["// >>>", "// <<<"] },
      { kind: "remove", line: 4, text: "...require('./apps.json')," },
    ]);
    expect(lines).toEqual([
      { sign: "-", line: 4, text: "...require('./apps.json')," },
      { sign: "+", line: 11, text: "// >>>" },
      { sign: "+", line: 12, text: "// <<<" },
    ]);
  });

  test("apply expects path → sha of the preview", () =>
    expect(fixExpect(preview())).toEqual({ "/s/ecosystem.config.js": "abc" }));
});

describe("apply run", () => {
  /** Fetch stub answering each call with the next [status, body]; records "METHOD url body". */
  const stub = (answers: [number, unknown][]) => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(url)} ${init?.body ?? ""}`);
      const [status, body] = answers.shift() ?? [500, {}];
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return calls;
  };
  const ok = { key: "ecosystem_block", outcome: "applied", restart: null, integration: integration([]) };

  test("fixes run one by one with their expect; success toast counts them", async () => {
    const calls = stub([
      [200, ok],
      [200, { ...ok, key: "pm2_auto_exit" }],
    ]);
    const run = await applyFixes([preview(), preview({ key: "pm2_auto_exit", files: [] })]);
    expect(run).toMatchObject({ done: 2, error: null });
    expect(calls).toEqual([
      'POST /api/panel/integration/fixes/ecosystem_block {"expect":{"/s/ecosystem.config.js":"abc"}}',
      'POST /api/panel/integration/fixes/pm2_auto_exit {"expect":{}}',
    ]);
    toastFixRun(run);
    expect(success).toHaveBeenCalledWith("2 hal diperbaiki. Pemeriksaan sudah diulang.");
  });

  test("stops at the first failure; validation_failed → 'Tidak diterapkan' as a warning", async () => {
    const calls = stub([[422, { error: "validation_failed", message: "x" }]]);
    const run = await applyFixes([preview(), preview({ key: "pm2_auto_exit" })]);
    expect(run.done).toBe(0);
    expect(calls).toHaveLength(1);
    toastFixRun(run);
    expect(warning.mock.calls[0]?.[0]).toBe(t.notApplied);
    expect(success).not.toHaveBeenCalled();
  });

  test("pm2 down error toast carries a 'Jalankan pm2' action; other errors do not", () => {
    toastSiteError(new ApiError("client", 409, "pm2_not_running", null));
    const opts = (n: number) => error.mock.calls[n]?.[1] as { action?: { label: string } } | undefined;
    expect(opts(0)?.action?.label).toBe("Jalankan pm2");
    toastSiteError(new ApiError("client", 409, "busy", null));
    expect(opts(1)?.action).toBeUndefined();
    expect(idSite.errorCodes.pm2_not_running).not.toContain("sv up");
  });
});

describe("undo and checked restart", () => {
  test("undo names the managed sites that stop surviving a reboot; a later edit adds the warning", () => {
    expect(undoDescription(backup({ affectedSites: ["blog", "shop"] }))).toBe(
      "blog dan shop tidak berjalan lagi setelah HP dinyalakan ulang. Sekarang tetap berjalan.",
    );
    expect(undoDescription(backup())).toBe(t.undoBody.ecosystem);
    expect(undoDescription(backup({ file: "pm2_run", changedSince: true }))).toBe(
      `${t.undoBody.pm2_run} ${t.undoChanged}`,
    );
  });

  test("restart names every app; the ecosystem note only after a panel ecosystem fix", () => {
    const i = integration([]);
    expect(restartDescription(i)).toBe(
      "Semua aplikasi berhenti beberapa detik lalu berjalan lagi: makuro-solusi dan adminneo. Pengunjung bisa terputus sebentar.",
    );
    expect(restartDescription({ ...i, lastFix: backup() })).toContain(t.restartPm2FileNote);
    expect(t.restartCheckFailed(["adminneo"])).toBe("adminneo tidak berjalan lagi setelah pm2 dimulai ulang.");
  });

  test("joinNames", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["a"])).toBe("a");
    expect(joinNames(["a", "b", "c"])).toBe("a, b, dan c");
  });
});
