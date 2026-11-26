import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SECRET_FILE = "secret";
const SECRET_BYTES = 32;

/** Ensures `dataDir` exists with mode 700 (created if missing, tightened if present). */
export function ensureDataDir(dataDir: string): void {
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    chmodSync(dataDir, 0o700);
  } catch (e) {
    throw new Error(`ensureDataDir ${dataDir} failed: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * Returns the data key (hex) from `<dataDir>/secret`; `created` = the file was missing and a new key was written
 * (mode 600). An existing but unusable file is an error, never overwritten: replacing it would silently orphan
 * every encrypted setting (PLAN/04 K8). A lost file yields a new key and mismatch mode, reported by data-key.service.
 */
export function loadOrCreateSecret(dataDir: string): { secret: string; created: boolean } {
  ensureDataDir(dataDir);
  const file = join(dataDir, SECRET_FILE);
  try {
    if (existsSync(file)) {
      const secret = readFileSync(file, "utf8").trim();
      if (secret.length < SECRET_BYTES * 2) throw new Error("existing secret file is too short");
      return { secret, created: false };
    }
    const secret = randomBytes(SECRET_BYTES).toString("hex");
    // flag "wx" fails if another process created it in between, instead of overwriting it.
    writeFileSync(file, secret, { mode: 0o600, flag: "wx" });
    return { secret, created: true };
  } catch (e) {
    throw new Error(`loadOrCreateSecret ${file} failed: ${(e as Error).message}`, { cause: e });
  }
}
