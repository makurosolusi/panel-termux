import { log } from "./log.service";

/** Validated runtime configuration. Values are never printed; errors name the variable only. */
export type Env = {
  APP_BASE_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SUPER_ADMIN_EMAILS: string[];
  PORT: number;
  PANEL_DATA_DIR: string;
};

const DEFAULT_PORT = 3200;
const DEFAULT_DATA_DIR = "./data";
/** Loose email shape check for SUPER_ADMIN_EMAILS entries. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Thrown when an env var is missing or invalid; message names the variable, never its value. */
export class EnvError extends Error {}

const required = (src: Record<string, string | undefined>, name: string): string => {
  const v = src[name]?.trim();
  if (!v) throw new EnvError(`env ${name} is required but missing or empty`);
  return v;
};

/** Parses and validates env from `src` (defaults to process.env). Throws EnvError on invalid input. */
export function parseEnv(src: Record<string, string | undefined> = process.env): Env {
  const APP_BASE_URL = required(src, "APP_BASE_URL");
  try {
    const u = new URL(APP_BASE_URL);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol must be http(s)");
  } catch (e) {
    throw new EnvError(`env APP_BASE_URL is not a valid http(s) URL (${(e as Error).message})`);
  }

  const emails = required(src, "SUPER_ADMIN_EMAILS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) throw new EnvError("env SUPER_ADMIN_EMAILS must contain at least one email");
  emails.forEach((e, i) => {
    if (!EMAIL_RE.test(e)) throw new EnvError(`env SUPER_ADMIN_EMAILS entry #${i + 1} is not a valid email`);
  });

  const portRaw = src.PORT?.trim();
  const PORT = portRaw ? Number(portRaw) : DEFAULT_PORT;
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new EnvError("env PORT must be an integer 1-65535");

  return {
    APP_BASE_URL,
    GOOGLE_CLIENT_ID: required(src, "GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: required(src, "GOOGLE_CLIENT_SECRET"),
    SUPER_ADMIN_EMAILS: emails,
    PORT,
    PANEL_DATA_DIR: src.PANEL_DATA_DIR?.trim() || DEFAULT_DATA_DIR,
  };
}

/** Like parseEnv but prints the error and exits(1) — for the process entrypoint. */
export function loadEnvOrExit(): Env {
  try {
    return parseEnv();
  } catch (e) {
    if (!(e instanceof EnvError)) throw e;
    log.error(`[panel] invalid configuration: ${e.message}`);
    process.exit(1);
  }
}
