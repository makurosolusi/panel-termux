// POST /jobs/:id/recover (B26): cleanup of cut-off jobs from the real files, retry of delete/hostname.remove.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, dnsRecord, job } from "@/server/db/schema";
import { HEALTH_TIMING } from "@/server/deploy/health.check";
import { insertIngressRule } from "@/server/sites/ingress.editor";
import type { Job, JobKind, JobStatus, JobStep, SiteCheckResult } from "@/shared/site.types";
import { siteHarness } from "./site.harness";

const h = siteHarness();
const { home, system, fakeDns, cfg, read, call, json, waitJob, startJob, dbs } = h;
const savedTiming = { ...HEALTH_TIMING };
const realNet = { ...system.net };
const shopDir = join(home, "sites", "shop");
const codes = (j: Job) => j.steps.map((s) => `${s.key}:${s.code}`);

let seq = 0;
const step = (key: string, status: JobStep["status"]): JobStep => ({
  key,
  status,
  code: null,
  params: {},
  detail: null,
  log: [],
  startedAt: null,
  finishedAt: null,
});
/** A job row as the runner leaves it after a cut-off (interrupted) or a dirty failure. */
function cutOff(
  kind: JobKind,
  target: string,
  input: Record<string, unknown>,
  steps: JobStep[],
  status: JobStatus = "interrupted",
) {
  const id = `cut${++seq}`;
  const at = new Date(Date.now() + seq); // newest job of the target
  h.db.insert(job).values({ id, kind, target, status, steps, input, startedAt: at, finishedAt: at }).run();
  return id;
}
const recover = async (id: string) =>
  waitJob((await json<{ jobId: string }>(await call("POST", `/jobs/${id}/recover`), 202)).jobId);
const original = async (id: string) => json<Job>(await call("GET", `/jobs/${id}`));

beforeAll(async () => {
  Object.assign(HEALTH_TIMING, { pollMs: 5, pm2EveryMs: 40, settleMs: 10, probeTimeoutMs: 50 });
  const j = await startJob("POST", "/sites", { name: "shop", hostname: "shop.example.test", database: true });
  expect(j.status).toBe("succeeded");
  // Every local port answers 200 from here on, so restart/health steps of the cleanups pass.
  system.net.isListening = async () => true;
  system.net.httpStatus = async () => 200;
});
afterAll(() => {
  Object.assign(HEALTH_TIMING, savedTiming);
  Object.assign(system.net, realNet);
});

describe("site.create cut off", () => {
  test("cleanup removes ingress, owned DNS, database and the leftover folder; then already_resolved", async () => {
    const dir = join(home, "sites", "blog");
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(join(dir, ".env"), "PORT=3050\n");
    writeFileSync(cfg, insertIngressRule(read(cfg) as string, "blog.example.test", "http://localhost:3050"));
    await system.postgres.createRoleAndDatabase("blog", "pw");
    await fakeDns.ensureTunnelCname("blog.example.test", "t");
    h.db.insert(dnsRecord).values({ hostname: "blog.example.test", zoneId: "z", recordId: "r" }).run();
    const id = cutOff(
      "site.create",
      "blog",
      { name: "blog", hostnames: ["blog.example.test"], port: 3050, database: true },
      [
        step("validate", "done"),
        step("folder", "done"),
        step("database", "done"),
        step("env_write", "done"),
        step("ingress", "running"),
      ],
    );
    expect(await original(id)).toMatchObject({ status: "interrupted", recoverMode: "cleanup", next: ["recover"] });
    const check = await json<SiteCheckResult>(
      await call("POST", "/sites/check", { name: "blog", hostname: "b.example.test" }),
    );
    expect(check.issues).toMatchObject([{ code: "name_leftover", params: { jobId: id } }]);

    const c = await recover(id);
    expect(c).toMatchObject({ kind: "job.cleanup", target: "blog", status: "succeeded", cleans: id });
    expect(codes(c)).toEqual([
      "inspect:inspect_found",
      "ingress:ingress_removed",
      "tunnel_restart:tunnel_restarted",
      "dns:dns_deleted",
      "apps_remove:apps_absent",
      "database_drop:database_dropped",
      "folder_remove:folder_removed",
    ]);
    expect(read(cfg)).not.toContain("blog.example.test");
    expect(fakeDns.records.has("blog.example.test")).toBe(false);
    expect(await dbs()).not.toContain("blog");
    expect(existsSync(dir)).toBe(false);
    expect(await original(id)).toMatchObject({ resolvedBy: c.id, recoverMode: null });
    expect(await json(await call("POST", `/jobs/${id}/recover`), 409)).toMatchObject({
      error: "already_resolved",
      resolvedBy: c.id,
    });
    expect(h.db.select().from(auditLog).where(eq(auditLog.action, "job.recover")).all()).toHaveLength(1);
  });

  test("folder with someone's files is kept (folder_not_empty); database untouched when its step never ran", async () => {
    const dir = join(home, "sites", "keepme");
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(join(dir, "data", "upload.db"), "x");
    await system.postgres.createRoleAndDatabase("keepme", "pw");
    const id = cutOff("site.create", "keepme", { name: "keepme", hostnames: [], port: 3051, database: true }, [
      step("validate", "done"),
      step("folder", "running"),
      step("database", "pending"),
    ]);
    const c = await recover(id);
    expect(c.steps.find((s) => s.key === "folder_remove")).toMatchObject({
      code: "folder_not_empty",
      params: { path: dir, entries: 1 },
    });
    expect(c.steps.find((s) => s.key === "database_drop")?.code).toBe("database_none");
    expect(existsSync(join(dir, "data", "upload.db"))).toBe(true);
    expect(await dbs()).toContain("keepme");
  });

  test("site row exists (create finished its records) → inspect_nothing; succeeded jobs are not recoverable", async () => {
    const id = cutOff("site.create", "shop", { name: "shop", hostnames: ["shop.example.test"] }, [
      step("validate", "done"),
    ]);
    expect(codes(await recover(id))).toEqual(["inspect:inspect_nothing"]);
    const done = (await json<{ items: Job[] }>(await call("GET", "/jobs?status=succeeded&kind=site.create"))).items[0];
    expect(await json(await call("POST", `/jobs/${done?.id}/recover`), 409)).toMatchObject({
      error: "not_recoverable",
      status: "succeeded",
    });
  });
});

