// `.env` value codec matching Bun 1.4.2's loader (DECISIONS B23, PLAN/03 D21; verified against real `bun`, see
// tests/env.codec.test.ts). Bun rules: `$NAME`/`${NAME}` expand in every quote style and unquoted; a backslash right
// before `$` makes it literal and is dropped; any other backslash stays. Inside "…" only `\n` becomes a newline
// (`\"` stays as two characters). A backslash also hides the next character from the closing-quote search, so a
// value ending in `\` cannot be quoted. Unquoted values end at the first `#` and are trimmed.

/** Longest value the panel writes (characters). */
export const ENV_VALUE_MAX = 16_384;

/** Why a value cannot be written as one `.env` line that Bun reads back unchanged. */
export type EnvValueProblem = "multiline" | "quote" | "too_long";

/** Values written bare (no quoting, nothing Bun would interpret). */
const PLAIN_VALUE = /^[A-Za-z0-9_./:@%+,=-]*$/;
const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const QUOTES = new Set(["'", '"', "`"]);

/** Index of the closing `quote` after position 0, skipping backslash-escaped characters; -1 when unterminated. */
function closingQuote(s: string, quote: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === quote) return i;
  }
  return -1;
}

/** Inside double quotes: `\n` → newline; any other backslash pair is kept as is. */
function unescapeDoubleQuoted(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      out += s[i + 1] === "n" ? "\n" : `\\${s[i + 1]}`;
      i++;
    } else out += s[i];
  }
  return out;
}

/**
 * The value Bun loads for the raw text after `KEY=` on one line, except that `$NAME` is kept literally (the panel
 * cannot know the app's environment; callers flag it). Text after a closing quote is ignored like Bun does.
 */
export function decodeEnvValue(raw: string): string {
  const s = raw.trimStart();
  const quote = s[0] ?? "";
  const end = QUOTES.has(quote) ? closingQuote(s, quote) : -1;
  let body: string;
  if (end > 0) {
    body = s.slice(1, end);
    if (quote === '"') body = unescapeDoubleQuoted(body);
  } else {
    const hash = s.indexOf("#");
    body = (hash >= 0 ? s.slice(0, hash) : s).trimEnd();
  }
  return body.replaceAll("\\$", "$");
}

/** Whether Bun would expand a variable in this raw value (`$` + name or `{`, not preceded by a backslash). */
export const expandsVariable = (raw: string): boolean => /(?:^|[^\\])\$[A-Za-z0-9_{]/.test(raw);

/** Why `value` cannot be encoded, or null when `encodeEnvLine` can write it. */
export function envValueProblem(value: string): EnvValueProblem | null {
  if (value.length > ENV_VALUE_MAX) return "too_long";
  if (/[\r\n]/.test(value)) return "multiline";
  if (value.endsWith("\\")) return "quote";
  if (value.includes("'") && /["\\]/.test(value)) return "quote";
  return null;
}

/**
 * One `KEY=value` line Bun reads back as exactly `value`: bare when plain, else single quotes, or double quotes when
 * the value holds `'` (then it has no `"` or `\`). `$` is always written as `\$`. Throws when envValueProblem says so.
 */
export function encodeEnvLine(key: string, value: string): string {
  const problem = envValueProblem(value);
  if (problem) throw new Error(`encodeEnvLine ${key}: value is not representable in .env (${problem})`);
  if (PLAIN_VALUE.test(value)) return `${key}=${value}`;
  const escaped = value.replaceAll("$", "\\$");
  return value.includes("'") ? `${key}="${escaped}"` : `${key}='${escaped}'`;
}

/** Raw text after `=` of the last line defining `key` (Bun: last one wins), `export ` allowed; null when absent. */
export function findEnvLine(text: string, key: string): string | null {
  let found: string | null = null;
  for (const line of text.split("\n")) {
    const m = KEY_LINE.exec(line.replace(/\r$/, ""));
    if (m?.[1] === key) found = m[2] ?? "";
  }
  return found;
}
