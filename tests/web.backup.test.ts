import { describe, expect, test } from "bun:test";
import type { BackupRun, BackupStatus } from "@/shared/backup.types";
import { BACKUP_ERROR_CODES, backupItemDownloadUrl, backupUrl } from "@/web/backup/backup.api";
import { backupSummary, canRunBackup, runTone } from "@/web/backup/backup.state";
import { id } from "@/web/i18n/id";
import { apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";

// test-only fixtures
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

describe("backupSummary", () => {
  test.each([
    [{ configured: false, missing: ["backup.s3_bucket"] as string[] }, "not_configured", "bad"],
    [{ running: true }, "running", "warn"],
    [{ lastRun: null }, "never", "muted"],
    [{ lastRun: run({ status: "failed" }) }, "last_failed", "bad"],
    [{ lastRun: run({ status: "partial" }) }, "last_partial", "warn"],
    [{}, "ok", "ok"],
  ] as const)("%p → %p", (over, summary, tone) => expect(backupSummary(status(over))).toEqual({ summary, tone }));

  test("not configured wins over running", () =>
    expect(backupSummary(status({ configured: false, running: true })).summary).toBe("not_configured"));

  test("every summary has a label", () => {
    for (const s of ["not_configured", "running", "last_failed", "last_partial", "never", "ok"] as const) {
      expect(id.backup.status.summaries[s]).toBeTruthy();
    }
  });
});

describe("run state", () => {
  test("run tones", () => {
    expect(runTone("succeeded")).toBe("ok");
    expect(runTone("partial")).toBe("warn");
    expect(runTone("failed")).toBe("bad");
    expect(runTone("running")).toBe("warn");
  });

  test("backup button only when configured and idle", () => {
    expect(canRunBackup(status())).toBe(true);
    expect(canRunBackup(status({ running: true }))).toBe(false);
    expect(canRunBackup(status({ configured: false }))).toBe(false);
  });
});

describe("backup api", () => {
  test("urls", () => {
    expect(backupUrl("/status")).toBe("/api/panel/backups/status");
    expect(backupUrl("", { page: 2, pageSize: 20 })).toBe("/api/panel/backups?page=2&pageSize=20");
    expect(backupItemDownloadUrl("r/1", 0)).toBe("/api/panel/backups/r%2F1/items/0/download");
  });

  test("busy and not_configured map to backup messages", () => {
    expect(apiErrorMessage(errorFromResponse(409, { error: "busy" }), BACKUP_ERROR_CODES)).toBe(
      id.backup.errorCodes.busy,
    );
    expect(apiErrorMessage(errorFromResponse(400, { error: "not_configured" }), BACKUP_ERROR_CODES)).toBe(
      id.backup.errorCodes.not_configured,
    );
  });

  test("schedule label pads the hour", () => expect(id.backup.status.scheduleAt(3)).toBe("Tiap hari pukul 03.00"));
});
