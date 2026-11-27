// Network side of the resumable deploy upload (PLAN/03 §3.5, §4.6). Errors keep the server's extra fields
// (`reason`, `expected`, `got`, `needBytes`, `freeBytes`, `index`) so the card can explain early rejections.
import { CHUNK_SHA_HEADER, type ChunkReceived, type UploadState } from "@/shared/deploy.types";
import type { JobAccepted } from "@/shared/site.types";
import { tDeploy } from "@/web/i18n/en.deploy";
import { panelUrl } from "@/web/panel/panel.api";
import { AJAX_HEADERS, ApiError, failedResponse } from "@/web/shared/api.client";
import { SITE_ERROR_CODES, siteUrl } from "@/web/site/site.api";
import {
  BUSY_RETRY_MS,
  BUSY_WAIT_MAX_MS,
  CHUNK_MAX_RETRIES,
  chunkAction,
  chunkPlan,
  isTransientStatus,
  receivedMap,
  retryDelayMs,
  sha256Hex,
} from "./deploy.upload";

/** Site error codes plus the deploy/rollback ones. */
export const DEPLOY_ERROR_CODES: Readonly<Record<string, string>> = { ...SITE_ERROR_CODES, ...tDeploy.errorCodes };

/** ApiError plus the `{ error, message, ...extra }` body fields. */
export class DeployApiError extends ApiError {
  constructor(
    base: ApiError,
    readonly extra: Readonly<Record<string, unknown>>,
  ) {
    super(base.kind, base.status, base.code, base.serverMessage, { cause: base });
  }
}

/** One deploy API call; JSON or raw body; 204 → undefined. Throws DeployApiError (network: status null). */
async function call<T>(method: string, url: string, signal: AbortSignal, body?: ArrayBuffer | object, sha?: string) {
  const raw = body instanceof ArrayBuffer;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        ...AJAX_HEADERS,
        ...(body === undefined ? {} : { "content-type": raw ? "application/octet-stream" : "application/json" }),
        ...(sha ? { [CHUNK_SHA_HEADER]: sha } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new DeployApiError(new ApiError("network", null, null, null, { cause }), {});
  }
  if (res.status === 204) return undefined as T;
  const parsed: unknown = await res.json().catch(() => null); // proxy error page → no body
  if (res.ok) return parsed as T;
  throw new DeployApiError(failedResponse(res.status, parsed), (parsed ?? {}) as Record<string, unknown>);
}

const uploadUrl = (uploadId: string, rest = "") => panelUrl(`/uploads/${encodeURIComponent(uploadId)}${rest}`);

/** Abortable wait. */
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/** What the upload is doing now, for the card. */
export type UploadPhase =
  | { kind: "preparing" }
  | {
      kind: "sending";
      uploadId: string;
      doneBytes: number;
      sessionBytes: number;
      /** Chunk being hashed/sent (0-based), null between chunks. */
      current: number | null;
      chunks: number;
    }
  | { kind: "retrying"; sec: number; attempt: number }
  | { kind: "completing" }
  | { kind: "waiting_busy" };

const isTransient = (e: unknown) => e instanceof ApiError && isTransientStatus(e.status);

/** Runs `op`, re-sending transient failures on the D15 schedule; then rethrows (the card offers "Lanjutkan"). */
async function withRetry<T>(op: () => Promise<T>, signal: AbortSignal, onPhase: (p: UploadPhase) => void) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const delay = isTransient(err) ? retryDelayMs(attempt) : null;
      if (delay === null || signal.aborted) throw err;
      onPhase({ kind: "retrying", sec: delay / 1_000, attempt });
      await sleep(delay, signal);
    }
  }
}

/** The site's unfinished upload, or null. */
export const activeUpload = (site: string, signal: AbortSignal) =>
  call<UploadState | null>("GET", siteUrl(site, "/uploads/active"), signal);

/** Drops an unfinished upload on the server. */
export const cancelUpload = (uploadId: string) =>
  call<void>("DELETE", uploadUrl(uploadId), new AbortController().signal);

/**
 * Uploads `file` to `site` and completes it; resolves to the deploy job id. `resumeId` continues that upload
 * (server `received` decides which chunks are skipped); null starts a new one (replacing any unfinished upload).
 */
export async function runUpload(
  site: string,
  file: File,
  resumeId: string | null,
  signal: AbortSignal,
  onPhase: (p: UploadPhase) => void,
): Promise<string> {
  onPhase({ kind: "preparing" });
  const state = await withRetry(
    () =>
      resumeId
        ? call<UploadState>("GET", uploadUrl(resumeId), signal)
        : call<UploadState>("POST", siteUrl(site, "/uploads"), signal, { sizeBytes: file.size, fileName: file.name }),
    signal,
    onPhase,
  );
  const { uploadId } = state;
  const plan = chunkPlan(file.size, state.chunkSize);
  const have = receivedMap(state);
  let doneBytes = 0;
  let sessionBytes = 0;
  const sendChunk = async (index: number) => {
    const c = plan[index];
    if (!c) throw new Error(`upload ${uploadId}: server asked for chunk ${index} of ${plan.length}`);
    onPhase({ kind: "sending", uploadId, doneBytes, sessionBytes, current: index, chunks: plan.length });
    const body = await file.slice(c.start, c.end).arrayBuffer();
    const sha = await sha256Hex(body);
    if (chunkAction(index, sha, have) === "send") {
      await withRetry(
        () => call<ChunkReceived>("PUT", uploadUrl(uploadId, `/chunks/${index}`), signal, body, sha),
        signal,
        onPhase,
      );
      sessionBytes += c.end - c.start;
      have.set(index, sha);
    }
    return c.end - c.start;
  };
  for (const c of plan) {
    doneBytes += await sendChunk(c.index);
    onPhase({ kind: "sending", uploadId, doneBytes, sessionBytes, current: null, chunks: plan.length });
  }
  return complete(uploadId, signal, onPhase, async (index) => {
    have.delete(index); // server forgot it: re-send regardless of the cached sha
    await sendChunk(index);
  });
}

/** POST complete: re-sends a corrupt chunk and tries again; waits (5 s, ≤ 10 min) while another change runs. */
async function complete(
  uploadId: string,
  signal: AbortSignal,
  onPhase: (p: UploadPhase) => void,
  resend: (index: number) => Promise<void>,
): Promise<string> {
  const busyUntil = Date.now() + BUSY_WAIT_MAX_MS;
  for (let corrupt = 0; ; ) {
    onPhase({ kind: "completing" });
    try {
      const res = await withRetry(
        () => call<JobAccepted>("POST", uploadUrl(uploadId, "/complete"), signal),
        signal,
        onPhase,
      );
      return res.jobId;
    } catch (err) {
      if (!(err instanceof DeployApiError)) throw err;
      if (err.code === "chunk_corrupt" && typeof err.extra.index === "number" && corrupt++ < CHUNK_MAX_RETRIES) {
        await resend(err.extra.index);
      } else if (err.code === "busy" && Date.now() < busyUntil) {
        onPhase({ kind: "waiting_busy" });
        await sleep(BUSY_RETRY_MS, signal);
      } else throw err;
    }
  }
}
