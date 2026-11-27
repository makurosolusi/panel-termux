// Contract of the in-UI integration fixes (PLAN/06 §5.1): preview, apply, restore, checked pm2 restart.
import type { Integration, IntegrationCheckKey } from "./site.types";

/**
 * Integration fixes the panel can apply itself (0.4.0). `sites_dir_create` makes whatever of sites folder, apps.json and
 * ecosystem.config.js (shipped template) is missing; `apps_json_rebuild` rewrites an unparsable apps.json from the
 * panel's site list (backup + undo like the other file fixes).
 */
export type FixKey = "ecosystem_block" | "pm2_auto_exit" | "sites_dir_create" | "apps_json_rebuild";
/** Why the panel will not apply a fix (copy: setup.unfixable.*). */
export type FixBlockReason =
  | "not_config_js"
  | "ecosystem_missing"
  | "ecosystem_linked"
  | "too_large"
  | "not_utf8"
  | "ecosystem_unloadable"
  | "markers_broken"
  | "unknown_apps_json_use"
  | "run_script_missing"
  | "run_script_unknown"
  | "sites_dir_outside_home";
/** Per fix: which checks it resolves and whether it can run now. */
export type FixAvailability = { key: FixKey; checks: IntegrationCheckKey[] } & (
  | { available: true }
  | { available: false; reason: FixBlockReason }
);
/** Which file a change or backup belongs to. */
export type FixFile = "ecosystem" | "pm2_run" | "apps_json";
/** One hunk produced by the patcher itself (1-based lines of the current file). */
export type FixChange =
  | { kind: "add"; afterLine: number; lines: string[] }
  | { kind: "remove"; line: number; text: string };
/** Preview of one file; `sha` goes back in the apply request. */
export type FixFilePreview = { file: FixFile; path: string; sha: string; changes: FixChange[] };
/** What the change means, for the plain-language dialog. */
export type FixEffects = {
  /** Hand-written apps, unchanged, not restarted. */
  keepApps: string[];
  /** Panel sites pm2 will load (on next start). */
  addApps: string[];
  /** pm2-guard added. */
  guard: boolean;
  /** `...require('./apps.json')` removed. */
  oldSpread: boolean;
  /** pm2_auto_exit: takes effect when pm2 starts next. */
  appliesOnRestart: boolean;
  /** sites_dir_create: the folder made (null = it exists). */
  dir: string | null;
  /** sites_dir_create: path of the ecosystem.config.js written from the shipped template (null/absent = it exists). */
  newEcosystem?: string | null;
  /** sites_dir_create with a new ecosystem: apps running now that the new file does not list (they stop on restart). */
  stopApps?: string[];
};
/** POST /integration/fixes/:key/preview. */
export type FixPreview = { key: FixKey; files: FixFilePreview[]; effects: FixEffects };
/** Body of POST /integration/fixes/:key; `expect` = path → sha from the preview. */
export type FixApplyRequest = { expect: Record<string, string> };
/** Error codes of the fix endpoints. */
export type FixErrorCode =
  | "busy"
  | "changed"
  | "changed_during_fix"
  | "changed_since"
  | "validation_failed"
  | "not_fixable"
  | "disk_full"
  | "not_writable"
  | "not_found";
/** Latest panel backup of one file; `changedSince` = file edited after the fix (restore needs force). */
export type FixBackup = { id: string; file: FixFile; at: string; changedSince: boolean; affectedSites: string[] };
/** Result of the checked pm2 restart (F10). */
export type Pm2RestartResult = {
  ok: boolean;
  missing: string[];
  offerRestore: string | null;
  /** Missing apps the ecosystem no longer lists at all: no restore brings them back, only a new entry in the file. */
  notListed?: string[];
  integration: Integration;
};
/** Result of a fix or a restore. */
export type FixResult = {
  key: FixKey | "restore";
  outcome: "applied" | "unchanged" | "restored";
  /** Restore with `restart: true`. */
  restart: Pm2RestartResult | null;
  integration: Integration;
};
