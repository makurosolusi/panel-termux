import type { UploadStarted } from "@/shared/deploy.types";
import type { JobAccepted } from "@/shared/site.types";
import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";
import { ApiError, apiFetch, errorFromResponse } from "@/web/shared/api.client";
import { SITE_ERROR_CODES, siteUrl } from "@/web/site/site.api";
import { chunkPlan, retryDelayMs } from "./deploy.upload";

/** Site error codes plus the deploy/rollback ones. */
export const DEPLOY_ERROR_CODES: Readonly<Record<string, string>> = { ...SITE_ERROR_CODES, ...id.deploy.errorCodes };

const uploadUrl = (uploadId: string, rest = "") => panelUrl(`/uploads/${encodeURIComponent(uploadId)}${rest}`);

/** PUTs one raw chunk (apiFetch only speaks JSON). Throws ApiError like apiFetch. */
async function putChunk(uploadId: string, index: number, body: Blob, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl(uploadId, `/chunks/${index}`), {
      method: "PUT",
      body,
      signal,
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", accept: "application/json" },
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new ApiError("network", null, null, null, { cause });
  }
  if (!res.ok) throw errorFromResponse(res.status, await res.json().catch(() => null));
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/** Network drops and 5xx are worth re-sending; 4xx (bad upload id, too large…) are not. */
const retryable = (err: unknown) => err instanceof ApiError && (err.kind === "network" || err.kind === "server");

/** Sends a chunk, retrying transient failures with the backoff schedule; rethrows the last error. */
async function putChunkWithRetry(uploadId: string, index: number, body: Blob, signal: AbortSignal) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await putChunk(uploadId, index, body, signal);
    } catch (err) {
      const delay = retryable(err) ? retryDelayMs(attempt) : null;
      if (delay === null || signal.aborted) throw err;
      await sleep(delay, signal);
    }
  }
}

/** Callbacks of `uploadBinary`: the upload id once created, and bytes sent so far after each chunk. */
export type UploadHooks = { onStarted: (uploadId: string) => void; onProgress: (sentBytes: number) => void };

/**
 * Creates the upload, sends every chunk in order, then completes it; resolves to the deploy job id.
 * Aborting `signal` stops between/inside chunks (the caller DELETEs the upload).
 */
export async function uploadBinary(
  site: string,
  file: File,
  sha256: string,
  signal: AbortSignal,
  hooks: UploadHooks,
): Promise<string> {
  const { uploadId, chunkSize } = await apiFetch<UploadStarted>(
    "POST",
    siteUrl(site, "/uploads"),
    { sizeBytes: file.size, sha256 },
    signal,
  );
  hooks.onStarted(uploadId);
  for (const c of chunkPlan(file.size, chunkSize)) {
    await putChunkWithRetry(uploadId, c.index, file.slice(c.start, c.end), signal);
    hooks.onProgress(c.end);
  }
  return (await apiFetch<JobAccepted>("POST", uploadUrl(uploadId, "/complete"), undefined, signal)).jobId;
}

/** Drops an unfinished upload on the server. */
export const cancelUpload = (uploadId: string): Promise<void> => apiFetch("DELETE", uploadUrl(uploadId));
