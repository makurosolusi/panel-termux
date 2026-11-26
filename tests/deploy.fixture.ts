// Shared helpers of tests/deploy.*.test.ts (not a test file itself): crafted ELF files and a deploy API harness that
// mounts only the deploy routes on a temp DB + fake system (no site service involved).
import { afterAll, beforeAll, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { createAuth } from "@/server/auth/auth.service";
import { type Db, openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { site, siteHostname, user } from "@/server/db/schema";
import { createDeployService, type DeployService } from "@/server/deploy/deploy.service";
import { createDeployRoutes } from "@/server/routes/deploy.routes";
import { createJobRunner, type JobRunner } from "@/server/sites/job.runner";
import { createFakeSystem } from "@/server/system/system.fake";
import type { SystemAdapters } from "@/server/system/system.types";
import { CHUNK_SHA_HEADER, DEPLOY_CHUNK_SIZE } from "@/shared/deploy.types";
import type { Job, SiteRuntime } from "@/shared/site.types";

export const ANDROID_LINKER = "/system/bin/linker64";
export const GLIBC_LINKER = "/lib/ld-linux-aarch64.so.1";
const EM_AARCH64 = 183;
const PHDR = 56;

/** Minimal 64-bit LE ELF: header + PT_PHDR + optional PT_INTERP, padded with `fill` to `size` bytes. */
export function fakeElf({
  interp = ANDROID_LINKER as string | null,
  machine = EM_AARCH64,
  size = 4096,
  fill = 0,
} = {}): Uint8Array<ArrayBuffer> {
  const b = Buffer.alloc(size, fill);
  b.fill(0, 0, 64 + 2 * PHDR + 64);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 2;
  b[5] = 1;
  b[6] = 1;
  b.writeUInt16LE(3, 16);
  b.writeUInt16LE(machine, 18);
  b.writeUInt32LE(1, 20);
  b.writeBigUInt64LE(64n, 32);
  b.writeUInt16LE(64, 52);
  b.writeUInt16LE(PHDR, 54);
  b.writeUInt16LE(interp === null ? 1 : 2, 56);
  b.writeUInt32LE(6, 64); // PT_PHDR
  if (interp !== null) {
    const o = 64 + PHDR;
    const at = 64 + 2 * PHDR;
    b.writeUInt32LE(3, o); // PT_INTERP
    b.writeBigUInt64LE(BigInt(at), o + 8);
    b.writeBigUInt64LE(BigInt(interp.length + 1), o + 32);
    b.write(`${interp}\0`, at, "latin1");
  }
  return new Uint8Array(b);
}

/** Lowercase hex sha256. */
export const sha256 = (data: Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** Compiles a tiny script with `bun build --compile --target=<target>` into a temp dir; returns the path. */
export function compileTiny(target: "bun-linux-arm64-android" | "bun-linux-arm64"): string {
  const dir = mkdtempSync(join(tmpdir(), "panel-elf-"));
  const src = join(dir, "a.ts");
  writeFileSync(src, "console.log(1);\n");
  const out = join(dir, "app");
  const r = Bun.spawnSync(["bun", "build", "--compile", `--target=${target}`, src, "--outfile", out]);
  if (r.exitCode !== 0) throw new Error(`bun build --compile ${target} failed: ${r.stderr.toString().slice(0, 300)}`);
  return out;
}

export type Bytes = Uint8Array<ArrayBuffer>;
/** Two-chunk binaries, distinguishable by their fill byte. */
export const bin = (fill: number, interp?: string): Bytes =>
  fakeElf({ size: DEPLOY_CHUNK_SIZE + 1000 + fill, fill, ...(interp ? { interp } : {}) });
/** The chunks of a file. */
export const chunks = (data: Bytes): Bytes[] =>
  Array.from({ length: Math.ceil(data.length / DEPLOY_CHUNK_SIZE) }, (_, i) =>
    data.subarray(i * DEPLOY_CHUNK_SIZE, (i + 1) * DEPLOY_CHUNK_SIZE),
  );

// test-only dummy values
const BASE = "http://localhost";
const SECRET = "0123456789abcdef".repeat(4);
const env = { APP_BASE_URL: BASE, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", SUPER_ADMIN_EMAILS: [] };
/** Fast health cadence for tests. */
export const FAST_TIMING = { pollMs: 5, pm2EveryMs: 50, settleMs: 10, probeTimeoutMs: 50 };

/**
 * Deploy API harness: temp data dir + DB, fake system (sandbox HOME), job runner, deploy service with fast health
 * timing and `healthTimeoutMs`, only the deploy routes mounted. `healthy` = ports whose fake app answers 200.
 */
export function deployHarness(opts: { healthTimeoutMs?: number; free?: (p: string) => number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "panel-deploy-"));
  const home = join(dir, "home");
  const system: SystemAdapters = createFakeSystem({ home });
  const healthy = new Set<number>();
  system.net.isListening = async (p) => healthy.has(p);
  system.net.httpStatus = async (p) => (healthy.has(p) ? 200 : null);
  const restarts: string[] = [];
  const state = {} as { db: Db; jobs: JobRunner; deploys: DeployService; app: Elysia; admin: string; adminId: string };

  async function cookieFor(userId: string): Promise<string> {
    const auth = createAuth({ db: state.db, env, secret: SECRET });
    const s = await (await auth.$context).internalAdapter.createSession(userId);
    if (!s) throw new Error(`createSession for ${userId} returned null`);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(s.token));
    return `better-auth.session_token=${encodeURIComponent(`${s.token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)}`;
  }

  /** (Re)builds runner + service on the same DB and data dir (= a panel restart). */
  function boot(): void {
    state.jobs = createJobRunner(state.db, { monitor: { noteIntentionalRestart: (r) => restarts.push(r.name) } });
    state.deploys = createDeployService({
      db: state.db,
      secret: SECRET,
      system,
      jobs: state.jobs,
      dataDir: dir,
      monitor: { noteIntentionalRestart: (r) => restarts.push(`revert:${r.name}`) },
      healthTiming: FAST_TIMING,
      healthTimeoutMs: opts.healthTimeoutMs ?? 300,
      ...(opts.free ? { freeBytes: opts.free } : {}),
    });
    const auth = createAuth({ db: state.db, env, secret: SECRET });
    state.app = new Elysia({ prefix: "/api" }).use(createDeployRoutes(auth, state.deploys)) as unknown as Elysia;
  }

  beforeAll(async () => {
    state.db = openDb(dir);
    runMigrations(state.db);
    state.adminId = "u-admin";
    state.db.insert(user).values({ id: state.adminId, email: "admin@x.io", name: "Admin", role: "admin" }).run();
    state.db.insert(user).values({ id: "u-plain", email: "plain@x.io", name: "Plain", role: "user" }).run();
    boot();
    state.admin = await cookieFor(state.adminId);
  });
  afterAll(() => {
    state.db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const req = (
    method: string,
    path: string,
    init: { body?: BodyInit; json?: unknown; headers?: object; cookie?: string },
  ) =>
    state.app.handle(
      new Request(`${BASE}/api/panel${path}`, {
        method,
        headers: {
          ...(init.cookie !== "" ? { cookie: init.cookie ?? state.admin } : {}),
          ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      }),
    );
  const call = (method: string, path: string, json?: unknown, cookie?: string) =>
    req(method, path, { json, ...(cookie !== undefined ? { cookie } : {}) });
  /** PUT one chunk with its sha256 header (`sha` null = header left out). */
  const put = (id: string, i: number, data: Bytes, sha: string | null = sha256(data)) =>
    req("PUT", `/uploads/${id}/chunks/${i}`, {
      body: data,
      headers: { "content-type": "application/octet-stream", ...(sha ? { [CHUNK_SHA_HEADER]: sha } : {}) },
    });
  const json = async <T>(res: Response, status = 200): Promise<T> => {
    const text = await res.text();
    expect({ status: res.status, text }).toMatchObject({ status });
    return JSON.parse(text) as T;
  };
  async function waitJob(id: string): Promise<Job> {
    await state.jobs.idle();
    return state.jobs.get(id);
  }

  /** Inserts a site row + folder (+ main hostname); managed by default, port 3100+. */
  function addSite(name: string, o: { managed?: boolean; app?: string; port?: number; runtime?: SiteRuntime } = {}) {
    const siteDir = join(home, "sites", name);
    mkdirSync(siteDir, { recursive: true });
    const port = o.port ?? 3100 + state.db.select().from(site).all().length;
    state.db
      .insert(site)
      .values({
        name,
        port,
        app: o.app ?? null,
        database: null,
        runtime: o.runtime ?? "native",
        managed: o.managed ?? true,
        dir: siteDir,
      })
      .run();
    state.db
      .insert(siteHostname)
      .values({ hostname: `${name}.example.test`, siteName: name, ingressManaged: true, dnsManaged: false })
      .run();
    return { dir: siteDir, port };
  }

  return {
    dir,
    home,
    system,
    healthy,
    restarts,
    boot,
    call,
    put,
    json,
    waitJob,
    addSite,
    cookieFor,
    get db() {
      return state.db;
    },
    get jobs() {
      return state.jobs;
    },
    get deploys() {
      return state.deploys;
    },
    get adminId() {
      return state.adminId;
    },
  };
}
