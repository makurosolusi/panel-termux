// Upload records (meta.json v1) and request validation of the resumable upload protocol (PLAN/03 §3.2).
import { statfsSync } from "node:fs";
import { DEPLOY_CHUNK_SIZE, DEPLOY_MAX_BYTES } from "../../shared/deploy.types";
import type { SiteRuntime } from "../../shared/site.types";
import { ApiError } from "../routes/http.error";

/** Unfinished uploads older than this (since their last chunk) are deleted. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
/** Free space kept on the data dir's filesystem on top of all active uploads. */
export const UPLOAD_SPACE_MARGIN = 200 * 1000 * 1000;
const SHA256_RE = /^[0-9a-f]{64}$/;
const FILE_NAME_MAX = 255;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused
const FILE_NAME_BAD = /[\u0000-\u001f\u007f/\\]/;

/** Persisted state of one upload (meta.json, v1). `sha256` = 0.2.x whole-file hash (goes away in W7). */
export type UploadMeta = {
  v: 1;
  id: string;
  site: string;
  fileName: string;
  sizeBytes: number;
  chunks: number;
  chunkSha: Record<string, string>;
  runtime: SiteRuntime | null;
  state: "receiving" | "assembling";
  createdAt: number;
  touchedAt: number;
  sha256?: string;
};

/** Called with chunk 0's runtime before it is stored; throws (ApiError) to refuse the upload. */
export type RuntimeCheck = (site: string, runtime: SiteRuntime) => void | Promise<void>;

/** 400 ApiError. */
export const bad = (code: string, message: string, extra?: Record<string, unknown>) =>
  new ApiError(400, code, message, extra);
/** 404 `upload_expired`. */
export const expired = (id: string) =>
  new ApiError(404, "upload_expired", `upload ${id} does not exist (expired or replaced)`);

/** Bytes chunk `index` of `u` must have. */
export const chunkBytes = (u: Pick<UploadMeta, "chunks" | "sizeBytes">, index: number) =>
  index < u.chunks - 1 ? DEPLOY_CHUNK_SIZE : u.sizeBytes - DEPLOY_CHUNK_SIZE * (u.chunks - 1);

/** Free bytes for unprivileged writes on the filesystem holding `path`. */
export const freeBytes = (path: string): number => {
  const s = statfsSync(path);
  return s.bavail * s.bsize;
};

/** Validated body of POST /sites/:name/uploads; `fileName` defaults to "app", `sha256` = 0.2.x whole-file hash. */
export function parseStart(body: unknown): { sizeBytes: number; fileName: string; sha256?: string } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { sizeBytes, sha256 } = b;
  const fileName = b.fileName ?? "app";
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 1)
    throw bad("invalid_size", "sizeBytes must be a positive integer");
  if (sizeBytes > DEPLOY_MAX_BYTES) throw bad("too_large", `binary larger than ${DEPLOY_MAX_BYTES} bytes`);
  if (typeof fileName !== "string" || !fileName || fileName.length > FILE_NAME_MAX || FILE_NAME_BAD.test(fileName))
    throw bad("invalid_file_name", "fileName must be 1-255 characters without control characters or slashes");
  if (sha256 !== undefined && (typeof sha256 !== "string" || !SHA256_RE.test(sha256)))
    throw bad("invalid_sha256", "sha256 must be 64 lowercase hex chars");
  return { sizeBytes, fileName, ...(sha256 ? { sha256: sha256 as string } : {}) };
}
