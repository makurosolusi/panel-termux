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

/** Returns the instance secret (hex), generating `<dataDir>/secret` (mode 600) on first call. */
export function loadOrCreateSecret(dataDir: string): string {
  ensureDataDir(dataDir);
  const file = join(dataDir, SECRET_FILE);
  try {
    if (existsSync(file)) {
      const s = readFileSync(file, "utf8").trim();
      if (s.length < SECRET_BYTES * 2) throw new Error("existing secret file is too short");
      return s;
    }
    const s = randomBytes(SECRET_BYTES).toString("hex");
    // flag "wx" fails if another process created it in between, instead of overwriting it.
    writeFileSync(file, s, { mode: 0o600, flag: "wx" });
    return s;
  } catch (e) {
    throw new Error(`loadOrCreateSecret ${file} failed: ${(e as Error).message}`, { cause: e });
  }
}
