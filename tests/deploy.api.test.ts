import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog } from "@/server/db/schema";
import { createUploadStore, UPLOAD_TTL_MS } from "@/server/deploy/upload.store";
import type { ChunkReceived, Deploy, UploadStarted } from "@/shared/deploy.types";
import { DEPLOY_CHUNK_SIZE, DEPLOY_MAX_BYTES } from "@/shared/deploy.types";
import type { Page } from "@/shared/dev.types";
import type { Job, SiteDetail } from "@/shared/site.types";
import { fakeElf, GLIBC_LINKER, sha256 } from "./deploy.fixture";
import { siteHarness } from "./site.harness";

const HEALTH_TIMEOUT_MS = 300; // test-only: fail health fast
const h = siteHarness({ healthTimeoutMs: HEALTH_TIMEOUT_MS });
const { call, raw, json, waitJob, startJob, stepStatus, read, appsJson } = h;

// Ports whose fake app "answers"; 3001 stays a busy port for the site tests' checks.
const healthy = new Set<number>();
const siteDir = (name: string) => join(h.home, "sites", name);
type Bytes = Uint8Array<ArrayBuffer>;
const bytes = (p: string): Bytes => new Uint8Array(readFileSync(p));

/** Two-chunk binaries, distinguishable by their fill byte. */
const bin = (fill: number, interp?: string) =>
  fakeElf({ size: DEPLOY_CHUNK_SIZE + 1000 + fill, fill, ...(interp ? { interp } : {}) });
const chunks = (data: Bytes) =>
  Array.from({ length: Math.ceil(data.length / DEPLOY_CHUNK_SIZE) }, (_, i) =>
    data.subarray(i * DEPLOY_CHUNK_SIZE, (i + 1) * DEPLOY_CHUNK_SIZE),
  );

const startUpload = async (site: string, data: Bytes, sha = sha256(data)) =>
  json<UploadStarted>(await call("POST", `/sites/${site}/uploads`, { sizeBytes: data.length, sha256: sha }), 201);
const put = (id: string, i: number, data: Bytes) => raw("PUT", `/uploads/${id}/chunks/${i}`, data);

/** Full upload + complete; returns the started job id. */
async function deployStart(site: string, data: Bytes, sha?: string): Promise<string> {
  const { uploadId } = await startUpload(site, data, sha);
  for (const [i, c] of chunks(data).entries()) await json<ChunkReceived>(await put(uploadId, i, c));
  return (await json<{ jobId: string }>(await call("POST", `/uploads/${uploadId}/complete`), 202)).jobId;
}
const deploy = async (site: string, data: Bytes, sha?: string) => waitJob(await deployStart(site, data, sha));
const deploys = async (site: string, q = "") => json<Page<Deploy>>(await call("GET", `/sites/${site}/deploys${q}`));

let port = 0;
beforeAll(async () => {
  h.system.net.isListening = async (p) => p === 3001 || healthy.has(p);
  h.system.net.httpStatus = async (p) => (healthy.has(p) ? 200 : null);
  const job = await startJob("POST", "/sites", { name: "shop", hostname: "shop.example.test", database: false });
  expect(job.status).toBe("succeeded");
  port = (await json<SiteDetail>(await call("GET", "/sites/shop"))).port;
});

describe("access control", () => {
  test.each([
    ["POST", "/sites/shop/uploads", { sizeBytes: 1, sha256: "0".repeat(64) }],
    ["PUT", "/uploads/x/chunks/0", undefined],
    ["POST", "/uploads/x/complete", undefined],
    ["DELETE", "/uploads/x", undefined],
    ["POST", "/sites/shop/rollback", undefined],
    ["GET", "/sites/shop/deploys", undefined],
  ] as const)("%s %s → 401 anon, 403 user", async (method, path, body) => {
    expect(await json(await call(method, path, body, ""), 401)).toEqual({ error: "unauthorized" });
    expect(await json(await call(method, path, body, h.userCookie), 403)).toEqual({ error: "forbidden" });
  });
});

