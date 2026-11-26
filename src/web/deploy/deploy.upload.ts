// Pure rules of the resumable binary upload (PLAN/03 §4.6, D15): chunk plan, resume decisions, retry schedule,
// progress math and the per-chunk checksum.
import type { UploadState } from "@/shared/deploy.types";

/** One byte range `[start, end)` of the file, sent as chunk `index`. */
export type ChunkRange = { index: number; start: number; end: number };

/** Splits `sizeBytes` into consecutive `chunkSize` ranges (last one shorter); empty file → no chunks. */
export function chunkPlan(sizeBytes: number, chunkSize: number): ChunkRange[] {
  if (!(chunkSize > 0)) throw new Error(`chunkPlan: chunkSize must be > 0, got ${chunkSize}`);
  const out: ChunkRange[] = [];
  for (let start = 0, index = 0; start < sizeBytes; start += chunkSize, index++) {
    out.push({ index, start, end: Math.min(start + chunkSize, sizeBytes) });
  }
  return out;
}

/** Waits before each re-send of a failed request (D15): ≈121 s in total, longer than a cloudflared restart blip. */
export const RETRY_DELAYS_MS: readonly number[] = [1, 2, 4, 8, 16, 30, 30, 30].map((s) => s * 1_000);
/** How often a failed request is re-sent before the upload pauses ("Unggahan terhenti"). */
export const CHUNK_MAX_RETRIES = RETRY_DELAYS_MS.length;

/** Wait before retry number `attempt` (1-based); null when retries are exhausted. */
export const retryDelayMs = (attempt: number): number | null =>
  Number.isInteger(attempt) && attempt >= 1 ? (RETRY_DELAYS_MS[attempt - 1] ?? null) : null;

/**
 * Whether a failed request is worth re-sending: no response (network), 408, 429, or 5xx (incl. Cloudflare 52x).
 * 507 `no_space` is not transient: waiting does not free storage.
 */
export const isTransientStatus = (status: number | null): boolean =>
  status === null || status === 408 || status === 429 || (status >= 500 && status !== 507);

/** Between retries `complete` waits this long while another change holds the lock (409 `busy`), at most BUSY_WAIT_MAX_MS. */
export const BUSY_RETRY_MS = 5_000;
export const BUSY_WAIT_MAX_MS = 10 * 60_000;

/** What picking `file` means given the site's unfinished upload: continue it, ask first (another file), or start fresh. */
export type ResumeChoice = "resume" | "different" | "new";

/** Same name and size as the unfinished upload → resume (chunk hashes still decide what is re-sent). */
export function resumeChoice(active: UploadState | null, file: { name: string; size: number }): ResumeChoice {
  if (!active) return "new";
  return active.fileName === file.name && active.sizeBytes === file.size ? "resume" : "different";
}

/** index → sha256 of the chunks the server already stored. */
export const receivedMap = (state: Pick<UploadState, "received">): Map<number, string> =>
  new Map(state.received.map((r) => [r.index, r.sha256]));

/** A chunk is skipped only when the server holds the same bytes (same sha256), otherwise sent (again). */
export const chunkAction = (index: number, localSha: string, received: ReadonlyMap<number, string>): "skip" | "send" =>
  received.get(index) === localSha ? "skip" : "send";

/** Chunk indexes the server does not have yet (for "6 dari 11 potongan" and progress before hashing). */
export function missingChunks(state: Pick<UploadState, "chunks" | "received">): number[] {
  const have = receivedMap(state);
  return Array.from({ length: state.chunks }, (_, i) => i).filter((i) => !have.has(i));
}

/**
 * Upload progress: percent of the file stored, at most 99 (100 would claim "done" while `complete` may still be
 * retrying offline; the card leaves for the job page once the server accepts it), and speed in bytes/second of what
 * this session actually sent (skipped chunks do not inflate it).
 */
export function uploadProgress(doneBytes: number, totalBytes: number, sessionBytes: number, elapsedMs: number) {
  const pct = totalBytes > 0 ? Math.min(99, Math.floor((doneBytes / totalBytes) * 100)) : 0;
  const bytesPerSec = elapsedMs > 0 ? (sessionBytes / elapsedMs) * 1_000 : 0;
  return { pct, bytesPerSec };
}

/** Lowercase hex of a byte buffer. */
export const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 hex of one chunk. crypto.subtle needs a secure context (https or localhost). */
export const sha256Hex = async (data: ArrayBuffer): Promise<string> =>
  toHex(await crypto.subtle.digest("SHA-256", data));
