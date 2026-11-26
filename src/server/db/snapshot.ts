import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { log } from "../log.service";
import type { Db } from "./client";
import { embeddedMigrations } from "./migrate";

// Pre-migration snapshot at boot (PLAN/04 K9, DECISIONS B10): nobody uses the DB yet, so the copy is consistent.

/** How many pre-migration snapshots are kept in `<dataDir>/snapshots`. */
export const SNAPSHOT_KEEP = 3;

const SNAPSHOT_DIR = "snapshots";
const PREFIX = "panel.db.";
const TS = /\.(\d{14})$/;
/** How long a failed boot waits before exiting, so runit does not crash-loop. */
const FAIL_SLEEP_MS = 60_000;

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Applied migration count, or null when `__drizzle_migrations` does not exist (fresh install). */
function appliedMigrations(db: Db): number | null {
  const table = db.$client
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return null;
  return (db.$client.query("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
}

/** Deletes all but the newest SNAPSHOT_KEEP snapshots (by the timestamp in the name, not by version). */
function prune(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && TS.test(f))
    .sort((a, b) => (TS.exec(b)?.[1] ?? "").localeCompare(TS.exec(a)?.[1] ?? ""));
  for (const f of files.slice(SNAPSHOT_KEEP)) rmSync(join(dir, f), { force: true });
}

/**
 * When embedded migrations are pending on an existing DB, writes `VACUUM INTO
 * <dataDir>/snapshots/panel.db.<prevVersion|unknown>.<yyyymmddHHMMSS>` (mode 600), keeps the newest 3 and returns
 * the path; null when nothing is pending (or fresh install). On failure the partial file is removed and it throws.
 */
export async function snapshotBeforeMigrations(
  db: Db,
  dataDir: string,
  prevVersion: string | null,
  now: Date = new Date(),
): Promise<string | null> {
  const applied = appliedMigrations(db);
  if (applied === null || applied >= embeddedMigrations().length) return null;
  const dir = join(dataDir, SNAPSHOT_DIR);
  const file = join(dir, `${PREFIX}${prevVersion ?? "unknown"}.${stamp(now)}`);
  // Never delete a file this call did not write (same-second reboot): fail before VACUUM instead.
  if (existsSync(file)) throw new Error(`snapshotBeforeMigrations: ${file} already exists`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    db.$client.run("VACUUM INTO ?", [file]);
    chmodSync(file, 0o600);
    prune(dir);
    return file;
  } catch (e) {
    if (existsSync(file)) rmSync(file, { force: true });
    throw new Error(`snapshotBeforeMigrations to ${file} failed: ${(e as Error).message}`, { cause: e });
  }
}

/** Side effects of snapshotOnBoot, injectable for tests. */
export type SnapshotBootOpts = {
  skip?: boolean;
  now?: Date;
  sleep?: (ms: number) => Promise<unknown>;
  exit?: (code: number) => never;
};

/**
 * Boot step before runMigrations: snapshot, or on failure log, wait 60 s and exit(1) — unless `skip`
 * (`PANEL_SKIP_SNAPSHOT=1`), which only logs. Returns the snapshot path (or null).
 */
export async function snapshotOnBoot(
  db: Db,
  dataDir: string,
  prevVersion: string | null,
  {
    skip = process.env.PANEL_SKIP_SNAPSHOT === "1",
    now,
    sleep = Bun.sleep,
    exit = (code) => process.exit(code),
  }: SnapshotBootOpts = {},
): Promise<string | null> {
  try {
    const file = await snapshotBeforeMigrations(db, dataDir, prevVersion, now);
    if (file) log.info(`[db] pre-migration snapshot ${file}`);
    return file;
  } catch (e) {
    if (skip) {
      log.warn(`[db] ${(e as Error).message}; continuing without a snapshot (PANEL_SKIP_SNAPSHOT=1)`);
      return null;
    }
    log.error(
      `[db] ${(e as Error).message}. Migrations were not run. Free up space, or start once with PANEL_SKIP_SNAPSHOT=1 ` +
        "to migrate without a snapshot. Exiting in 60 s.",
    );
    await sleep(FAIL_SLEEP_MS);
    return exit(1);
  }
}
