import type { AuditActorKind } from "./audit.types";
import type { PanelMode, Problem } from "./panel.types";
import type { Role } from "./roles";

// Response/request types of the super_admin developer API under /api/dev (PLAN/05 §3.1). Dates are ISO-8601 strings.
// Fields marked "0.3.0" are optional until their producers land, "0.2.x" ones go away; both settle in W7 (schedule §1.4).

/** Paginated list envelope (`page` from 1, `pageSize` default 20, max 100). */
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

/** Error body for 4xx responses, e.g. `{ error: "invalid_email", message: "..." }`, plus ApiError `extra` fields. */
export type ApiErrorBody = { error: string; message?: string };

/** Verdict of one health check, and of the whole health page. */
export type HealthStatus = "ok" | "warn" | "fail";

/** Panel-only checks outside Problem[] (PLAN/05 K8). */
export type PanelCheckKey = "errors" | "sampler" | "backup_scheduler" | "fake_on_https";
/** One panel-only check of GET /api/dev/health. */
export type PanelCheck = { key: PanelCheckKey; status: HealthStatus; value: number | string | null };

/** GET /api/dev/health. `requestsPerMinute` = API requests in the last 60 s; `errorCount5m` = all 5xx in 5 min. */
export type DevHealth = {
  /** 0.3.0. Worst of problems (without info codes) + checks. */
  verdict?: HealthStatus;
  /** 0.3.0 */
  checkedAt?: string;
  /** 0.3.0. Latest sampler snapshot (PLAN/02), including kind "security" (PLAN/04). */
  problems?: Problem[];
  /** 0.3.0. Codes in `problems` that never count for the verdict, e.g. "backup_not_configured", "access_not_seen". */
  infoCodes?: string[];
  /** 0.3.0 */
  checks?: PanelCheck[];
  /** 0.3.0 */
  mode?: PanelMode;
  /** 0.3.0. monitor.status() (B5). */
  sampledAt?: string | null;
  /** 0.3.0. backupScheduler.lastTickAt() (B5). */
  backupTickAt?: string | null;
  version: string;
  /** Shown in Detail only, not a check. */
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
  /** 0.3.0. Only 500s (basis of the `errors` check). */
  unhandled5m?: number;
  counts: { users: number; sessions: number };
  /** 0.3.0 */
  runningJob?: { id: string; kind: string; target: string; startedAt: string } | null;
  /** 0.3.0. null = unreadable (key_mismatch). */
  backup?: { configured: boolean; nextRunAt: string | null } | null;
  /** 0.3.0. At most 5 error entries, newest first. */
  lastErrors?: DevLogEntry[];
};

/** Item of GET /api/dev/users (also the PATCH /users/:id response). `lastSeenAt` has day resolution in the UI (K9). */
export type DevUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  createdAt: string;
  lastSeenAt: string | null;
  /** 0.3.0 */
  activeSessions?: number;
  isEnvSuperAdmin: boolean;
};

/** Roles assignable via PATCH /api/dev/users/:id (super_admin comes from env only). */
export type AssignableRole = Exclude<Role, "super_admin">;

/** Body of PATCH /api/dev/users/:id */
export type DevUserPatch = { role: AssignableRole };

/** Small user reference (actor); null when that user was deleted. */
export type UserRef = { id: string; name: string };

/** Item of GET /api/dev/audit, newest first (flat shape, PLAN/04 §3.3). */
export type DevAuditEntry = {
  id: number;
  at: string;
  /** Live user; null when deleted or system. */
  actor: UserRef | null;
  /** 0.3.0 */
  actorKind?: AuditActorKind;
  /** 0.3.0. Name at event time (survives deletion). */
  actorLabel?: string | null;
  /** 0.3.0 */
  actorEmail?: string | null;
  /** 0.3.0. actorKind "user" but the account is gone. */
  actorDeleted?: boolean;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  /** 0.3.0 */
  ipMasked?: string | null;
  /** 0.3.0 */
  userAgent?: string | null;
  /** 0.3.0 */
  requestId?: string | null;
};

/** Log severity, least severe first. GET /api/dev/logs?level=X returns entries at X or more severe. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** All log levels, least severe first. */
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** One in-memory log line. */
export type DevLogEntry = { at: string; level: LogLevel; msg: string };

/** GET /api/dev/logs?level&q&limit (limit default 200, max 1000). */
export type DevLogs = { items: DevLogEntry[] };

