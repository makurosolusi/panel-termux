import { LOG_LEVELS, type LogLevel, type SettingKey } from "../../shared/dev.types";
import { listAudit } from "../audit.service";
import type { Auth } from "../auth/auth.service";
import { assertFresh, roleGuard } from "../auth/role.guard";
import type { Db } from "../db/client";
import { getHealth } from "../dev/health.service";
import { changeRole, deleteUser, listUsers } from "../dev/users.service";
import { log, readLogs } from "../log.service";
import {
  changedSettingKeys,
  InvalidSettingError,
  isSettingKey,
  KeyMismatchError,
  listSettings,
  MAX_SETTINGS_BATCH,
  setSettings,
} from "../settings.service";
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

// Changing where backups go, or starting to ship secrets in them, needs a fresh sign-in (PLAN/04 §3.5).
const FRESH_KEYS: readonly SettingKey[] = ["backup.s3_endpoint", "backup.s3_bucket", "backup.prefix"];

/** Validates the PATCH /settings body shape; values are validated later by setSettings. */
function parseSettingsPatch(body: unknown): Partial<Record<SettingKey, string | null>> {
  const values = field(body, "values");
  const bad = (message: string, fields: Record<string, string> = {}) =>
    new ApiError(400, "invalid_body", message, { fields });
  if (typeof values !== "object" || values === null || Array.isArray(values))
    throw bad('body must be { "values": { key: string | null } }');
  const entries = Object.entries(values);
  if (entries.length === 0 || entries.length > MAX_SETTINGS_BATCH)
    throw bad(`values must hold 1-${MAX_SETTINGS_BATCH} keys`);
  const fields: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!isSettingKey(k)) fields[k] = "unknown";
    else if (v !== null && typeof v !== "string") fields[k] = "invalid";
  }
  if (Object.keys(fields).length) throw bad("unknown keys or values that are not a string or null", fields);
  return values as Partial<Record<SettingKey, string | null>>;
}

/** super_admin developer API under /dev (users, audit, logs, settings, health). */
export function createDevRoutes(auth: Auth, { db, secret, superAdmins, dataDir }: DevDeps) {
  const ctx = (actorId: string) => ({ db, superAdmins, actorId });
  return roleGuard(auth, "/dev", "super_admin")
    .onError(({ error, code, status }) => {
      if (error instanceof ApiError) return status(error.status, error.body);
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
    .get("/settings", () => ({ items: listSettings({ db, secret }) }))
    .patch("/settings", ({ body, user, session }) => {
      const values = parseSettingsPatch(body);
      const changed = changedSettingKeys(db, values);
      if (
        changed.some((k) => FRESH_KEYS.includes(k)) ||
        (changed.includes("backup.include_secrets") && values["backup.include_secrets"]?.trim() === "on")
      )
        assertFresh(session);
      try {
        setSettings({ db, secret }, values, user.id);
      } catch (e) {
        if (e instanceof InvalidSettingError) throw new ApiError(400, "invalid_value", e.message, { fields: e.fields });
        if (e instanceof KeyMismatchError) throw new ApiError(409, "key_mismatch", e.message);
        throw new Error(`PATCH /dev/settings failed: ${(e as Error).message}`, { cause: e });
      }
      // Keys only: values (possibly secrets) never reach the log.
      log.info(`[dev] settings ${changed.join(", ") || "(unchanged)"} saved by ${user.id}`);
      return { items: listSettings({ db, secret }) };
    });
}