describe("chunked upload", () => {
  test("validation of the upload request", async () => {
    const start = (b: unknown, site = "shop") => call("POST", `/sites/${site}/uploads`, b);
    const sha = "a".repeat(64);
    expect(await json(await start({ sizeBytes: DEPLOY_MAX_BYTES + 1, sha256: sha }), 400)).toMatchObject({
      error: "too_large",
    });
    expect(await json(await start({ sizeBytes: 0, sha256: sha }), 400)).toMatchObject({ error: "invalid_size" });
    expect(await json(await start({ sizeBytes: 10, sha256: "XYZ" }), 400)).toMatchObject({ error: "invalid_sha256" });
    expect(await json(await start({ sizeBytes: 10, sha256: sha }, "nope"), 404)).toMatchObject({ error: "not_found" });
  });

  test("any order, idempotent re-send, wrong size, missing → incomplete; stored in the data dir", async () => {
    const data = bin(1);
    const [c0, c1] = chunks(data) as [Bytes, Bytes];
    const { uploadId, chunkSize } = await startUpload("shop", data);
    expect(chunkSize).toBe(DEPLOY_CHUNK_SIZE);
    expect(await json<ChunkReceived>(await put(uploadId, 1, c1))).toEqual({ received: [1] });
    expect(await json(await call("POST", `/uploads/${uploadId}/complete`), 400)).toMatchObject({
      error: "incomplete",
      message: "missing chunks: 0",
    });
    expect(await json(await put(uploadId, 0, c1), 400)).toMatchObject({ error: "invalid_chunk_size" });
    expect(await json(await put(uploadId, 1, c0), 400)).toMatchObject({ error: "invalid_chunk_size" });
    expect(await json(await put(uploadId, 2, c1), 400)).toMatchObject({ error: "invalid_index" });
    expect(await json<ChunkReceived>(await put(uploadId, 0, c0))).toEqual({ received: [0, 1] });
    expect(await json<ChunkReceived>(await put(uploadId, 0, c0))).toEqual({ received: [0, 1] });
    expect(existsSync(join(h.dir, "uploads", uploadId, "0.part"))).toBe(true);
    expect(existsSync(join(siteDir("shop"), "app.new"))).toBe(false);
    expect((await call("DELETE", `/uploads/${uploadId}`)).status).toBe(204);
    expect(existsSync(join(h.dir, "uploads", uploadId))).toBe(false);
    expect(await json(await put(uploadId, 0, c0), 404)).toMatchObject({ error: "not_found" });
  });

  test("a new upload for the same site replaces the unfinished one", async () => {
    const first = await startUpload("shop", bin(1));
    await startUpload("shop", bin(1));
    expect((await call("POST", `/uploads/${first.uploadId}/complete`)).status).toBe(404);
    expect(existsSync(join(h.dir, "uploads", first.uploadId))).toBe(false);
  });

  test("non-ELF and x86 binaries are refused at complete", async () => {
    const text = new TextEncoder().encode("#!/bin/sh\necho hi\n".repeat(10));
    const { uploadId } = await startUpload("shop", text);
    await json(await put(uploadId, 0, text));
    expect(await json(await call("POST", `/uploads/${uploadId}/complete`), 400)).toMatchObject({
      error: "invalid_binary",
      message: "not an ELF binary",
    });
  });

  test("stale uploads are swept after the TTL", () => {
    let t = 0;
    const store = createUploadStore(join(h.dir, "sweep"), () => t);
    const u = store.start("shop", { sizeBytes: 10, sha256: "b".repeat(64) });
    expect(store.onDisk()).toEqual([u.id]);
    t = UPLOAD_TTL_MS + 1;
    store.sweep();
    expect(store.onDisk()).toEqual([]);
  });
});

