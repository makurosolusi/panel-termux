import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { UploadState } from "@/shared/deploy.types";
import type { Job, JobStep } from "@/shared/job.types";
import type { BinaryInfo } from "@/shared/site.types";
import { STATUS_META } from "@/web/components/status.vocab";
import { DEPLOY_ERROR_CODES, DeployApiError } from "@/web/deploy/deploy.api";
import { binaryLine, canRollback, shortSha, uploadFailure } from "@/web/deploy/deploy.state";
import { DEPLOY_STATUS_KEY } from "@/web/deploy/deploy.status-key";
import {
  CHUNK_MAX_RETRIES,
  chunkAction,
  chunkPlan,
  isTransientStatus,
  missingChunks,
  RETRY_DELAYS_MS,
  receivedMap,
  resumeChoice,
  retryDelayMs,
  sha256Hex,
  toHex,
  uploadProgress,
} from "@/web/deploy/deploy.upload";
import { fileProblem } from "@/web/deploy/deploy.uploader";
import { idDeploy } from "@/web/i18n/id.deploy";
import { idJob } from "@/web/i18n/id.job";
import { ApiError, apiErrorMessage, errorFromResponse } from "@/web/shared/api.client";
import {
  BLIP_TOLERANCE_MS,
  currentStepIndex,
  durationText,
  jobProgress,
  jobResultLink,
  liveAnnouncement,
  nextActions,
  outcomeText,
  pollErrorView,
  recoverAction,
  stepDurationMs,
  stepLabel,
} from "@/web/site/job.state";
import { JOB_STATUS_KEY, JOB_STEP_STATUS_KEY } from "@/web/site/job.status-key";

// test-only fixtures
const upload = (over: Partial<UploadState> = {}): UploadState => ({
  uploadId: "u1",
  site: "blog",
  fileName: "app-v2",
  sizeBytes: 25,
  chunkSize: 10,
  chunks: 3,
  received: [],
  runtime: null,
  expiresAt: "2026-11-27T10:00:00Z",
  ...over,
});
const step = (key: string, status: JobStep["status"], over: Partial<JobStep> = {}): JobStep => ({
  key,
  status,
  ...over,
});
const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  kind: "site.deploy",
  target: "blog",
  status: "running",
  steps: [],
  error: null,
  startedAt: "2026-11-27T09:00:00Z",
  finishedAt: null,
  ...over,
});
const bin = (over: Partial<BinaryInfo> = {}): BinaryInfo => ({
  sizeBytes: Math.round(89.2 * 1024 * 1024),
  modifiedAt: "2026-11-26T15:40:00Z",
  deployId: "d1",
  sha256: "3f9a2c1b7e0d".padEnd(64, "0"),
  fileName: "app-v2",
  runtime: "native",
  ...over,
});
const deployErr = (status: number, body: Record<string, unknown>) =>
  new DeployApiError(errorFromResponse(status, body), body);

describe("chunk plan", () => {
  test("remainder → shorter last chunk, every byte once", () => {
    expect(chunkPlan(25, 10)).toEqual([
      { index: 0, start: 0, end: 10 },
      { index: 1, start: 10, end: 20 },
      { index: 2, start: 20, end: 25 },
    ]);
    const size = 100 * 1000 * 1000;
    const plan = chunkPlan(size, 8 * 1024 * 1024);
    expect(plan).toHaveLength(12);
    expect(plan.at(-1)?.end).toBe(size);
    expect(plan.every((c, i) => i === 0 || c.start === plan[i - 1]?.end)).toBe(true);
  });

  test("empty file → no chunks; bad chunk size throws", () => {
    expect(chunkPlan(0, 10)).toEqual([]);
    expect(() => chunkPlan(10, 0)).toThrow("chunkSize");
  });

  test("picked file: empty and over 300 MB are refused before sending", () => {
    expect(fileProblem({ size: 0 })).toBe(idDeploy.upload.empty);
    expect(fileProblem({ size: 300 * 1000 * 1000 + 1 })).toContain("batas");
    expect(fileProblem({ size: 89_000_000 })).toBeNull();
  });
});

describe("retry schedule (D15)", () => {
  test("1, 2, 4, 8, 16, 30, 30, 30 s, then give up", () => {
    expect(CHUNK_MAX_RETRIES).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(retryDelayMs)).toEqual([1, 2, 4, 8, 16, 30, 30, 30].map((s) => s * 1000));
    expect(retryDelayMs(9)).toBeNull();
    expect(retryDelayMs(0)).toBeNull();
  });

  test("total window outlasts a cloudflared blip (≥ 120 s)", () =>
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(120_000));

  test("transient: network, 408, 429, 5xx/52x; not 4xx or 507 no_space", () => {
    for (const s of [null, 408, 429, 500, 502, 503, 522, 524]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [400, 401, 404, 409, 507]) expect(isTransientStatus(s)).toBe(false);
  });
});

