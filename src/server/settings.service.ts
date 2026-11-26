import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { DevSetting } from "../shared/dev.types";
import { decryptSecret, encryptSecret } from "./crypto.service";
import type { Db } from "./db/client";
import { setting } from "./db/schema";

/** What settings functions need: the DB and the data secret (for encrypting secret values). */
export type SettingsDeps = { db: Db; secret: string };

type SettingDef = {
  label: string;
  description: string;
  secret: boolean;
  default: string | null;
  /** Returns an error message for an invalid (already trimmed) value, null when valid. */
  validate: (v: string) => string | null;
  /** Turns the stored/default value into what callers use (e.g. expands `~`). */
  resolve?: (v: string) => string;
};

const MIN_UNPRIVILEGED_PORT = 1024;
const MAX_PORT = 65535;
const CF_TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
const CF_ACCOUNT_RE = /^[0-9a-f]{32}$/i;
const PORT_RANGE_RE = /^(\d+)-(\d+)$/;
const SERVICE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_PATH_LEN = 4096;

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_RE = /^[a-z0-9-]{1,32}$/;
const S3_KEY_RE = /^[A-Za-z0-9+/=_-]{8,256}$/;
const PREFIX_RE = /^[A-Za-z0-9._-][A-Za-z0-9._/-]*\/$/;
const MAX_PREFIX_LEN = 256;
const LAST_HOUR = 23;
const MAX_RETENTION_DAYS = 365;

const intIn = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;

/** http(s) origin only: no credentials in the URL, no path/query (the bucket goes in the path). */
function validateEndpoint(v: string): string | null {
  const bad =
    "must be an http(s) URL without credentials, path or query, e.g. https://<account>.r2.cloudflarestorage.com";
  try {
    const u = new URL(v);
    const ok =
      (u.protocol === "https:" || u.protocol === "http:") &&
      !u.username &&
      !u.password &&
      (u.pathname === "/" || u.pathname === "") &&
      !u.search &&
      !u.hash;
    return ok ? null : bad;
  } catch {
    return bad; // URL() throws on unparseable input; that is exactly the invalid case.
  }
}

const expandHome = (p: string) => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);

/** Typed registry of runtime settings editable in /dev. */
export const SETTINGS = {
  "cloudflare.api_token": {
    label: "Cloudflare API token",
    description: "API token with Zone:DNS:Edit permission, used to create DNS records for sites.",
    secret: true,
    default: null,
    validate: (v) => (CF_TOKEN_RE.test(v) ? null : "must be 20-200 characters of A-Z, a-z, 0-9, _ or -"),
  },
  "cloudflare.account_id": {
    label: "Cloudflare account ID",
    description: "32-character hex account ID from the Cloudflare dashboard.",
    secret: false,
    default: null,
    validate: (v) => (CF_ACCOUNT_RE.test(v) ? null : "must be 32 hex characters"),
  },
  "sites.dir": {
    label: "Sites directory",
    description: "Directory holding hosted sites. `~` expands to the panel user's HOME.",
    secret: false,
    default: "~/sites",
    validate: (v) =>
      (v.startsWith("/") || v === "~" || v.startsWith("~/")) && v.length <= MAX_PATH_LEN && !v.includes("\0")
        ? null
        : "must be an absolute path or start with ~/",
    resolve: expandHome,
  },
  "sites.port_range": {
    label: "Sites port range",
    description: "Local ports assigned to sites, as `from-to`.",
    secret: false,
    default: "3001-3999",
    validate: (v) => {
      const m = v.match(PORT_RANGE_RE);
      const [a, b] = [Number(m?.[1]), Number(m?.[2])];
      return m && MIN_UNPRIVILEGED_PORT < a && a < b && b < MAX_PORT + 1
        ? null
        : `must be a-b with ${MIN_UNPRIVILEGED_PORT} < a < b <= ${MAX_PORT}`;
    },
  },
  "panel.protected_services": {
    label: "Protected services",
    description: "Comma-separated runit services the panel refuses to stop.",
    secret: false,
    default: "sshd,cloudflared,panel",
    validate: (v) =>
      v.split(",").every((s) => SERVICE_NAME_RE.test(s.trim()))
        ? null
        : "must be a comma-separated list of service names (A-Z, a-z, 0-9, . _ -)",
  },
  "backup.s3_endpoint": {
    label: "Backup S3 endpoint",
    description: "S3-compatible endpoint, e.g. https://<account>.r2.cloudflarestorage.com (path-style).",
    secret: false,
    default: null,
    validate: validateEndpoint,
  },
  "backup.s3_bucket": {
    label: "Backup bucket",
    description: "Bucket that receives the backups.",
    secret: false,
    default: null,
    validate: (v) => (BUCKET_RE.test(v) ? null : "must be 3-63 characters of a-z, 0-9, . or -"),
  },
  "backup.s3_region": {
    label: "Backup S3 region",
    description: "S3 region; Cloudflare R2 uses `auto`.",
    secret: false,
    default: "auto",
    validate: (v) => (REGION_RE.test(v) ? null : "must be 1-32 characters of a-z, 0-9 or -"),
  },
  "backup.s3_access_key_id": {
    label: "Backup S3 access key ID",
    description: "Access key ID of an API token with write access to the bucket.",
    secret: true,
    default: null,
    validate: (v) => (S3_KEY_RE.test(v) ? null : "must be 8-256 characters of A-Z, a-z, 0-9, + / = _ -"),
  },
  "backup.s3_secret_access_key": {
    label: "Backup S3 secret access key",
    description: "Secret access key belonging to the access key ID.",
    secret: true,
    default: null,
    validate: (v) => (S3_KEY_RE.test(v) ? null : "must be 8-256 characters of A-Z, a-z, 0-9, + / = _ -"),
  },
  "backup.prefix": {
    label: "Backup key prefix",
    description: "Object key prefix; retention only ever deletes keys under it. Must end with /.",
    secret: false,
    default: "panel-termux/",
    validate: (v) =>
      PREFIX_RE.test(v) && v.length <= MAX_PREFIX_LEN && !v.includes("//") && !v.split("/").includes("..")
        ? null
        : "must be a relative key prefix of A-Z, a-z, 0-9, . _ - / ending with /",
  },
  "backup.hour": {
    label: "Backup hour",
    description: "Local hour (0-23) of the daily backup, or `off`.",
    secret: false,
    default: "3",
    validate: (v) => (v === "off" || intIn(v, 0, LAST_HOUR) ? null : "must be an hour 0-23 or off"),
  },
  "backup.retention_days": {
    label: "Backup retention (days)",
    description: "Backups older than this many days are deleted after each run.",
    secret: false,
    default: "14",
    validate: (v) => (intIn(v, 1, MAX_RETENTION_DAYS) ? null : `must be a whole number 1-${MAX_RETENTION_DAYS}`),
  },
} satisfies Record<string, SettingDef>;

