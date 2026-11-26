import { describe, expect, test } from "bun:test";
import type { BackupItem, BackupLastGood, BackupRestore, BackupRun, BackupStatus } from "@/shared/backup.types";
import { BACKUP_ERROR_CODES, backupItemDownloadUrl, backupUrl } from "@/web/backup/backup.api";
import { canDropRestore } from "@/web/backup/backup.restores";
import {
  backupBanners,
  canDownload,
  canRestore,
  contentKinds,
  findItem,
  isBackupBusy,
  isInterrupted,
  lastGoodRows,
  runBlock,
  STALE_AFTER_MS,
} from "@/web/backup/backup.state";
import { backupHeadline, restoreStatusKey, runStatusKey } from "@/web/backup/backup.status-key";
import { idBackup } from "@/web/i18n/id.backup";
import { apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";

// test-only fixtures
const item = (over: Partial<BackupItem> = {}): BackupItem => ({
  kind: "database",
  name: "blog",
  key: "k1",
  sizeBytes: 1024,
  ok: true,
  error: null,
  restoreHint: "pg_restore -d blog blog.dump",
  ...over,
});
const run = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: "r1",
  trigger: "manual",
  status: "succeeded",
  startedAt: "2026-11-26T03:00:00Z",
  finishedAt: "2026-11-26T03:01:00Z",
  items: [],
  error: null,
  ...over,
});
const good = (over: Partial<BackupLastGood> = {}): BackupLastGood => ({
  kind: "database",
  name: "blog",
  runId: "r1",
  itemIndex: 0,
  at: "2026-11-26T03:00:00Z",
  sizeBytes: 1024,
  checked: true,
  ...over,
});
const status = (over: Partial<BackupStatus> = {}): BackupStatus => ({
  configured: true,
  missing: [],
  hourLocal: 3,
  nextRunAt: "2026-11-27T03:00:00Z",
  retentionDays: 14,
  running: false,
  lastRun: run(),
  ...over,
});
const restore = (over: Partial<BackupRestore> = {}): BackupRestore => ({
  id: "x1",
  runId: "r1",
  itemIndex: 0,
  sourceName: "blog",
  targetDb: "blog_r202611260300",
  status: "succeeded",
  error: null,
  errorCode: null,
  tableCount: 4,
  startedAt: "2026-11-26T04:00:00Z",
  finishedAt: "2026-11-26T04:01:00Z",
  droppedAt: null,
  inUse: false,
  actor: null,
  ...over,
});
const INTERRUPTED = "interrupted by panel restart";

describe("run button", () => {
  test.each([
    [{ configured: false }, "not_configured"],
    [{ keyMismatch: true, running: true }, "key_mismatch"],
    [{ running: true }, "running"],
    [{ restoring: true }, "restoring"],
    [{}, null],
  ] as const)("%p → %p", (over, block) => expect(runBlock(status(over))).toBe(block));

  test("every block reason has copy", () => {
    for (const b of ["not_configured", "key_mismatch", "running", "restoring"] as const)
      expect(idBackup.run.blocked[b]).toBeTruthy();
  });

  test("busy while a run or a restore goes", () => {
    expect(isBackupBusy(status({ restoring: true }))).toBe(true);
    expect(isBackupBusy(status({ running: true }))).toBe(true);
    expect(isBackupBusy(status())).toBe(false);
    expect(isBackupBusy(undefined)).toBe(false);
  });
});

describe("banners", () => {
  test("most urgent first", () =>
    expect(backupBanners(status({ keyMismatch: true, configured: false, includeSecrets: true }), null)).toEqual([
      "key_mismatch",
      "not_configured",
      "secrets_included",
    ]));
  test("no key copy only when known never exported and secrets are off", () => {
    expect(backupBanners(status(), null)).toEqual(["no_key_copy"]);
    expect(backupBanners(status(), undefined)).toEqual([]);
    expect(backupBanners(status(), "2026-11-01T00:00:00Z")).toEqual([]);
    expect(backupBanners(status({ includeSecrets: true }), null)).toEqual(["secrets_included"]);
  });
});

