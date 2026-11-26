// Pure decisions of the #deploy section: what an upload error means for the card, rollback availability and the
// "Dari → Ke" description of a binary.
import { formatBytes } from "@/shared/format.id";
import type { BinaryInfo, SiteDetail } from "@/shared/site.types";
import { idDeploy } from "@/web/i18n/id.deploy";
import { ApiError, apiErrorMessage } from "@/web/shared/api.client";
import { DEPLOY_ERROR_CODES, DeployApiError } from "./deploy.api";
import { isTransientStatus } from "./deploy.upload";

const t = idDeploy;

/** First 12 hex chars of a checksum, enough to tell binaries apart. */
export const shortSha = (sha256: string): string => sha256.slice(0, 12);

/**
 * How the card continues after a failed upload: `resume` = transient, offer "Lanjutkan unggahan" (chunks kept);
 * `repick` = the server dropped the upload or refused the file, pick a (new) file; `retry` = fix the cause, try again.
 */
export type UploadFailure = { message: string; next: "resume" | "repick" | "retry" };

const str = (v: unknown): string => (typeof v === "string" ? v : "–");
const runtimeName = (v: unknown): string => (v === "native" || v === "grun" ? t.runtimes[v] : str(v));

/** Card message + next step for an upload error (early rejections spelled out with their server fields). */
export function uploadFailure(err: unknown): UploadFailure {
  if (!(err instanceof ApiError)) return { message: t.upload.failed, next: "retry" };
  const extra = err instanceof DeployApiError ? err.extra : {};
  if (isTransientStatus(err.status)) return { message: t.upload.paused, next: "resume" };
  switch (err.code) {
    case "invalid_binary": {
      const reason = extra.reason as keyof typeof t.invalidBinary;
      return { message: t.invalidBinary[reason] ?? t.errorCodes.invalid_binary, next: "repick" };
    }
    case "runtime_mismatch":
      return { message: t.runtimeMismatch(runtimeName(extra.got), runtimeName(extra.expected)), next: "repick" };
    case "no_space": {
      const need = typeof extra.needBytes === "number" ? formatBytes(extra.needBytes) : "–";
      const free = typeof extra.freeBytes === "number" ? formatBytes(extra.freeBytes) : "–";
      return { message: t.noSpace(need, free), next: "retry" };
    }
    case "upload_expired":
      return { message: t.upload.expired, next: "repick" };
    case "chunk_sha_mismatch":
    case "incomplete":
      return { message: apiErrorMessage(err, DEPLOY_ERROR_CODES), next: "resume" };
    default:
      return { message: apiErrorMessage(err, DEPLOY_ERROR_CODES), next: "retry" };
  }
}

/** Rollback needs both the live and the previous binary on disk (PLAN/03 §4.7). */
export const canRollback = (site: Pick<SiteDetail, "binary">): boolean =>
  Boolean(site.binary?.live && site.binary.previous);

/** One side of the rollback dialog: "3f9a2c1b7e0d · app-v2 · 89,2 MB", or the untracked fallback. */
export function binaryLine(bin: BinaryInfo, formatAt: (iso: string) => string): string {
  if (!bin.sha256) return t.rollback.untracked(formatBytes(bin.sizeBytes), formatAt(bin.modifiedAt));
  return [shortSha(bin.sha256), bin.fileName, formatBytes(bin.sizeBytes), formatAt(bin.modifiedAt)]
    .filter(Boolean)
    .join(" · ");
}
