import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { createApiHandler, MAX_JSON_BODY_BYTES } from "@/server/http/api.handler";
import { AUTH_LIMIT_PER_IP, clientIp, createRateLimiter, MUTATION_LIMIT_PER_SESSION } from "@/server/http/rate.limit";
import { requestLine, requestStats } from "@/server/http/request.log";
import { inlineScriptHashes, pageCsp } from "@/server/http/security.headers";
import { app, servePanel } from "@/server/index";
import { readLogs } from "@/server/log.service";

const BASE = "http://localhost:3200"; // test-only
const echo = new Elysia({ prefix: "/api" })
  .get("/health", () => ({ ok: true }))
  .post("/panel/echo", ({ body }) => ({ got: body }))
  .put("/panel/uploads/u1/chunks/0", ({ request }) => request.arrayBuffer().then((b) => ({ n: b.byteLength })), {
    parse: "none",
  })
  .get("/boom", () => {
    throw new Error("db password=hunter2 leaked in stack");
  })
  .get("/teapot", ({ status }) => status(409, { error: "busy" }));
const peer = (address: string) => ({ requestIP: () => ({ address }) });
const req = (method: string, path: string, init: RequestInit = {}) =>
  new Request(`${BASE}${path}`, { method, ...init });

describe("security headers", () => {
  const theme = "document.documentElement.dataset.theme=localStorage.theme||'light'";
  const html = `<html><head><script>${theme}</script><script type="module" src="/chunk-1.js"></script></head></html>`;

  test("page CSP allows the inline script by its sha256 only, no 'unsafe-inline' for scripts", () => {
    const hash = createHash("sha256").update(theme).digest("base64");
    expect(inlineScriptHashes(html)).toEqual([`'sha256-${hash}'`]);
    const csp = pageCsp(html, false);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).toBe(`script-src 'self' 'sha256-${hash}'`);
    expect(csp).toContain("img-src 'self' data: https://lh3.googleusercontent.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://accounts.google.com");
  });

  test("development relaxes scripts and allows the HMR websocket", () => {
    const csp = pageCsp(html, true);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });

  test("API responses: nosniff, referrer, permissions, COOP, request id; HSTS only for https", async () => {
    const res = await createApiHandler(echo, { https: false })(req("GET", "/api/health"));
    const h = res.headers;
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(h.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(h.get("content-security-policy")).toContain("default-src 'none'");
    expect(h.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.get("strict-transport-security")).toBeNull();
    const secure = await createApiHandler(echo, { https: true })(req("GET", "/api/health"));
    expect(secure.headers.get("strict-transport-security")).toMatch(/^max-age=\d+/);
  });

  describe("real server (production mode, https base URL)", () => {
    let server: ReturnType<typeof servePanel>;
    beforeAll(() => {
      server = servePanel(app, "https://panel.example.com", 0, false);
    });
    afterAll(() => server.stop(true));
    const get = (path: string) =>
      fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { host: "panel.example.com" }, redirect: "manual" });

    test("SPA page carries CSP (hashes of its own inline scripts) + HSTS", async () => {
      const res = await get("/login");
      expect(res.status).toBe(200);
      const body = await res.text();
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      for (const h of inlineScriptHashes(body)) expect(csp).toContain(h);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(res.headers.get("strict-transport-security")).toMatch(/^max-age=/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    test("HEAD of a page carries the same CSP as GET", async () => {
      const head = await fetch(`http://127.0.0.1:${server.port}/login`, {
        method: "HEAD",
        headers: { host: "panel.example.com" },
      });
      expect(head.headers.get("content-security-policy")).toBe(
        (await get("/login")).headers.get("content-security-policy"),
      );
    });

    test("/api/health through the wrapper has the API headers", async () => {
      const res = await get("/api/health");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-request-id")).toBeTruthy();
      expect(res.headers.get("strict-transport-security")).toMatch(/^max-age=/);
    });
  });
});

describe("rate limiting", () => {
  test("clientIp trusts CF-Connecting-IP only from a loopback peer", () => {
    const h = new Headers({ "cf-connecting-ip": "203.0.113.7" });
    expect(clientIp(h, "127.0.0.1")).toBe("203.0.113.7");
    expect(clientIp(h, "::1")).toBe("203.0.113.7");
    expect(clientIp(h, "198.51.100.9")).toBe("198.51.100.9");
    expect(clientIp(new Headers(), "127.0.0.1")).toBe("127.0.0.1");
  });

  test("limiter: allows `limit` per window, then seconds until reset; new window resets", () => {
    let now = 0;
    const l = createRateLimiter(2, 60_000, () => now);
    expect(l.take("k")).toBeNull();
    expect(l.take("k")).toBeNull();
    now = 15_000;
    expect(l.take("k")).toBe(45);
    expect(l.take("other")).toBeNull();
    now = 60_000;
    expect(l.take("k")).toBeNull();
  });

  test(`sign-in: ${AUTH_LIMIT_PER_IP}/min per CF-Connecting-IP → 429 JSON + Retry-After`, async () => {
    const handle = createApiHandler(echo, { https: false });
    const signIn = (ip: string) =>
      handle(req("POST", "/api/auth/sign-in/social", { headers: { "cf-connecting-ip": ip } }), peer("127.0.0.1"));
    for (let i = 0; i < AUTH_LIMIT_PER_IP; i++) expect((await signIn("203.0.113.1")).status).not.toBe(429);
    const res = await signIn("203.0.113.1");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ error: "rate_limited", message: expect.stringContaining("retry in") });
    expect((await signIn("203.0.113.2")).status).not.toBe(429); // other visitor unaffected
    // get-session is polled by the SPA and is never limited.
    expect((await handle(req("GET", "/api/auth/get-session"), peer("127.0.0.1"))).status).not.toBe(429);
  });

  test(`mutations: ${MUTATION_LIMIT_PER_SESSION}/min per session; GETs and chunk uploads exempt`, async () => {
    const handle = createApiHandler(echo, { https: false });
    const cookie = { cookie: "better-auth.session_token=abc.sig" };
    const post = () => handle(req("POST", "/api/panel/echo", { headers: cookie, body: "{}" }), peer("127.0.0.1"));
    for (let i = 0; i < MUTATION_LIMIT_PER_SESSION; i++) expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
    expect((await handle(req("GET", "/api/health", { headers: cookie }), peer("127.0.0.1"))).status).toBe(200);
    const chunk = await handle(
      req("PUT", "/api/panel/uploads/u1/chunks/0", { headers: cookie, body: "x" }),
      peer("127.0.0.1"),
    );
    expect(chunk.status).toBe(200);
  });
});

