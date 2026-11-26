import { eq } from "drizzle-orm";
import { type DevSetting, SETTING_KEYS, type SettingKey } from "../shared/dev.types";
import { recordAudit } from "./audit.service";
import { decryptSecret, encryptSecret } from "./crypto.service";
import type { Db } from "./db/client";
import { setting } from "./db/schema";
import { SETTINGS, type SettingDef } from "./settings.registry";

export type { SettingKey } from "../shared/dev.types";
export { SETTINGS } from "./settings.registry";

/** What settings functions need: the DB and the data secret (for encrypting secret values). */
export type SettingsDeps = { db: Db; secret: string };

/** Upper bound of keys in one setSettings / PATCH batch. */
export const MAX_SETTINGS_BATCH = 30;

/** Why one key of a batch was rejected (PLAN/05 K2: one message per key, the text lives in the web). */
export type SettingFieldError = "invalid" | "empty" | "unknown";

/** Whether `k` is a registered setting key. */
export const isSettingKey = (k: string): k is SettingKey => Object.hasOwn(SETTINGS, k);

/** Thrown by setSettings when any value is rejected; `fields` names every rejected key. Nothing was written. */
export class InvalidSettingError extends Error {
  constructor(
    message: string,
    readonly fields: Partial<Record<string, SettingFieldError>>,
  ) {
    super(message);
  }
}

/** A stored secret cannot be decrypted with the current data key (PLAN/04 K8); maps to 409 `key_mismatch`. */
export class KeyMismatchError extends Error {}

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
      throw new KeyMismatchError(`getSetting ${key}: ${(e as Error).message}`, { cause: e });
    }
  }
  return value !== null && def.resolve ? def.resolve(value) : value;
}

/** Secret settings whose stored row does not decrypt with the current data key (empty = key ok). */
export function unreadableSecretSettings({ db, secret }: SettingsDeps): SettingKey[] {
  return SETTING_KEYS.filter((key) => {
    if (!defOf(key).secret) return false;
    const row = rowOf(db, key);
    if (!row) return false;
    try {
      decryptSecret(secret, row.value);
      return false;
    } catch {
      return true; // a failed decrypt is the answer here, not an error to propagate
    }
  });
}

/**
 * Public view of one setting; secret values are never included. `readable` comes from the caller (listSettings
 * computes it once per request). Labels live only in the web (B8).
 */
export function describeSetting(db: Db, key: SettingKey, readable = true): DevSetting {
  const def = defOf(key);
  const row = rowOf(db, key);
  return {
    key,
    secret: def.secret,
    value: def.secret ? null : (row?.value ?? def.default),
    default: def.default,
    isSet: row !== undefined,
    readable,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

/** All settings in SETTING_KEYS order, with `readable` from a try-decrypt of every secret row. */
export function listSettings(deps: SettingsDeps): DevSetting[] {
  const unreadable = new Set(unreadableSecretSettings(deps));
  return SETTING_KEYS.map((k) => describeSetting(deps.db, k, !unreadable.has(k)));
}

/** Value as it would be stored: trimmed, or null for "back to default / delete". */
const normalize = (v: string | null) => (v === null ? null : v.trim());

/**
 * Keys of `values` whose stored value would change. Secret keys always count as changed (their value is never
 * compared). Callers use it for audit and for the fresh-session check of sensitive keys.
 */
export function changedSettingKeys(db: Db, values: Partial<Record<SettingKey, string | null>>): SettingKey[] {
  return (Object.keys(values) as SettingKey[]).filter((key) => {
    if (defOf(key).secret) return true;
    return (rowOf(db, key)?.value ?? null) !== normalize(values[key] ?? null);
  });
}

function validateBatch(values: Partial<Record<SettingKey, string | null>>): void {
  const fields: Partial<Record<string, SettingFieldError>> = {};
  const messages: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (!isSettingKey(key)) {
      fields[key] = "unknown";
      messages.push(`${key} is not a setting`);
      continue;
    }
    const v = normalize(raw ?? null);
    if (v === null) continue;
    const err = v ? defOf(key).validate(v) : "must not be empty";
    if (err) {
      fields[key] = v ? "invalid" : "empty";
      messages.push(`${key} ${err}`);
    }
  }
  if (messages.length) throw new InvalidSettingError(messages.join("; "), fields);
}

/**
 * Atomically stores a batch (PLAN/05 K3): every value is trimmed and validated first, then all rows are written
 * (secrets encrypted; null deletes the row = back to default) together with one `settings.update` audit per
 * changed key (key + `{reset}` only, never the value). Throws InvalidSettingError (nothing written) or
 * KeyMismatchError when the batch touches a secret key while any stored secret is unreadable (PLAN/04 K8).
 * Returns the changed keys.
 */
export function setSettings(
  deps: SettingsDeps,
  values: Partial<Record<SettingKey, string | null>>,
  actorId: string,
): SettingKey[] {
  const { db, secret } = deps;
  const keys = Object.keys(values) as SettingKey[];
  if (keys.length === 0 || keys.length > MAX_SETTINGS_BATCH)
    throw new InvalidSettingError(`a batch holds 1-${MAX_SETTINGS_BATCH} keys, got ${keys.length}`, {});
  validateBatch(values);
  if (keys.some((k) => defOf(k).secret)) {
    const unreadable = unreadableSecretSettings(deps);
    if (unreadable.length)
      throw new KeyMismatchError(`cannot save secret settings: ${unreadable.join(", ")} unreadable with the data key`);
  }
  const changed = changedSettingKeys(db, values);
  const now = new Date();
  db.transaction((tx) => {
    for (const key of keys) {
      const v = normalize(values[key] ?? null);
      if (v === null) {
        tx.delete(setting).where(eq(setting.key, key)).run();
        continue;
      }
      const stored = defOf(key).secret ? encryptSecret(secret, v) : v;
      tx.insert(setting)
        .values({ key, value: stored, updatedAt: now, updatedBy: actorId })
        .onConflictDoUpdate({ target: setting.key, set: { value: stored, updatedAt: now, updatedBy: actorId } })
        .run();
    }
    // Same bun:sqlite connection as `tx`, so these inserts commit or roll back with the writes above.
    for (const key of changed) {
      const reset = values[key] === null;
      recordAudit(db, { actorId, action: "settings.update", target: key, meta: { reset } });
    }
  });
  return changed;
}

/** Single-key wrapper over setSettings (kept for server callers and tests). */
export function setSetting(deps: SettingsDeps, key: SettingKey, value: string | null, actorId: string): void {
  setSettings(deps, { [key]: value }, actorId);
}
