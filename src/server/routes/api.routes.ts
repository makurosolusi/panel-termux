import { Elysia } from "elysia";
import { homeFor } from "../../shared/roles";
import type { Auth } from "../auth/auth.service";
import { getSessionUser, roleGuard } from "../auth/role.guard";
import { createBackupRoutes } from "../backup/backup.routes";
import { createCloudflareDevRoutes } from "../cloudflare/cloudflare.routes";
import { createDnsProvider } from "../cloudflare/dns.provider";
import type { DnsProvider } from "../cloudflare/dns.types";
import { createDeployService } from "../deploy/deploy.service";
import { createSiteService } from "../sites/site.service";
import { selectSystem } from "../system/system.select";
import type { SystemAdapters } from "../system/system.types";
import { createDeployRoutes } from "./deploy.routes";
import { createDevRoutes, type DevDeps } from "./dev.routes";
import { createPanelRoutes, panelOnError } from "./panel.routes";
import { createSiteRoutes } from "./sites.routes";

/**
 * Auth-aware API under /api: Better Auth endpoints, /me, and role-guarded /panel and /dev areas.
 * `system` defaults to auto-detected adapters (Termux when `$PREFIX/bin/sv` exists, else fake);
 * `dns` defaults to the Cloudflare provider (one instance shared by site jobs and /dev/cloudflare).
 * `deploy.healthTimeoutMs` shortens the post-deploy health wait (tests).
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
      // Better Auth owns /api/auth/* (sign-in/social, callback/google, get-session, sign-out, ...).
      .all("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
      .get("/me", async ({ request, status }) => {
        const user = await getSessionUser(auth, request.headers);
        if (!user) return status(401, { error: "unauthorized" });
        return { ...user, home: homeFor(user.role) };
      })
      .use(createPanelRoutes(auth, { db: dev.db, secret: dev.secret, system }))
      .use(createSiteRoutes(auth, sites))
      .use(createDeployRoutes(auth, deploys))
      .use(createBackupRoutes({ auth, db: dev.db, secret: dev.secret, dataDir: dev.dataDir, system }))
      .use(createDevRoutes(auth, dev))
      .use(
        roleGuard(auth, "/dev", "super_admin")
          .onError(panelOnError as never)
          .use(createCloudflareDevRoutes({ dns })),
      )
  );
}
