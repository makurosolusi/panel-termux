import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import type { SiteService } from "../sites/site.service";
import { parsePaging } from "./http.error";
import { panelOnError } from "./panel.routes";

const flag = (v: string | undefined) => v === "true" || v === "1";

/** admin site management API under /panel: sites, jobs, integration status. */
export function createSiteRoutes(auth: Auth, sites: SiteService) {
  return roleGuard(auth, "/panel", "admin")
    .onError(panelOnError as never)
    .get("/sites", () => sites.list())
    .get("/sites/discovered", () => sites.discovered())
    .get("/sites/suggest-port", () => sites.suggestPort())
    .post("/sites/check", ({ body }) => sites.check(body))
    .post("/sites", async ({ body, user, status }) => status(202, await sites.create(user.id, body)))
    .post("/sites/adopt", async ({ body, user, status }) => status(201, await sites.adopt(user.id, body)))
    .get("/sites/:name", ({ params }) => sites.detail(params.name))
    .put("/sites/:name/env", ({ params, body, user }) => sites.updateEnv(user.id, params.name, body))
    .post("/sites/:name/hostnames", ({ params, body, user, status }) =>
      status(202, sites.addHostname(user.id, params.name, body)),
    )
    .delete("/sites/:name/hostnames/:hostname", ({ params, user, status }) =>
      status(202, sites.removeHostname(user.id, params.name, decodeURIComponent(params.hostname))),
    )
    .delete("/sites/:name", ({ params, query, user, status }) =>
      status(
        202,
        sites.remove(user.id, params.name, { data: flag(query.keepData), database: flag(query.keepDatabase) }),
      ),
    )
    .get("/jobs", ({ query }) => sites.jobs.list(parsePaging(query)))
    .get("/jobs/:id", ({ params }) => sites.jobs.get(params.id))
    .get("/integration", () => sites.integration());
}
