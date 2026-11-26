import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, deploy as deployTable } from "@/server/db/schema";
import { readLogs } from "@/server/log.service";
import type { ChunkReceived, Deploy, UploadState } from "@/shared/deploy.types";
import type { Page } from "@/shared/dev.types";
import type { Job } from "@/shared/site.types";
import { type Bytes, bin, chunks, deployHarness, GLIBC_LINKER, sha256 } from "./deploy.fixture";

const h = deployHarness();
const { call, put, json, waitJob } = h;
const bytes = (p: string): Bytes => new Uint8Array(readFileSync(p));
const codes = (j: Job) => Object.fromEntries(j.steps.map((s) => [s.key, s.code]));

const startUpload = async (site: string, data: Bytes, fileName = "app-v1") =>
  json<UploadState>(await call("POST", `/sites/${site}/uploads`, { sizeBytes: data.length, fileName }), 201);
async function deployStart(site: string, data: Bytes): Promise<string> {
  const { uploadId } = await startUpload(site, data);
  for (const [i, c] of chunks(data).entries()) await json<ChunkReceived>(await put(uploadId, i, c));
  return (await json<{ jobId: string }>(await call("POST", `/uploads/${uploadId}/complete`), 202)).jobId;
}
const deploy = async (site: string, data: Bytes) => waitJob(await deployStart(site, data));
const deploys = async (site: string, q = "") => json<Page<Deploy>>(await call("GET", `/sites/${site}/deploys${q}`));

let shop = { dir: "", port: 0 };
const app = () => bytes(join(shop.dir, "app"));
const prev = () => bytes(join(shop.dir, "app.prev"));
const appsJson = () => join(h.home, "sites", "apps.json");
const entry = () =>
  JSON.parse(readFileSync(appsJson(), "utf8")).find((a: { name: string }) => a.name === "shop") as Record<
    string,
    unknown
  >;
beforeAll(() => {
  shop = h.addSite("shop");
  h.healthy.add(shop.port);
});

describe("access control", () => {
  test.each([
    ["POST", "/sites/shop/uploads"],
    ["GET", "/sites/shop/uploads/active"],
    ["GET", "/uploads/x"],
    ["PUT", "/uploads/x/chunks/0"],
    ["POST", "/uploads/x/complete"],
    ["DELETE", "/uploads/x"],
    ["POST", "/sites/shop/rollback"],
    ["GET", "/sites/shop/deploys"],
  ] as const)("%s %s → 401 anon, 403 user", async (method, path) => {
    expect(await json(await call(method, path, undefined, ""), 401)).toMatchObject({ error: "unauthorized" });
    const plain = await h.cookieFor("u-plain");
    expect(await json(await call(method, path, undefined, plain), 403)).toMatchObject({ error: "forbidden" });
  });
});

describe("resumable upload API", () => {
  test("state, active upload, resume after a panel restart, abort", async () => {
    expect(await json(await call("GET", "/sites/shop/uploads/active"))).toBeNull();
    const data = bin(1);
    const [c0] = chunks(data) as [Bytes];
    const u = await startUpload("shop", data, "app-v2");
    expect(u).toMatchObject({ fileName: "app-v2", chunks: 2, received: [], runtime: null });
    expect(await json<ChunkReceived>(await put(u.uploadId, 0, c0))).toEqual({ received: [0], runtime: "native" });
    h.boot(); // panel restart: meta survives, chunk 0 is still there
    const active = await json<UploadState>(await call("GET", "/sites/shop/uploads/active"));
    expect(active).toMatchObject({ uploadId: u.uploadId, received: [{ index: 0, sha256: sha256(c0) }] });
    expect(await json<UploadState>(await call("GET", `/uploads/${u.uploadId}`))).toEqual(active);
    expect(existsSync(join(shop.dir, "app.new"))).toBe(false); // never inside the site folder
    expect((await call("DELETE", `/uploads/${u.uploadId}`)).status).toBe(204);
    expect(await json(await call("GET", `/uploads/${u.uploadId}`), 404)).toMatchObject({ error: "upload_expired" });
  });

  test("errors carry their extra fields: incomplete, chunk sha, invalid binary at chunk 0", async () => {
    const data = bin(2);
    const [c0, c1] = chunks(data) as [Bytes, Bytes];
    const u = await startUpload("shop", data);
    await json(await put(u.uploadId, 1, c1));
    expect(await json(await call("POST", `/uploads/${u.uploadId}/complete`), 400)).toMatchObject({
      error: "incomplete",
      missing: [0],
    });
    expect(await json(await put(u.uploadId, 0, c0, null), 400)).toMatchObject({ error: "missing_chunk_sha" });
    expect(await json(await put(u.uploadId, 0, c0, "0".repeat(64)), 400)).toMatchObject({
      error: "chunk_sha_mismatch",
      index: 0,
    });
    const text = new TextEncoder().encode("#!/bin/sh\n".repeat(20)) as Bytes;
    const t = await startUpload("shop", text);
    expect(await json(await put(t.uploadId, 0, text), 400)).toMatchObject({
      error: "invalid_binary",
      reason: "not_elf",
    });
    expect(await json(await call("GET", `/uploads/${t.uploadId}`), 404)).toMatchObject({ error: "upload_expired" });
  });

  test("unknown site → 404, missing folder → 409 no_folder", async () => {
    expect(await json(await call("POST", "/sites/nope/uploads", { sizeBytes: 1 }), 404)).toMatchObject({
      error: "not_found",
    });
    const { dir } = h.addSite("nofolder");
    rmSync(dir, { recursive: true });
    expect(await json(await call("POST", "/sites/nofolder/uploads", { sizeBytes: 1 }), 409)).toMatchObject({
      error: "no_folder",
    });
  });
});

