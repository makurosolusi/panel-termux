import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import { createBackupRoutes } from "../backup/backup.routes";
import { createCloudflareDevRoutes } from "../cloudflare/cloudflare.routes";
import { createDnsProvider } from "../cloudflare/dns.provider";
import type { DnsProvider } from "../cloudflare/dns.types";
import { latestSchemaVersion } from "../db/migrate";
import { appMeta } from "../db/schema";
import { createDeployService } from "../deploy/deploy.service";
import { setupChecklist } from "../dev/setup.service";
import { createSiteService } from "../sites/site.service";
import { selectSystem } from "../system/system.select";
import type { SystemAdapters } from "../system/system.types";
import { createDeployRoutes } from "./deploy.routes";
import { createDevRoutes, type DevDeps } from "./dev.routes";
import { createMeRoutes } from "./me.routes";
import { rejectForeignOrigin } from "./origin.guard";
import { createPanelRoutes, panelOnError } from "./panel.routes";
import { createSiteRoutes } from "./sites.routes";

const HTTP_UNAVAILABLE = 503;

/**
 * Auth-aware API under /api: Better Auth endpoints, /ready, /me, and role-guarded /panel and /dev areas.
 * `system` defaults to auto-detected adapters (Termux when `$PREFIX/bin/sv` exists, else fake);
 * `dns` defaults to the Cloudflare provider (one instance shared by site jobs and /dev/cloudflare).
 * `deploy.healthTimeoutMs` shortens the post-deploy health wait (tests). The site job runner is exposed
 * as `decorator.siteJobs` so graceful shutdown can wait for a running job.
 */
export function createApiRoutes(
  auth: Auth,
  dev: DevDeps,
  system: SystemAdapters = selectSystem(),
  dns: DnsProvider = createDnsProvider({ db: dev.db, secret: dev.secret }),
  deploy: { healthTimeoutMs?: number } = {},
) {
  const sites = createSiteService({ db: dev.db, secret: dev.secret, system, dns });
  const deploys = createDeployService({
    db: dev.db,
    secret: dev.secret,
    system,
    jobs: sites.jobs,
    dataDir: dev.dataDir,
    ...deploy,
  });
  return (
    new Elysia({ prefix: "/api" })
      // CSRF: state-changing requests must come from the panel's own pages (see origin.guard.ts).
      .onRequest(({ request }) => rejectForeignOrigin(request, auth.options.baseURL) ?? undefined)
      // Better Auth owns /api/auth/* (sign-in/social, callback/google, get-session, sign-out, ...).
      .all("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
      .decorate("siteJobs", sites.jobs)
      // Public readiness probe: DB answers and the embedded migrations are applied.
      .get("/ready", ({ status }) => {
        try {
          const v = dev.db.select({ v: appMeta.value }).from(appMeta).where(eq(appMeta.key, "schema_version")).get()?.v;
          const want = latestSchemaVersion();
          if (v !== want)
            return status(HTTP_UNAVAILABLE, { error: "not_ready", message: `schema ${v ?? "none"}, expected ${want}` });
          return { ok: true, schemaVersion: v };
        } catch (e) {
          return status(HTTP_UNAVAILABLE, { error: "not_ready", message: `database: ${(e as Error).message}` });
        }
      })
      .use(createMeRoutes(auth, dev.db))
      .use(createPanelRoutes(auth, { db: dev.db, secret: dev.secret, dataDir: dev.dataDir, system }))
      .use(createSiteRoutes(auth, sites))
      .use(createDeployRoutes(auth, deploys))
      .use(createBackupRoutes({ auth, db: dev.db, secret: dev.secret, dataDir: dev.dataDir, system }))
      .use(createDevRoutes(auth, dev))
      .use(
        roleGuard(auth, "/dev", "super_admin")
          .onError(panelOnError as never)
          .get("/setup", () => setupChecklist(dev, sites))
          .use(createCloudflareDevRoutes({ dns })),
      )
  );
}