describe("resume plan from server `received`", () => {
  test("same name + size resumes, other file asks, none starts new", () => {
    expect(resumeChoice(null, { name: "app-v2", size: 25 })).toBe("new");
    expect(resumeChoice(upload(), { name: "app-v2", size: 25 })).toBe("resume");
    expect(resumeChoice(upload(), { name: "app-v2", size: 26 })).toBe("different");
    expect(resumeChoice(upload(), { name: "app-v3", size: 25 })).toBe("different");
  });

  test("chunks with the same sha are skipped, changed or missing ones sent", () => {
    const have = receivedMap(
      upload({
        received: [
          { index: 0, sha256: "aa" },
          { index: 2, sha256: "cc" },
        ],
      }),
    );
    expect(chunkAction(0, "aa", have)).toBe("skip");
    expect(chunkAction(1, "bb", have)).toBe("send");
    expect(chunkAction(2, "c0", have)).toBe("send"); // same name+size but different bytes
  });

  test("missing chunks drive '6 dari 11 potongan'", () => {
    expect(missingChunks(upload({ received: [{ index: 1, sha256: "x" }] }))).toEqual([0, 2]);
    expect(missingChunks(upload({ chunks: 0 }))).toEqual([]);
  });

  test("progress: % of stored bytes, speed only from bytes sent this session", () => {
    expect(uploadProgress(20, 40, 10, 2_000)).toEqual({ pct: 50, bytesPerSec: 5 });
    expect(uploadProgress(999, 1000, 0, 1).pct).toBe(99);
    expect(uploadProgress(0, 100, 0, 0)).toEqual({ pct: 0, bytesPerSec: 0 });
  });

  test("chunk sha256 matches known vectors", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe("000fff");
  });
});

describe("upload failures", () => {
  test("network and 5xx pause with Lanjutkan; chunk_sha_mismatch resumes", () => {
    expect(uploadFailure(new ApiError("network", null, null, null))).toEqual({
      message: idDeploy.upload.paused,
      next: "resume",
    });
    expect(uploadFailure(deployErr(502, {})).next).toBe("resume");
    expect(uploadFailure(deployErr(400, { error: "chunk_sha_mismatch", index: 3 })).next).toBe("resume");
  });

  test("early rejections spell out the fix", () => {
    expect(uploadFailure(deployErr(400, { error: "invalid_binary", reason: "not_aarch64" }))).toEqual({
      message: idDeploy.invalidBinary.not_aarch64,
      next: "repick",
    });
    const mismatch = uploadFailure(deployErr(409, { error: "runtime_mismatch", expected: "native", got: "grun" }));
    expect(mismatch.message).toContain("glibc lewat grun");
    expect(mismatch.message).toContain("Android native");
    const space = uploadFailure(
      deployErr(507, { error: "no_space", needBytes: 300 * 1024 * 1024, freeBytes: 120 * 1024 * 1024 }),
    );
    expect(space).toEqual({ message: idDeploy.noSpace("300 MB", "120 MB"), next: "retry" });
    expect(uploadFailure(deployErr(404, { error: "upload_expired" }))).toEqual({
      message: idDeploy.upload.expired,
      next: "repick",
    });
  });

  test("deploy codes over site codes", () => {
    expect(apiErrorMessage(errorFromResponse(409, { error: "no_previous" }), DEPLOY_ERROR_CODES)).toBe(
      idDeploy.errorCodes.no_previous,
    );
  });
});

describe("rollback + history", () => {
  test("rollback needs live and previous", () => {
    expect(canRollback({ binary: { live: bin(), previous: bin() } })).toBe(true);
    expect(canRollback({ binary: { live: bin(), previous: null } })).toBe(false);
    expect(canRollback({})).toBe(false);
  });

  test("Dari → Ke lines: recorded binary vs untracked", () => {
    const at = () => "26 Nov 22.40";
    expect(binaryLine(bin(), at)).toBe("3f9a2c1b7e0d · app-v2 · 89,2 MB · 26 Nov 22.40");
    expect(binaryLine(bin({ sha256: null, deployId: null }), at)).toBe(idDeploy.rollback.untracked("89,2 MB", at()));
    expect(shortSha("0123456789abcdef")).toBe("0123456789ab");
  });

  test("status keys: undone and interrupted are warnings, running is processing", () => {
    for (const map of [DEPLOY_STATUS_KEY, JOB_STATUS_KEY]) {
      expect(map.running).toBe("processing");
      expect(STATUS_META[map.rolled_back].tone).toBe("warning");
      expect(STATUS_META[map.interrupted].tone).toBe("warning");
      expect(STATUS_META[map.failed].tone).toBe("danger");
    }
    expect(JOB_STEP_STATUS_KEY.skipped).toBe("skipped");
  });
});

