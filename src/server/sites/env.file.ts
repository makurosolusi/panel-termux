// .env helpers on top of the shared Bun codec (B23). Values are written, and read back only for PORT and redaction.
import {
  decodeEnvValue,
  type EnvValueProblem,
  encodeEnvLine,
  envValueProblem,
  findEnvLine,
} from "../../shared/env.codec";
import { ENV_KEY_RE } from "../../shared/site.types";

export { ENV_KEY_RE };

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const MAX_PORT = 65535;

/** Why an env entry is refused (API `invalid_env.reason`). */
export type EnvInputReason = "key" | EnvValueProblem;

/** Thrown for an invalid key or value; names the key, never the value. */
export class EnvInputError extends Error {
  constructor(
    readonly key: string,
    readonly reason: EnvInputReason,
  ) {
    super(`env ${key}: ${reason === "key" ? "invalid key" : `value not representable (${reason})`}`);
  }
}

/** Checks a set of env entries (key shape, string value that encodeEnvLine can write, no NUL). */
export function assertEnvEntries(env: Record<string, unknown>): asserts env is Record<string, string> {
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY_RE.test(k)) throw new EnvInputError(k, "key");
    if (typeof v !== "string" || v.includes("\0")) throw new EnvInputError(k, "quote");
    const problem = envValueProblem(v);
    if (problem) throw new EnvInputError(k, problem);
  }
}

/** Keys defined in a .env text, in file order, without duplicates. */
export const envKeys = (text: string): string[] => [
  ...new Set(text.split("\n").flatMap((l) => l.match(KEY_LINE)?.[1] ?? [])),
];

/**
 * Applies `set`/`unset` to .env text: every line defining a touched key is dropped (comments and other
 * keys stay), then set keys are appended. Multi-line quoted values in hand-written files are not supported.
 */
export function updateEnv(text: string, set: Record<string, string>, unset: string[]): string {
  const touched = new Set([...Object.keys(set), ...unset]);
  const kept = text.split("\n").filter((l) => !touched.has(l.match(KEY_LINE)?.[1] ?? ""));
  while (kept.length && kept.at(-1) === "") kept.pop();
  const added = Object.entries(set).map(([k, v]) => encodeEnvLine(k, v));
  return `${[...kept, ...added].join("\n")}\n`.replace(/^\n/, "");
}

/** Text of a fresh .env with `vars` in order. */
export const envText = (vars: [string, string][]): string =>
  `${vars.map(([k, v]) => encodeEnvLine(k, v)).join("\n")}\n`;

/** PORT of a .env (decoded, integer 1-65535) or null. Reads only that line (D8). */
export function envPort(text: string): number | null {
  const raw = findEnvLine(text, "PORT");
  const p = raw === null ? Number.NaN : Number(decodeEnvValue(raw));
  return Number.isInteger(p) && p >= 1 && p <= MAX_PORT ? p : null;
}

/** Decoded values of every key except `skip` (for log redaction; never logged or returned by the API). */
export function envValues(text: string, skip: readonly string[] = []): string[] {
  return text.split("\n").flatMap((l) => {
    const m = KEY_LINE.exec(l.replace(/\r$/, ""));
    return m?.[1] && !skip.includes(m[1]) ? [decodeEnvValue(m[2] ?? "")] : [];
  });
}
