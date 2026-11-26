import { DEPLOY_CHUNK_SIZE } from "../../shared/deploy.types";
import spa from "../../web/index.html";
import { createApiHandler } from "./api.handler";
import { applySecurityHeaders, pageCsp } from "./security.headers";

/** Loopback only: the panel is reached through the Cloudflare tunnel, never exposed on the LAN. */
export const LISTEN_HOST = "127.0.0.1";
/** Hard cap on any request body (one deploy chunk + headroom); JSON routes are capped lower in api.handler. */
const MAX_BODY_BYTES = DEPLOY_CHUNK_SIZE + 1024 * 1024;
const HTTP_NOT_MODIFIED = 304;

/** Internal path the SPA bundle is mounted on; "/*" serves it from here after the origin check. */
const SPA_PATH = "/__spa";

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

/**
 * HTTP server on loopback: /api/* → `api` through createApiHandler (limits, error bodies, headers, log;
 * never redirected: install script and probes curl 127.0.0.1), everything else → embedded SPA behind
 * canonicalRedirect with security headers. Bundle assets keep their own exact routes, so only HTML
 * navigations pass through the check (and get the CSP). `development` = Bun dev bundling/HMR
 * (note: Bun's dev server answers 403 to non-loopback Host headers, so the tunnel needs production).
 */
export function servePanel(
  api: { handle(req: Request): Response | Promise<Response> },
  appBaseUrl: string,
  port: number,
  development = process.env.NODE_ENV !== "production",
) {
  const https = new URL(appBaseUrl).protocol === "https:";
  const handleApi = createApiHandler(api, { https });
  const cspFor = pageCspCache(development);
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: LISTEN_HOST,
    port,
    development,
    maxRequestBodySize: MAX_BODY_BYTES,
    routes: {
      "/api/*": (req, srv) => handleApi(req, srv),
      [SPA_PATH]: spa,
      // Bun routes cannot return an HTMLBundle from a handler, so matching requests fetch it over loopback.
      // accept-encoding dropped: fetch() decodes bodies, a forwarded content-encoding would then lie.
      "/*": async (req): Promise<Response> => {
        const redirect = canonicalRedirect(req, appBaseUrl);
        if (redirect) return redirect;
        const headers = new Headers(req.headers);
        headers.delete("accept-encoding");
        // Always GET: the CSP hashes the inline scripts of the real body, also for HEAD.
        const page = await fetch(new URL(SPA_PATH, server.url), { headers });
        const html = await page.text();
        const out = applySecurityHeaders(new Headers(page.headers), cspFor(html), https);
        out.delete("content-length");
        const noBody = req.method === "HEAD" || page.status === HTTP_NOT_MODIFIED;
        return new Response(noBody ? null : html, { status: page.status, headers: out });
      },
    },
  });
  return server;
}
