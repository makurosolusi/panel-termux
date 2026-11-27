// `panel doctor --json` contract (PLAN/07 §3.1, §3.2), frozen at gate G0. Pure types: no src/server imports.
import type { JobParams } from "./job.types";
import type { IntegrationCheckKey } from "./site.types";

/** Version of the `--json` shape; bump on any breaking change. */
export const DOCTOR_SCHEMA = 1;

/** Outcome of one check; only `error` makes doctor exit 1. */
export type DoctorState = "ok" | "warning" | "error" | "info";

/** Output group, in print order. `situs` = the Persiapan card checks. */
export type DoctorGroup = "termux" | "paket" | "layanan" | "panel" | "situs" | "tunnel" | "boot" | "manual";

/** Where the fix lives: `init` (0.5.1+), the panel UI, a manual command, a `panel docs` topic, or nothing. */
export type DoctorAction = "init" | "ui" | "manual" | "docs" | null;

/** Bootstrap check keys (PLAN/07 §3.1); `situs` uses IntegrationCheckKey unchanged. */
export type DoctorBootstrapKey =
  | "arch_arm64"
  | "termux_prefix"
  | "termux_source"
  | "disk_free"
  | "pkg_manager_apt"
  | "app_termux_boot"
  | "app_termux_api"
  | "pkg_termux_services"
  | "pkg_cloudflared"
  | "node"
  | "pm2"
  | "pkg_postgresql"
  | "pkg_termux_api"
  | "pkg_held"
  | "postgres_major"
  | "service_daemon"
  | "svc_panel"
  | "svc_pm2"
  | "svc_cloudflared"
  | "svc_postgres"
  | "cloudflared_down_file"
  | "cloudflared_run_script"
  | "postgres_initdb"
  | "binary_installed"
  | "panel_instances"
  | "env_complete"
  | "env_valid"
  | "env_extra_files"
  | "data_dir_private"
  | "panel_health"
  | "cf_cert"
  | "cf_config"
  | "cf_panel_ingress"
  | "panel_public"
  | "termux_boot_script"
  | "android_settings"
  | "cloudflare_access";

/** Every stable doctor key. */
export type DoctorKey = DoctorBootstrapKey | IntegrationCheckKey;

/** One printed/JSON check. `params` never holds secret values (same rule as the integration API). */
export type DoctorCheck = {
  group: DoctorGroup;
  key: DoctorKey;
  state: DoctorState;
  label: string;
  action: DoctorAction;
  hint: string | null;
  params: JobParams;
};

/** Whole stdout of `panel doctor --json`; `ok` = no `error` check. */
export type DoctorReport = {
  schema: typeof DOCTOR_SCHEMA;
  panelVersion: string;
  mode: "termux" | "fake";
  ok: boolean;
  summary: Record<DoctorState, number>;
  checks: DoctorCheck[];
};
