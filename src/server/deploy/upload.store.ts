// Resumable chunked uploads (PLAN/03 D13): <panel data dir>/uploads/<id>/{upload.bin, meta.json}. Chunks are written
// in place at their offset and fsynced before meta.json (tmp + rename) records their sha256, so a panel restart keeps
// every acknowledged chunk. Never inside a site folder.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { UploadState } from "../../shared/deploy.types";
import { DEPLOY_CHUNK_SIZE } from "../../shared/deploy.types";
import { log } from "../log.service";
import { ApiError } from "../routes/http.error";
import { BinaryError, detectRuntimeBuffer } from "./elf.runtime";
import {
  bad,
  chunkBytes,
  expired,
  freeBytes,
  parseStart,
  type RuntimeCheck,
  UPLOAD_SPACE_MARGIN,
  UPLOAD_TTL_MS,
  type UploadMeta,
} from "./upload.meta";

export { freeBytes, UPLOAD_SPACE_MARGIN, UPLOAD_TTL_MS, type UploadMeta } from "./upload.meta";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const INDEX_RE = /^\d+$/;
const META = "meta.json";
const BIN = "upload.bin";

const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/**
 * Upload registry under `root`. On creation it drops dirs without readable meta, expired ones, `assembling` ones
 * (their job was cut off) and stray temp files; the rest resume after a panel restart.
 */