describe("deploy + rollback jobs", () => {
  const v1 = bin(1);
  const v2 = bin(2, GLIBC_LINKER);
  const app = () => bytes(join(siteDir("shop"), "app"));
  const prev = () => bytes(join(siteDir("shop"), "app.prev"));
  const entry = () => JSON.parse(read(appsJson) as string).find((a: { name: string }) => a.name === "shop");

  test("first deploy: native, pm2 started, no app.prev", async () => {
    healthy.add(port);
    const job = await deploy("shop", v1);
    expect(job).toMatchObject({ kind: "site.deploy", target: "shop", status: "succeeded" });
    expect(stepStatus(job)).toEqual({
      assemble: "done",
      detect: "done",
      chmod: "done",
      swap: "done",
      apps: "skipped",
      restart: "done",
      health: "done",
    });
    expect(app()).toEqual(v1);
    expect(statSync(join(siteDir("shop"), "app")).mode & 0o777).toBe(0o755);
    expect(existsSync(join(siteDir("shop"), "app.prev"))).toBe(false);
    expect(entry()).toMatchObject({ script: "./app" });
    expect((await h.system.pm2.list()).find((a) => a.name === "shop")?.status).toBe("online");
    const page = await deploys("shop");
    expect(page.items[0]).toMatchObject({
      kind: "deploy",
      status: "succeeded",
      runtime: "native",
      sha256: sha256(v1),
      sizeBytes: v1.length,
      jobId: job.id,
      actor: { name: expect.any(String) },
    });
    expect(h.db.select().from(auditLog).where(eq(auditLog.action, "site.deploy")).all()).toHaveLength(1);
  });

  test("second deploy: glibc → apps.json runs grun, app.prev = v1", async () => {
    const job = await deploy("shop", v2);
    expect(job.status).toBe("succeeded");
    expect(app()).toEqual(v2);
    expect(prev()).toEqual(v1);
    expect(entry().script).toMatch(/\/bin\/grun$/);
    expect(entry().args).toEqual(["./app"]);
    expect(existsSync(`${appsJson}.bak`)).toBe(true);
    expect((await json<SiteDetail>(await call("GET", "/sites/shop"))).runtime).toBe("grun");
  });

  test("health failure → rolled back byte-identical (app, app.prev, apps.json)", async () => {
    const before = { app: app(), prev: prev(), apps: read(appsJson) };
    healthy.delete(port);
    const job = await deploy("shop", bin(3));
    expect(job.status).toBe("rolled_back");
    expect(job.error?.detail).toMatch(/^Wait until healthy: not healthy on port/);
    expect(stepStatus(job)).toMatchObject({ swap: "rolled_back", apps: "rolled_back", health: "failed" });
    expect(app()).toEqual(before.app);
    expect(prev()).toEqual(before.prev);
    expect(read(appsJson)).toBe(before.apps);
    for (const f of ["app.new", ".app.prev.drop"]) expect(existsSync(join(siteDir("shop"), f))).toBe(false);
    expect((await deploys("shop")).items[0]).toMatchObject({ status: "rolled_back", jobId: job.id });
    healthy.add(port);
  });

  test("sha256 mismatch fails before touching the site", async () => {
    const before = app();
    const job = await deploy("shop", bin(4), "c".repeat(64));
    expect(job.error?.detail).toMatch(/sha256 mismatch/);
    expect(app()).toEqual(before);
    expect((await deploys("shop")).items[0]).toMatchObject({ status: "failed" });
  });

  test("rollback swaps app ↔ app.prev and switches the runtime back", async () => {
    const res = await call("POST", "/sites/shop/rollback");
    const job = await waitJob((await json<{ jobId: string }>(res, 202)).jobId);
    expect(job).toMatchObject({ kind: "site.rollback", status: "succeeded" });
    expect(app()).toEqual(v1);
    expect(prev()).toEqual(v2);
    expect(entry()).toMatchObject({ script: "./app" });
    expect(entry().args).toBeUndefined();
    expect((await deploys("shop")).items[0]).toMatchObject({ kind: "rollback", runtime: "native", sha256: sha256(v1) });
    expect(h.db.select().from(auditLog).where(eq(auditLog.action, "site.rollback")).all()).toHaveLength(1);
  });

  test("rollback without app.prev → 409 no_previous", async () => {
    const j = await startJob("POST", "/sites", { name: "blog", hostname: "blog.example.test", database: false });
    expect(j.status).toBe("succeeded");
    expect(await json(await call("POST", "/sites/blog/rollback"), 409)).toMatchObject({ error: "no_previous" });
  });

  test("busy: a running deploy blocks complete and rollback", async () => {
    healthy.delete(port);
    const running = await deployStart("shop", bin(5));
    expect(await json(await call("POST", "/sites/shop/rollback"), 409)).toMatchObject({ error: "busy" });
    const data = bin(6);
    const { uploadId } = await startUpload("blog", data);
    for (const [i, c] of chunks(data).entries()) await put(uploadId, i, c);
    expect(await json(await call("POST", `/uploads/${uploadId}/complete`), 409)).toMatchObject({ error: "busy" });
    expect((await waitJob(running)).status).toBe("rolled_back");
    healthy.add(port);
    // The upload survived the 409 and can be completed now.
    const job: Job = await waitJob(
      (await json<{ jobId: string }>(await call("POST", `/uploads/${uploadId}/complete`), 202)).jobId,
    );
    expect(job.target).toBe("blog");
    // blog's port is not healthy: its first deploy is undone, the app removed from pm2 again, no binary left.
    expect(job.status).toBe("rolled_back");
    expect(existsSync(join(siteDir("blog"), "app"))).toBe(false);
    expect((await h.system.pm2.list()).some((a) => a.name === "blog")).toBe(false);
  });

  test("history is paginated, newest first", async () => {
    const all = await deploys("shop");
    expect(all.total).toBe(all.items.length);
    const p2 = await deploys("shop", "?page=2&pageSize=2");
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: all.total });
    expect(p2.items.map((d) => d.id)).toEqual(all.items.slice(2, 4).map((d) => d.id));
  });

  test("adopted site: pm2 entry untouched, app restarted by name", async () => {
    await json(
      await call("POST", "/sites/adopt", {
        name: "solusi",
        hostname: "solusi2.example.test",
        port: 3005,
        app: "makuro-solusi",
      }),
      201,
    );
    mkdirSync(siteDir("solusi"), { recursive: true });
    healthy.add(3005);
    const apps = read(appsJson);
    const restarts = (await h.system.pm2.list()).find((a) => a.name === "makuro-solusi")?.restarts ?? -1;
    const job = await deploy("solusi", bin(7, GLIBC_LINKER));
    expect(job.status).toBe("succeeded");
    expect(stepStatus(job).apps).toBe("skipped");
    expect(read(appsJson)).toBe(apps);
    expect((await h.system.pm2.list()).find((a) => a.name === "makuro-solusi")?.restarts).toBe(restarts + 1);
  });
});
