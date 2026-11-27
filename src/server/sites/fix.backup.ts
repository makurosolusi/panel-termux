// Local backups of files changed by integration fixes (PLAN/06 F6, DECISIONS C5): <dataDir>/fix-backups/<file>/
// <yyyymmdd-HHMMSSmmm>-<sha8 of the result>.bak (0.4.0 betas wrote HHMMSS, still read), folder 700, file 600, 10 newest per file, never uploaded.
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { FixFile } from "../../shared/fix.types";
import { writeAtomic } from "./site.files";

/** Backups kept per file. */
export const FIX_BACKUP_KEEP = 10;
const ROOT = "fix-backups";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const FILES: readonly FixFile[] = ["ecosystem", "pm2_run"];
// Milliseconds so two fixes in one second (Perbaiki semua) still order; second-only names are older backups.
const ID = /^(ecosystem|pm2_run)\.(\d{8}-(?:\d{9}|\d{6}))-([0-9a-f]{8})$/;
const NAME = /^(\d{8})-(\d{9}|\d{6})-([0-9a-f]{8})\.bak$/;

/** One backup on disk; `id` = `<file>.<stamp>-<sha8>`, `sha8` = first 8 hex of the sha256 the fix produced. */
export type FixBackupEntry = { id: string; file: FixFile; path: string; at: string; sha8: string };

const dirOf = (dataDir: string, file: FixFile) => join(dataDir, ROOT, file);
/** `2026-11-27T10:00:05.123Z` → `20261127-100005123`. */
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:.Z]/g, "")
    .replace("T", "-");

const newestFirst = (a: FixBackupEntry, b: FixBackupEntry) =>
  a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

function entry(dataDir: string, file: FixFile, name: string): FixBackupEntry | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [, day, time, sha8] = m as unknown as [string, string, string, string];
  const at = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.${time.slice(6) || "000"}Z`;
  return { id: `${file}.${day}-${time}-${sha8}`, file, path: join(dirOf(dataDir, file), name), at, sha8 };
}

function ensureDir(dataDir: string, file: FixFile): string {
  const dir = dirOf(dataDir, file);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  chmodSync(join(dataDir, ROOT), DIR_MODE); // mkdir's mode is masked by umask
  chmodSync(dir, DIR_MODE);
  return dir;
}

/** Backups of `file`, newest first; [] when none. */
export function listFixBackups(dataDir: string, file: FixFile): FixBackupEntry[] {
  const dir = dirOf(dataDir, file);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => entry(dataDir, file, n))
    .filter((e): e is FixBackupEntry => e !== null)
    .sort(newestFirst);
}

/** Newest backup of each fixed file that has one, newest first. */
export function latestFixBackups(dataDir: string): FixBackupEntry[] {
  return FILES.flatMap((f) => listFixBackups(dataDir, f).slice(0, 1)).sort(newestFirst);
}

/** Stores `bytes` (the file before the fix) durably, then keeps only the 10 newest of that file. */
export function saveFixBackup(
  dataDir: string,
  file: FixFile,
  bytes: Uint8Array,
  resultSha: string,
  now = new Date(),
): FixBackupEntry {
  const sha8 = resultSha.slice(0, 8);
  if (!/^[0-9a-f]{8}$/.test(sha8))
    throw new Error(`fix backup ${file}: result sha must be hex, got ${sha8.length} chars`);
  ensureDir(dataDir, file);
  const e = entry(dataDir, file, `${stamp(now)}-${sha8}.bak`) as FixBackupEntry;
  writeAtomic(e.path, bytes, { mode: FILE_MODE }); // fsyncs file and folder
  for (const old of listFixBackups(dataDir, file).slice(FIX_BACKUP_KEEP)) rmSync(old.path, { force: true });
  return e;
}

/** Backup for an id from a request, or null when the id is malformed, escapes its folder, or does not exist. */
export function resolveFixBackup(dataDir: string, id: string): FixBackupEntry | null {
  const m = ID.exec(id);
  if (!m) return null;
  const file = m[1] as FixFile;
  const dir = resolve(dirOf(dataDir, file));
  const e = entry(dataDir, file, `${m[2]}-${m[3]}.bak`);
  if (!e || !resolve(e.path).startsWith(dir + sep) || !existsSync(e.path)) return null;
  return e;
}

/** Maps a write failure to its fix error code (PLAN/06 §3.4, debat C19); null = not an expected I/O failure. */
export function fixIoError(e: unknown): "disk_full" | "not_writable" | null {
  for (let cur = e; cur instanceof Error; cur = cur.cause) {
    const code = (cur as NodeJS.ErrnoException).code;
    if (code === "ENOSPC") return "disk_full";
    if (code === "EACCES" || code === "EPERM") return "not_writable";
  }
  return null;
}
