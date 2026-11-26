import { DEPLOY_CHUNK_SIZE } from "../../shared/deploy.types";
// @ts-expect-error -- Bun `type: "file"` import (embedded in the binary, value = its path); no *.png module types
import touchIconPng from "../../web/assets/apple-touch-icon.png" with { type: "file" };
// @ts-expect-error -- same as apple-touch-icon.png above
import ogPng from "../../web/assets/og.png" with { type: "file" };
import spa from "../../web/index.html";
import { createApiHandler } from "./api.handler";
import { applySecurityHeaders, pageCsp } from "./security.headers";
import { pageHead, robotsTxt, sitemapXml } from "./seo";

/** Loopback only: the panel is reached through the Cloudflare tunnel, never exposed on the LAN. */
export const LISTEN_HOST = "127.0.0.1";
/** Hard cap on any request body (one deploy chunk + headroom); JSON routes are capped lower in api.handler. */
const MAX_BODY_BYTES = DEPLOY_CHUNK_SIZE + 1024 * 1024;
const HTTP_NOT_FOUND = 404;

/** Development only: path the bundle is mounted on in this server (HMR needs it here). */
const DEV_SPA_PATH = "/__spa";
/** Content-hashed bundle files (PLAN/01 §3.12): cached forever, a missing one is a real 404. */
const HASHED_ASSET = /^\/[\w.-]+-[a-z0-9]{8}\.(js|css|svg|png|webp|woff2)$/;
const ASSET_CACHE = "public, max-age=31536000, immutable";
const HTML_CACHE = "no-cache";
/** og.png / apple-touch-icon.png: fixed names, so a day instead of immutable (PLAN/05 §3.3). */
const IMAGE_CACHE = "public, max-age=86400";

/**
 * 302 to the same path+query on APP_BASE_URL when a page request's host differs from it, else null.
 * One canonical origin: Better Auth trusts only APP_BASE_URL and OAuth state cookies are per host, so
 * e.g. http://127.0.0.1:PORT must not serve pages when APP_BASE_URL is http://localhost:PORT.
 * Host only, never scheme: behind the Cloudflare tunnel requests arrive as plain http with the public
 * Host (X-Forwarded-Proto https), so comparing schemes would redirect https → https forever.
 */
export function canonicalRedirect(req: Request, appBaseUrl: string): Response | null {
  const base = new URL(appBaseUrl);
  const url = new URL(req.url); // Bun builds req.url from the Host header
  if (url.host === base.host) return null;
  return Response.redirect(`${base.origin}${url.pathname}${url.search}`, 302);
}

/** Page CSP per served HTML (the bundle's HTML is fixed per process, so this hashes once). */
function pageCspCache(development: boolean) {
  let last: { html: string; csp: string } | null = null;
  return (html: string) => {
    if (last?.html !== html) last = { html, csp: pageCsp(html, development) };
    return last.csp;
  };
}

