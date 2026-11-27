// Explicit read of ~/panel/.env (PLAN/07 K11a): the CLI never trusts process.env for panel variables (it is scrubbed,
// K11b, and Bun loaded .env from the cwd, not from ~/panel). Values are returned to the caller, never logged.
import { readFileSync } from "node:fs";
import { decodeEnvValue, findEnvLine } from "../shared/env.codec";
import { ENV_VARS, type EnvVarName } from "../shared/env.schema";

/** Decoded value of each ENV_VARS key the file defines (last line wins, like Bun); absent keys are left out. */
export type EnvFileValues = Partial<Record<EnvVarName, string>>;

/** Values of `file` by ENV_VARS key, or null when the file does not exist. Other read errors throw with the path. */
export function readEnvFile(file: string): EnvFileValues | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`read ${file} failed: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`, { cause: e });
  }
  const values: EnvFileValues = {};
  for (const { name } of ENV_VARS) {
    const raw = findEnvLine(text, name);
    if (raw !== null) values[name] = decodeEnvValue(raw);
  }
  return values;
}
