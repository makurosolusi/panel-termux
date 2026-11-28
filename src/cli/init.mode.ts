// Which init mode a phone is in (PLAN/07 §4 mode table, K7, K20, K21, C20, C27). Read-only: stats, hashes, a
// read-only panel.db open and /api/health; the installed binary is never executed (binaries < 0.5.0 ignore argv).
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { ENV_VARS, type EnvVar, type EnvVarName } from "../shared/env.schema";
import { type CliHost, probePaths } from "./cli.host";
import { readEnvFile } from "./env.file";
import { isUnfinished } from "./init.lock";
import type { InstalledVersion, ModeDecision } from "./init.types";

/** Version of this binary (package.json, embedded at build). */
export const SELF_VERSION: string = pkg.version;

/**
 * Release tag embedded at build (`scripts/build.ts` define, C24); "" for a local build, `bun test` and dev. Never read
 * from process.env at run time, so a `.env` in the cwd cannot change what the self check trusts.
 */
export const releaseTag = (): string => (typeof __PANEL_RELEASE_TAG__ === "string" ? __PANEL_RELEASE_TAG__ : "");

const envDefault = (name: EnvVarName) => (ENV_VARS as readonly EnvVar[]).find((v) => v.name === name)?.default ?? "";

/** Lowercase hex SHA-256 of a file, streamed (the binary is ~100 MB). Read errors throw with the path. */
export async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  try {
    for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  } catch (e) {
    throw new Error(`hash ${path} failed: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`, { cause: e });
  }
  return hasher.digest("hex");
}

/** Same bytes: sizes first (cheap), then SHA-256 of both. */
async function sameFile(a: string, b: string): Promise<boolean> {
  if (statSync(a).size !== statSync(b).size) return false;
  const [ha, hb] = await Promise.all([sha256File(a), sha256File(b)]);
  return ha === hb;
}

/** User-data paths of C20 that exist; the binary, the `panel` service and the lock do not count. */
export function userDataPaths(host: CliHost): string[] {
  const p = probePaths(host.paths);
  const env = readEnvFile(p.envFile) ?? {};
  const dataDir = resolve(host.paths.panelDir, env.PANEL_DATA_DIR || envDefault("PANEL_DATA_DIR"));
  return [
    p.pgVersion,
    p.cloudflaredDir,
    join(host.paths.home, ".pm2"),
    join(host.paths.home, "sites"),
    join(dataDir, "panel.db"),
  ].filter((f) => existsSync(f));
}

/** app_meta.panel_version read-only (K12); null when absent or unreadable. Lab L6: a -wal without -shm is skipped. */
export function dbPanelVersion(db: string): string | null {
  if (!existsSync(db) || (existsSync(`${db}-wal`) && !existsSync(`${db}-shm`))) return null;
  let conn: Database | undefined;
  try {
    conn = new Database(db, { readonly: true });
    const row = conn.query("SELECT value FROM app_meta WHERE key = 'panel_version'").get() as { value: string } | null;
    return row?.value ?? null;
  } catch {
    return null; // no app_meta (0.2.x) or a locked/corrupt file: "unknown" is the K20 answer, init plans an upgrade
  } finally {
    conn?.close();
  }
}

/** Installed version (K20): /api/health of the running panel → app_meta in panel.db → unknown. */
export async function installedVersion(host: CliHost): Promise<InstalledVersion> {
  const env = readEnvFile(probePaths(host.paths).envFile) ?? {};
  const health = await host.health(Number(env.PORT || envDefault("PORT")));
  if (health?.version) return { version: health.version, source: "health" };
  const dataDir = resolve(host.paths.panelDir, env.PANEL_DATA_DIR || envDefault("PANEL_DATA_DIR"));
  const v = dbPanelVersion(join(dataDir, "panel.db"));
  return v ? { version: v, source: "db" } : { version: null, source: null };
}

/** K21: runit's panel pid (supervise/pid) runs a file other than ~/panel/panel (dev+ino differ). */
export function staleProcess(host: CliHost): boolean {
  const pidFile = join(host.paths.svdir, "panel", "supervise", "pid");
  const binary = probePaths(host.paths).binary;
  if (!existsSync(pidFile) || !existsSync(binary)) return false;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const exe = host.proc.exeId(pid);
  if (!exe) return false;
  const file = statSync(binary);
  return exe.dev !== file.dev || exe.ino !== file.ino;
}

/**
 * Mode of this phone for this binary: no user data, or a fresh install that did not finish → fresh; no ~/panel/panel →
 * repair; same bytes → repair, or upgrade when runit still runs another file; else by version: newer, same (other
 * build) or unknown → upgrade, older → downgrade (init exits 3).
 */
export async function detectMode(host: CliHost): Promise<ModeDecision> {
  const binary = probePaths(host.paths).binary;
  const userData = userDataPaths(host);
  const binaryInstalled = existsSync(binary);
  const sameBinary = binaryInstalled && (await sameFile(binary, host.selfPath));
  const stale = staleProcess(host);
  const installed = binaryInstalled ? await installedVersion(host) : { version: null, source: null };
  const base = { userData, installed, binaryInstalled, sameBinary, staleProcess: stale };
  if (userData.length === 0 || isUnfinished(host)) return { ...base, mode: "fresh" }; // unfinished: a resumed fresh install
  if (!binaryInstalled) return { ...base, mode: "repair" };
  if (sameBinary) return { ...base, mode: stale ? "upgrade" : "repair" };
  if (installed.version === null) return { ...base, mode: "upgrade" };
  return { ...base, mode: Bun.semver.order(SELF_VERSION, installed.version) < 0 ? "downgrade" : "upgrade" };
}
