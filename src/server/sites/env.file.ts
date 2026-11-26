// .env helpers. Values are written but never read back out of the file (only keys are listed).

/** Allowed env key. */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const PLAIN_VALUE = /^[A-Za-z0-9_./:@%+,=-]*$/;
const MAX_VALUE_LEN = 16_384;
/** What envLine cannot encode for Bun's .env loader (verified against Bun 1.4.2, see tests/site.files.test.ts). */
const UNREPRESENTABLE = /['\r\n]|\\$/;

/** Thrown for an invalid key or value; the message names the key, never the value. */
export class EnvInputError extends Error {}

/** Checks a set of env entries (key shape, value type/length, no NUL). */
export function assertEnvEntries(env: Record<string, unknown>): asserts env is Record<string, string> {
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY_RE.test(k)) throw new EnvInputError(`invalid env key ${JSON.stringify(k)}`);
    if (typeof v !== "string" || v.length > MAX_VALUE_LEN || v.includes("\0")) {
      throw new EnvInputError(`env ${k}: value must be a string of at most ${MAX_VALUE_LEN} characters`);
    }
    if (UNREPRESENTABLE.test(v)) {
      throw new EnvInputError(`env ${k}: value must be one line without ' and must not end with a backslash`);
    }
  }
}

/**
 * One `KEY=value` line. Non-trivial values are single-quoted: Bun keeps backslashes literal there but still expands `$VAR`, so `$` is written as `\$`. Values must pass assertEnvEntries.
 */
export function envLine(key: string, value: string): string {
  if (PLAIN_VALUE.test(value)) return `${key}=${value}`;
  return `${key}='${value.replaceAll("$", "\\$")}'`;
}

/** Keys defined in a .env text, in file order, without duplicates. */
export const envKeys = (text: string): string[] => [
  ...new Set(text.split("\n").flatMap((l) => (l.match(KEY_LINE)?.[1] ? [l.match(KEY_LINE)?.[1] as string] : []))),
];

/**
 * Applies `set`/`unset` to .env text: every line defining a touched key is dropped (comments and other
 * keys stay), then set keys are appended. Multi-line quoted values in hand-written files are not supported.
 */
export function updateEnv(text: string, set: Record<string, string>, unset: string[]): string {
  const touched = new Set([...Object.keys(set), ...unset]);
  const kept = text.split("\n").filter((l) => !touched.has(l.match(KEY_LINE)?.[1] ?? ""));
  while (kept.length && kept.at(-1) === "") kept.pop();
  const added = Object.entries(set).map(([k, v]) => envLine(k, v));
  return `${[...kept, ...added].join("\n")}\n`.replace(/^\n/, "");
}