describe("last good per item", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  test("stale after 36 hours", () => {
    const old = new Date(now.getTime() - STALE_AFTER_MS - 1).toISOString();
    const rows = lastGoodRows(status({ lastGood: [good(), good({ name: "shop", at: old })] }), now);
    expect(rows.map((r) => [r.name, r.stale])).toEqual([
      ["blog", false],
      ["shop", true],
    ]);
  });
  test("failed item of the last run without a good copy is 'never', bookkeeping files skipped", () => {
    const last = run({
      status: "partial",
      items: [
        item(),
        item({ name: "shop", ok: false }),
        item({ kind: "manifest", name: "m", ok: false }),
        item({ name: "shop", ok: false }),
      ],
    });
    const rows = lastGoodRows(status({ lastRun: last, lastGood: [good()] }), now);
    expect(rows.map((r) => [r.name, r.good === null])).toEqual([
      ["blog", false],
      ["shop", true],
    ]);
  });
  test("item lookup for the restore command", () => {
    const runs = [run({ id: "a" }), run({ id: "r1", items: [item({ restoreHint: "cmd" })] })];
    expect(findItem(runs, "r1", 0)?.restoreHint).toBe("cmd");
    expect(findItem(runs, "r1", 3)).toBeNull();
    expect(findItem(runs, "zz", 0)).toBeNull();
  });
  test("contents list unique kinds without checksums/manifest", () =>
    expect(
      contentKinds(run({ items: [item(), item({ name: "b" }), item({ kind: "checksums" }), item({ kind: "panel" })] })),
    ).toEqual(["database", "panel"]));
});

describe("download and restore rules", () => {
  const access = { keyMismatch: false, superAdmin: false };
  test("secrets only for super_admin, nothing on mismatch, pruned or failed", () => {
    expect(canDownload(item(), access)).toBe(true);
    expect(canDownload(item({ kind: "secrets" }), access)).toBe(false);
    expect(canDownload(item({ kind: "secrets" }), { ...access, superAdmin: true })).toBe(true);
    expect(canDownload(item(), { ...access, keyMismatch: true })).toBe(false);
    expect(canDownload(item({ pruned: true }), access)).toBe(false);
    expect(canDownload(item({ ok: false }), access)).toBe(false);
  });
  test("restore only for databases while idle and key ok", () => {
    expect(canRestore("database", status())).toBe(true);
    expect(canRestore("sites", status())).toBe(false);
    expect(canRestore("database", status({ restoring: true }))).toBe(false);
    expect(canRestore("database", status({ keyMismatch: true }))).toBe(false);
  });
  test("drop test database hidden when dropped, in use or running", () => {
    expect(canDropRestore(restore())).toBe(true);
    expect(canDropRestore(restore({ droppedAt: "2026-11-26T05:00:00Z" }))).toBe(false);
    expect(canDropRestore(restore({ inUse: true }))).toBe(false);
    expect(canDropRestore(restore({ status: "running" }))).toBe(false);
  });
});

describe("status keys", () => {
  test("runs", () => {
    expect(runStatusKey(run({ status: "running" }))).toBe("processing");
    expect(runStatusKey(run())).toBe("succeeded");
    expect(runStatusKey(run({ status: "partial" }))).toBe("partial");
    expect(runStatusKey(run({ status: "failed", error: "s3 down" }))).toBe("failed");
    expect(runStatusKey(run({ status: "failed", error: INTERRUPTED }))).toBe("interrupted");
  });
  test("restores", () => {
    expect(restoreStatusKey(restore({ status: "running" }))).toBe("processing");
    expect(restoreStatusKey(restore({ status: "failed", error: INTERRUPTED }))).toBe("interrupted");
    expect(restoreStatusKey(restore({ status: "failed", error: "pg_restore: x" }))).toBe("failed");
    expect(isInterrupted({ status: "succeeded", error: INTERRUPTED })).toBe(false);
  });
  test("headline", () => {
    expect(backupHeadline(status({ keyMismatch: true, configured: false })).state).toBe("key_mismatch");
    expect(backupHeadline(status({ configured: false })).state).toBe("not_configured");
    expect(backupHeadline(status({ restoring: true }))).toEqual({
      state: "processing",
      label: idBackup.headline.restoring,
    });
    expect(backupHeadline(status({ lastRun: null })).label).toBe(idBackup.headline.never);
    expect(backupHeadline(status({ lastRun: run({ status: "partial" }) })).state).toBe("partial");
  });
});

describe("backup api", () => {
  test("urls", () => {
    expect(backupUrl("/status")).toBe("/api/panel/backups/status");
    expect(backupUrl("", { page: 2, pageSize: 20 })).toBe("/api/panel/backups?page=2&pageSize=20");
    expect(backupItemDownloadUrl("r/1", 0)).toBe("/api/panel/backups/r%2F1/items/0/download");
  });
  test.each([
    [409, "busy"],
    [400, "not_configured"],
    [409, "key_mismatch"],
    [410, "pruned"],
    [409, "in_use"],
    [400, "confirm_mismatch"],
  ] as const)("%p %p → backup copy", (code, error) =>
    expect(apiErrorMessage(errorFromResponse(code, { error }), BACKUP_ERROR_CODES)).toBe(idBackup.errorCodes[error]),
  );
  test("copy", () => {
    expect(idBackup.status.scheduleAt(3)).toBe("Tiap hari pukul 03.00");
    expect(idBackup.status.retentionValue(14, 3)).toBe("14 hari, minimal 3 cadangan berhasil terakhir");
    expect(idBackup.restores.done(4)).toBe("Siap: 4 tabel");
  });
});
