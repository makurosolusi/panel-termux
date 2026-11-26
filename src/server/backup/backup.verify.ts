import { S3Client } from "bun";
import type { BackupVerify, BackupVerifyCode, BackupVerifyInput, BackupVerifyStep } from "../../shared/backup.types";
import { recordAudit } from "../audit.service";
import type { SettingsDeps } from "../settings.service";
import { describeS3Error, draftS3Config, s3ErrorCode } from "./backup.config";

/** Whole-test budget (PLAN/04 F5.2). */
export const VERIFY_TIMEOUT_MS = 15_000;
/** Size of the probe object. */
const PROBE_BYTES = 16;
const STEPS: BackupVerifyStep[] = ["write", "read", "delete"];
const UNREACHABLE = new Set(["ConnectionRefused", "DNSResolveFailed", "ECONNREFUSED", "ENOTFOUND"]);

class Timeout extends Error {}

/** Bun S3 error → verify code for the step it failed in (PLAN/04 F5.3). */
function codeFor(step: BackupVerifyStep, e: unknown): BackupVerifyCode {
  if (e instanceof Timeout) return "timeout";
  const code = s3ErrorCode(e) ?? "";
  if (code === "NoSuchBucket") return "bucket_not_found";
  if (UNREACHABLE.has(code)) return "unreachable";
  if (code === "AccessDenied" && step === "write") return "write_denied";
  if (code === "AccessDenied" && step === "delete") return "delete_denied";
  if (step === "read") return "read_failed";
  return "s3_error";
}

const result = (code: BackupVerifyCode, failed: BackupVerifyStep | null, t0: number, detail: string | null) => {
  // No S3 call (not configured / unreadable): at = -1, every step skipped.
  const at = failed ? STEPS.indexOf(failed) : code === "ok" ? STEPS.length : -1;
  const steps = STEPS.map((step, i) => ({
    step,
    ok: at >= 0 && i < at,
    code: (i < at ? "ok" : i === at ? code : "skipped") as BackupVerifyCode | "skipped",
  }));
  return { ok: code === "ok", code, failedStep: failed, steps, ms: Date.now() - t0, detail } satisfies BackupVerify;
};

/**
 * S3 connection test (DECISIONS B7): draft ∪ stored settings; write a 16-byte probe under the prefix, stat
 * it, delete it. No list step (retention never lists, K3). Never throws; audited as `backup.verify`.
 */
export async function verifyBackupTarget(
  deps: SettingsDeps,
  actorId: string,
  draft: BackupVerifyInput = {},
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<BackupVerify> {
  const t0 = Date.now();
  const cfg = draftS3Config(deps, draft);
  let out: BackupVerify;
  if (cfg.keyMismatch) out = result("unreadable", null, t0, null);
  else if (!cfg.s3) out = result("not_configured", null, t0, null);
  else {
    const s3 = cfg.s3;
    const client = new S3Client(s3);
    const key = `${cfg.prefix}.panel-termux-check-${crypto.randomUUID()}`;
    const deadline = t0 + timeoutMs;
    const timed = <T>(p: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Timeout(`no answer within ${timeoutMs} ms`)), deadline - Date.now());
      });
      return Promise.race([p, late]).finally(() => clearTimeout(timer));
    };
    let step: BackupVerifyStep = "write";
    try {
      await timed(client.write(key, new Uint8Array(PROBE_BYTES)));
      step = "read";
      const size = (await timed(client.stat(key))).size;
      if (size !== PROBE_BYTES) throw new Error(`probe reads back as ${size} B, wrote ${PROBE_BYTES} B`);
      step = "delete";
      await timed(client.delete(key));
      out = result("ok", null, t0, null);
    } catch (e) {
      out = result(codeFor(step, e), step, t0, describeS3Error(e, s3));
    }
  }
  recordAudit(deps.db, {
    actorId,
    action: "backup.verify",
    target: cfg.s3?.bucket ?? null,
    meta: { ok: out.ok, code: out.code },
  });
  return out;
}