/** 404 for a hashed asset that is not in this build (old tab after a deploy): plain text, never cached. */
const missingAsset = () =>
  new Response("not found\n", {
    status: HTTP_NOT_FOUND,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

/** A fixed public file (robots, sitemap, images) with nosniff and `cache-control`. */
const publicFile = (body: BodyInit, type: string, cache: string) => () =>
  new Response(body, {
    headers: { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff" },
  });

/** `/robots.txt`, `/sitemap.xml`, `/og.png`, `/apple-touch-icon.png`, `/favicon.ico` (PNG icon) — PLAN/05 K17. */
function seoRoutes(appBaseUrl: string) {
  const touchIcon = publicFile(Bun.file(touchIconPng as string), "image/png", IMAGE_CACHE);
  return {
    "/robots.txt": publicFile(robotsTxt(appBaseUrl), "text/plain; charset=utf-8", HTML_CACHE),
    "/sitemap.xml": publicFile(sitemapXml(appBaseUrl), "application/xml; charset=utf-8", HTML_CACHE),
    "/og.png": publicFile(Bun.file(ogPng as string), "image/png", IMAGE_CACHE),
    "/apple-touch-icon.png": touchIcon,
    "/favicon.ico": touchIcon,
  };
}

/**
 * HTTP server on loopback: /api/* → `api` through createApiHandler (host check, CSRF, limits, error bodies,
 * headers, log; never redirected: install script and probes curl 127.0.0.1); everything else is proxied to
 * the SPA bundle, which lives on an internal loopback server because Bun has no header hook for HTMLBundle
 * routes and cannot return one from a handler. Headers per B11: hashed asset → `immutable` + nosniff, or
 * 404 text `no-store` when missing; HTML (canonicalRedirect first) → `no-cache` + CSP, head rewritten by
 * seo.pageHead (OG for `/`, `noindex` elsewhere, status 404 for unknown paths incl. the bundle's old
 * `/__spa`), never ETag/304 since the body differs from the bundle's. SEO files: seoRoutes. `development` = Bun dev bundling/HMR:
 * the bundle stays on this server (HMR websocket) so its assets bypass the proxy (note: Bun's dev server
 * answers 403 to non-loopback Host headers, so the tunnel needs production).
 */
export function servePanel(
  api: { handle(req: Request): Response | Promise<Response> },
  appBaseUrl: string,
  port: number,
  development = process.env.NODE_ENV !== "production",
) {
  const https = new URL(appBaseUrl).protocol === "https:";
  const handleApi = createApiHandler(api, { appBaseUrl });
  const cspFor = pageCspCache(development);
  const bundle = development
    ? null
    : Bun.serve({
        hostname: LISTEN_HOST,
        port: 0,
        development: false,
        routes: { "/": spa },
        fetch: () => new Response(null, { status: HTTP_NOT_FOUND }),
      });
  bundle?.unref(); // never keeps the process alive on its own; dies with it
  const bundleUrl = (path: string) => new URL(path, bundle ? bundle.url : server.url);

  async function asset(req: Request, path: string): Promise<Response> {
    const res = await fetch(bundleUrl(path), { method: req.method === "HEAD" ? "HEAD" : "GET" });
    if (!res.ok) return missingAsset();
    const headers = new Headers(res.headers);
    headers.set("cache-control", ASSET_CACHE);
    headers.set("x-content-type-options", "nosniff");
    return new Response(res.body, { status: res.status, headers });
  }

  async function page(req: Request, path: string): Promise<Response> {
    const redirect = canonicalRedirect(req, appBaseUrl);
    if (redirect) return redirect;
    const headers = new Headers(req.headers);
    // fetch() decodes bodies, a forwarded content-encoding would then lie; the bundle has its own host.
    headers.delete("accept-encoding");
    headers.delete("host");
    // The body is rewritten below, so the bundle's validators never describe it: no 304, ever.
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    // Always GET "/": the CSP hashes the inline scripts of the real body, also for HEAD.
    const res = await fetch(bundleUrl(development ? DEV_SPA_PATH : "/"), { headers });
    const raw = await res.text();
    const head = pageHead(raw, path, appBaseUrl);
    const out = applySecurityHeaders(new Headers(res.headers), cspFor(raw), https);
    for (const h of ["content-length", "etag", "last-modified"]) out.delete(h);
    out.set("cache-control", HTML_CACHE);
    if (head.robots) out.set("x-robots-tag", head.robots);
    const status = res.ok ? head.status : res.status;
    return new Response(req.method === "HEAD" ? null : head.html, { status, headers: out });
  }

  const devBundle: Record<string, typeof spa> = development ? { [DEV_SPA_PATH]: spa } : {};
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: LISTEN_HOST,
    port,
    development,
    maxRequestBodySize: MAX_BODY_BYTES,
    routes: {
      "/api/*": (req, srv) => handleApi(req, srv),
      ...seoRoutes(appBaseUrl),
      ...devBundle,
      "/*": (req) => {
        const path = new URL(req.url).pathname;
        return HASHED_ASSET.test(path) ? asset(req, path) : page(req, path);
      },
    },
  });
  return server;
}
