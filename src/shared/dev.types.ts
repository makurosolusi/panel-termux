import type { Role } from "./roles";

// Response/request types of the super_admin developer API under /api/dev. Dates are ISO-8601 strings.

/** Paginated list envelope (`page` from 1, `pageSize` default 20, max 100). */
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

/** Error body for 4xx responses, e.g. `{ error: "invalid_email", message: "..." }`. */
export type ApiErrorBody = { error: string; message?: string };

/** GET /api/dev/health. `requestsPerMinute` = API requests in the last 60 s; `errorCount5m` = 5xx in 5 min. */
export type DevHealth = {
  version: string;
  schemaVersion: string;
  startedAt: string;
  uptimeSec: number;
  memory: { rssMb: number; heapUsedMb: number };
  db: { sizeBytes: number };
  dataDir: { freeBytes: number; totalBytes: number };
  runtime: { bun: string; node: string; platform: string; arch: string };
  cpuCores: number;
  requestsPerMinute: number;
  errorCount5m: number;
  counts: { users: number; sessions: number };
};

/** Item of GET /api/dev/users (also the PATCH /users/:id response). */
export type DevUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  createdAt: string;
  lastSeenAt: string | null;
  isEnvSuperAdmin: boolean;
};

/** Roles assignable via PATCH /api/dev/users/:id (super_admin comes from env only). */
export type AssignableRole = Exclude<Role, "super_admin">;

/** Body of PATCH /api/dev/users/:id */
export type DevUserPatch = { role: AssignableRole };

/** Small user reference (actor); null when that user was deleted. */
export type UserRef = { id: string; name: string };

/** Item of GET /api/dev/audit, newest first. */
export type DevAuditEntry = {
  id: number;
  at: string;
  actor: UserRef | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
};

/** Log severity, least severe first. GET /api/dev/logs?level=X returns entries at X or more severe. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** All log levels, least severe first. */
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** One in-memory log line. */
export type DevLogEntry = { at: string; level: LogLevel; msg: string };

/** GET /api/dev/logs?level&q&limit (limit default 200, max 1000), newest first. */
export type DevLogs = { items: DevLogEntry[] };

/**
 * One runtime setting. `value` is the effective value (stored or default) for non-secret settings and
 * always null for secret ones; `isSet` = an explicit value is stored.
 */
export type DevSetting = {
  key: string;
  label: string;
  description: string;
  secret: boolean;
  value: string | null;
  isSet: boolean;
  updatedAt: string | null;
};

/** GET /api/dev/settings */
export type DevSettings = { items: DevSetting[] };

/** Body of PUT /api/dev/settings/:key (null resets to the default). */
export type DevSettingPut = { value: string | null };

/** Key of one GET /api/dev/setup checklist item. */
export type SetupItemKey = "cloudflare_token" | "backup" | "apps_json" | "adopt_sites" | "admins";

/** One first-run setup step; `hint` = short English pointer to where it is done. */
export type SetupItem = { key: SetupItemKey; done: boolean; hint: string };

/** GET /api/dev/setup */
export type DevSetup = { items: SetupItem[] };
