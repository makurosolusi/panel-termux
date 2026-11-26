// Contract of the binary deploy API under /api/panel (role ≥ admin). Errors are `{ error, message }`.
import type { SiteRuntime } from "./site.types";

/** Size of every upload chunk except the last (which holds the remainder). Below Cloudflare's 100 MB body cap. */
export const DEPLOY_CHUNK_SIZE = 8 * 1024 * 1024;
/** Largest accepted binary; bigger → 400 `too_large`. */
export const DEPLOY_MAX_BYTES = 300 * 1000 * 1000;

/**
 * Body of POST /sites/:name/uploads (→ 201 UploadStarted). `sha256` = lowercase hex of the whole file.
 * Starting an upload for a site aborts that site's previous unfinished upload (one active upload per site).
 */
export type UploadStartRequest = { sizeBytes: number; sha256: string };

/** 201 response of POST /sites/:name/uploads. Send chunks 0..ceil(sizeBytes/chunkSize)-1. */
export type UploadStarted = { uploadId: string; chunkSize: number };

/**
 * Response of PUT /uploads/:uploadId/chunks/:index (raw application/octet-stream body, exactly chunkSize bytes
 * except the last chunk). Re-sending an index replaces it. `received` = sorted indexes stored so far.
 * Then POST /uploads/:uploadId/complete → 202 { jobId } (job kind "site.deploy"), 400 `incomplete` when chunks
 * are missing; DELETE /uploads/:uploadId → 204. Unfinished uploads expire after 1 h (and on panel restart).
 */
export type ChunkReceived = { received: number[] };

export type DeployStatus = "running" | "succeeded" | "failed" | "rolled_back";
export type DeployKind = "deploy" | "rollback";

/**
 * Item of GET /sites/:name/deploys?page&pageSize (Page<Deploy>, newest first). POST /sites/:name/rollback
 * → 202 { jobId } (job kind "site.rollback"), 409 `no_previous` without a previous binary.
 * `sha256`/`sizeBytes`/`runtime` describe the binary that the deploy (or rollback) put in place.
 */
export type Deploy = {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  sha256: string;
  sizeBytes: number;
  runtime: SiteRuntime;
  status: DeployStatus;
  jobId: string;
  kind: DeployKind;
};