describe("deploy + rollback jobs", () => {
  const v1 = bin(1);
  const v2 = bin(2, GLIBC_LINKER);

  test("first deploy: run written (native), fixed ./run entry, pm2 start, healthy; sha in input and row", async () => {
    const j = await deploy("shop", v1);
    expect(j).toMatchObject({ kind: "site.deploy", status: "succeeded" });
    expect(codes(j)).toEqual({
      stage: "staged",
      detect: "runtime_native",
      chmod: "chmod_done",
      swap: "swap_first",
      run_script: "run_written",
      apps_entry: "apps_registered",
      app_restart: "app_started",
      health: "healthy",
    });
    expect(app()).toEqual(v1);
    expect(statSync(join(shop.dir, "app")).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(shop.dir, "run"), "utf8")).toContain("exec ./app");
    expect(entry()).toMatchObject({ script: "./run", cwd: shop.dir, interpreter: "none" });
    expect(entry()).not.toHaveProperty("env");
    expect(h.jobs.get(j.id)).toBeTruthy();
    const input = h.db.$client.query("select input from job where id = ?").get(j.id) as { input: string };
    expect(JSON.parse(input.input)).toMatchObject({
      site: "shop",
      sha256: sha256(v1),
      firstDeploy: true,
      fromSha256: null,
    });
    const page = await deploys("shop");
    expect(page.items[0]).toMatchObject({
      kind: "deploy",
      status: "succeeded",
      sha256: sha256(v1),
      fileName: "app-v1",
      active: true,
      finishedAt: expect.any(String),
      actor: { name: "Admin" },
    });
    expect(h.db.select().from(auditLog).where(eq(auditLog.action, "site.deploy")).all()).toHaveLength(1);
    expect(h.dir && h.deploys.uploads.onDisk()).toEqual([]);
  });

  test("second deploy glibc: run → grun, entry unchanged, pm2 restart, app.prev = v1 (still recognised)", async () => {
    const j = await deploy("shop", v2);
    expect(j.status).toBe("succeeded");
    expect(codes(j)).toMatchObject({
      swap: "swap_kept_previous",
      apps_entry: "apps_unchanged",
      app_restart: "app_restarted",
    });
    expect(j.steps.find((s) => s.key === "swap")?.params).toEqual({ linked: true });
    expect(readFileSync(join(shop.dir, "run"), "utf8")).toMatch(/exec \S+\/bin\/grun \.\/app/);
    expect([app(), prev()]).toEqual([v2, v1]);
    const b = h.deploys.binaries({ name: "shop", dir: shop.dir });
    expect(b.live?.sha256).toBe(sha256(v2));
    expect(b.previous?.sha256).toBe(sha256(v1));
    expect((await deploys("shop")).items.map((d) => d.active)).toEqual([true, false]);
  });

  test("health failure → rolled back byte-identical, restart reverted (monitor told), stderr tail redacted", async () => {
    writeFileSync(join(shop.dir, ".env"), "PORT=3100\nAPI_TOKEN=supersecretvalue\n");
    h.system.pm2.readLog = async () => ["boot failed: supersecretvalue rejected"];
    const before = {
      app: app(),
      prev: prev(),
      apps: readFileSync(appsJson(), "utf8"),
      run: readFileSync(join(shop.dir, "run"), "utf8"),
    };
    h.healthy.delete(shop.port);
    const j = await deploy("shop", bin(3));
    h.healthy.add(shop.port);
    expect(j.status).toBe("rolled_back");
    expect(j.error).toMatchObject({ code: "health_timeout", params: { last: "refused", path: "/" } });
    expect(app()).toEqual(before.app);
    expect(prev()).toEqual(before.prev);
    expect(readFileSync(appsJson(), "utf8")).toBe(before.apps);
    expect(readFileSync(join(shop.dir, "run"), "utf8")).toBe(before.run);
    for (const f of ["app.new", ".app.prev.drop", ".app.swap"]) expect(existsSync(join(shop.dir, f))).toBe(false);
    expect(h.restarts).toContain("revert:shop");
    expect((await deploys("shop")).items[0]).toMatchObject({ status: "rolled_back", active: false });
    const logs = readLogs({ limit: 200, q: "stderr of shop" })
      .map((l) => l.msg)
      .join("\n");
    expect(logs).toContain("rejected");
    expect(logs).not.toContain("supersecretvalue");
  });

  test("rollback: app ↔ app.prev, run back to native, history row active", async () => {
    const res = await call("POST", "/sites/shop/rollback");
    const j = await waitJob((await json<{ jobId: string }>(res, 202)).jobId);
    expect(j).toMatchObject({ kind: "site.rollback", status: "succeeded" });
    expect(codes(j)).toMatchObject({
      swap: "swap_back",
      run_script: "run_written",
      app_restart: "app_restarted",
      health: "healthy",
    });
    expect([app(), prev()]).toEqual([v1, v2]);
    expect(readFileSync(join(shop.dir, "run"), "utf8")).toContain("exec ./app");
    const top = (await deploys("shop")).items[0];
    expect(top).toMatchObject({ kind: "rollback", runtime: "native", sha256: sha256(v1), active: true });
    const row = h.db.select().from(deployTable).where(eq(deployTable.jobId, j.id)).get();
    expect(row?.binIno).toBe(statSync(join(shop.dir, "app")).ino);
  });

  test("rollback without app.prev → 409 no_previous", async () => {
    h.addSite("blog");
    expect(await json(await call("POST", "/sites/blog/rollback"), 409)).toMatchObject({ error: "no_previous" });
  });

  test("pm2 down → complete 409 pm2_not_running (upload kept)", async () => {
    const data = bin(5);
    const { uploadId } = await startUpload("shop", data);
    for (const [i, c] of chunks(data).entries()) await put(uploadId, i, c);
    const list = h.system.pm2.procs;
    const { Pm2UnavailableError } = await import("@/server/system/system.types");
    h.system.pm2.procs = async () => {
      throw new Pm2UnavailableError("service_down");
    };
    expect(await json(await call("POST", `/uploads/${uploadId}/complete`), 409)).toMatchObject({
      error: "pm2_not_running",
    });
    h.system.pm2.procs = list;
    expect(await json<UploadState>(await call("GET", `/uploads/${uploadId}`))).toMatchObject({ uploadId });
    await call("DELETE", `/uploads/${uploadId}`);
  });

  test("busy: a running deploy blocks complete and rollback; the upload survives the 409", async () => {
    h.healthy.delete(shop.port);
    const running = await deployStart("shop", bin(6));
    expect(await json(await call("POST", "/sites/shop/rollback"), 409)).toMatchObject({ error: "busy" });
    const data = bin(7);
    const { uploadId } = await startUpload("blog", data);
    for (const [i, c] of chunks(data).entries()) await put(uploadId, i, c);
    expect(await json(await call("POST", `/uploads/${uploadId}/complete`), 409)).toMatchObject({ error: "busy" });
    expect((await waitJob(running)).status).toBe("rolled_back");
    h.healthy.add(shop.port);
    const j = await waitJob(
      (await json<{ jobId: string }>(await call("POST", `/uploads/${uploadId}/complete`), 202)).jobId,
    );
    // blog's port never answers: its first deploy is undone, pm2 app removed, no binary or entry left.
    expect(j).toMatchObject({ target: "blog", status: "rolled_back" });
    expect(existsSync(join(h.home, "sites", "blog", "app"))).toBe(false);
    expect((await h.system.pm2.list()).some((a) => a.name === "blog")).toBe(false);
    expect(JSON.parse(readFileSync(appsJson(), "utf8")).some((a: { name: string }) => a.name === "blog")).toBe(false);
  });

  test("history is paginated, newest first", async () => {
    const all = await deploys("shop");
    const p2 = await deploys("shop", "?page=2&pageSize=2");
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: all.total });
    expect(p2.items.map((d) => d.id)).toEqual(all.items.slice(2, 4).map((d) => d.id));
  });
});

describe("adopted site", () => {
  test("glibc pm2 entry: android build refused at chunk 0 (409 runtime_mismatch); glibc build deploys untouched entry", async () => {
    const { port } = h.addSite("solusi", { managed: false, app: "makuro-solusi", runtime: "grun", port: 3005 });
    h.healthy.add(port);
    const android = bin(8);
    const u = await startUpload("solusi", android);
    expect(await json(await put(u.uploadId, 0, chunks(android)[0] as Bytes), 409)).toMatchObject({
      error: "runtime_mismatch",
      expected: "grun",
      got: "native",
    });
    const apps = readFileSync(appsJson(), "utf8");
    const j = await deploy("solusi", bin(9, GLIBC_LINKER));
    expect(j.status).toBe("succeeded");
    expect(codes(j)).toMatchObject({
      run_script: "run_unchanged",
      apps_entry: "apps_adopted_skip",
      app_restart: "app_restarted",
    });
    expect(readFileSync(appsJson(), "utf8")).toBe(apps);
    expect(existsSync(join(h.home, "sites", "solusi", "run"))).toBe(false);
  });
});