/**
 * Every registered setting key, in registry order (DECISIONS B8: one list). The server registry (validators) and the
 * web labels (`id.settings.ts`) both `satisfies Record<SettingKey, …>`.
 */
export const SETTING_KEYS = [
  "cloudflare.api_token",
  "cloudflare.account_id",
  "sites.dir",
  "sites.port_range",
  "panel.protected_services",
  "backup.s3_endpoint",
  "backup.s3_bucket",
  "backup.s3_region",
  "backup.s3_access_key_id",
  "backup.s3_secret_access_key",
  "backup.prefix",
  "backup.hour",
  "backup.retention_days",
  "backup.keep_min_runs",
  "backup.include_secrets",
  "backup.max_item_mb",
  "audit.retention_days",
  "alerts.enabled",
  "alerts.telegram_bot_token",
  "alerts.telegram_chat_id",
  "alerts.min_severity",
  "monitor.sample_interval_sec",
  "monitor.battery_warn_percent",
] as const;
/** A registered setting key. */
export type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * One runtime setting. `value` is the effective value (stored or default) for non-secret settings and always null
 * for secret ones; `isSet` = an explicit value is stored.
 */
export type DevSetting = {
  /** A SettingKey; typed `string` until W7 because 0.2.x test fixtures use free keys. */
  key: string;
  /** 0.2.x English label; 0.3.0 labels live only in the web (B8). */
  label: string;
  /** 0.2.x, like `label`. */
  description: string;
  secret: boolean;
  value: string | null;
  /** 0.3.0. Built-in default, for the "Bawaan" state. */
  default?: string | null;
  isSet: boolean;
  /** 0.3.0. false = secret stored but not decryptable with the current data key. */
  readable?: boolean;
  updatedAt: string | null;
};

/** GET /api/dev/settings */
export type DevSettings = { items: DevSetting[] };

/** PATCH /api/dev/settings (atomic). null = back to default / delete the secret. 1–30 keys. */
export type DevSettingsPatch = { values: Partial<Record<SettingKey, string | null>> };

/** 400 body of PATCH /api/dev/settings. "unknown" = key not registered. */
export type DevSettingsInvalid = {
  error: "invalid_value" | "invalid_body";
  message: string;
  fields: Partial<Record<string, "invalid" | "empty" | "unknown">>;
};

/** 0.2.x body of PUT /api/dev/settings/:key (null resets to the default); the route goes away in W1 (B8). */
export type DevSettingPut = { value: string | null };

/** Outcome of POST /api/dev/cloudflare/verify (stored token). */
export type CloudflareVerifyCode = "ok" | "not_set" | "inactive" | "no_zones" | "api_error" | "key_mismatch";
/** POST /api/dev/cloudflare/verify response. */
export type CloudflareVerify = { ok: boolean; code: CloudflareVerifyCode; zones: number | null; detail: string | null };

/** Key of one GET /api/dev/setup checklist item. `adopt_sites` is 0.2.x (replaced by `first_site`). */
export type SetupItemKey =
  | "access"
  | "secret_saved"
  | "backup"
  | "cloudflare_token"
  | "apps_json"
  | "first_site"
  | "admins"
  | "adopt_sites";

/** How much an onboarding item matters. */
export type SetupLevel = "required" | "recommended" | "optional";

/** One first-run setup step. */
export type SetupItem = {
  key: SetupItemKey;
  /** 0.3.0 */
  level?: SetupLevel;
  done: boolean;
  /** 0.3.0. manual = done because it was ticked. */
  source?: "auto" | "manual";
  /** 0.3.0. Backup only: stored but no successful run yet. */
  needsFirstRun?: boolean;
  /** 0.3.0. false: access while APP_BASE_URL is not https. */
  applicable?: boolean;
  /** 0.2.x short English pointer to where it is done. */
  hint?: string;
};

/** GET /api/dev/setup */
export type DevSetup = {
  items: SetupItem[];
  /** 0.3.0 */
  dismissedAt?: string | null;
  /** 0.3.0. Every applicable required + recommended item done. */
  complete?: boolean;
};
/** Body of PUT /api/dev/setup/items/:key. */
export type SetupManualPut = { done: boolean };
/** Body of PUT /api/dev/setup/dismiss. */
export type SetupDismissPut = { dismissed: boolean };