describe("env, restart, hostname.add", () => {
  test("site.env cut off: .env.panel-prev back to .env, restart, health", async () => {
    writeFileSync(join(shopDir, ".env.panel-prev"), "PORT=3002\nOLD=1\n");
    writeFileSync(join(shopDir, ".env"), "PORT=3002\nNEW=half-written\n");
    const id = cutOff("site.env", "shop", { site: "shop", set: ["NEW"], unset: ["OLD"] }, [
      step("env_write", "running"),
    ]);
    const c = await recover(id);
    expect(c.status).toBe("succeeded");
    expect(codes(c)).toEqual([
      "inspect:inspect_found",
      "env_write:env_restored",
      "app_restart:app_started",
      "health:healthy",
    ]);
    expect(readFileSync(join(shopDir, ".env"), "utf8")).toBe("PORT=3002\nOLD=1\n");
    expect(existsSync(join(shopDir, ".env.panel-prev"))).toBe(false);
  });

  test("site.restart cut off → restart + health again", async () => {
    const c = await recover(cutOff("site.restart", "shop", { site: "shop" }, [step("app_restart", "running")]));
    expect(codes(c)).toEqual(["inspect:inspect_found", "app_restart:app_restarted", "health:healthy"]);
  });

  test("hostname.add cut off: rules of domains the site never got are removed", async () => {
    writeFileSync(cfg, insertIngressRule(read(cfg) as string, "extra.example.test", "http://localhost:3002"));
    const id = cutOff(
      "hostname.add",
      "shop",
      { site: "shop", hostnames: ["extra.example.test", "shop.example.test"] },
      [step("validate", "done"), step("ingress", "done"), step("dns", "running")],
    );
    const c = await recover(id);
    expect(codes(c).slice(0, 3)).toEqual([
      "inspect:inspect_found",
      "ingress:ingress_removed",
      "tunnel_restart:tunnel_restarted",
    ]);
    expect(c.steps[1]?.params).toEqual({ hostnames: "extra.example.test" });
    expect(read(cfg)).not.toContain("extra.example.test");
    expect(read(cfg)).toContain("shop.example.test"); // owned by the site: kept
  });

  test("an interrupted cleanup is redone as a new cleanup of the original; both resolved", async () => {
    const orig = cutOff("site.restart", "shop", { site: "shop" }, [step("app_restart", "running")]);
    const cleanup = cutOff("job.cleanup", "shop", { jobId: orig }, [step("inspect", "running")]);
    const c = await recover(cleanup);
    expect(c).toMatchObject({ kind: "job.cleanup", cleans: orig, status: "succeeded" });
    expect((await original(orig)).resolvedBy).toBe(c.id);
    expect((await original(cleanup)).resolvedBy).toBe(c.id);
  });
});

describe("retry", () => {
  test("site.delete is retried from the journal only when its validate step finished", async () => {
    const early = cutOff("site.delete", "shop", { name: "shop", keepData: false, keepDatabase: false }, [
      step("validate", "running"),
    ]);
    expect(await json(await call("POST", `/jobs/${early}/recover`), 409)).toMatchObject({ error: "not_recoverable" });
    await system.postgres.dropRoleAndDatabase("shop"); // the earlier attempt already dropped it
    expect(await dbs()).not.toContain("shop");
    const id = cutOff(
      "site.delete",
      "shop",
      { name: "shop", keepData: false, keepDatabase: true },
      [step("validate", "done"), step("apps_remove", "done"), step("database_drop", "failed")],
      "failed",
    );
    expect((await original(id)).recoverMode).toBe("retry");
    const r = await recover(id);
    expect(r).toMatchObject({ kind: "site.delete", target: "shop", status: "succeeded" });
    expect(r.steps.find((s) => s.key === "database_drop")?.code).toBe("database_kept");
    expect(existsSync(shopDir)).toBe(false);
    expect((await call("GET", "/sites/shop")).status).toBe(404);
    expect((await original(id)).resolvedBy).toBe(r.id);
  });

  test("target already gone → cleanup that finds nothing, resolved", async () => {
    const id = cutOff("hostname.remove", "ghost", { site: "ghost", hostname: "g.example.test" }, [
      step("ingress", "running"),
    ]);
    expect((await original(id)).recoverMode).toBe("retry");
    const r = await recover(id);
    expect(r).toMatchObject({ kind: "job.cleanup", status: "succeeded" });
    expect(codes(r)).toEqual(["inspect:inspect_nothing"]);
  });
});
