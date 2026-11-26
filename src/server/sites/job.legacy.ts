// Reading job rows written by 0.2.x (before migration 0007): free-text errors and English step labels.
import type { JobError, JobKind, JobStep, JobStepKey } from "../../shared/site.types";

const SITE_DELETE_KEYS: Record<string, JobStepKey> = {
  apps: "apps_remove",
  pm2: "app_remove",
  database: "database_drop",
  folder: "folder_remove",
};
const COMMON_KEYS: Record<string, JobStepKey> = { env: "env_write", assemble: "stage", pm2: "app_remove" };
const DEPLOY_KINDS: JobKind[] = ["site.deploy", "site.rollback"];
const LEGACY_INTERRUPTED = "interrupted by panel restart";

/** Maps a 0.2.x step key to its 0.3.0 key; 0.3.0 keys come back unchanged. */
export function legacyStepKey(key: string, kind: JobKind): JobStepKey | (string & {}) {
  if (kind === "site.delete" && SITE_DELETE_KEYS[key]) return SITE_DELETE_KEYS[key];
  if (key === "restart") return DEPLOY_KINDS.includes(kind) ? "app_restart" : "tunnel_restart";
  if (key === "apps") return "apps_entry";
  return COMMON_KEYS[key] ?? key;
}

/** True for a step persisted before 0007: the 0.3.0 runner always writes `code` (null when none). */
export const isLegacyStep = (s: JobStep): boolean => s.code === undefined;

/** 0.2.x step → 0.3.0 shape: coded key, no code, old message as `detail`, old label as `legacyLabel`. */
export function legacyStep(s: JobStep, kind: JobKind): JobStep {
  return {
    key: legacyStepKey(s.key, kind),
    status: s.status,
    code: null,
    params: {},
    detail: s.message ?? null,
    log: [],
    startedAt: null,
    finishedAt: null,
    ...(s.label !== undefined ? { legacyLabel: s.label } : {}),
  };
}

/** Serializes a JobError into the text column `job.error`. */
export const encodeJobError = (e: JobError | null): string | null => (e === null ? null : JSON.stringify(e));

/** Reads `job.error`: 0.3.0 rows hold a JSON JobError, 0.2.x rows free English text. */
export function decodeJobError(text: string | null): JobError | null {
  if (text === null) return null;
  if (text.startsWith("{")) {
    try {
      const v = JSON.parse(text) as Partial<JobError>;
      if (typeof v.code === "string") return { code: v.code, params: v.params ?? {}, detail: v.detail ?? null };
    } catch {
      // Not JSON after all: a 0.2.x message that starts with "{" — read it as legacy text below.
    }
  }
  return { code: text === LEGACY_INTERRUPTED ? "interrupted" : "unexpected", params: {}, detail: text };
}
