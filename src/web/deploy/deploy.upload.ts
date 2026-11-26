// Pure helpers of the chunked binary upload: chunk planning, retry schedule, progress math and the checksum.

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

/** How often a failed chunk is re-sent before the upload gives up. */
export const CHUNK_MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

/** Wait before retry number `attempt` (1-based): 1 s, 2 s, 4 s; null when retries are exhausted. */
export const retryDelayMs = (attempt: number): number | null =>
  attempt >= 1 && attempt <= CHUNK_MAX_RETRIES ? RETRY_BASE_MS * 2 ** (attempt - 1) : null;

/** Upload progress: percent (0–100, whole), and average speed in bytes/second since the upload started. */
export function uploadProgress(sentBytes: number, totalBytes: number, elapsedMs: number) {
  const pct = totalBytes > 0 ? Math.min(100, Math.floor((sentBytes / totalBytes) * 100)) : 100;
  const bytesPerSec = elapsedMs > 0 ? (sentBytes / elapsedMs) * 1_000 : 0;
  return { pct, bytesPerSec };
}

/** Lowercase hex of a byte buffer. */
export const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * SHA-256 hex of the data. crypto.subtle needs a secure context (https or localhost) and has no streaming API.
 * ponytail: reads the whole file into memory (fine for ~100 MB binaries); hash incrementally if files get bigger.
 */
export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}
