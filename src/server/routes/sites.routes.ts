import type { JobKind, JobStatus } from "../../shared/site.types";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import type { SiteService } from "../sites/site.service";
import { Pm2UnavailableError } from "../system/system.types";
import { ApiError, parsePaging } from "./http.error";
import { panelOnError } from "./panel.routes";

const flag = (v: string | undefined) => v === "true" || v === "1";
const KINDS: JobKind[] = [
  "site.create",
  "site.delete",
  "hostname.add",
  "hostname.remove",
  "site.deploy",
  "site.rollback",
  "site.restart",
  "site.env",
  "job.cleanup",
];
const STATUSES: JobStatus[] = ["running", "succeeded", "failed", "rolled_back", "interrupted"];
const HTTP_UNAVAILABLE = 503;

/** `?kind=`/`?status=` value from `allowed`, or 400 `invalid_filter`. */
function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (v === undefined || v === "") return undefined;
  if (!allowed.includes(v as T))
    throw new ApiError(400, "invalid_filter", `${name} must be one of ${allowed.join(", ")}`);
  return v as T;
}

type ErrorCtx = Parameters<typeof panelOnError>[0];
/** Like panelOnError, but keeps ApiError `extra` (409 busy carries `job`) and maps pm2-down to 503. */
function sitesOnError(c: ErrorCtx) {
  if (c.error instanceof ApiError) return c.status(c.error.status, c.error.body);
  if (c.error instanceof Pm2UnavailableError)
    return c.status(HTTP_UNAVAILABLE, { error: "pm2_unavailable", message: c.error.message, reason: c.error.reason });
  return panelOnError(c);
}

/** admin site management API under /panel: sites, jobs (+ recover), integration status and fixes. */
export function createSiteRoutes(auth: Auth, sites: SiteService) {
  return (
    roleGuard(auth, "/panel", "admin")
      .onError(sitesOnError as never)
      .get("/sites", () => sites.list())
      .get("/sites/discovered", () => sites.discovered())
      .get("/sites/suggest-port", () => sites.suggestPort())
      .post("/sites/check", ({ body }) => sites.check(body))
      .post("/sites", async ({ body, user, status }) => status(202, await sites.create(user.id, body)))
      .post("/sites/adopt", async ({ body, user, status }) => status(201, await sites.adopt(user.id, body)))
      .get("/sites/:name", ({ params }) => sites.detail(params.name))
      .patch("/sites/:name/settings", ({ params, body, user }) => sites.updateSettings(user.id, params.name, body))
      .get("/sites/:name/health", ({ params }) => sites.health(params.name))
      .post("/sites/:name/restart", async ({ params, user, status }) =>
        status(202, await sites.restart(user.id, params.name)),
      )
      .put("/sites/:name/env", async ({ params, body, user, status }) => {
        const r = await sites.saveEnv(user.id, params.name, body);
        return "jobId" in r ? status(202, r) : r;
      })
      .post("/sites/:name/hostnames", ({ params, body, user, status }) =>
        status(202, sites.addHostnames(user.id, params.name, body)),
      )
      .delete("/sites/:name/hostnames/:hostname", ({ params, user, status }) =>
        status(202, sites.removeHostname(user.id, params.name, decodeURIComponent(params.hostname))),
      )
      .delete("/sites/:name", ({ params, query, user, status }) =>
        status(
          202,
          sites.remove(
            user.id,
            params.name,
            { data: flag(query.keepData), database: flag(query.keepDatabase) },
            query.confirm,
          ),
        ),
      )
      .get("/jobs", ({ query }) =>
        sites.jobs.list(parsePaging(query), {
          target: query.target || undefined,
          kind: oneOf(query.kind, KINDS, "kind"),
          status: oneOf(query.status, STATUSES, "status"),
        }),
      )
      .get("/jobs/active", () => ({ job: sites.jobs.active() }))
      .get("/jobs/:id", ({ params }) => sites.jobs.get(params.id))
      .post("/jobs/:id/recover", ({ params, user, status }) => status(202, sites.recover(user.id, params.id)))
      .get("/integration", () => sites.getIntegration())
      .post("/integration/verify", () => sites.verifyIntegration())
      // PLAN/06 §5.2: fixes are admin-only like the whole group; the CSRF guard runs before every /api route.
      .post("/integration/fixes/:key/preview", ({ params }) => sites.fixes.preview(params.key))
      .post("/integration/fixes/:key", ({ params, body, user }) => sites.fixes.apply(user.id, params.key, body))
      .post("/integration/backups/:id/restore", ({ params, body, user }) =>
        sites.fixes.restore(user.id, params.id, body),
      )
      .post("/integration/pm2/restart", ({ user }) => sites.fixes.restartPm2(user.id))
  );
}
