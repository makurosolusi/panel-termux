/** Valid `.env` key: upper-case letters, digits and `_`, not starting with a digit. */
export const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Keys the panel writes itself; the user may not set or unset them. */
export const RESERVED_ENV_KEYS: readonly string[] = ["PORT", "DATABASE_URL"];

/** One editable key/value row; `id` keeps React keys stable while rows are added/removed. */
export type EnvRow = { id: number; key: string; value: string };

/** Why a row's key is rejected, or null when fine. */
export type EnvKeyError = "invalid" | "reserved" | "duplicate" | "empty" | null;

/** A row left fully blank is ignored (not an error, not sent). */
const isBlank = (r: EnvRow): boolean => r.key.trim() === "" && r.value === "";

/**
 * Per-row key errors, same order as `rows`. `existing` = keys already in the site's .env that these rows
 * would duplicate (the detail editor replaces those through their own inputs instead).
 */
export function envRowErrors(rows: readonly EnvRow[], existing: readonly string[] = []): EnvKeyError[] {
  const seen = new Map<string, number>();
  for (const r of rows) if (!isBlank(r)) seen.set(r.key.trim(), (seen.get(r.key.trim()) ?? 0) + 1);
  return rows.map((r) => {
    if (isBlank(r)) return null;
    const key = r.key.trim();
    if (key === "") return "empty";
    if (!ENV_KEY_RE.test(key)) return "invalid";
    if (RESERVED_ENV_KEYS.includes(key)) return "reserved";
    if ((seen.get(key) ?? 0) > 1 || existing.includes(key)) return "duplicate";
    return null;
  });
}

/** Whether every row is valid (blank rows allowed). */
export const envRowsValid = (rows: readonly EnvRow[], existing?: readonly string[]): boolean =>
  envRowErrors(rows, existing).every((e) => e === null);

/** Non-blank rows as a `{ KEY: value }` record (keys trimmed). */
export function envRecord(rows: readonly EnvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (!isBlank(r)) out[r.key.trim()] = r.value;
  return out;
}

/** Body of `PUT /sites/:name/env`: replaced values (non-empty only) + new rows, and keys to drop. */
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
