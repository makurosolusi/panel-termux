import { isRole } from "../../shared/roles";
import { listAudit } from "../audit.service";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import { revokeUserSessions } from "../auth/sessions.service";
import type { BackupService } from "../backup/backup.service";
import type { Db } from "../db/client";
import { exportAuditCsv, parseAuditFilter } from "../dev/audit.export";
import { getHealth } from "../dev/health.service";
import { getSetup, isManualKey, setDismissed, setManual } from "../dev/setup.service";
import { changeRole, deleteUser, listUsers } from "../dev/users.service";
import type { Monitor } from "../monitor/monitor.contract";
import { createIntegration } from "../sites/integration.service";
import type { JobRunner } from "../sites/job.runner";
import type { SystemAdapters } from "../system/system.types";
import { ApiError, parsePaging } from "./http.error";
import { panelOnError } from "./panel.routes";

/** What the /dev admin API needs (boot builds each service once). Picks keep test stubs small. */
export type DevAdminDeps = {
  auth: Auth;
  db: Db;
  secret: string;
  system: SystemAdapters;
  monitor: Pick<Monitor, "status" | "problems">;
  backup: Pick<BackupService, "status">;
  jobs: Pick<JobRunner, "active">;
  appBaseUrl: string;
  createdThisBoot: boolean;
};

const field = (body: unknown, name: string): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;

const bool = (body: unknown, name: string): boolean => {
  const v = field(body, name);
  if (typeof v !== "boolean") throw new ApiError(400, "invalid_body", `body must be { "${name}": boolean }`);
  return v;
};

/** super_admin API under /dev: health verdict, onboarding, users (+ revoke sessions), audit list and CSV. */
export function createDevAdminRoutes(deps: DevAdminDeps) {
  const { auth, db } = deps;
  const setupDeps = { ...deps, integration: createIntegration({ db, secret: deps.secret, system: deps.system }) };
  const ctx = (actorId: string) => ({ db, actorId });
  return (
    roleGuard(auth, "/dev", "super_admin")
      .onError(panelOnError as never)
      .get("/health", () => getHealth(deps))
      .get("/setup", () => getSetup(setupDeps))
      .put("/setup/items/:key", ({ params, body, user }) => {
        if (!isManualKey(params.key)) throw new ApiError(404, "not_found", `setup item ${params.key} cannot be ticked`);
        return setManual(setupDeps, user.id, params.key, bool(body, "done"));
      })
      .put("/setup/dismiss", ({ body }) => setDismissed(setupDeps, bool(body, "dismissed")))
      .get("/users", ({ query }) => {
        const role = query.role || undefined;
        if (role !== undefined && !isRole(role)) throw new ApiError(400, "invalid_role", `unknown role ${role}`);
        return listUsers(db, parsePaging(query), { q: query.q?.trim() || undefined, role });
      })
      .patch("/users/:id", ({ params, body, user }) => {
        const role = field(body, "role");
        if (role !== "user" && role !== "admin")
          throw new ApiError(400, "invalid_role", 'role must be "user" or "admin"');
        return changeRole(ctx(user.id), params.id, role);
      })
      .delete("/users/:id", ({ params, user, status }) => {
        deleteUser(ctx(user.id), params.id);
        return status(204);
      })
      // 409 `self` only for the caller (B6); audit + log in revokeUserSessions.
      .post("/users/:id/sessions/revoke", ({ params, user }) => revokeUserSessions(db, user.id, params.id))
      .get("/audit", ({ query, request }) =>
        listAudit(db, parsePaging(query), parseAuditFilter(new URL(request.url).searchParams)),
      )
      .get("/audit/export.csv", ({ request, user }) =>
        exportAuditCsv(db, user.id, parseAuditFilter(new URL(request.url).searchParams)),
      )
  );
}
