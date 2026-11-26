import { Elysia } from "elysia";
import pkg from "../../package.json" with { type: "json" };
import spa from "../web/index.html";
import { syncSuperAdminsOnBoot } from "./auth/access.service";
import { createAuth } from "./auth/auth.service";
import { backupServiceFor } from "./backup/backup.service";
import { openDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { loadEnvOrExit } from "./env";
import { log } from "./log.service";
import { createApiRoutes } from "./routes/api.routes";
import { loadOrCreateSecret } from "./secret";
import { selectSystem } from "./system/system.select";

/** Loopback only: the panel is reached through the Cloudflare tunnel, never exposed on the LAN. */
const LISTEN_HOST = "127.0.0.1";

/** Dependency-free API part (health); tests call `app.handle(new Request(...))` without starting a server. */
export const app = new Elysia({ prefix: "/api" }).get("/health", () => ({ ok: true, version: pkg.version }));

/**
 * Boots the panel: env → data dir + secret → DB migrations → auth → HTTP server (API + embedded SPA)
 * → daily backup scheduler (its timer dies with the process; no explicit stop needed under runit).
 */
export function start() {
  const env = loadEnvOrExit();
  const secret = loadOrCreateSecret(env.PANEL_DATA_DIR);
  const db = openDb(env.PANEL_DATA_DIR);
  const schemaVersion = runMigrations(db);
  syncSuperAdminsOnBoot(db, env.SUPER_ADMIN_EMAILS);
  // One adapter set shared by the API and the backup scheduler (same backup service instance per DB).
  const system = selectSystem();
  const api = new Elysia()
    .use(app)
    .use(
      createApiRoutes(
        createAuth({ db, env, secret }),
        { db, secret, superAdmins: env.SUPER_ADMIN_EMAILS, dataDir: env.PANEL_DATA_DIR },
        system,
      ),
    );
  backupServiceFor({ db, secret, dataDir: env.PANEL_DATA_DIR, system }).startScheduler();

  const server = servePanel(api, env.APP_BASE_URL, env.PORT);
  log.info(
    `[panel] v${pkg.version} schema=${schemaVersion} open ${env.APP_BASE_URL} (listening on ${LISTEN_HOST}:${server.port})`,
  );
  return server;
}

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

/**
 * HTTP server on loopback: /api/* → `api` (never redirected: install script and probes curl
 * 127.0.0.1), everything else → embedded SPA behind canonicalRedirect. Bundle assets keep their own
 * exact routes, so only HTML navigations pass through the check. `development` = Bun dev bundling/HMR
 * (note: Bun's dev server answers 403 to non-loopback Host headers, so the tunnel needs production).
 */
export function servePanel(
  api: { handle(req: Request): Response | Promise<Response> },
  appBaseUrl: string,
  port: number,
  development = process.env.NODE_ENV !== "production",
) {
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: LISTEN_HOST,
    port,
    development,
    routes: {
      "/api/*": (req) => api.handle(req),
      [SPA_PATH]: spa,
      // Bun routes cannot return an HTMLBundle from a handler, so matching requests fetch it over loopback.
      // accept-encoding dropped: fetch() decodes bodies, a forwarded content-encoding would then lie.
      "/*": (req): Response | Promise<Response> => {
        const redirect = canonicalRedirect(req, appBaseUrl);
        if (redirect) return redirect;
        const headers = new Headers(req.headers);
        headers.delete("accept-encoding");
        return fetch(new URL(SPA_PATH, server.url), { method: req.method, headers });
      },
    },
  });
  return server;
}

if (import.meta.main) start();
