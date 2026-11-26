import { Elysia } from "elysia";
import pkg from "../../package.json" with { type: "json" };
import { syncSuperAdminsOnBoot } from "./auth/access.service";
import { createAuth } from "./auth/auth.service";
import { backupServiceFor } from "./backup/backup.service";
import { checkDataKeyOnBoot } from "./data-key.service";
import { openDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { loadEnvOrExit } from "./env";
import { LISTEN_HOST, servePanel } from "./http/spa.serve";
import { log } from "./log.service";
import { createApiRoutes } from "./routes/api.routes";
import { loadOrCreateSecret } from "./secret";
import { createShutdown } from "./shutdown";
import { selectSystem } from "./system/system.select";

/** Dependency-free API part (health); tests call `app.handle(new Request(...))` without starting a server. */
export const app = new Elysia({ prefix: "/api" }).get("/health", () => ({ ok: true, version: pkg.version }));

/**
 * Boots the panel: env → data dir + secret → DB migrations → auth → HTTP server (API + embedded SPA)
 * → daily backup scheduler. SIGTERM (runit `sv down`) / SIGINT shut down gracefully (see shutdown.ts).
 */
export function start() {
  const env = loadEnvOrExit();
  const { secret, created } = loadOrCreateSecret(env.PANEL_DATA_DIR);
  const db = openDb(env.PANEL_DATA_DIR);
  const schemaVersion = runMigrations(db);
  checkDataKeyOnBoot({ db, secret }, created);
  syncSuperAdminsOnBoot(db, env.SUPER_ADMIN_EMAILS);
  // One adapter set shared by the API and the backup scheduler (same backup service instance per DB).
  const system = selectSystem();
  const routes = createApiRoutes(
    createAuth({ db, env, secret }),
    { db, secret, superAdmins: env.SUPER_ADMIN_EMAILS, dataDir: env.PANEL_DATA_DIR },
    system,
  );
  const api = new Elysia().use(app).use(routes);
  const backup = backupServiceFor({ db, secret, dataDir: env.PANEL_DATA_DIR, system });
  const stopScheduler = backup.startScheduler();

  const server = servePanel(api, env.APP_BASE_URL, env.PORT);
  const shutdown = createShutdown({
    server,
    stopScheduler,
    idle: [() => routes.decorator.siteJobs.idle(), () => backup.idle()],
    closeDb: () => db.$client.close(),
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void shutdown(sig));
  log.info(
    `[panel] v${pkg.version} schema=${schemaVersion} open ${env.APP_BASE_URL} (listening on ${LISTEN_HOST}:${server.port})`,
  );
  return server;
}
