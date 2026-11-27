import { uptime } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { handleAuthRequest } from "../auth/auth.audit";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import { createBackupDevRoutes, createBackupRoutes } from "../backup/backup.routes";
import { backupServiceFor } from "../backup/backup.service";
import { createCloudflareDevRoutes } from "../cloudflare/cloudflare.routes";
import { tokenGated } from "../cloudflare/dns.fake";
import { createDnsProvider, type SiteDnsProvider } from "../cloudflare/dns.provider";
import { getSecurityStatus } from "../data-key.service";
import { latestSchemaVersion } from "../db/migrate";
import { appMeta } from "../db/schema";
import { createDeployService } from "../deploy/deploy.service";
import type { HealthTiming } from "../deploy/health.check";
import { DEFAULT_PORT } from "../env";
import { type MonitorDeps, monitorFor } from "../monitor/monitor.service";
import { describeSetting } from "../settings.service";
import { createSiteService, type SiteDeps } from "../sites/site.service";
import { FAKE_HOME_DIR } from "../system/system.fake";
import { selectSystem } from "../system/system.select";
import type { SystemAdapters } from "../system/system.types";
import { createAlertRoutes } from "./alerts.routes";
import { createDeployRoutes } from "./deploy.routes";
import { createDevAdminRoutes } from "./dev.admin.routes";
import { createDevRoutes, type DevDeps } from "./dev.routes";
import { createMeRoutes } from "./me.routes";
import { createPanelRoutes, panelOnError } from "./panel.routes";
import { createSecurityRoutes } from "./security.routes";
import { createSiteRoutes } from "./sites.routes";

const HTTP_UNAVAILABLE = 503;

/**
 * DevDeps plus what boot knows (all optional so tests can build the API from DevDeps alone): public URL and port
 * (default: APP_BASE_URL / PORT env, else localhost:DEFAULT_PORT), whether this boot created the data key, and the monitor's
 * boot inputs (notice, connectivity URL, "an admin used the panel since boot").
 */
export type ApiDeps = DevDeps & {
  appBaseUrl?: string;
  panelPort?: number;
  createdThisBoot?: boolean;
} & Partial<Pick<MonitorDeps, "bootNotice" | "connectivityUrl" | "adminSeenSinceBoot">> &
  Pick<SiteDeps, "pm2RestartPoll">;

/**
 * Auth-aware API under /api (CSRF guard and limits run before it, in createApiHandler): Better Auth endpoints, /ready,
 * /me, and role-guarded /panel and /dev areas. `system` defaults to auto-detected adapters (Termux when
 * `$PREFIX/bin/sv` exists, else fake); `dns` defaults to the Cloudflare provider (shared by site jobs and
 * /dev/cloudflare). `deploy` overrides post-deploy health timing (tests). The one monitor, backup service and site
 * job runner (+ site service) of this DB are exposed as decorators so boot can start/stop them and shutdown can wait for them.
 */
export function createApiRoutes(
  auth: Auth,
  dev: ApiDeps,
  system: SystemAdapters = selectSystem({ fakeHome: join(dev.dataDir, FAKE_HOME_DIR) }), // fake HOME inside the data dir, like boot
  // Fake DNS honours "no token" like the real provider, so the cloudflared cert path runs in fake mode (QA fix-04).
  dns: SiteDnsProvider = system.offline
    ? tokenGated(system.offline.dns, () => describeSetting(dev.db, "cloudflare.api_token").isSet)
    : createDnsProvider({ db: dev.db, secret: dev.secret }),
  deploy: { healthTimeoutMs?: number; healthTiming?: HealthTiming } = {},
) {
  const { db, secret, dataDir } = dev;
  const panelPort = dev.panelPort ?? (Number(process.env.PORT) || DEFAULT_PORT);
  const appBaseUrl = dev.appBaseUrl ?? process.env.APP_BASE_URL ?? `http://localhost:${panelPort}`;
  const createdThisBoot = dev.createdThisBoot ?? false;
  const backup = backupServiceFor({ db, secret, dataDir, system });
  // `jobs` is read lazily (first tick), so the monitor can exist before the site service that it is handed to.
  const monitor = monitorFor({
    db,
    secret,
    system,
    backupStatus: () => backup.status(),
    securityStatus: () => getSecurityStatus({ db, secret }, { appBaseUrl, createdThisBoot }),
    jobs: () => sites.jobs.needsAttention(),
    adminSeenSinceBoot: dev.adminSeenSinceBoot ?? (() => false),
    appBaseUrl,
    panelPort,
    bootNotice: dev.bootNotice ?? { cleanShutdown: true, uptimeSec: uptime() },
    connectivityUrl: dev.connectivityUrl,
  });
  // Without boot's values the site service reads APP_BASE_URL/PORT itself (tests set them per file).
  const panel = dev.appBaseUrl ? { hostname: new URL(dev.appBaseUrl).hostname, port: panelPort } : undefined;
  const sites = createSiteService({
    db,
    secret,
    system,
    dns,
    panel,
    monitor,
    backupBusy: () => backup.busy(),
    dataDir,
    pm2RestartPoll: dev.pm2RestartPoll,
    // `deploys` is created below; the hook only runs after a delete job, long after this function returned.
    onSiteDeleted: (name) => deploys.dropUploadsFor(name),
  });
  const jobs = sites.jobs;
  const deploys = createDeployService({
    db,
    secret,
    system,
    jobs,
    dataDir,
    monitor,
    integrationFailing: async () =>
      ((await sites.getIntegration()).checks ?? []).filter((c) => c.state === "error").map((c) => c.key),
    ...deploy,
  });
  return (
    new Elysia({ prefix: "/api" })
      // Better Auth owns /api/auth/* (sign-in/social, callback/google, get-session, sign-out, ...).
      .all("/auth/*", ({ request }) => handleAuthRequest(auth, db, request), { parse: "none" })
      .decorate({ siteJobs: jobs, sites, monitor, backup })
      // Public readiness probe: DB answers and the embedded migrations are applied.
      .get("/ready", ({ status }) => {
        try {
          const v = db.select({ v: appMeta.value }).from(appMeta).where(eq(appMeta.key, "schema_version")).get()?.v;
          const want = latestSchemaVersion();
          if (v !== want)
            return status(HTTP_UNAVAILABLE, { error: "not_ready", message: `schema ${v ?? "none"}, expected ${want}` });
          return { ok: true, schemaVersion: v };
        } catch (e) {
          return status(HTTP_UNAVAILABLE, { error: "not_ready", message: `database: ${(e as Error).message}` });
        }
      })
      .use(createMeRoutes(auth, db))
      .use(createPanelRoutes(auth, { db, secret, system, monitor, jobs, backup, panelPort }))
      .use(createSiteRoutes(auth, sites))
      .use(createDeployRoutes(auth, deploys))
      .use(createBackupRoutes({ auth, db, secret, dataDir, system }))
      .use(createBackupDevRoutes({ auth, db, secret, dataDir, system }))
      .use(createAlertRoutes({ auth, db, secret, monitor, telegramFetch: system.offline?.telegramFetch }))
      .use(createSecurityRoutes(auth, { db, secret, appBaseUrl, createdThisBoot }))
      .use(createDevRoutes(auth, dev))
      .use(createDevAdminRoutes({ auth, db, secret, system, monitor, backup, jobs, appBaseUrl, createdThisBoot }))
      .use(
        roleGuard(auth, "/dev", "super_admin")
          .onError(panelOnError as never)
          .use(createCloudflareDevRoutes({ dns, db })),
      )
  );
}
