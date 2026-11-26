import { describe, expect, test } from "bun:test";
import type { Deploy } from "@/shared/deploy.types";
import type { Page } from "@/shared/dev.types";
import { DEPLOY_ERROR_CODES } from "@/web/deploy/deploy.api";
import { canRollback, deployTone, shortSha } from "@/web/deploy/deploy.state";
import {
  CHUNK_MAX_RETRIES,
  chunkPlan,
  retryDelayMs,
  sha256Hex,
  toHex,
  uploadProgress,
} from "@/web/deploy/deploy.upload";
import { id } from "@/web/i18n/id";
import { apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";

// test-only fixtures
const deploy = (over: Partial<Deploy> = {}): Deploy => ({
  id: "d1",
  at: "2026-11-26T07:00:00Z",
  actor: { id: "u1", name: "Bip" },
  sha256: "ab".repeat(32),
  sizeBytes: 1000,
  runtime: "native",
  status: "succeeded",
  jobId: "j1",
  kind: "deploy",
  ...over,
});
const page = (items: Deploy[], over: Partial<Page<Deploy>> = {}): Page<Deploy> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
  ...over,
});

describe("chunkPlan", () => {
  test("exact multiple → equal chunks", () =>
    expect(chunkPlan(30, 10)).toEqual([
      { index: 0, start: 0, end: 10 },
      { index: 1, start: 10, end: 20 },
      { index: 2, start: 20, end: 30 },
    ]));

  test("remainder → shorter last chunk", () =>
    expect(chunkPlan(25, 10).map((c) => c.end - c.start)).toEqual([10, 10, 5]));

  test("file smaller than a chunk → one chunk", () =>
    expect(chunkPlan(3, 10)).toEqual([{ index: 0, start: 0, end: 3 }]));

  test("100 MB with 8 MiB chunks covers every byte once", () => {
    const size = 100 * 1000 * 1000;
    const plan = chunkPlan(size, 8 * 1024 * 1024);
    expect(plan).toHaveLength(Math.ceil(size / (8 * 1024 * 1024)));
    expect(plan.at(-1)?.end).toBe(size);
    expect(plan.every((c, i) => i === 0 || c.start === plan[i - 1]?.end)).toBe(true);
  });

  test("empty file → no chunks; bad chunk size throws", () => {
    expect(chunkPlan(0, 10)).toEqual([]);
    expect(() => chunkPlan(10, 0)).toThrow("chunkSize");
  });
});

describe("retry schedule", () => {
  test("exponential backoff, then give up", () => {
    expect(CHUNK_MAX_RETRIES).toBe(3);
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000, null]);
    expect(retryDelayMs(0)).toBeNull();
  });
});

describe("uploadProgress", () => {
  test("percent floored, speed in bytes/s", () =>
    expect(uploadProgress(5 * 1024 * 1024, 20 * 1024 * 1024, 2_000)).toEqual({
      pct: 25,
      bytesPerSec: 2.5 * 1024 * 1024,
    }));

  test("no elapsed time → speed 0; never above 100%", () => {
    expect(uploadProgress(0, 100, 0)).toEqual({ pct: 0, bytesPerSec: 0 });
    expect(uploadProgress(150, 100, 1_000).pct).toBe(100);
    expect(uploadProgress(0, 0, 0).pct).toBe(100);
  });

  test("99.9% is still shown as 99 until the last byte", () => expect(uploadProgress(999, 1000, 1).pct).toBe(99));
});

describe("sha256Hex", () => {
  test("known vectors (empty, 'abc')", async () => {
    expect(await sha256Hex(new ArrayBuffer(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("toHex pads bytes", () => expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe("000fff"));
});

describe("deploy history state", () => {
  test("rollback needs a previous successful binary", () => {
    expect(canRollback(page([]))).toBe(false);
    expect(canRollback(page([deploy()]))).toBe(false);
    expect(canRollback(page([deploy({ status: "failed" }), deploy()]))).toBe(false);
    expect(canRollback(page([deploy(), deploy({ kind: "rollback" })]))).toBe(true);
  });

  test("more entries than shown → let the server decide", () => {
    expect(canRollback(page([deploy()], { total: 25 }))).toBe(true);
    expect(canRollback(page([deploy()], { page: 2, total: 21 }))).toBe(true);
  });

  test("tones and short sha", () => {
    expect(deployTone("succeeded")).toBe("ok");
    expect(deployTone("rolled_back")).toBe("bad");
    expect(deployTone("running")).toBe("warn");
    expect(shortSha("0123456789abcdef")).toBe("0123456789ab");
  });

  test("deploy error codes map to Indonesian messages", () => {
    expect(apiErrorMessage(errorFromResponse(409, { error: "no_previous" }), DEPLOY_ERROR_CODES)).toBe(
      id.deploy.errorCodes.no_previous,
    );
    expect(apiErrorMessage(errorFromResponse(409, { error: "busy" }), DEPLOY_ERROR_CODES)).toBe(
      id.site.errorCodes.busy,
    );
  });

  test("job kinds of deploy/rollback have labels", () => {
    expect(id.site.job.kinds["site.deploy"]).toBe("Deploy");
    expect(id.site.job.kinds["site.rollback"]).toBe("Rollback");
  });
});
