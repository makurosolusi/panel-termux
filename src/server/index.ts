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

  const server = Bun.serve({
    hostname: LISTEN_HOST,
    port: env.PORT,
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/api/*": (req) => api.handle(req),
      "/*": spa,
    },
  });
  log.info(`[panel] v${pkg.version} schema=${schemaVersion} listening on ${server.url}`);
  return server;
}

if (import.meta.main) start();
