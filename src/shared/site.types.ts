// Contract of the site management API under /api/panel (role ≥ admin, PLAN/03 §3.1). Errors: { error, message, ...extra }.
// Fields marked "0.3.0" are optional until their producers land, "0.2.x" ones go away; both settle in W7 (schedule §1.4).
import type { JobKind, JobParams } from "./job.types";
import type { AppStatus } from "./panel.types";

export type * from "./job.types";

/** How the site's binary runs: directly (Android linker / static) or through grun (glibc). */
export type SiteRuntime = "native" | "grun";
/** What a hand-written pm2 entry runs (pm_exec_path basename): grun/glibc-runner, the binary, or anything else. */
export type ScriptRuntime = SiteRuntime | "other";
/** pm2 status of the site's app, or "not_deployed" when pm2 has no such process. */
export type SiteAppStatus = AppStatus | "not_deployed";

/** Allowed env key (one source for client and server). */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Bounds and default of a site's health check timeout (seconds). */
export const HEALTH_TIMEOUT_MIN_SEC = 10;
export const HEALTH_TIMEOUT_MAX_SEC = 300;
export const HEALTH_TIMEOUT_DEFAULT_SEC = 60;

/** pm2 app name reserved for the keep-alive guard of fresh phones: never a site, hidden from Aplikasi/adopt (B24). */
export const PM2_GUARD_NAME = "pm2-guard";
/** PLAN/03 spelling of PM2_GUARD_NAME. */
export const PM2_GUARD_APP = PM2_GUARD_NAME;

/**
 * Binary files the panel keeps in a site folder (live, previous, staged, and swap leftovers). Backups skip exactly
 * these names at the top of each site folder (PLAN/04 K20), never at deeper levels.
 */
export const SITE_BINARY_NAMES: readonly string[] = ["app", "app.prev", "app.new", ".app.prev.drop", ".app.swap"];

/** What counts as a healthy answer of the site's health path. */
export type HealthExpect = "lt500" | "2xx3xx";
/** Per-site health check used after deploy/restart. */
export type SiteHealthConfig = { path: string; expect: HealthExpect; timeoutSec: number };

type DeployKindRef = "deploy" | "rollback";
type DeployStatusRef = "running" | "succeeded" | "failed" | "rolled_back" | "interrupted";

/** Item of GET /sites. `managed` false = adopted (pm2 entry hand-written, panel never touches it). */
export type Site = {
  name: string;
  port: number;
  hostnames: string[];
  database: string | null;
  runtime: SiteRuntime;
  managed: boolean;
  /** 0.3.0. pm2 process name (site.app ?? site.name). */
  app?: string;
  /** "unknown" when pm2 is unavailable (never "not_deployed" in that case). */
  appStatus: SiteAppStatus;
  /** 0.3.0 */
  restarts?: number | null;
  /** 0.3.0 */
  lastDeploy?: { at: string; kind: DeployKindRef; status: DeployStatusRef; actorName: string | null } | null;
  createdAt: string;
};

/** A binary file of a site, matched against deploy rows by (ino, mtimeMs, size). */
export type BinaryInfo = {
  sizeBytes: number;
  modifiedAt: string;
  /** Deploy row that put exactly this file in place; null = "Versi tanpa catatan". */
  deployId: string | null;
  sha256: string | null;
  fileName: string | null;
  runtime: SiteRuntime | null;
};

/** The one job running now (sites share one lock). */
export type ActiveJob = { id: string; kind: JobKind; target: string; startedAt: string };

/** GET /sites/:name. Env values are never returned. */
export type SiteDetail = Site & {
  dir: string;
  envKeys: string[];
  /** 0.3.0. Managed: PORT (+ DATABASE_URL when database). Adopted: []. */
  lockedEnvKeys?: string[];
  /** 0.3.0. Adopted: keys set in the pm2 entry's env (they override .env; names only). Managed: []. */
  pm2EnvKeys?: string[];
  /** 0.3.0 */
  restartPending?: boolean;
  /** `managed` = the panel created (and may delete) the DNS record. */
  dns: { hostname: string; managed: boolean }[];
  /** 0.3.0 */
  health?: SiteHealthConfig;
  /** 0.3.0 */
  binary?: { live: BinaryInfo | null; previous: BinaryInfo | null };
  /** 0.3.0 */
  scriptRuntime?: ScriptRuntime | null;
  /** 0.3.0 */
  deployBlocker?: "integration" | "no_folder" | "pm2_not_running" | null;
  /** 0.3.0 */
  activeJob?: ActiveJob | null;
};

/**
 * pm2 has no process although the site has a binary (D-W9-3): adopted (it ran when adopted), a live binary, or a last
 * deploy that left one in place. Only a site with none of these is "Belum di-deploy". One rule for server and web.
 */
export const missingFromPm2 = (
  s: Pick<Site, "appStatus" | "managed" | "lastDeploy"> & Partial<Pick<SiteDetail, "binary">>,
): boolean =>
  s.appStatus === "not_deployed" &&
  (!s.managed || Boolean(s.binary?.live) || ["succeeded", "rolled_back"].includes(s.lastDeploy?.status ?? ""));

/** GET /sites/discovered (0.3.0; 0.2.x returns DiscoveredIngress[]). */
export type Discovered = { ingress: DiscoveredIngress[]; apps: AdoptCandidateApp[] };

/** An ingress entry that belongs to no site (candidate for adopt). */
export type DiscoveredIngress = {
  hostname: string;
  port: number | null;
  /** 0.2.x: pm2 app whose port matches. */
  app?: string | null;
  /** 0.3.0. Points at the panel itself. */
  self?: boolean;
  /** 0.3.0. pm2 app it matches. */
  match?: string | null;
  /** 0.3.0 */
  blockers?: ("self" | "no_port" | "wildcard")[];
};

