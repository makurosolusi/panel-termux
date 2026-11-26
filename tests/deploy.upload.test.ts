import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUploadStore, UPLOAD_SPACE_MARGIN, UPLOAD_TTL_MS, type UploadMeta } from "@/server/deploy/upload.store";
import { ApiError } from "@/server/routes/http.error";
import { DEPLOY_CHUNK_SIZE } from "@/shared/deploy.types";
import { bin, chunks, fakeElf, sha256 } from "./deploy.fixture";

const PLENTY = () => 10 * 1000 ** 4; // test-only: 10 TB free
const root = () => join(mkdtempSync(join(tmpdir(), "panel-upload-")), "uploads");
const apiErr = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.code, extra: e.extra ?? {} };
    throw e;
  }
  throw new Error("expected an ApiError");
};

describe("upload store", () => {
  test("chunks land at their offset in one upload.bin; meta records each sha", async () => {
    const r = root();
    const s = createUploadStore(r, { free: PLENTY });
    const data = bin(1);
    const [c0, c1] = chunks(data) as [Uint8Array, Uint8Array];
    const u = s.start("shop", { sizeBytes: data.length, fileName: "app-v2" });
    expect(u).toMatchObject({
      site: "shop",
      fileName: "app-v2",
      chunks: 2,
      chunkSize: DEPLOY_CHUNK_SIZE,
      received: [],
    });
    expect(statSync(join(r, u.uploadId, "upload.bin")).size).toBe(0);
    expect(statSync(join(r, u.uploadId, "upload.bin")).mode & 0o777).toBe(0o600);
    expect(await s.putChunk(u.uploadId, "1", c1, sha256(c1))).toEqual({ received: [1], runtime: null });
    expect(await s.putChunk(u.uploadId, "0", c0, sha256(c0))).toEqual({ received: [0, 1], runtime: "native" });
    expect(new Uint8Array(readFileSync(join(r, u.uploadId, "upload.bin")))).toEqual(data);
    const meta = JSON.parse(readFileSync(join(r, u.uploadId, "meta.json"), "utf8")) as UploadMeta;
    expect(meta.chunkSha).toEqual({ "0": sha256(c0), "1": sha256(c1) });
    expect(await s.verify(s.get(u.uploadId))).toBe(sha256(data));
  });

  test("a panel restart keeps acknowledged chunks; the client resumes from `received`", async () => {
    const r = root();
    const data = bin(2);
    const [c0, c1] = chunks(data) as [Uint8Array, Uint8Array];
    const a = createUploadStore(r, { free: PLENTY });
    const u = a.start("shop", { sizeBytes: data.length, fileName: "x" });
    await a.putChunk(u.uploadId, "0", c0, sha256(c0));
    const b = createUploadStore(r, { free: PLENTY }); // restart
    expect(b.activeFor("shop")).toMatchObject({
      uploadId: u.uploadId,
      received: [{ index: 0, sha256: sha256(c0) }],
      runtime: "native",
    });
    await b.putChunk(u.uploadId, "1", c1, sha256(c1));
    expect(await b.verify(b.get(u.uploadId))).toBe(sha256(data));
  });

  test("boot drops dirs without meta, corrupt meta, expired, assembling, and temp files", async () => {
    const r = root();
    let t = 1_000_000;
    const a = createUploadStore(r, { free: PLENTY, now: () => t });
    const keep = a.start("a", { sizeBytes: 10 });
    const old = a.start("b", { sizeBytes: 10 });
    const asm = a.start("c", { sizeBytes: 10 });
    const m = JSON.parse(readFileSync(join(r, asm.uploadId, "meta.json"), "utf8"));
    writeFileSync(join(r, asm.uploadId, "meta.json"), JSON.stringify({ ...m, state: "assembling" }));
    mkdirSync(join(r, "no-meta"));
    mkdirSync(join(r, "bad-meta"));
    writeFileSync(join(r, "bad-meta", "meta.json"), "{");
    writeFileSync(join(r, keep.uploadId, "meta.json.tmp"), "partial");
    const oldMeta = JSON.parse(readFileSync(join(r, old.uploadId, "meta.json"), "utf8"));
    writeFileSync(join(r, old.uploadId, "meta.json"), JSON.stringify({ ...oldMeta, touchedAt: t - UPLOAD_TTL_MS - 1 }));
    t += 1;
    const b = createUploadStore(r, { free: PLENTY, now: () => t });
    expect(b.onDisk()).toEqual([keep.uploadId]);
    expect(existsSync(join(r, keep.uploadId, "meta.json.tmp"))).toBe(false);
  });

  test("TTL sweep and expired get → 404 upload_expired", async () => {
    let t = 0;
    const s = createUploadStore(root(), { free: PLENTY, now: () => t });
    const u = s.start("shop", { sizeBytes: 10 });
    t = UPLOAD_TTL_MS + 1;
    expect(await apiErr(() => s.get(u.uploadId))).toMatchObject({ status: 404, code: "upload_expired" });
    const v = s.start("shop", { sizeBytes: 10 });
    t += UPLOAD_TTL_MS + 1;
    s.sweep();
    expect(s.onDisk()).not.toContain(v.uploadId);
  });

  test("a new upload replaces the site's unfinished one", async () => {
    const s = createUploadStore(root(), { free: PLENTY });
    const first = s.start("shop", { sizeBytes: 10 });
    s.start("shop", { sizeBytes: 10 });
    expect(await apiErr(() => s.get(first.uploadId))).toMatchObject({ code: "upload_expired" });
    expect(s.onDisk()).toHaveLength(1);
  });

  test("space preflight: Σ active + size + 200 MB → 507 no_space", async () => {
    const free = 3 * DEPLOY_CHUNK_SIZE + UPLOAD_SPACE_MARGIN;
    const s = createUploadStore(root(), { free: () => free });
    s.start("a", { sizeBytes: 2 * DEPLOY_CHUNK_SIZE });
    const r = await apiErr(() => s.start("b", { sizeBytes: 2 * DEPLOY_CHUNK_SIZE }));
    expect(r).toEqual({
      status: 507,
      code: "no_space",
      extra: { needBytes: 4 * DEPLOY_CHUNK_SIZE + UPLOAD_SPACE_MARGIN, freeBytes: free },
    });
  });

  test("chunk 0 is checked as ELF before the rest is sent; an invalid one removes the upload", async () => {
    const s = createUploadStore(root(), { free: PLENTY });
    const x86 = fakeElf({ machine: 62, size: 4096 });
    const u = s.start("shop", { sizeBytes: x86.length });
    expect(await apiErr(s.putChunk(u.uploadId, "0", x86, sha256(x86)))).toMatchObject({
      status: 400,
      code: "invalid_binary",
      extra: { reason: "not_aarch64" },
    });
    expect(s.onDisk()).toEqual([]);
  });

  test("runtime check refusing chunk 0 removes the upload and passes its error on", async () => {
    const s = createUploadStore(root(), { free: PLENTY });
    const data = fakeElf({ size: 4096 });
    const u = s.start("shop", { sizeBytes: data.length });
    const refuse = () => {
      throw new ApiError(409, "runtime_mismatch", "x", { expected: "grun", got: "native" });
    };
    expect(await apiErr(s.putChunk(u.uploadId, "0", data, sha256(data), refuse))).toMatchObject({
      status: 409,
      code: "runtime_mismatch",
    });
    expect(s.onDisk()).toEqual([]);
  });

  test("header checks: missing, mismatching, wrong size, bad index", async () => {
    const s = createUploadStore(root(), { free: PLENTY });
    const data = bin(3);
    const [c0, c1] = chunks(data) as [Uint8Array, Uint8Array];
    const { uploadId } = s.start("shop", { sizeBytes: data.length, fileName: "f" });
    expect(await apiErr(s.putChunk(uploadId, "0", c0, null))).toMatchObject({ code: "missing_chunk_sha" });
    expect(await apiErr(s.putChunk(uploadId, "1", c1, "0".repeat(64)))).toMatchObject({
      code: "chunk_sha_mismatch",
      extra: { index: 1 },
    });
    expect(await apiErr(s.putChunk(uploadId, "0", c1, sha256(c1)))).toMatchObject({ code: "invalid_chunk_size" });
    expect(await apiErr(s.putChunk(uploadId, "2", c1, sha256(c1)))).toMatchObject({ code: "invalid_index" });
    expect(await apiErr(() => s.start("shop", { sizeBytes: 1, fileName: "a/b" }))).toMatchObject({
      code: "invalid_file_name",
    });
  });

  test("verify: a chunk changed on disk → chunk_corrupt {index}, forgotten, receiving again", async () => {
    const r = root();
    const s = createUploadStore(r, { free: PLENTY });
    const data = bin(4);
    const [c0, c1] = chunks(data) as [Uint8Array, Uint8Array];
    const { uploadId } = s.start("shop", { sizeBytes: data.length });
    await s.putChunk(uploadId, "0", c0, sha256(c0));
    await s.putChunk(uploadId, "1", c1, sha256(c1));
    const file = join(r, uploadId, "upload.bin");
    const bytes = readFileSync(file);
    bytes[DEPLOY_CHUNK_SIZE + 5] = 0xee;
    writeFileSync(file, bytes);
    const u = s.get(uploadId);
    expect(await apiErr(s.verify(u))).toMatchObject({ code: "chunk_corrupt", extra: { index: 1 } });
    expect(s.missing(u)).toEqual([1]);
    expect(u.state).toBe("receiving");
  });

  test("0.2.x whole-file sha256 without chunk headers is still accepted and checked", async () => {
    const s = createUploadStore(root(), { free: PLENTY });
    const data = fakeElf({ size: 5000 });
    const { uploadId } = s.start("shop", { sizeBytes: data.length, sha256: "f".repeat(64) });
    await s.putChunk(uploadId, "0", data, null);
    expect(await apiErr(s.verify(s.get(uploadId)))).toMatchObject({ code: "sha_mismatch" });
  });
});
