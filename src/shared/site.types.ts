// Contract of the site management API under /api/panel (role ≥ admin). Errors are `{ error, message }`.
import type { AppStatus } from "./panel.types";

/** How the site's binary is run by pm2: directly (bun-linux-arm64-android) or through grun (glibc). */
export type SiteRuntime = "native" | "grun";

/** pm2 status of the site's app, or "not_deployed" when pm2 has no such process. */
export type SiteAppStatus = AppStatus | "not_deployed";

/** Item of GET /sites. `managed` false = adopted (pm2 entry hand-written, panel never touches it). */
export type Site = {
  name: string;
  port: number;
  hostnames: string[];
  database: string | null;
  runtime: SiteRuntime;
  managed: boolean;
  appStatus: SiteAppStatus;
  createdAt: string;
};

/** GET /sites/:name. `envKeys` = keys in the site's .env (values are never returned). */
export type SiteDetail = Site & {
  dir: string;
  envKeys: string[];
  /** `managed` = the panel created (and may delete) the DNS record. */
  dns: { hostname: string; managed: boolean }[];
};

/** Item of GET /sites/discovered: an ingress entry that belongs to no site (candidate for adopt). */
export type DiscoveredIngress = { hostname: string; port: number | null; app: string | null };

/** Body of POST /sites/check. */
export type SiteCheckRequest = { name: string; hostname: string; port?: number };

/** Field-level problem found by validation. */
export type SiteIssue = { field: "name" | "hostname" | "port"; code: string; message: string };

/** POST /sites/check response. */
export type SiteCheckResult = { ok: boolean; issues: SiteIssue[] };

/** Body of POST /sites (→ 202 { jobId }). `port` omitted = suggested port. */
export type SiteCreateRequest = {
  name: string;
  hostname: string;
  port?: number;
  database: boolean;
  env?: Record<string, string>;
};

/** Body of POST /sites/adopt (→ 201 Site). DB record only; `app` = existing pm2 app name. */
export type SiteAdoptRequest = { name: string; hostname: string; port: number; app?: string; runtime?: SiteRuntime };

/** Body of PUT /sites/:name/env (→ { envKeys }). */
export type SiteEnvUpdate = { set: Record<string, string>; unset: string[] };

/** 202 response of the job-starting endpoints. */
export type JobAccepted = { jobId: string };

export type JobKind = "site.create" | "site.delete" | "hostname.add" | "hostname.remove";
export type JobStatus = "running" | "succeeded" | "failed" | "rolled_back";
export type JobStepStatus = "pending" | "running" | "done" | "failed" | "rolled_back" | "skipped";

export type JobStep = { key: string; label: string; status: JobStepStatus; message: string | null };

/** GET /jobs/:id; GET /jobs?page&pageSize returns Page<Job> (newest first). */
export type Job = {
  id: string;
  kind: JobKind;
  target: string;
  status: JobStatus;
  steps: JobStep[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/** GET /integration: whether the phone's config files are wired for panel-managed sites. */
export type Integration = {
  ecosystemIncludesAppsJson: boolean;
  appsJsonExists: boolean;
  tunnelId: string | null;
  cloudflareTokenSet: boolean;
  issues: string[];
};