describe("body limits and error bodies", () => {
  const handle = createApiHandler(echo, { https: false });

  test("JSON body over 1 MB → 413 { error, message } (content-length and chunked)", async () => {
    const big = JSON.stringify({ x: "a".repeat(MAX_JSON_BODY_BYTES) });
    const res = await handle(
      req("POST", "/api/panel/echo", { body: big, headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large", message: expect.any(String) });
    const stream = new Blob([big]).stream();
    const chunked = await handle(req("POST", "/api/panel/echo", { body: stream, duplex: "half" } as RequestInit));
    expect(chunked.status).toBe(413);
  });

  test("small chunked JSON body still reaches the handler", async () => {
    const stream = new Blob(['{"a":1}']).stream();
    const res = await handle(
      req("POST", "/api/panel/echo", {
        body: stream,
        duplex: "half",
        headers: { "content-type": "application/json" },
      } as RequestInit),
    );
    expect(await res.json()).toEqual({ got: { a: 1 } });
  });

  test("chunk upload route is not capped at 1 MB", async () => {
    const res = await handle(
      req("PUT", "/api/panel/uploads/u1/chunks/0", { body: new Uint8Array(2 * MAX_JSON_BODY_BYTES) }),
    );
    expect(await res.json()).toEqual({ n: 2 * MAX_JSON_BODY_BYTES });
  });

  test("unexpected error → 500 { error, message, requestId }, no stack/message leak, logged with the id", async () => {
    const res = await handle(req("GET", "/api/boom"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string; requestId: string };
    expect(body).toEqual({
      error: "internal_error",
      message: expect.stringContaining(body.requestId),
      requestId: body.requestId,
    });
    expect(body.requestId).toBe(res.headers.get("x-request-id") as string);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(readLogs({ level: "error", q: body.requestId, limit: 5 }).length).toBeGreaterThan(0);
  });

  test("handler that throws outright → same 500 shape", async () => {
    const res = await createApiHandler(
      { handle: () => Promise.reject(new Error("x")) },
      { https: false },
    )(req("GET", "/api/x"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "internal_error", requestId: expect.any(String) });
  });

  test("4xx without message gets one; plain-text 404 becomes JSON", async () => {
    expect(await (await handle(req("GET", "/api/teapot"))).json()).toEqual({ error: "busy", message: "conflict" });
    const nf = await handle(req("GET", "/api/nope"));
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: "not_found", message: "not found" });
  });
});

describe("request log", () => {
  test("one line: method, path without query, status, ms, user id; probes at debug; counted", async () => {
    const before = requestStats().requestsPerMinute;
    const handle = createApiHandler(echo, { https: false });
    await handle(req("POST", "/api/panel/echo?token=s3cret&email=a@b.c", { body: "{}" }));
    const line = readLogs({ level: "info", q: "/api/panel/echo", limit: 1 })[0]?.msg ?? "";
    expect(line).toMatch(/^\[http\] POST \/api\/panel\/echo 200 \d+ms$/);
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("@");
    await handle(req("GET", "/api/health"));
    expect(readLogs({ level: "debug", q: "GET /api/health", limit: 1 })[0]?.level).toBe("debug");
    expect(requestStats().requestsPerMinute).toBeGreaterThanOrEqual(before + 2);
    expect(requestLine({ method: "GET", path: "/api/me", status: 200, ms: 3.4, userId: "u1" })).toBe(
      "[http] GET /api/me 200 3ms user=u1",
    );
  });

  test("5xx are counted in errorCount5m", async () => {
    const before = requestStats().errorCount5m;
    await createApiHandler(echo, { https: false })(req("GET", "/api/boom"));
    expect(requestStats().errorCount5m).toBe(before + 1);
  });
});
