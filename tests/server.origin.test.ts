import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { app, canonicalRedirect, servePanel } from "@/server/index";

// Real Bun server on an ephemeral loopback port, with the real SPA bundle and the health-only API.
let server: ReturnType<typeof servePanel>;
let port: number;
const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: "manual" });

describe("servePanel canonical origin (APP_BASE_URL http://localhost:PORT)", () => {
  beforeAll(() => {
    // Port is unknown until bound; the closure reads it per request.
    server = servePanel(app, "http://placeholder", 0);
    port = server.port ?? 0;
    server.stop(true);
    server = servePanel(app, `http://localhost:${port}`, port);
  });
  afterAll(() => server.stop(true));

  test("page on 127.0.0.1 → 302 to the same path+query on APP_BASE_URL", async () => {
    const res = await get("/dev/users?page=2&q=a%20b");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`http://localhost:${port}/dev/users?page=2&q=a%20b`);
  });

  test("page on the APP_BASE_URL host → 200 SPA html", async () => {
    const res = await get("/login", { host: `localhost:${port}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('<div id="root">');
  });

  test("/api/health on 127.0.0.1 → 200, never redirected", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe("behind the Cloudflare tunnel (APP_BASE_URL https://panel.example.com)", () => {
  test("plain-http hop with public Host + X-Forwarded-Proto https → 200, no redirect loop", async () => {
    // Production mode like the binary: Bun's dev server itself 403s non-loopback Host headers.
    const tunnel = servePanel(app, "https://panel.example.com", 0, false);
    try {
      const res = await fetch(`http://127.0.0.1:${tunnel.port}/profile`, {
        headers: { host: "panel.example.com", "x-forwarded-proto": "https" },
        redirect: "manual",
      });
      expect(res.status).toBe(200);
    } finally {
      tunnel.stop(true);
    }
  });
});

describe("canonicalRedirect", () => {
  test("other host → 302 to APP_BASE_URL origin, path+query kept", () => {
    const res = canonicalRedirect(new Request("http://127.0.0.1:3000/a/b?x=1"), "http://localhost:3000");
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("http://localhost:3000/a/b?x=1");
  });
});
