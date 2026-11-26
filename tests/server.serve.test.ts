import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// B11 headers measured on the real `build:local` binary (`bun build --compile` serves bundles differently
// from `bun test`/`bun run`, so only the binary proves them).
const BUILD_TIMEOUT_MS = 180_000;
const BOOT_TIMEOUT_MS = 15_000;
const dir = mkdtempSync(join(tmpdir(), "panel-serve-"));
const bin = join(dir, "panel");
let proc: Bun.Subprocess | undefined;
let base = "";

const freePort = () => {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = s.port as number;
  s.stop(true);
  return port;
};
const get = (path: string, method = "GET") => fetch(`${base}${path}`, { method, redirect: "manual" });

beforeAll(async () => {
  // Same command as `bun run build:local`, into a temp outfile.
  const build = Bun.spawnSync(["bun", "scripts/build.ts", "local", bin], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) throw new Error(`build:local failed: ${build.stderr.toString()}`);
  const port = freePort();
  base = `http://localhost:${port}`;
  proc = Bun.spawn([bin], {
    env: {
      PATH: process.env.PATH ?? "",
      APP_BASE_URL: base,
      PORT: String(port),
      PANEL_DATA_DIR: join(dir, "data"),
      SUPER_ADMIN_EMAILS: "boss@example.com", // test-only
      GOOGLE_CLIENT_ID: "cid", // test-only
      GOOGLE_CLIENT_SECRET: "csecret", // test-only
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const until = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < until) {
    const ok = await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false, // not listening yet
    );
    if (ok) return;
    await Bun.sleep(100);
  }
  throw new Error(`binary did not answer /api/health within ${BOOT_TIMEOUT_MS} ms`);
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  proc?.kill();
  rmSync(dir, { recursive: true, force: true });
});

describe("binary headers (B11)", () => {
  test("HTML page: no-cache + CSP + nosniff", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("every hashed asset of the page: immutable + nosniff", async () => {
    const html = await (await get("/login")).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/[\w.-]+-[a-z0-9]{8}\.\w+)"/g)].map((m) => m[1] as string);
    expect(assets.length).toBeGreaterThanOrEqual(2); // js + css at least
    for (const path of assets) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-type")).not.toContain("text/html");
    }
  });

  test("missing hashed chunk → 404 text/plain no-store (not the SPA HTML)", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await get("/chunk-deadbeef.js", method);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("/__spa is not the raw bundle: 404 HTML + noindex + no-cache, CSP like any page", async () => {
    const res = await get("/__spa");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  test("unknown path → 404 no-cache; /api/* → no-store", async () => {
    const page = await get("/does-not-exist");
    expect(page.status).toBe(404);
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(page.headers.get("etag")).toBeNull();
    const api = await get("/api/health");
    expect(api.status).toBe(200);
    expect(api.headers.get("cache-control")).toBe("no-store");
  });
});
