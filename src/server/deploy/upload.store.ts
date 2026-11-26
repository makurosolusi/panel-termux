// Chunked binary uploads, staged under <panel data dir>/uploads/<uploadId>/<index>.part (never in a site dir).
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEPLOY_CHUNK_SIZE, DEPLOY_MAX_BYTES } from "../../shared/deploy.types";
import { log } from "../log.service";
import { ApiError } from "../routes/http.error";

/** Unfinished uploads older than this (since their last chunk) are deleted. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SHA256_RE = /^[0-9a-f]{64}$/;
const INDEX_RE = /^\d+$/;

/** One staged upload. `chunks` = number of chunks the file is split into. */
export type Upload = {
  id: string;
  site: string;
  sizeBytes: number;
  sha256: string;
  dir: string;
  chunks: number;
  received: Set<number>;
  touchedAt: number;
};

const bad = (code: string, message: string) => new ApiError(400, code, message);

/** Size the chunk `index` of `u` must have. */
const chunkBytes = (u: Upload, index: number) =>
  index < u.chunks - 1 ? DEPLOY_CHUNK_SIZE : u.sizeBytes - DEPLOY_CHUNK_SIZE * (u.chunks - 1);

/** Path of chunk `index`. */
export const chunkPath = (u: Upload, index: number) => join(u.dir, `${index}.part`);

/**
 * In-memory upload registry. Metadata is not persisted, so everything under `root` is wiped on creation
 * (panel restart = uploads lost, the client starts over). ponytail: memory-only, persist if restarts mid-upload hurt.
 */
export function createUploadStore(root: string, now = () => Date.now()) {
  const uploads = new Map<string, Upload>();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const get = (id: string) => {
    const u = uploads.get(id);
    if (!u) throw new ApiError(404, "not_found", `unknown upload ${id}`);
    return u;
  };
  const drop = (u: Upload) => {
    uploads.delete(u.id);
    rmSync(u.dir, { recursive: true, force: true });
  };
  const sweep = () => {
    for (const u of uploads.values()) {
      if (now() - u.touchedAt > UPLOAD_TTL_MS) {
        log.info(`[deploy] upload ${u.id} for ${u.site} expired`);
        drop(u);
      }
    }
  };
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();

  return {
    sweep,
    get,

    /** Validates `{ sizeBytes, sha256 }` and registers a new upload for `site`, replacing its previous one. */
    start(site: string, body: unknown): Upload {
      const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
      const { sizeBytes, sha256 } = b;
      if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 1)
        throw bad("invalid_size", "sizeBytes must be a positive integer");
      if (sizeBytes > DEPLOY_MAX_BYTES) throw bad("too_large", `binary larger than ${DEPLOY_MAX_BYTES} bytes`);
      if (typeof sha256 !== "string" || !SHA256_RE.test(sha256))
        throw bad("invalid_sha256", "sha256 must be 64 lowercase hex chars");
      for (const u of uploads.values()) if (u.site === site) drop(u);
      const id = crypto.randomUUID();
      const u: Upload = {
        id,
        site,
        sizeBytes,
        sha256,
        dir: join(root, id),
        chunks: Math.ceil(sizeBytes / DEPLOY_CHUNK_SIZE),
        received: new Set(),
        touchedAt: now(),
      };
      mkdirSync(u.dir, { mode: 0o700 });
      uploads.set(id, u);
      return u;
    },

    /** Stores chunk `rawIndex` (replacing an earlier copy); returns the sorted received indexes. */
    async putChunk(id: string, rawIndex: string, body: ArrayBuffer): Promise<number[]> {
      const u = get(id);
      const index = INDEX_RE.test(rawIndex) ? Number(rawIndex) : -1;
      if (index < 0 || index >= u.chunks) throw bad("invalid_index", `chunk index must be 0-${u.chunks - 1}`);
      const want = chunkBytes(u, index);
      if (body.byteLength !== want)
        throw bad("invalid_chunk_size", `chunk ${index} must be ${want} bytes, got ${body.byteLength}`);
      const tmp = join(u.dir, `.${index}.${crypto.randomUUID()}.tmp`);
      await Bun.write(tmp, body);
      if (!uploads.has(id)) {
        rmSync(tmp, { force: true }); // aborted while writing
        throw new ApiError(404, "not_found", `upload ${id} was aborted`);
      }
      renameSync(tmp, chunkPath(u, index));
      u.received.add(index);
      u.touchedAt = now();
      return [...u.received].sort((a, b) => a - b);
    },

    /** Chunk indexes of `u` not received yet. */
    missing: (u: Upload) => Array.from({ length: u.chunks }, (_, i) => i).filter((i) => !u.received.has(i)),

    /** Hands the upload to a job: forgets it without deleting its files (the job removes the dir). */
    detach: (u: Upload) => uploads.delete(u.id),

    /** Aborts upload `id` and deletes its chunks. */
    abort: (id: string) => drop(get(id)),

    /** Ids of the staged upload dirs on disk (tests). */
    onDisk: () => (existsSync(root) ? readdirSync(root) : []),
  };
}

/** The upload store instance type. */
export type UploadStore = ReturnType<typeof createUploadStore>;
