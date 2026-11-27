import { uptime } from "node:os";
import { basename, join, resolve } from "node:path";
import { Elysia } from "elysia";
import pkg from "../../package.json" with { type: "json" };
import { pruneAudit, recordAudit } from "./audit.service";
import { syncSuperAdminsOnBoot } from "./auth/access.service";
import { createAuth } from "./auth/auth.service";
import { checkDataKeyOnBoot } from "./data-key.service";
import { type Db, openDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { appMeta } from "./db/schema";
import { snapshotOnBoot } from "./db/snapshot";
import { type Env, loadEnvOrExit } from "./env";
import { LISTEN_HOST, servePanel } from "./http/spa.serve";
import { log } from "./log.service";
import { PROCESS_BOOT_ID } from "./panel/panel.service";
import { createApiRoutes } from "./routes/api.routes";
import { loadOrCreateSecret } from "./secret";
import { getSetting } from "./settings.service";
import { consumeCleanShutdownMarker, createShutdown } from "./shutdown";
import { FAKE_HOME_DIR } from "./system/system.fake";
import { selectSystem } from "./system/system.select";
import type { SystemAdapters } from "./system/system.types";

/** Id of this process's boot; a changed id in /api/health tells the client the panel restarted (PLAN/02 §4.4). */
export const BOOT_ID = PROCESS_BOOT_ID;

/** Dependency-free API part (health); tests call `app.handle(new Request(...))` without starting a server. */
export const app = new Elysia({ prefix: "/api" }).get("/health", () => ({
  ok: true,
  version: pkg.version,
  bootId: BOOT_ID,
}));

const PANEL_VERSION_KEY = "panel_version";
/** Authorized requests here mean an admin used the panel since boot (input of `access_not_seen`, PLAN/02 B4). */
const ADMIN_AREA = /^\/api\/(panel|dev)\//;
const HTTP_CLIENT_ERROR = 400;

/** app_meta.panel_version written by the previous boot; null on a fresh DB or a 0.2.x upgrade (no such row). */
function previousPanelVersion(db: Db): string | null {
  const table = db.$client.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'").get();
  if (!table) return null;
  const row = db.$client.query("SELECT value FROM app_meta WHERE key = ?").get(PANEL_VERSION_KEY) as {
    value: string;
  } | null;
  return row?.value ?? null;
}

/** Overrides for tests: system adapters and the exit used by shutdown. */
export type BootOpts = { system?: SystemAdapters; exit?: (code: number) => void };

/**
 * Boots the panel from a parsed env (PLAN/04 F6/F7 order): secret → DB → pre-migration snapshot → migrations →
 * panel_version → data-key check → clean-shutdown marker → services → apps.json + orphan fix candidate → monitor → backup scheduler →
 * HTTP server. Returns the server and the graceful shutdown handler (not yet bound to signals).
 */
export async function bootPanel(env: Env, opts: BootOpts = {}) {
  const dataDir = resolve(env.PANEL_DATA_DIR);
  const { secret, created } = loadOrCreateSecret(dataDir);
  const db = openDb(dataDir);
  const prevVersion = previousPanelVersion(db);
  const snapshot = await snapshotOnBoot(db, dataDir, prevVersion, { skip: env.PANEL_SKIP_SNAPSHOT });
  const schemaVersion = runMigrations(db);
  db.insert(appMeta)
    .values({ key: PANEL_VERSION_KEY, value: pkg.version })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: pkg.version } })
    .run();
  checkDataKeyOnBoot({ db, secret }, created);
  const cleanShutdown = consumeCleanShutdownMarker(dataDir);
  syncSuperAdminsOnBoot(db, env.SUPER_ADMIN_EMAILS);
  pruneAudit(db, Number(getSetting({ db, secret }, "audit.retention_days")));
  recordAudit(db, {
    actorId: null,
    action: "panel.start",
    meta: { version: pkg.version, schema: schemaVersion, snapshot: snapshot ? basename(snapshot) : null },
  });

  let adminSeen = false;
  const system = opts.system ?? selectSystem({ fakeHome: join(dataDir, FAKE_HOME_DIR) });
  const routes = createApiRoutes(
    createAuth({ db, env, secret }),
    {
      db,
      secret,
      superAdmins: env.SUPER_ADMIN_EMAILS,
      dataDir,
      appBaseUrl: env.APP_BASE_URL,
      panelPort: env.PORT,
      createdThisBoot: created,
      bootNotice: { cleanShutdown, uptimeSec: uptime() },
      connectivityUrl: env.PANEL_CONNECTIVITY_URL,
      adminSeenSinceBoot: () => adminSeen,
    },
    system,
  );
  const { siteJobs, monitor, backup } = routes.decorator;
  routes.decorator.sites.ensureAppsJson();
  routes.decorator.sites.removeFixCandidate();
  const api = new Elysia().use(app).use(routes);
  const stopMonitor = monitor.start();
  const stopBackup = backup.startScheduler();

  const server = servePanel(
    {
      async handle(req) {
        const res = await api.handle(req);
        if (!adminSeen && res.status < HTTP_CLIENT_ERROR && ADMIN_AREA.test(new URL(req.url).pathname))
          adminSeen = true;
        return res;
      },
    },
    env.APP_BASE_URL,
    env.PORT,
  );
  const shutdown = createShutdown({
    server,
    stopScheduler: () => {
      stopMonitor();
      stopBackup();
    },
    idle: [() => siteJobs.idle(), () => backup.idle(), () => monitor.idle()],
    closeDb: () => db.$client.close(),
    dataDir,
    exit: opts.exit,
  });
  log.info(
    `[panel] v${pkg.version} schema=${schemaVersion} open ${env.APP_BASE_URL} (listening on ${LISTEN_HOST}:${server.port})`,
  );
  return { server, shutdown, db };
}

/** Process entrypoint: env (exit 1 when invalid) → bootPanel → SIGTERM (runit `sv down`) / SIGINT → graceful stop. */
export async function start() {
  const { server, shutdown } = await bootPanel(loadEnvOrExit());
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void shutdown(sig));
  return server;
}