export function createUploadStore(root: string, opts: { now?: () => number; free?: (p: string) => number } = {}) {
  const now = opts.now ?? Date.now;
  const free = opts.free ?? freeBytes;
  const uploads = new Map<string, UploadMeta>();
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const dirOf = (id: string) => join(root, id);
  const binOf = (id: string) => join(root, id, BIN);
  const persist = (u: UploadMeta) => {
    const tmp = join(dirOf(u.id), `${META}.tmp`);
    writeFileSync(tmp, JSON.stringify(u), { mode: 0o600 });
    renameSync(tmp, join(dirOf(u.id), META));
  };
  const drop = (u: UploadMeta, why: string) => {
    uploads.delete(u.id);
    rmSync(dirOf(u.id), { recursive: true, force: true });
    log.info(`[deploy] upload ${u.id} for ${u.site} removed (${why})`);
  };
  const isExpired = (u: UploadMeta) => now() - u.touchedAt > UPLOAD_TTL_MS;

  for (const id of readdirSync(root)) {
    let u: UploadMeta | null = null;
    try {
      u = JSON.parse(readFileSync(join(root, id, META), "utf8")) as UploadMeta;
    } catch (e) {
      log.warn(`[deploy] dropping upload dir ${id}: no readable meta.json (${(e as Error).message})`);
    }
    if (u?.v !== 1 || u.id !== id || u.state !== "receiving" || isExpired(u) || !existsSync(binOf(id))) {
      rmSync(join(root, id), { recursive: true, force: true });
      continue;
    }
    rmSync(join(root, id, `${META}.tmp`), { force: true });
    uploads.set(id, u);
  }
  if (uploads.size) log.info(`[deploy] ${uploads.size} unfinished upload(s) kept for resume`);

  const sweep = () => {
    for (const u of uploads.values()) if (isExpired(u)) drop(u, "expired");
  };
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();

  const get = (id: string): UploadMeta => {
    const u = uploads.get(id);
    if (!u) throw expired(id);
    if (isExpired(u)) {
      drop(u, "expired");
      throw expired(id);
    }
    return u;
  };

  const view = (u: UploadMeta): UploadState => ({
    uploadId: u.id,
    site: u.site,
    fileName: u.fileName,
    sizeBytes: u.sizeBytes,
    chunkSize: DEPLOY_CHUNK_SIZE,
    chunks: u.chunks,
    received: Object.entries(u.chunkSha)
      .map(([i, sha]) => ({ index: Number(i), sha256: sha }))
      .sort((a, b) => a.index - b.index),
    runtime: u.runtime,
    expiresAt: new Date(u.touchedAt + UPLOAD_TTL_MS).toISOString(),
  });
  const receivedOf = (u: UploadMeta) => view(u).received.map((r) => r.index);

  return {
    sweep,
    get,
    view,
    /** Path of the upload's data file. */
    binOf: (u: UploadMeta) => binOf(u.id),

    /** The site's unfinished upload, or null. */
    activeFor(site: string): UploadState | null {
      for (const u of uploads.values()) if (u.site === site && !isExpired(u)) return view(u);
      return null;
    },

    /** Validates `{ sizeBytes, fileName }`, replaces the site's previous upload, checks free space (507). */
    start(site: string, body: unknown): UploadState {
      const { sizeBytes, fileName, sha256: whole } = parseStart(body);
      for (const u of uploads.values()) if (u.site === site) drop(u, "replaced by a new upload");
      const pending = [...uploads.values()].reduce((n, u) => n + u.sizeBytes, 0);
      const needBytes = pending + sizeBytes + UPLOAD_SPACE_MARGIN;
      const freeNow = free(root);
      if (freeNow < needBytes) {
        throw new ApiError(507, "no_space", `need ${needBytes} free bytes in the panel data dir, have ${freeNow}`, {
          needBytes,
          freeBytes: freeNow,
        });
      }
      const t = now();
      const u: UploadMeta = {
        v: 1,
        id: crypto.randomUUID(),
        site,
        fileName,
        sizeBytes,
        chunks: Math.ceil(sizeBytes / DEPLOY_CHUNK_SIZE),
        chunkSha: {},
        runtime: null,
        state: "receiving",
        createdAt: t,
        touchedAt: t,
        ...(whole ? { sha256: whole } : {}),
      };
      mkdirSync(dirOf(u.id), { mode: 0o700 });
      closeSync(openSync(binOf(u.id), "w", 0o600)); // empty: no ftruncate, so no blocks are allocated up front
      persist(u);
      uploads.set(u.id, u);
      return view(u);
    },

    /**
     * Stores chunk `rawIndex` at its offset after checking size and sha256 (header `sha`). Chunk 0 is parsed as
     * ELF first: invalid → upload removed + 400 `invalid_binary`; `check` may refuse its runtime (upload removed).
     */
    async putChunk(id: string, rawIndex: string, body: Uint8Array, sha: string | null, check?: RuntimeCheck) {
      const u = get(id);
      if (u.state !== "receiving") throw new ApiError(409, "busy", `upload ${id} is being completed`);
      const index = INDEX_RE.test(rawIndex) ? Number(rawIndex) : -1;
      if (index < 0 || index >= u.chunks) throw bad("invalid_index", `chunk index must be 0-${u.chunks - 1}`);
      const want = chunkBytes(u, index);
      if (body.byteLength !== want)
        throw bad("invalid_chunk_size", `chunk ${index} must be ${want} bytes, got ${body.byteLength}`);
      const got = sha256(body);
      // 0.2.x clients send no per-chunk hash (whole-file sha256 at start instead); goes away in W7.
      if (sha === null && !u.sha256) throw bad("missing_chunk_sha", "header X-Chunk-Sha256 is required");
      if (sha !== null && sha.toLowerCase() !== got)
        throw bad("chunk_sha_mismatch", `chunk ${index} sha256 does not match its body`, { index });
      if (index === 0) {
        try {
          u.runtime = detectRuntimeBuffer(body);
        } catch (e) {
          if (!(e instanceof BinaryError)) throw e;
          drop(u, `invalid binary: ${e.message}`);
          throw bad("invalid_binary", e.message, { reason: e.reason });
        }
        try {
          await check?.(u.site, u.runtime);
        } catch (e) {
          drop(u, `refused at chunk 0: ${(e as Error).message}`);
          throw e;
        }
        if (!uploads.has(id)) throw expired(id); // replaced while the check ran
      }
      const fd = openSync(binOf(id), "r+");
      try {
        writeSync(fd, body, 0, body.byteLength, index * DEPLOY_CHUNK_SIZE);
        fsyncSync(fd);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOSPC") {
          throw new ApiError(507, "no_space", `no space left writing chunk ${index}`, {
            needBytes: body.byteLength,
            freeBytes: free(root),
          });
        }
        throw new Error(`write chunk ${index} of upload ${id}: ${(e as Error).message}`, { cause: e });
      } finally {
        closeSync(fd);
      }
      u.chunkSha[String(index)] = got;
      u.touchedAt = now();
      persist(u);
      return { received: receivedOf(u), runtime: u.runtime };
    },

    /** Chunk indexes of `u` not received yet. */
    missing: (u: UploadMeta) => Array.from({ length: u.chunks }, (_, i) => i).filter((i) => !(String(i) in u.chunkSha)),

    /**
     * Re-reads upload.bin: every chunk's sha256 must still match meta (else that chunk is forgotten, state back to
     * receiving, 400 `chunk_corrupt {index}`). Returns the whole-file sha256; state stays `assembling`.
     */
    async verify(u: UploadMeta): Promise<string> {
      u.state = "assembling";
      persist(u);
      const whole = new Bun.CryptoHasher("sha256");
      const fh = await open(binOf(u.id), "r");
      try {
        const buf = Buffer.alloc(DEPLOY_CHUNK_SIZE);
        for (let i = 0; i < u.chunks; i++) {
          const len = chunkBytes(u, i);
          const { bytesRead } = await fh.read(buf, 0, len, i * DEPLOY_CHUNK_SIZE);
          const part = buf.subarray(0, bytesRead);
          if (bytesRead !== len || sha256(part) !== u.chunkSha[String(i)]) {
            delete u.chunkSha[String(i)];
            u.state = "receiving";
            persist(u);
            throw bad("chunk_corrupt", `chunk ${i} changed on disk; send it again`, { index: i });
          }
          whole.update(part);
        }
      } finally {
        await fh.close();
      }
      const sha = whole.digest("hex");
      if (u.sha256 && u.sha256 !== sha) {
        u.state = "receiving";
        persist(u);
        throw bad("sha_mismatch", `file sha256 ${sha} does not match the announced ${u.sha256}`);
      }
      return sha;
    },

    /** Back to receiving (complete refused after verify, e.g. busy). */
    reopen(u: UploadMeta) {
      u.state = "receiving";
      u.touchedAt = now();
      persist(u);
    },

    /** Hands the upload to its job: forgotten here, files stay until the `stage` step takes upload.bin. */
    detach: (u: UploadMeta) => uploads.delete(u.id),

    /** Aborts upload `id` and deletes its files. */
    abort: (id: string) => drop(get(id), "aborted"),

    /** Removes the site's unfinished upload, if any (site delete). */
    dropFor(site: string) {
      for (const u of uploads.values()) if (u.site === site) drop(u, "site removed");
    },

    /** Removes an upload dir by id (the job's stage step finished with it). */
    removeDir: (id: string) => rmSync(dirOf(id), { recursive: true, force: true }),

    /** Upload dirs on disk (tests). */
    onDisk: () => (existsSync(root) ? readdirSync(root) : []),
  };
}

/** The upload store instance type. */
export type UploadStore = ReturnType<typeof createUploadStore>;
