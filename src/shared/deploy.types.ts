// Contract of the binary deploy API under /api/panel (role ≥ admin, PLAN/03 §3.2). Errors: { error, message, ...extra }.
// Fields marked "0.3.0" are optional until their producers land, "0.2.x" ones go away; both settle in W7 (schedule §1.4).
import type { SiteRuntime } from "./site.types";

/** Size of every upload chunk except the last (which holds the remainder). Below Cloudflare's 100 MB body cap. */
export const DEPLOY_CHUNK_SIZE = 8 * 1024 * 1024;
/** Largest accepted binary; bigger → 400 `too_large`. */
export const DEPLOY_MAX_BYTES = 300 * 1000 * 1000;
/** Header carrying the lowercase hex sha256 of a chunk body. */
export const CHUNK_SHA_HEADER = "X-Chunk-Sha256";

/**
 * Body of POST /sites/:name/uploads (→ 201). Replaces that site's previous unfinished upload. 0.3.0 sends
 * `fileName` and per-chunk hashes (CHUNK_SHA_HEADER) instead of the whole-file `sha256`.
 */
export type UploadStartRequest = {
  sizeBytes: number;
  /** 0.3.0 */
  fileName?: string;
  /** 0.2.x: lowercase hex of the whole file. */
  sha256?: string;
};

/** 201 of POST uploads, GET /uploads/:id, GET /sites/:name/uploads/active (200 null when none). */
export type UploadState = {
  uploadId: string;
  site: string;
  fileName: string;
  sizeBytes: number;
  chunkSize: number;
  chunks: number;
  received: { index: number; sha256: string }[];
  runtime: SiteRuntime | null;
  expiresAt: string;
};

/** 0.2.x 201 response of POST /sites/:name/uploads; replaced by UploadState in W7. */
export type UploadStarted = { uploadId: string; chunkSize: number };

/** Response of PUT /uploads/:uploadId/chunks/:index. `received` = sorted indexes stored so far. */
export type ChunkReceived = {
  received: number[];
  /** 0.3.0. Detected from chunk 0. */
  runtime?: SiteRuntime | null;
};

/** Deploy row outcome; `interrupted` = the panel stopped while it ran. */
export type DeployStatus = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";
/** Whether a row put a new binary in place or went back to the previous one. */
export type DeployKind = "deploy" | "rollback";

/**
 * Item of GET /sites/:name/deploys?page&pageSize (Page<Deploy>, newest first). `sha256`/`sizeBytes`/`runtime`
 * describe the binary that the deploy (or rollback) put in place.
 */
export type Deploy = {
  id: string;
  at: string;
  /** 0.3.0 */
  finishedAt?: string | null;
  actor: { id: string; name: string } | null;
  sha256: string;
  sizeBytes: number;
  /** 0.3.0 */
  fileName?: string | null;
  runtime: SiteRuntime;
  status: DeployStatus;
  jobId: string;
  kind: DeployKind;
  /** 0.3.0. This row's file is the live `app` now (stat match). At most one per site. */
  active?: boolean;
};
