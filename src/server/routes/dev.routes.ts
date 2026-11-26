import { LOG_LEVELS, type LogLevel } from "../../shared/dev.types";
import { listAudit, recordAudit } from "../audit.service";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import type { Db } from "../db/client";
import { getHealth } from "../dev/health.service";
import { changeRole, deleteUser, listUsers } from "../dev/users.service";
import { log, readLogs } from "../log.service";
import { describeSetting, InvalidSettingError, isSettingKey, listSettings, setSetting } from "../settings.service";
import { ApiError, parsePaging } from "./http.error";

/** What the /dev API needs besides auth. `superAdmins` = env SUPER_ADMIN_EMAILS (lowercase). */
export type DevDeps = { db: Db; secret: string; superAdmins: readonly string[]; dataDir: string };

const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 1000;

const field = (body: unknown, name: string): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;

function logLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LOG_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "invalid_limit", "limit must be an integer >= 1");
  return Math.min(n, MAX_LOG_LIMIT);
}

/** super_admin developer API under /dev (users, audit, logs, settings, health). */
export function createDevRoutes(auth: Auth, { db, secret, superAdmins, dataDir }: DevDeps) {
  const ctx = (actorId: string) => ({ db, superAdmins, actorId });
  return roleGuard(auth, "/dev", "super_admin")
    .onError(({ error, code, status }) => {
      if (error instanceof ApiError) return status(error.status, { error: error.code, message: error.message });
      if (code === "PARSE") return status(400, { error: "invalid_body", message: "request body must be JSON" });
      if (code === "NOT_FOUND") return;
      log.error(`[dev] request failed: ${error instanceof Error ? error.message : String(code)}`);
    })
    .get("/ping", () => ({ ok: true }))
    .get("/health", () => getHealth(db, dataDir))
    .get("/users", ({ query }) => listUsers(db, superAdmins, parsePaging(query), query.q?.trim() || undefined))
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
    .get("/audit", ({ query }) =>
      listAudit(db, parsePaging(query), { action: query.action || undefined, actorId: query.actorId || undefined }),
    )
    .get("/logs", ({ query }) => {
      const level = query.level || undefined;
      if (level !== undefined && !LOG_LEVELS.includes(level as LogLevel)) {
        throw new ApiError(400, "invalid_level", `level must be one of ${LOG_LEVELS.join(", ")}`);
      }
      return {
        items: readLogs({
          level: level as LogLevel | undefined,
          q: query.q || undefined,
          limit: logLimit(query.limit),
        }),
      };
    })
    .get("/settings", () => ({ items: listSettings(db) }))
    .put("/settings/:key", ({ params, body, user }) => {
      const { key } = params;
      if (!isSettingKey(key)) throw new ApiError(404, "not_found", `unknown setting ${key}`);
      const value = field(body, "value");
      if (value !== null && typeof value !== "string") {
        throw new ApiError(400, "invalid_value", "value must be a string or null");
      }
      try {
        setSetting({ db, secret }, key, value, user.id);
      } catch (e) {
        if (e instanceof InvalidSettingError) throw new ApiError(400, "invalid_value", e.message);
        throw new Error(`PUT /dev/settings/${key} failed: ${(e as Error).message}`, { cause: e });
      }
      // Key only: the value (possibly a secret) never enters the audit trail.
      recordAudit(db, { actorId: user.id, action: "settings.update", target: key, meta: { reset: value === null } });
      log.info(`[dev] setting ${key} ${value === null ? "reset" : "updated"} by ${user.id}`);
      return describeSetting(db, key);
    });
}
