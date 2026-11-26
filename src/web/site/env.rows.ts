import { type EnvValueProblem, envValueProblem } from "@/shared/env.codec";
import { ENV_KEY_RE, type SiteDetail } from "@/shared/site.types";

/** Keys the panel writes itself for a managed site with a database (the wizard's fixed locked set). */
export const RESERVED_ENV_KEYS: readonly string[] = ["PORT", "DATABASE_URL"];

/** One editable key/value row; `id` keeps React keys stable while rows are added/removed. */
export type EnvRow = { id: number; key: string; value: string };

/** Why a row is rejected: a key problem first, else why its value cannot be written to `.env`; null when fine. */
export type EnvKeyError = "invalid" | "reserved" | "duplicate" | "empty" | EnvValueProblem | null;

let nextRowId = 1;
/** New row with a unique id. */
export const newEnvRow = (key = "", value = ""): EnvRow => ({ id: nextRowId++, key, value });

/** A row left fully blank is ignored (not an error, not sent). */
const isBlank = (r: EnvRow): boolean => r.key.trim() === "" && r.value === "";

/**
 * Per-row errors, same order as `rows`. `existing` = keys already in the site's .env that these rows would duplicate
 * (the detail editor replaces those through their own inputs instead); `locked` = keys the panel owns.
 */
export function envRowErrors(
  rows: readonly EnvRow[],
  existing: readonly string[] = [],
  locked: readonly string[] = RESERVED_ENV_KEYS,
): EnvKeyError[] {
  const seen = new Map<string, number>();
  for (const r of rows) if (!isBlank(r)) seen.set(r.key.trim(), (seen.get(r.key.trim()) ?? 0) + 1);
  return rows.map((r) => {
    if (isBlank(r)) return null;
    const key = r.key.trim();
    if (key === "") return "empty";
    if (!ENV_KEY_RE.test(key)) return "invalid";
    if (locked.includes(key)) return "reserved";
    if ((seen.get(key) ?? 0) > 1 || existing.includes(key)) return "duplicate";
    return envValueProblem(r.value);
  });
}

/** Whether every row is valid (blank rows allowed). */
export const envRowsValid = (rows: readonly EnvRow[], existing?: readonly string[], locked?: readonly string[]) =>
  envRowErrors(rows, existing, locked).every((e) => e === null);

/** Non-blank rows as a `{ KEY: value }` record (keys trimmed). */
export function envRecord(rows: readonly EnvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (!isBlank(r)) out[r.key.trim()] = r.value;
  return out;
}

/** Body of `PUT /sites/:name/env` (without `restart`): replaced values (non-empty only) + new rows, and keys to drop. */
export function envUpdateBody(
  replaced: Readonly<Record<string, string>>,
  unset: ReadonlySet<string>,
  newRows: readonly EnvRow[],
): { set: Record<string, string>; unset: string[] } {
  const set: Record<string, string> = {};
  for (const [k, v] of Object.entries(replaced)) if (v !== "" && !unset.has(k)) set[k] = v;
  return { set: { ...set, ...envRecord(newRows) }, unset: [...unset].sort() };
}

/** Whether an env update would change anything. */
export const envUpdateEmpty = (body: { set: Record<string, string>; unset: string[] }): boolean =>
  Object.keys(body.set).length === 0 && body.unset.length === 0;

/** Unsaved edits of the detail editor: new values for existing keys, keys to drop, and new rows. */
export type EnvDraft = { replaced: Record<string, string>; unset: ReadonlySet<string>; rows: EnvRow[] };

/** Draft with no edits. */
export const emptyEnvDraft = (): EnvDraft => ({ replaced: {}, unset: new Set(), rows: [] });

/** Keys the panel owns for this site; falls back to PORT (+ DATABASE_URL) for managed sites on 0.2.x servers. */
export function lockedKeysOf(site: Pick<SiteDetail, "lockedEnvKeys" | "managed" | "database">): string[] {
  if (site.lockedEnvKeys) return site.lockedEnvKeys;
  if (!site.managed) return [];
  return site.database ? ["PORT", "DATABASE_URL"] : ["PORT"];
}

/** Badge shown next to an existing key. */
export type EnvKeyBadge = "locked" | "pm2" | "replace" | "unset";

/** Badges of an existing key: who owns it, then what the draft will do to it. */
export function envKeyBadges(
  key: string,
  draft: EnvDraft,
  locked: readonly string[],
  pm2: readonly string[],
): EnvKeyBadge[] {
  const out: EnvKeyBadge[] = [];
  if (locked.includes(key)) out.push("locked");
  if (pm2.includes(key)) out.push("pm2");
  if (draft.unset.has(key)) out.push("unset");
  else if ((draft.replaced[key] ?? "") !== "") out.push("replace");
  return out;
}

/** Value problems of replaced existing keys (only keys with a problem appear). */
export function replacedErrors(draft: EnvDraft): Record<string, EnvValueProblem> {
  const out: Record<string, EnvValueProblem> = {};
  for (const [k, v] of Object.entries(draft.replaced)) {
    const p = v === "" || draft.unset.has(k) ? null : envValueProblem(v);
    if (p) out[k] = p;
  }
  return out;
}

/** The draft can be saved: it changes something and nothing in it is invalid. */
export function envDraftSavable(draft: EnvDraft, existing: readonly string[], locked: readonly string[]): boolean {
  const body = envUpdateBody(draft.replaced, draft.unset, draft.rows);
  return (
    !envUpdateEmpty(body) &&
    envRowsValid(draft.rows, existing, locked) &&
    Object.keys(replacedErrors(draft)).length === 0
  );
}

/** Footer counts: values replaced, keys added, keys removed. */
export function envDraftCounts(draft: EnvDraft): { replaced: number; added: number; unset: number } {
  const body = envUpdateBody(draft.replaced, draft.unset, []);
  return {
    replaced: Object.keys(body.set).length,
    added: Object.keys(envRecord(draft.rows)).length,
    unset: body.unset.length,
  };
}

/** Toggles "akan dihapus" for an existing key (dropping its pending replacement). */
export function toggleUnset(draft: EnvDraft, key: string): EnvDraft {
  const unset = new Set(draft.unset);
  const replaced = { ...draft.replaced };
  if (unset.has(key)) unset.delete(key);
  else {
    unset.add(key);
    delete replaced[key];
  }
  return { ...draft, unset, replaced };
}