describe("stepper state", () => {
  const steps = [
    step("stage", "done", { code: "staged", params: { sizeBytes: Math.round(89.2 * 1024 * 1024) } }),
    step("detect", "done", { code: "runtime_native" }),
    step("swap", "running", { startedAt: "2026-11-27T09:00:00Z" }),
    step("health", "pending"),
  ];

  test("labels come from coded keys; legacy rows fall back to their label", () => {
    expect(stepLabel(step("swap", "done"))).toBe("Menukar binary");
    expect(stepLabel(step("restart", "done", { legacyLabel: "Restart app" }))).toBe("Restart app");
    expect(outcomeText("staged", { sizeBytes: Math.round(89.2 * 1024 * 1024) })).toBe("Binary 89,2 MB siap.");
    expect(outcomeText("healthy", { status: 200, path: "/api/health", ms: 85, seconds: 3 })).toBe(
      "HTTP 200 dari /api/health dalam 85 ms, stabil.",
    );
    expect(outcomeText("health_timeout", { seconds: 60, last: "refused", path: "/" })).toContain("menolak koneksi");
    expect(outcomeText("brand_new_code")).toBe("Hasil: brand_new_code");
    expect(outcomeText(null)).toBeNull();
  });

  test("current step, live sentence, progress", () => {
    expect(currentStepIndex(steps)).toBe(2);
    expect(currentStepIndex([step("a", "done"), step("b", "failed"), step("c", "pending")])).toBe(1);
    expect(liveAnnouncement({ steps })).toBe("Langkah 3 dari 4: Menukar binary… sedang berjalan");
    expect(jobProgress(job({ steps }))).toBe(50);
    expect(jobProgress(job({ status: "rolled_back", steps }))).toBe(100);
  });

  test("durations", () => {
    const now = new Date("2026-11-27T09:00:12Z").getTime();
    expect(stepDurationMs(steps[2] as JobStep, now)).toBe(12_000);
    expect(stepDurationMs(step("x", "pending"), now)).toBeNull();
    expect(durationText(300)).toBe("< 1 dtk");
    expect(durationText(65_000)).toBe("1 mnt 5 dtk");
  });

  test("poll errors: hidden during cloudflared restart up to 120 s, then lost", () => {
    const blip = job({ steps: [step("ingress", "done"), step("tunnel_restart", "running")] });
    const t0 = 1_000_000;
    expect(pollErrorView(blip, false, t0, t0)).toBe("none");
    expect(pollErrorView(blip, true, t0, t0 + 30_000)).toBe("blip");
    expect(pollErrorView(blip, true, t0, t0 + BLIP_TOLERANCE_MS + 1)).toBe("lost");
    expect(pollErrorView(job({ steps }), true, t0, t0 + 5_000)).toBe("stale");
    expect(pollErrorView(job({ status: "succeeded", steps }), true, t0, t0 + 5_000)).toBe("stale");
  });

  test("every server outcome code has Indonesian copy (compile-time steps, scan for outcomes)", () => {
    const codes = new Set<string>();
    for (const dir of ["src/server/sites", "src/server/deploy"]) {
      for (const f of readdirSync(dir)) {
        const src = readFileSync(join(dir, f), "utf8");
        for (const m of src.matchAll(/(?:StepError\(|code: )"([a-z0-9_]+)"/g)) codes.add(m[1] as string);
      }
    }
    const missing = [...codes].filter((c) => !(c in idJob.outcomes));
    expect(codes.size).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});

describe("recover and next actions", () => {
  test("cleanup is a plain button, retry is confirmed with a kind-specific label", () => {
    expect(recoverAction(job({ status: "interrupted", recoverMode: "cleanup" }))).toEqual({
      mode: "cleanup",
      label: "Bersihkan",
      confirm: false,
    });
    expect(recoverAction(job({ kind: "site.delete", status: "failed", recoverMode: "retry" }))).toEqual({
      mode: "retry",
      label: "Ulangi hapus situs",
      confirm: true,
    });
    expect(recoverAction(job({ kind: "hostname.remove", recoverMode: "retry" }))?.label).toBe("Ulangi hapus domain");
    expect(recoverAction(job({ recoverMode: "cleanup", resolvedBy: "j2" }))).toBeNull();
    expect(recoverAction(job({ recoverMode: null }))).toBeNull();
  });

  test("next actions only after the end; resolved jobs drop recover", () => {
    expect(nextActions(job({ next: ["recover"] }))).toEqual([]);
    expect(nextActions(job({ status: "failed", next: ["recover", "app_log"], recoverMode: "cleanup" }))).toEqual([
      "recover",
      "app_log",
    ]);
    expect(nextActions(job({ status: "failed", next: ["recover", "app_log"], recoverMode: null }))).toEqual([
      "app_log",
    ]);
    expect(nextActions(job({ status: "rolled_back", next: ["redeploy", "redeploy"] }))).toEqual(["redeploy"]);
    expect(nextActions(job({ status: "succeeded" }))).toEqual([]);
  });

  test("result link goes to the list when the site is gone", () => {
    expect(jobResultLink(job({ status: "succeeded" }))).toBe("/panel/sites/blog");
    expect(jobResultLink(job({ kind: "site.delete", status: "succeeded" }))).toBe("/panel/sites");
    expect(jobResultLink(job({ kind: "site.create", status: "failed" }))).toBe("/panel/sites");
    expect(jobResultLink(job({ kind: "hostname.add", target: "a b" }))).toBe("/panel/sites/a%20b");
  });
});