/** A registered setting key. */
export type SettingKey = keyof typeof SETTINGS;

/** Whether `k` is a registered setting key. */
export const isSettingKey = (k: string): k is SettingKey => Object.hasOwn(SETTINGS, k);

/** Thrown by setSetting for a value rejected by the key's validator. */
export class InvalidSettingError extends Error {}

const defOf = (key: SettingKey): SettingDef => SETTINGS[key];

const rowOf = (db: Db, key: SettingKey) => db.select().from(setting).where(eq(setting.key, key)).get();

/** Effective value of `key` (decrypted if secret, else default; resolved), or null when unset with no default. */
export function getSetting({ db, secret }: SettingsDeps, key: SettingKey): string | null {
  const def = defOf(key);
  const row = rowOf(db, key);
  let value = def.default;
  if (row) {
    try {
      value = def.secret ? decryptSecret(secret, row.value) : row.value;
    } catch (e) {
      throw new Error(`getSetting ${key}: ${(e as Error).message}`, { cause: e });
    }
  }
  return value !== null && def.resolve ? def.resolve(value) : value;
}

/** Public view of one setting; secret values are never included. */
export function describeSetting(db: Db, key: SettingKey): DevSetting {
  const def = defOf(key);
  const row = rowOf(db, key);
  return {
    key,
    label: def.label,
    description: def.description,
    secret: def.secret,
    value: def.secret ? null : (row?.value ?? def.default),
    isSet: row !== undefined,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

/** All settings in registry order. */
export const listSettings = (db: Db): DevSetting[] =>
  (Object.keys(SETTINGS) as SettingKey[]).map((k) => describeSetting(db, k));

/** Stores `value` (trimmed, validated, encrypted if secret) or deletes the row when null (back to default). */
export function setSetting({ db, secret }: SettingsDeps, key: SettingKey, value: string | null, actorId: string): void {
  if (value === null) {
    db.delete(setting).where(eq(setting.key, key)).run();
    return;
  }
  const def = defOf(key);
  const v = value.trim();
  const err = v ? def.validate(v) : "must not be empty";
  if (err) throw new InvalidSettingError(`${key} ${err}`);
  const stored = def.secret ? encryptSecret(secret, v) : v;
  const now = new Date();
  db.insert(setting)
    .values({ key, value: stored, updatedAt: now, updatedBy: actorId })
    .onConflictDoUpdate({ target: setting.key, set: { value: stored, updatedAt: now, updatedBy: actorId } })
    .run();
}
