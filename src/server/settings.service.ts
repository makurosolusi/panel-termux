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