/** A pm2 app that could be adopted as a site. */
export type AdoptCandidateApp = {
  name: string;
  status: AppStatus;
  cwd: string | null;
  port: number | null;
  portSource: "pm2_env" | "pm2_args" | "dotenv" | null;
  runtime: SiteRuntime | null;
  scriptRuntime: ScriptRuntime;
  blockers: ("outside_sites_dir" | "no_binary" | "invalid_binary" | "pm2_module" | "name_invalid")[];
  warnings: ("runtime_script_mismatch" | "script_other" | "port_unknown" | "port_mismatch")[];
};

/** Body of POST /sites/adopt (→ 201 SiteDetail). 0.3.0: `{ hostname, app, name? }`; port/runtime come from pm2. */
export type SiteAdoptRequest = {
  hostname: string;
  app?: string;
  /** Optional in 0.3.0 (defaults to the app name); required until the web adopt dialog is rebuilt. */
  name: string;
  /** 0.2.x */
  port?: number;
  /** 0.2.x */
  runtime?: SiteRuntime;
};

/** Body of POST /sites/check. */
export type SiteCheckRequest = {
  name?: string;
  hostname: string;
  /** 0.3.0 */
  extraHostnames?: string[];
  port?: number;
  /** 0.3.0 */
  database?: boolean;
  /** 0.3.0 */
  scope?: "site" | "hostname";
};

/** Field-level validation problem of a site request. */
export type SiteIssueCode =
  | "name_invalid"
  | "name_taken"
  | "name_reserved"
  | "name_folder_exists"
  | "name_database_exists"
  | "name_leftover"
  | "hostname_invalid"
  | "hostname_in_use"
  | "hostname_self"
  | "hostname_duplicate"
  | "hostname_zone_missing"
  | "hostname_dns_conflict"
  | "port_invalid"
  | "port_out_of_range"
  | "port_in_use"
  | "port_panel";
/** Non-blocking note about a hostname. */
export type SiteNoteCode = "dns_same_tunnel" | "dns_owned" | "dns_token_missing" | "dns_check_failed";

/** Field-level problem found by validation. */
export type SiteIssue = {
  field: "name" | "hostname" | "port";
  /** 0.3.0 */
  hostname?: string;
  /** 0.3.0 values are SiteIssueCode; 0.2.x producers still send free codes. */
  code: SiteIssueCode | (string & {});
  /** 0.3.0 */
  params?: JobParams;
  /** 0.2.x English text; still required by the web until its issue copy comes from `code` (W7: removed). */
  message: string;
};
/** Non-blocking note found by validation. */
export type SiteNote = { field: "hostname"; hostname: string; code: SiteNoteCode; params: JobParams };
/** POST /sites/check response. */
export type SiteCheckResult = {
  ok: boolean;
  issues: SiteIssue[];
  /** 0.3.0 */
  notes?: SiteNote[];
};

/** Body of POST /sites (→ 202 { jobId }). `port` omitted = suggested port. */
export type SiteCreateRequest = {
  name: string;
  hostname: string;
  /** Extra domains added in the same job (one cloudflared restart). Max 4. */
  extraHostnames?: string[];
  port?: number;
  database: boolean;
  env?: Record<string, string>;
};

/** Body of PUT /sites/:name/env. `restart` (0.3.0) = run job `site.env` instead of only writing the file. */
export type SiteEnvUpdate = { set: Record<string, string>; unset: string[]; restart?: boolean };
/** 200 response of PUT /sites/:name/env without restart. */
export type SiteEnvSaved = { envKeys: string[]; restartPending: boolean };
/** Body of PATCH /sites/:name/settings. */
export type SiteSettingsUpdate = { health?: Partial<SiteHealthConfig> };
/** POST /sites/:name/hostnames body: 1–5 domains, one job, one cloudflared restart. */
export type HostnamesAddRequest = { hostnames: string[] };

/** GET /sites/:name/health. */
export type HealthProbe = { ok: boolean; status: number | null; ms: number | null; path: string; checkedAt: string };

/** One integration check of GET /integration. */
export type IntegrationCheckKey =
  | "sites_dir"
  | "apps_json"
  | "ecosystem_file"
  | "ecosystem_loads"
  | "ecosystem_spreads_apps_json"
  | "snippet_current"
  | "apps_entries_runnable"
  | "pm2_runtime"
  | "pm2_auto_exit"
  | "pm2_guard"
  | "tunnel"
  | "cloudflare_token";
/** Result of one integration check. */
export type IntegrationCheck = {
  key: IntegrationCheckKey;
  state: "ok" | "warning" | "error";
  params: JobParams;
  detail: string | null;
};
/** GET /integration: whether the phone's config files are wired for panel-managed sites. */
export type Integration = {
  /** 0.3.0. sites_dir, apps_json, ecosystem_loads, ecosystem_spreads_apps_json, snippet_current, pm2_runtime, tunnel ok. */
  ready?: boolean;
  /** 0.3.0 */
  checks?: IntegrationCheck[];
  /** 0.3.0 */
  snippet?: string;
  /** 0.3.0 */
  ecosystemPath?: string;
  /** 0.3.0 */
  appsJsonPath?: string;
  /** 0.3.0 */
  appNames?: string[];
  /** 0.3.0 */
  checkedAt?: string;
  /** 0.2.x */
  ecosystemIncludesAppsJson: boolean;
  /** 0.2.x */
  appsJsonExists: boolean;
  /** 0.2.x */
  tunnelId: string | null;
  /** 0.2.x */
  cloudflareTokenSet: boolean;
  /** 0.2.x */
  issues: string[];
};
